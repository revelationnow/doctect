import { WorkspaceStoreError, type IncrementalWorkspaceCommand, type PreferenceWorkspaceCommand,
  type ProjectMetadataCommand, type ReplacementWorkspaceCommand, type WorkspaceProject } from './contracts';
import { getRetainedQueueProject, readQueueReadmission, type IncrementalQueue, type QueueReadmissionEvidence,
  type QueueSubmissionReceipt, type RetainedQueueWork } from './incrementalQueue';
import { captureProjectInstallation, isProjectInstallationCurrent, type ProjectInstallationRegistry } from './projectInstallationRegistry';
import type { BulkDocumentAck, DocumentSaveAck, PreferenceSaveAck } from './normalized/schema';

export type ProjectWriteCommand = IncrementalWorkspaceCommand | PreferenceWorkspaceCommand | ProjectMetadataCommand | ReplacementWorkspaceCommand;
export interface ProjectWriteRoute {
  commit(command: ProjectWriteCommand): Promise<DocumentSaveAck | PreferenceSaveAck | BulkDocumentAck>;
  resolveAuthority(): WorkspaceProject | undefined;
  flushPending(): Promise<void>;
}
declare const writeOwnerBrand: unique symbol;
export interface ProjectWriteOwner { readonly [writeOwnerBrand]: true }
declare const retainedWritesBrand: unique symbol;
export interface RetainedProjectWrites { readonly [retainedWritesBrand]: true }
declare const verifiedRecoveryBrand: unique symbol;
export interface VerifiedProjectWriteRecovery { readonly [verifiedRecoveryBrand]: true }
export interface ProjectWriteCheckpoint {
  readonly source: object; readonly projectId: string; readonly incarnation: string | undefined; readonly revision: number | undefined;
  readonly localGeneration: number; readonly writeGeneration: number; readonly unrepresented: boolean;
  readonly obligations: readonly { readonly receipt: QueueSubmissionReceipt | undefined; readonly lane: 'document' | 'preferences'; readonly generation: number }[];
}
interface WriteOperations {
  retain(): RetainedProjectWrites;
  readmit(recovery: VerifiedProjectWriteRecovery): Promise<boolean>;
  cut(generation: number): Promise<boolean>;
}
interface Owner { source: object; projectId: string; operations: WriteOperations; latest?: RetainedProjectWrites;
  handoff?: { admitted: number; missing: boolean } }
interface Capture { owner: Owner; quiet: Promise<void>; read(): ProjectWriteCheckpoint; current(): boolean }
export interface ProjectWriteReadmission {
  readonly checkpoint: ProjectWriteCheckpoint; readonly queue: QueueReadmissionEvidence; readonly route: ProjectWriteRoute;
  assertCurrent(): void;
}
interface Verified { capture: Capture; retained: RetainedProjectWrites; value: ProjectWriteReadmission; targetQueue: IncrementalQueue }
export interface ProjectWriteAttachment {
  readonly readmission: ProjectWriteReadmission;
  readonly completion: Promise<boolean>;
  assertCurrent(): void;
  /** Callback-free hook lifetime, epoch and last resolved working-lineage fence. */
  assertLive(): void;
}
const owners = new WeakMap<ProjectWriteOwner, Owner>();
const captures = new WeakMap<RetainedProjectWrites, Capture>();
const recoveries = new WeakMap<VerifiedProjectWriteRecovery, Verified>();
const claimed = new WeakMap<ProjectWriteReadmission, Owner>();
const attachments = new WeakMap<ProjectWriteReadmission, { owner: Owner; assertCurrent(): void; assertLive(): void }>();
function refuse(condition: unknown): asserts condition {
  if (!condition) throw new WorkspaceStoreError('Project write recovery is not verified.', 'conflict');
}

/** Called only by the private save hook; no payload or public editing authority. */
export function createProjectWriteOwner(source: object, projectId: string, operations: WriteOperations): ProjectWriteOwner {
  const owner = Object.freeze({}) as ProjectWriteOwner;
  owners.set(owner, { source, projectId, operations: Object.freeze({ ...operations }) }); return owner;
}
export function assertProjectWriteOwner(owner: ProjectWriteOwner, source: object, projectId: string): void {
  const identity = owners.get(owner); refuse(identity && identity.source === source && identity.projectId === projectId);
}
export function retainRegisteredProjectWrites(owner: ProjectWriteOwner): RetainedProjectWrites {
  const identity = owners.get(owner); refuse(identity); return identity.operations.retain();
}
export function captureRegisteredProjectCut(owner: ProjectWriteOwner, generation: number): Promise<boolean> {
  const identity = owners.get(owner); refuse(identity); return identity.operations.cut(generation);
}
/** Only the hook reports its synchronous, actual queue-admission receipts. */
export function noteProjectWriteSubmission(owner: ProjectWriteOwner, receipt: QueueSubmissionReceipt | undefined): void {
  const identity = owners.get(owner); refuse(identity);
  if (identity.handoff) { if (receipt) identity.handoff.admitted++; else identity.handoff.missing = true; }
}
export function captureProjectWriteHandoff(owner: ProjectWriteOwner, submit: () => Promise<boolean>): { represented: boolean; completion: Promise<boolean> } {
  const identity = owners.get(owner); refuse(identity);
  const previous = identity.handoff, current = { admitted: 0, missing: false }; identity.handoff = current;
  let completion: Promise<boolean>;
  try { completion = Promise.resolve(submit()); } catch (error) { completion = Promise.reject(error); }
  finally { identity.handoff = previous; }
  return { represented: current.admitted > 0 && !current.missing, completion };
}
export async function readRetainedProjectWrites(owner: ProjectWriteOwner, retained: RetainedProjectWrites): Promise<ProjectWriteCheckpoint> {
  const capture = captures.get(retained), identity = owners.get(owner); refuse(capture && identity && capture.owner === identity);
  await capture.quiet; refuse(identity.latest === retained && capture.current()); return capture.read();
}
export function retainProjectWrites(owner: ProjectWriteOwner, quiet: Promise<void>, read: Capture['read'], current: Capture['current']): RetainedProjectWrites {
  const identity = owners.get(owner); refuse(identity);
  const handle = Object.freeze({}) as RetainedProjectWrites; captures.set(handle, { owner: identity, quiet, read, current }); identity.latest = handle;
  return handle;
}
export async function prepareProjectWriteRecovery(options: { retained: RetainedProjectWrites; checkpoint: RetainedQueueWork;
  queue: IncrementalQueue; installations: ProjectInstallationRegistry; route: ProjectWriteRoute }): Promise<VerifiedProjectWriteRecovery> {
  const capture = captures.get(options.retained); refuse(capture);
  await capture.quiet; refuse(capture.owner.latest === options.retained && capture.current());
  const checkpoint = capture.read();
  refuse(checkpoint.source === capture.owner.source && checkpoint.projectId === capture.owner.projectId && !checkpoint.unrepresented);
  const previous = getRetainedQueueProject(options.checkpoint, checkpoint.source, checkpoint.projectId); refuse(previous);
  const receipts = checkpoint.obligations.map(obligation => { refuse(obligation.receipt); return obligation.receipt; });
  const proof = await options.queue.prepareProjectReadmission(options.checkpoint, previous, receipts), evidence = readQueueReadmission(proof);
  refuse(evidence.authority.source === checkpoint.source && evidence.authority.binding.scope.projectId === checkpoint.projectId
    && evidence.authority.binding.scope.incarnation === checkpoint.incarnation && capture.current());
  for (let index = 0; index < checkpoint.obligations.length; index++) {
    const expected = checkpoint.obligations[index], actual = evidence.receipts[index];
    refuse(actual.receipt === expected.receipt && actual.lane === expected.lane && actual.generation === expected.generation);
  }
  const lease = captureProjectInstallation(options.installations, evidence.authority);
  const value: ProjectWriteReadmission = Object.freeze({ checkpoint, queue: evidence, route: Object.freeze({ ...options.route }), assertCurrent() {
    evidence.assertCurrent(); refuse(isProjectInstallationCurrent(lease));
  } });
  value.assertCurrent(); const handle = Object.freeze({}) as VerifiedProjectWriteRecovery;
  recoveries.set(handle, { capture, retained: options.retained, value, targetQueue: options.queue }); return handle;
}
export function inspectProjectWriteRecovery(owner: ProjectWriteOwner, recovery: VerifiedProjectWriteRecovery): ProjectWriteReadmission {
  const verified = recoveries.get(recovery), identity = owners.get(owner);
  refuse(verified && identity && verified.capture.owner === identity && identity.latest === verified.retained
    && verified.capture.current());
  verified.value.assertCurrent(); return verified.value;
}
export function claimProjectWriteRecovery(owner: ProjectWriteOwner, recovery: VerifiedProjectWriteRecovery): ProjectWriteReadmission {
  const value = inspectProjectWriteRecovery(owner, recovery), verified = recoveries.get(recovery)!;
  // Consumption invalidates both handles and drops the owner's capture closure.
  // The active session needs only the immutable proof, not settled submissions.
  verified.capture.owner.latest = undefined; captures.delete(verified.retained); recoveries.delete(recovery);
  claimed.set(value, verified.capture.owner);
  return value;
}
/** Called by the genuine hook only after it synchronously entered recovery. */
export function markProjectWriteAttachment(owner: ProjectWriteOwner, value: ProjectWriteReadmission, assertCurrent: () => void, assertLive: () => void): void {
  const identity = owners.get(owner); refuse(identity && claimed.get(value) === identity && !attachments.has(value));
  assertCurrent(); assertLive(); attachments.set(value, { owner: identity, assertCurrent, assertLive });
}
/** A promise alone cannot prove attachment before the queue recovery hold opens. */
export function attachProjectWriteOwner(owner: ProjectWriteOwner, recovery: VerifiedProjectWriteRecovery, queue: IncrementalQueue): ProjectWriteAttachment {
  const verified = recoveries.get(recovery), identity = owners.get(owner); refuse(verified && identity && verified.targetQueue === queue);
  const value = inspectProjectWriteRecovery(owner, recovery), completion = identity.operations.readmit(recovery);
  void completion.catch(() => {});
  const attachment = attachments.get(value); refuse(attachment && attachment.owner === identity); attachment.assertCurrent();
  return Object.freeze({ readmission: value, completion, assertCurrent: attachment.assertCurrent, assertLive: attachment.assertLive });
}

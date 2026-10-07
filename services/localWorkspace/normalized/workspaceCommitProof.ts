import { assertWorkRuntime, effect, type Work, type WorkRuntime } from '../../../shared/cooperativeWork.js';
import type { Frame } from '../../../shared/jsonWork.js';
import { COMMIT_WINDOW_BYTES, COMMIT_WINDOW_COUNT, denseDataArrayWork, exactFieldsWork,
  privateId, requireContract, safeCounter, validDigest } from './commitProof';
import { canonicalFrame, equalFrameWork, frameBytesWork, hashFrame } from './work';
import type { NormalizedWorkspaceManifest, WorkspaceManifestCore, WorkspaceReceipt, WorkspaceStamp, WorkspaceCommitWindow } from './workspaceManifest';

// Both frames live below manifest validation to avoid a runtime import cycle.
export const workspaceManifestCoreFrame = (value: WorkspaceManifestCore): Frame => canonicalFrame(['doctect-workspace-core-v1', {
  id: value.id, kind: value.kind, formatVersion: value.formatVersion, manifestVersion: value.manifestVersion,
  storageGeneration: value.storageGeneration, activation: value.activation, revision: value.revision,
  members: value.members, activeProjectId: value.activeProjectId, presets: value.presets,
  pendingImports: value.pendingImports, legacyAcceptance: value.legacyAcceptance,
}]);
export const workspaceReceiptFrame = (value: Omit<WorkspaceReceipt, 'proofDigest'>): Frame => canonicalFrame(['doctect-workspace-receipt-v1', {
  identity: value.identity, requestDigest: value.requestDigest, before: value.before, after: value.after, postconditionDigest: value.postconditionDigest,
}]);
function* stampWork(value: unknown): Work<WorkspaceStamp> {
  const stamp = yield* exactFieldsWork(value, ['revision', 'coreDigest']);
  safeCounter(stamp.revision); validDigest(stamp.coreDigest); return value as WorkspaceStamp;
}
function* receiptWork(value: unknown): Work<WorkspaceReceipt> {
  const receipt = yield* exactFieldsWork(value, ['identity', 'requestDigest', 'before', 'after', 'postconditionDigest', 'proofDigest']);
  const identity = yield* exactFieldsWork(receipt.identity, ['clientId', 'commandSequence', 'commandId']);
  privateId(identity.clientId); privateId(identity.commandId); safeCounter(identity.commandSequence);
  for (const field of ['requestDigest', 'postconditionDigest', 'proofDigest']) yield* effect(1, () => validDigest(receipt[field]));
  const before = yield* stampWork(receipt.before); const after = yield* stampWork(receipt.after);
  requireContract(before.revision < Number.MAX_SAFE_INTEGER && after.revision === before.revision + 1, 'Workspace receipt revision gap');
  return value as WorkspaceReceipt;
}
const same = (a: WorkspaceStamp, b: WorkspaceStamp) => a.revision === b.revision && a.coreDigest === b.coreDigest;

/** Shape/chain validation only; independent digest verification is separate. */
export function* validateWorkspaceWindowWork(value: unknown, current: WorkspaceStamp,
  lastCommit: WorkspaceReceipt | null): Work<WorkspaceCommitWindow> {
  yield* stampWork(current);
  const proofWindow = yield* exactFieldsWork(value, ['floorRevision', 'floorCoreDigest', 'entries']);
  safeCounter(proofWindow.floorRevision); validDigest(proofWindow.floorCoreDigest);
  requireContract(Array.isArray(proofWindow.entries) && proofWindow.entries.length <= COMMIT_WINDOW_COUNT, 'Workspace proof window count exceeded');
  yield* denseDataArrayWork(proofWindow.entries);
  let stamp: WorkspaceStamp = { revision: proofWindow.floorRevision, coreDigest: proofWindow.floorCoreDigest };
  const ids = new Set<string>(); const sequences = new Map<string, number>();
  let last: WorkspaceReceipt | null = null;
  for (const candidate of proofWindow.entries) {
    const receipt = yield* receiptWork(candidate);
    yield* effect(1, () => {
      requireContract(same(receipt.before, stamp), 'Workspace receipt chain mismatch');
      requireContract(!ids.has(receipt.identity.commandId), 'Duplicate workspace command');
      const previous = sequences.get(receipt.identity.clientId);
      requireContract(previous === undefined || receipt.identity.commandSequence > previous, 'Workspace command sequence regressed');
      ids.add(receipt.identity.commandId); sequences.set(receipt.identity.clientId, receipt.identity.commandSequence);
    });
    stamp = receipt.after; last = receipt;
  }
  requireContract(same(stamp, current), 'Workspace window does not reach current authority');
  requireContract((last === null) === (lastCommit === null), 'Workspace head/window mismatch');
  if (lastCommit !== null) {
    yield* receiptWork(lastCommit);
    requireContract(yield* equalFrameWork(canonicalFrame(last), canonicalFrame(lastCommit)), 'Workspace head/window mismatch');
  }
  requireContract((yield* frameBytesWork(canonicalFrame(value))) <= COMMIT_WINDOW_BYTES, 'Workspace proof window bytes exceeded');
  return value as WorkspaceCommitWindow;
}

/** Caller owns immutable, shape-validated manifest metadata for this read. */
export async function verifyWorkspaceReceipts(value: NormalizedWorkspaceManifest, initial: WorkspaceStamp,
  work: WorkRuntime): Promise<void> {
  assertWorkRuntime(work); await work.run(stampWork(initial));
  await work.run(validateWorkspaceWindowWork(value.commitWindow, { revision: value.revision, coreDigest: value.coreDigest }, value.lastCommit));
  requireContract(value.revision >= initial.revision && value.commitWindow.floorRevision >= initial.revision, 'Workspace predates activation');
  requireContract(await hashFrame(work, 'proof', workspaceManifestCoreFrame(value)) === value.coreDigest, 'Workspace core digest mismatch');
  if (value.commitWindow.floorRevision === initial.revision) requireContract(value.commitWindow.floorCoreDigest === initial.coreDigest, 'Workspace activation floor mismatch');
  if (value.lastCommit === null) requireContract(same(value, initial), 'Missing workspace command proof');
  for (const receipt of value.commitWindow.entries) requireContract(
    await hashFrame(work, 'proof', workspaceReceiptFrame(receipt)) === receipt.proofDigest, 'Workspace receipt digest mismatch');
}

/** Pure preparation; inputs remain owned by the calling serialized operation. */
export async function appendWorkspaceReceipt(proofWindow: WorkspaceCommitWindow, receipt: WorkspaceReceipt,
  work: WorkRuntime): Promise<WorkspaceCommitWindow> {
  assertWorkRuntime(work); await work.run(receiptWork(receipt));
  // Validate the array before reading its last item (including hostile accessors).
  const fields = await work.run(exactFieldsWork(proofWindow, ['floorRevision', 'floorCoreDigest', 'entries']));
  requireContract(Array.isArray(fields.entries) && fields.entries.length <= COMMIT_WINDOW_COUNT, 'Workspace proof window count exceeded');
  await work.run(denseDataArrayWork(fields.entries));
  await work.run(validateWorkspaceWindowWork(proofWindow, receipt.before, proofWindow.entries.at(-1) ?? null));
  for (const previous of proofWindow.entries) {
    requireContract(previous.identity.commandId !== receipt.identity.commandId, 'Duplicate workspace command');
    requireContract(previous.identity.clientId !== receipt.identity.clientId || previous.identity.commandSequence < receipt.identity.commandSequence,
      'Workspace command sequence regressed');
    requireContract(await hashFrame(work, 'proof', workspaceReceiptFrame(previous)) === previous.proofDigest, 'Workspace receipt digest mismatch');
  }
  requireContract(await hashFrame(work, 'proof', workspaceReceiptFrame(receipt)) === receipt.proofDigest, 'Workspace receipt digest mismatch');
  const entries = [...proofWindow.entries, receipt];
  let next: WorkspaceCommitWindow = { floorRevision: proofWindow.floorRevision, floorCoreDigest: proofWindow.floorCoreDigest, entries };
  while (entries.length > COMMIT_WINDOW_COUNT || await work.run(frameBytesWork(canonicalFrame(next))) > COMMIT_WINDOW_BYTES) {
    requireContract(entries.length > 1, 'Workspace receipt exceeds proof window');
    const removed = entries.shift()!;
    next = { floorRevision: removed.after.revision, floorCoreDigest: removed.after.coreDigest, entries };
  }
  return next;
}

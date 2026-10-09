import { assertWorkRuntime, effect, primitive, runSync, type Ownership, type WorkRuntime } from '../../../shared/cooperativeWork.js';
import { canonicalText, copyEnumerableWork, jsonTextWork, plainJsonBytesWork, rawValueWeightWork, textWork, type Frame } from '../../../shared/jsonWork.js';
import { decomposeProject, decomposeProjectWork, reconstructProject, reconstructProjectWork } from './codec';
import { authority, canonicalTimestamp, dataObject, dataObjectWork, exactFields, frameRecord, isBulkCommitProof, recordFrame, requireContract,
  safeCounter, sameAuthority, validateBulkBaselineWork, validateIdentity, validDigest } from './commitProof';
import { createProjectBulkDigests, createTrustedProjectBulkDigests, projectBulkFrame } from './projectBaseline';
import { canonicalFrame, equalFrameWork, hashFrame, orderedFrame } from './work';
import { NORMALIZED_STORE_NAMES, type BulkCommitProof, type BulkDocumentAck, type BulkDocumentBatch,
  type BulkProjectBaseline, type CommitIdentity, type NormalizedProject, type ProjectScope } from './schema';

export interface PreparedBulkProject {
  project: NormalizedProject; ack: BulkDocumentAck; release(): void;
  /** Trusted preparation only: the validated reconstruction of `project`. */
  external?: ReturnType<typeof reconstructProject>;
}
export function frameBulkDocumentBatch(value: unknown): asserts value is BulkDocumentBatch {
  const batch = exactFields(value, ['scope', 'clientId', 'commitGeneration', 'commitId', 'editorGeneration', 'expected', 'state', 'preferences'], ['metadata']);
  const scope = exactFields(batch.scope, ['storageGeneration', 'projectId', 'incarnation']);
  for (const item of Object.values(scope)) requireContract(typeof item === 'string' && item.length > 0, 'Invalid replacement scope');
  validateIdentity({ clientId: batch.clientId, commitGeneration: batch.commitGeneration, commitId: batch.commitId,
    editorGeneration: batch.editorGeneration, lane: 'document' });
  const stamp = exactFields(batch.expected, ['documentRevision', 'preferenceRevision', 'foldStructureGeneration']);
  for (const counter of Object.values(stamp)) safeCounter(counter);
  if (batch.metadata !== undefined) {
    const metadata = exactFields(batch.metadata, ['kind', 'name']);
    requireContract(metadata.kind === 'linked-root' && typeof metadata.name === 'string', 'Invalid replacement metadata');
  }
}

/** Caller supplies a fresh command runtime; the first charged operation detaches ingress. */
export async function captureBulkDocumentBatch(input: unknown, work: WorkRuntime): Promise<{ batch: BulkDocumentBatch; release(): void }> {
  assertWorkRuntime(work); frameBulkDocumentBatch(input);
  let batch: BulkDocumentBatch, lease: Ownership | undefined;
  try {
    await work.run(primitive('clone', () => { batch = structuredClone(input); lease = work.own(0, true); }));
    const weight = await work.run(rawValueWeightWork(batch!));
    await work.run(effect(1, () => { lease!.grow(weight.bytes); }));
    return { batch: batch!, release: () => lease!.release() };
  } catch (error) { lease?.release(); throw error; }
}

export async function hashBulkDocumentRequest(batch: BulkDocumentBatch, work: WorkRuntime): Promise<string> {
  frameBulkDocumentBatch(batch);
  return hashFrame(work, 'proof', function* (emit) {
    yield* textWork('["doctect-bulk-document-request-v1",', emit);
    yield* canonicalFrame({ scope: batch.scope, clientId: batch.clientId, commitGeneration: batch.commitGeneration,
      commitId: batch.commitId, editorGeneration: batch.editorGeneration, expected: batch.expected, metadata: batch.metadata ?? null })(emit);
    yield* textWork(',', emit); yield* orderedFrame(batch.state)(emit);
    yield* textWork(',', emit); yield* orderedFrame(batch.preferences)(emit);
    yield* textWork(']', emit);
  });
}

const baselineFrame = (scope: ProjectScope, proof: Omit<BulkCommitProof, 'manifestDigest'>,
  digests: BulkProjectBaseline['digests']): Frame => function* (emit) {
  yield* textWork('["doctect-bulk-project-baseline-v1",', emit);
  yield* canonicalFrame(scope)(emit); yield* textWork(',', emit);
  yield* canonicalFrame(proof)(emit); yield* textWork(',', emit);
  yield* canonicalFrame(digests)(emit); yield* textWork(']', emit);
};

/**
 * Native twin of hashBulkDocumentRequest for the worker's own commit: canonical validation admits
 * only plain JSON data, which JSON.stringify frames in ordered form. Tests pin byte equality.
 */
export async function hashTrustedBulkDocumentRequest(batch: BulkDocumentBatch, hash: (text: string) => Promise<string>): Promise<string> {
  frameBulkDocumentBatch(batch); canonicalText(batch.state); canonicalText(batch.preferences);
  return hash(`["doctect-bulk-document-request-v1",${canonicalText({ scope: batch.scope, clientId: batch.clientId,
    commitGeneration: batch.commitGeneration, commitId: batch.commitId, editorGeneration: batch.editorGeneration,
    expected: batch.expected, metadata: batch.metadata ?? null })},${JSON.stringify(batch.state)},${JSON.stringify(batch.preferences)}]`);
}
/** Native twin of baselineFrame's text. Tests pin byte equality. */
export const bulkBaselineText = (scope: ProjectScope, proof: Omit<BulkCommitProof, 'manifestDigest'>,
  digests: BulkProjectBaseline['digests']): string =>
  `["doctect-bulk-project-baseline-v1",${canonicalText(scope)},${canonicalText(proof)},${canonicalText(digests)}]`;

/** Inputs are repository-owned, detached immutable captures; no storage authority is granted here. */
export async function prepareBulkProject(current: NormalizedProject, batch: BulkDocumentBatch, now: string,
  work: WorkRuntime): Promise<PreparedBulkProject> {
  assertWorkRuntime(work); frameBulkDocumentBatch(batch); canonicalTimestamp(now);
  let lease: Ownership | undefined;
  try {
    await work.run(effect(1, () => { lease = work.own(0); }));
    requireContract(await work.run(equalFrameWork(canonicalFrame(current.scope), canonicalFrame(batch.scope))), 'Replacement scope mismatch');
    const beforeHeader = current.projectHeaders.values().next().value!, beforePreferences = current.projectPreferences.values().next().value!;
    await work.run(dataObjectWork(beforeHeader)); await work.run(dataObjectWork(beforePreferences));
    const before = authority(beforeHeader, beforePreferences);
    requireContract(sameAuthority(before, batch.expected), 'Replacement authority changed');
    const after = { documentRevision: before.documentRevision + 1, preferenceRevision: before.preferenceRevision + 1,
      foldStructureGeneration: before.foldStructureGeneration + 1 };
    Object.values(after).forEach(safeCounter);
    const wrapper = await work.run(reconstructProjectWork(current));
    wrapper.initialState = batch.state;
    if (batch.metadata) {
      requireContract(batch.state.nodes[batch.state.rootId]?.title === batch.metadata.name, 'Linked project name must match final root title');
      wrapper.name = batch.metadata.name;
    }
    // The repository already detached ingress. Decomposition unconditionally
    // validates the complete wrapper and current AppState without normalizing it;
    // a returning validator here would repeat those scans and clone it twice.
    const project = await work.run(decomposeProjectWork(wrapper, batch.scope));
    const header = project.projectHeaders.values().next().value!, preferences = project.projectPreferences.values().next().value!;
    await work.run(dataObjectWork(batch.preferences));
    const supplied = await work.run(copyEnumerableWork(batch.preferences));
    supplied.panelsExpanded = {};
    requireContract(await work.run(equalFrameWork(canonicalFrame(supplied), canonicalFrame(preferences.value))), 'Replacement preference/state mismatch');
    preferences.value = await work.run(copyEnumerableWork(batch.preferences)) as typeof preferences.value;
    preferences.encodedSize.valueBytes = await work.run(plainJsonBytesWork(preferences.value));
    header.storageRevision = after.documentRevision; header.foldStructureGeneration = after.foldStructureGeneration;
    header.lastCommitId = batch.commitId; header.updatedAt = now;
    if (beforeHeader.migrationBaseline) header.migrationBaseline = beforeHeader.migrationBaseline;
    if (beforeHeader.workspaceBirth) header.workspaceBirth = beforeHeader.workspaceBirth;
    preferences.revision = after.preferenceRevision; preferences.lastCommitId = batch.commitId;
    const folds = project.projectExtensions.get(await work.run(jsonTextWork([batch.scope.storageGeneration, batch.scope.projectId, batch.scope.incarnation, 'folds'])))!;
    preferences.foldRecordDigest = await hashFrame(work, 'proof', recordFrame('projectExtensions', folds));
    header.commitWindow = { floorRevision: after.documentRevision, entries: [] };
    preferences.commitWindow = { floorRevision: after.preferenceRevision, entries: [] };
    const identity: CommitIdentity = { clientId: batch.clientId, commitGeneration: batch.commitGeneration,
      commitId: batch.commitId, editorGeneration: batch.editorGeneration, lane: 'document' };
    const core = { kind: 'bulk-document' as const, identity, requestDigest: await hashBulkDocumentRequest(batch, work), before, after,
      headerCoreDigest: await hashFrame(work, 'proof', recordFrame('projectHeaders', header, 'bulk')),
      preferenceCoreDigest: await hashFrame(work, 'proof', recordFrame('projectPreferences', preferences, 'bulk')) };
    const digests = await createProjectBulkDigests(project, work);
    const proof: BulkCommitProof = { ...core, manifestDigest: await hashFrame(work, 'proof', baselineFrame(batch.scope, core, digests)) };
    header.bulkBaseline = { proof, digests }; preferences.bulkBoundary = proof.manifestDigest;
    header.commitProof = proof; preferences.commitProof = proof;
    await work.run(reconstructProjectWork(project)); // Full codec/size/lineage validation, not digest-only admission.
    const weight = await work.run(rawValueWeightWork(project));
    await work.run(effect(1, () => lease!.grow(weight.bytes)));
    return { project, ack: { type: 'document-replaced', projectId: batch.scope.projectId, incarnation: batch.scope.incarnation,
      commitId: batch.commitId, editorGeneration: batch.editorGeneration, authority: after, boundaryDigest: proof.manifestDigest },
      release: () => lease!.release() };
  } catch (error) { lease?.release(); throw error; }
}

/**
 * prepareBulkProject for a replacement whose current rows the repository has just matched,
 * record for record, against its admitted cache (Trusted Document Replace). Same records, proof
 * and ack, built with one synchronous decomposition (which validates the wrapper and AppState),
 * one synchronous reconstruction of the result (codec/size/lineage validation) and native
 * hashing. `currentWrapper` is the current project reconstructed once, and is consumed.
 */
export async function prepareTrustedBulkProject(current: NormalizedProject, currentWrapper: ReturnType<typeof reconstructProject>,
  batch: BulkDocumentBatch, now: string, work: WorkRuntime, hash: (text: string) => Promise<string>): Promise<PreparedBulkProject> {
  assertWorkRuntime(work); frameBulkDocumentBatch(batch); canonicalTimestamp(now);
  let lease: Ownership | undefined;
  try {
    await work.run(effect(1, () => { lease = work.own(0); }));
    requireContract(canonicalText(current.scope) === canonicalText(batch.scope), 'Replacement scope mismatch');
    const beforeHeader = current.projectHeaders.values().next().value!, beforePreferences = current.projectPreferences.values().next().value!;
    dataObject(beforeHeader); dataObject(beforePreferences);
    const before = authority(beforeHeader, beforePreferences);
    requireContract(sameAuthority(before, batch.expected), 'Replacement authority changed');
    const after = { documentRevision: before.documentRevision + 1, preferenceRevision: before.preferenceRevision + 1,
      foldStructureGeneration: before.foldStructureGeneration + 1 };
    Object.values(after).forEach(safeCounter);
    const wrapper = currentWrapper;
    wrapper.initialState = batch.state;
    if (batch.metadata) {
      requireContract(batch.state.nodes[batch.state.rootId]?.title === batch.metadata.name, 'Linked project name must match final root title');
      wrapper.name = batch.metadata.name;
    }
    const project = decomposeProject(wrapper, batch.scope);
    await work.run(effect(1, () => {})); // a cancellation point between the two large synchronous passes
    const header = project.projectHeaders.values().next().value!, preferences = project.projectPreferences.values().next().value!;
    dataObject(batch.preferences);
    const supplied = runSync(copyEnumerableWork(batch.preferences));
    supplied.panelsExpanded = {};
    requireContract(canonicalText(supplied) === canonicalText(preferences.value), 'Replacement preference/state mismatch');
    preferences.value = runSync(copyEnumerableWork(batch.preferences)) as typeof preferences.value;
    preferences.encodedSize.valueBytes = runSync(plainJsonBytesWork(preferences.value));
    header.storageRevision = after.documentRevision; header.foldStructureGeneration = after.foldStructureGeneration;
    header.lastCommitId = batch.commitId; header.updatedAt = now;
    if (beforeHeader.migrationBaseline) header.migrationBaseline = beforeHeader.migrationBaseline;
    if (beforeHeader.workspaceBirth) header.workspaceBirth = beforeHeader.workspaceBirth;
    preferences.revision = after.preferenceRevision; preferences.lastCommitId = batch.commitId;
    const folds = project.projectExtensions.get(canonicalText([batch.scope.storageGeneration, batch.scope.projectId, batch.scope.incarnation, 'folds']))!;
    preferences.foldRecordDigest = await hash(frameRecord('projectExtensions', folds));
    header.commitWindow = { floorRevision: after.documentRevision, entries: [] };
    preferences.commitWindow = { floorRevision: after.preferenceRevision, entries: [] };
    const identity: CommitIdentity = { clientId: batch.clientId, commitGeneration: batch.commitGeneration,
      commitId: batch.commitId, editorGeneration: batch.editorGeneration, lane: 'document' };
    const core = { kind: 'bulk-document' as const, identity, requestDigest: await hashTrustedBulkDocumentRequest(batch, hash), before, after,
      headerCoreDigest: await hash(frameRecord('projectHeaders', header, 'bulk')),
      preferenceCoreDigest: await hash(frameRecord('projectPreferences', preferences, 'bulk')) };
    const digests = await createTrustedProjectBulkDigests(project, hash);
    const proof: BulkCommitProof = { ...core, manifestDigest: await hash(bulkBaselineText(batch.scope, core, digests)) };
    header.bulkBaseline = { proof, digests }; preferences.bulkBoundary = proof.manifestDigest;
    header.commitProof = proof; preferences.commitProof = proof;
    work.assertCurrent();
    const external = reconstructProject(project); // Full codec/size/lineage validation of exactly what will be written.
    const weight = runSync(rawValueWeightWork(project));
    await work.run(effect(1, () => lease!.grow(weight.bytes)));
    return { project, ack: { type: 'document-replaced', projectId: batch.scope.projectId, incarnation: batch.scope.incarnation,
      commitId: batch.commitId, editorGeneration: batch.editorGeneration, authority: after, boundaryDigest: proof.manifestDigest },
      external, release: () => lease!.release() };
  } catch (error) { lease?.release(); throw error; }
}

/** Component evidence only. Full codec/current-source admission remains independently required. */
export async function verifyBulkProjectProof(scope: ProjectScope, value: unknown, boundary: unknown,
  work: WorkRuntime): Promise<BulkProjectBaseline> {
  const baseline = await work.run(validateBulkBaselineWork(value));
  validDigest(boundary); requireContract(boundary === baseline.proof.manifestDigest, 'Bulk boundary mismatch');
  const { manifestDigest, ...core } = baseline.proof;
  requireContract(await hashFrame(work, 'proof', baselineFrame(scope, core, baseline.digests)) === manifestDigest, 'Bulk baseline proof mismatch');
  return baseline;
}
export async function verifyBulkProjectBaseline(project: NormalizedProject, work: WorkRuntime): Promise<void> {
  assertWorkRuntime(work);
  requireContract(project.projectHeaders.size === 1 && project.projectPreferences.size === 1, 'Invalid bulk project pair');
  const header = project.projectHeaders.values().next().value!, preferences = project.projectPreferences.values().next().value!;
  await work.run(dataObjectWork(header)); await work.run(dataObjectWork(preferences));
  const baseline = await verifyBulkProjectProof(project.scope, header.bulkBaseline, preferences.bulkBoundary, work);
  const core = baseline.proof;
  const { documentRevision, preferenceRevision, foldStructureGeneration } = baseline.proof.after;
  requireContract(header.storageRevision >= documentRevision && preferences.revision >= preferenceRevision
    && header.foldStructureGeneration >= foldStructureGeneration, 'Rewound bulk baseline');
  if (header.storageRevision === documentRevision) {
    requireContract(await hashFrame(work, 'proof', projectBulkFrame(project, 'document')) === baseline.digests.documentDigest, 'Bulk document baseline mismatch');
    requireContract(await hashFrame(work, 'proof', recordFrame('projectHeaders', header, 'bulk')) === core.headerCoreDigest, 'Bulk header core mismatch');
  }
  if (preferences.revision === preferenceRevision) {
    requireContract(await hashFrame(work, 'proof', projectBulkFrame(project, 'preferences')) === baseline.digests.preferenceDigest, 'Bulk preference baseline mismatch');
    requireContract(await hashFrame(work, 'proof', projectBulkFrame(project, 'folds')) === baseline.digests.foldDigest, 'Bulk fold baseline mismatch');
    requireContract(await hashFrame(work, 'proof', recordFrame('projectPreferences', preferences, 'bulk')) === core.preferenceCoreDigest, 'Bulk preference core mismatch');
  }
  if (header.storageRevision === documentRevision && preferences.revision === preferenceRevision) {
    let count = 0;
    for (const store of NORMALIZED_STORE_NAMES) if (store !== 'normalizationLedger') await work.run(effect(1, () => { count += project[store].size; }));
    requireContract(count === baseline.digests.recordCount
      && await hashFrame(work, 'proof', projectBulkFrame(project, 'image')) === baseline.digests.imageDigest, 'Bulk image baseline mismatch');
    requireContract(isBulkCommitProof(header.commitProof) && isBulkCommitProof(preferences.commitProof), 'Missing bulk head proof');
  }
}

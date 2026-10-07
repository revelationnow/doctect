import { assertWorkRuntime, effect, primitive, retainWork, type WorkRuntime } from '../../../shared/cooperativeWork.js';
import { canonicalText, compareStringsWork, quoteWork, stableSortWork, textWork, type Frame } from '../../../shared/jsonWork.js';
import { dataObject, dataObjectWork, denseDataArray, denseDataArrayWork, exactFields, exactFieldsWork, frameRecord, recordFrame, requireContract, safeCounter,
  validDigest, validateWorkspaceBirthOriginWork, workspaceBirthOriginFields } from './commitProof';
import { canonicalFrame, equalFrameWork, hashFrame } from './work';
import { NORMALIZED_STORE_NAMES, type NormalizedProject, type NormalizedRecordTypes, type ProjectStoreName } from './schema';
import type { ProjectBaselineDigests, WorkspaceMember } from './workspaceManifest';

type Part = 'image' | 'document' | 'preferences' | 'folds';
type PhysicalRecord = NormalizedRecordTypes[ProjectStoreName];
const stores = NORMALIZED_STORE_NAMES.filter((name): name is ProjectStoreName => name !== 'normalizationLedger');
const include = (store: ProjectStoreName, record: PhysicalRecord, part: Part) => {
  const folds = store === 'projectExtensions' && record.key[3] === 'folds';
  return part === 'image' || (part === 'preferences' ? store === 'projectPreferences'
    : part === 'folds' ? folds : store !== 'projectPreferences' && !folds);
};

const recordFields = ['key', 'formatVersion', 'value', 'encodedSize'];
const optionalRecordFields = (store: ProjectStoreName) => store === 'projectHeaders'
  ? ['incarnation', 'document', 'order', 'storageRevision', 'lastCommitId', 'updatedAt',
    'foldStructureGeneration', 'counters', 'commitProof', 'commitWindow', 'migrationBaseline', 'workspaceBirth', 'bulkBaseline']
  : store === 'projectPreferences' ? ['revision', 'lastCommitId', 'preferenceBytes', 'commitProof', 'commitWindow', 'foldRecordDigest', 'bulkBoundary']
    : store === 'projectVariants' ? ['fieldOrder', 'templateOrder'] : [];
const projected = (store: ProjectStoreName, name: string, kind: 'birth' | 'bulk') => !['commitProof', 'commitWindow'].includes(name)
  && !(kind === 'bulk' && (store === 'projectHeaders' && name === 'bulkBaseline' || store === 'projectPreferences' && name === 'bulkBoundary'));

/** Frames immutable owner records. This projection alone is not full project validation. */
export const projectBirthFrame = (project: NormalizedProject, part: Part): Frame => function* (emit) {
  yield* projectFrame(project, part, 'birth')(emit);
};
export const projectBulkFrame = (project: NormalizedProject, part: Part): Frame => projectFrame(project, part, 'bulk');
const projectFrame = (project: NormalizedProject, part: Part, kind: 'birth' | 'bulk'): Frame => function* (emit) {
  yield* textWork('[', emit); yield* quoteWork(`doctect-project-${kind}-${part}-v1`, emit);
  for (const store of stores) {
    const owned = yield* retainWork(0);
    try {
    const entries: PhysicalRecord[] = [];
    for (const [key, candidate] of project[store]) {
      yield* dataObjectWork(candidate); yield* denseDataArrayWork(candidate.key);
      for (const field of candidate.key) yield* effect(1, () => requireContract(typeof field === 'string', 'Invalid birth record key'));
      requireContract(typeof key === 'string' && (yield* equalFrameWork(emit => textWork(key, emit), canonicalFrame(candidate.key))), 'Mismatched birth record key');
      if (include(store, candidate, part)) yield* effect(1, () => {
        // Entries plus two merge-sort reference buffers; record bodies remain borrowed.
        owned.grow(24); entries.push(candidate);
      });
    }
    const ordered = yield* stableSortWork(entries, function* (a, b) {
      for (let i = 0; i < Math.min(a.key.length, b.key.length); i++) {
        const comparison = yield* compareStringsWork(a.key[i], b.key[i]); if (comparison) return comparison;
      }
      return yield* effect(1, () => a.key.length - b.key.length);
    });
    for (const record of ordered) {
      const fields = yield* dataObjectWork(record); const projection: Record<string, unknown> = {};
      const keys = yield* exactFieldsWork(fields, recordFields, optionalRecordFields(store));
      const names = yield* primitive('keys', () => Object.keys(keys));
      const projectionOwner = yield* retainWork(0);
      try {
      projectionOwner.grow(names.length * 24);
      for (const name of names) yield* effect(1, () => {
        if (projected(store, name, kind)) Object.defineProperty(projection, name, { value: fields[name], enumerable: true });
      });
      yield* textWork(',', emit); yield* recordFrame(store, projection)(emit);
      } finally { projectionOwner.release(); }
    }
    } finally { owned.release(); }
  }
  yield* textWork(']', emit);
};

/** Native twin of the birth frame text for a worker's own fresh write. Tests pin byte equality with projectBirthFrame. */
export function projectBirthFrameText(project: NormalizedProject, part: Part): string {
  const parts = [`[${JSON.stringify(`doctect-project-birth-${part}-v1`)}`];
  for (const store of stores) {
    const entries: PhysicalRecord[] = [];
    for (const [key, candidate] of project[store]) {
      dataObject(candidate); denseDataArray(candidate.key);
      for (const field of candidate.key) requireContract(typeof field === 'string', 'Invalid birth record key');
      requireContract(typeof key === 'string' && key === canonicalText(candidate.key), 'Mismatched birth record key');
      if (include(store, candidate, part)) entries.push(candidate);
    }
    entries.sort((a, b) => {
      for (let i = 0; i < Math.min(a.key.length, b.key.length); i++) if (a.key[i] !== b.key[i]) return a.key[i] < b.key[i] ? -1 : 1;
      return a.key.length - b.key.length;
    });
    for (const record of entries) {
      const fields = exactFields(record, recordFields, optionalRecordFields(store)); const projection: Record<string, unknown> = {};
      for (const name of Object.keys(fields)) if (projected(store, name, 'birth')) Object.defineProperty(projection, name, { value: fields[name], enumerable: true });
      parts.push(',', frameRecord(store, projection));
    }
  }
  parts.push(']');
  return parts.join('');
}
export async function createTrustedProjectBirthDigests(project: NormalizedProject, hash: (text: string) => Promise<string>): Promise<ProjectBaselineDigests> {
  let recordCount = 0;
  for (const store of stores) { recordCount += project[store].size; safeCounter(recordCount); }
  return { imageDigest: await hash(projectBirthFrameText(project, 'image')), documentDigest: await hash(projectBirthFrameText(project, 'document')),
    preferenceDigest: await hash(projectBirthFrameText(project, 'preferences')), foldDigest: await hash(projectBirthFrameText(project, 'folds')), recordCount };
}

export async function createProjectBirthDigests(project: NormalizedProject, work: WorkRuntime): Promise<ProjectBaselineDigests> {
  return createDigests(project, work, projectBirthFrame);
}
export async function createProjectBulkDigests(project: NormalizedProject, work: WorkRuntime): Promise<ProjectBaselineDigests> {
  return createDigests(project, work, projectBulkFrame);
}
async function createDigests(project: NormalizedProject, work: WorkRuntime,
  frame: (project: NormalizedProject, part: Part) => Frame): Promise<ProjectBaselineDigests> {
  assertWorkRuntime(work); let recordCount = 0;
  for (const store of stores) await work.run(effect(1, () => { recordCount += project[store].size; safeCounter(recordCount); }));
  return { imageDigest: await hashFrame(work, 'proof', frame(project, 'image')),
    documentDigest: await hashFrame(work, 'proof', frame(project, 'document')),
    preferenceDigest: await hashFrame(work, 'proof', frame(project, 'preferences')),
    foldDigest: await hashFrame(work, 'proof', frame(project, 'folds')), recordCount };
}

/** Verify independent initial lanes; the repository must also validate all current records/proofs. */
export async function verifyProjectBirth(project: NormalizedProject, member: WorkspaceMember, work: WorkRuntime): Promise<void> {
  assertWorkRuntime(work);
  await work.run(dataObjectWork(project)); await work.run(dataObjectWork(project.scope));
  await work.run(exactFieldsWork(member, ['projectId', 'incarnation', 'birth', 'consumedImport']));
  await work.run(exactFieldsWork(member.birth, [...workspaceBirthOriginFields, 'digests']));
  requireContract(member.birth.kind === 'workspace-command', 'Workspace birth scope mismatch');
  requireContract(await work.run(equalFrameWork(canonicalFrame([member.projectId, member.incarnation]),
    canonicalFrame([project.scope.projectId, project.scope.incarnation]))), 'Workspace birth scope mismatch');
  const birth = member.birth;
  requireContract(project.projectHeaders.size === 1 && project.projectPreferences.size === 1, 'Invalid project birth pair');
  const header = project.projectHeaders.values().next().value;
  const preferences = project.projectPreferences.values().next().value;
  await work.run(dataObjectWork(header)); await work.run(dataObjectWork(preferences));
  requireContract(header && preferences && !header.migrationBaseline && header.workspaceBirth, 'Missing workspace birth identity');
  await work.run(validateWorkspaceBirthOriginWork(header.workspaceBirth));
  const expected: Record<string, unknown> = {};
  for (const field of workspaceBirthOriginFields) await work.run(effect(1, () => { expected[field] = birth[field]; }));
  requireContract(await work.run(equalFrameWork(canonicalFrame(header.workspaceBirth), canonicalFrame(expected))), 'Workspace birth identity mismatch');
  const digests = await work.run(exactFieldsWork(birth.digests, ['imageDigest', 'documentDigest', 'preferenceDigest', 'foldDigest', 'recordCount']));
  for (const field of ['imageDigest', 'documentDigest', 'preferenceDigest', 'foldDigest']) validDigest(digests[field]);
  safeCounter(digests.recordCount); safeCounter(header.storageRevision); safeCounter(preferences.revision);
  const initialDocument = header.storageRevision === 0; const initialPreferences = preferences.revision === 0;
  if (initialDocument) requireContract(await hashFrame(work, 'proof', projectBirthFrame(project, 'document')) === digests.documentDigest,
    'Workspace document baseline mismatch');
  if (initialPreferences) {
    requireContract(await hashFrame(work, 'proof', projectBirthFrame(project, 'preferences')) === digests.preferenceDigest, 'Workspace preference baseline mismatch');
    requireContract(await hashFrame(work, 'proof', projectBirthFrame(project, 'folds')) === digests.foldDigest, 'Workspace fold baseline mismatch');
  }
  if (initialDocument && initialPreferences) {
    let count = 0; for (const store of stores) await work.run(effect(1, () => { count += project[store].size; }));
    requireContract(count === digests.recordCount && await hashFrame(work, 'proof', projectBirthFrame(project, 'image')) === digests.imageDigest,
      'Workspace image baseline mismatch');
  }
}

import { effect, primitive, assertWorkRuntime, type Work, type WorkRuntime } from '../../../shared/cooperativeWork.js';
import { canonicalWork, copyEnumerableWork, enumerableEntriesWork, compareStringsWork, stableSortWork, textWork, quoteWork, type Frame } from '../../../shared/jsonWork.js';
import { withFrameDigests } from '../canonical';
import type { WorkspaceSnapshot } from '../contracts';
import type { WorkspaceRecords } from '../migration';
import type { LegacyBackupRecord, MigrationLedger, NormalizationSourceArchive, StoredProject } from '../schema';
import { NORMALIZATION_LEDGER_ID, type NormalizationSourceProject } from './schema';
import { canonicalFrame, envelopeFrame, equalFrameWork, hashFrame, listFrame, orderedFrame } from './work';
import { dataObjectWork, requireContract } from './commitProof';

interface SourceImages {
  kind: 'fresh' | 'historical'; records: WorkspaceRecords; projects: readonly StoredProject[];
  snapshot: WorkspaceSnapshot; ledger: MigrationLedger | null; backups: readonly LegacyBackupRecord[];
}

const archivePrefix = (archive: NormalizationSourceArchive): Frame => function* (emit) {
  yield* textWork('["normalization-archive-v1",', emit);
  yield* envelopeFrame('workspace', archive.workspace)(emit); yield* textWork(',', emit);
  yield* listFrame('presets', archive.presets)(emit); yield* textWork(',', emit);
  yield* listFrame('imports', archive.pendingImports)(emit); yield* textWork(',', emit);
  yield* listFrame('metadata', archive.projectMetadata)(emit); yield* textWork(',', emit);
  yield* canonicalFrame(archive.backupDigests)(emit); yield* textWork(',', emit);
};

/** Hash previously validated immutable source images. This pure result is not
 * storage admission. Project bodies are serialized once for all compatible
 * frames; a differing fresh seed order retains its independent archive pass. */
export async function hashSourceImages(input: SourceImages, work: WorkRuntime) {
  assertWorkRuntime(work);
  const ids = new Set<string>(), backupDigests: NormalizationSourceArchive['backupDigests'] = [];
  for (const backup of input.backups) {
    const digest = await hashFrame(work, 'source', envelopeFrame('backup', backup));
    await work.run(effect(1, () => { ids.add(backup.id); backupDigests.push({ id: backup.id, digest }); }));
  }
  const preferred = `normalization-source:${NORMALIZATION_LEDGER_ID}`; let archiveId = preferred;
  for (let suffix = 1; ids.has(archiveId); suffix++) archiveId = await work.run(effect(1, () => `${preferred}:${suffix}`));
  const projectMetadata: NormalizationSourceArchive['projectMetadata'] = [];
  for (const row of input.records.projects) {
    const copy = await work.run(copyEnumerableWork(row));
    await work.run(effect(1, () => { delete (copy as Partial<StoredProject>).project; projectMetadata.push(copy); }));
  }
  requireContract(input.kind !== 'historical' || input.ledger, 'Missing historical source ledger');
  const archive: NormalizationSourceArchive = { id: archiveId, kind: 'normalization-source', formatVersion: 3,
    ...(input.kind === 'historical' ? { sourceKind: 'historical' as const, ledger: input.ledger! }
      : { sourceKind: 'fresh' as const, ledger: null, seed: input.records.projects }),
    workspace: input.records.workspace, presets: input.records.presets, pendingImports: input.records.pendingImports, projectMetadata, backupDigests };
  let sharedArchive = input.kind === 'fresh' && input.projects.length === input.records.projects.length;
  requireContract(input.snapshot.projects.length === input.projects.length, 'Source snapshot membership mismatch');
  for (let index = 0; index < input.projects.length; index++) await work.run(effect(2, () => {
    requireContract(input.projects[index].project === input.snapshot.projects[index], 'Source snapshot image mismatch');
    if (input.projects[index] !== input.records.projects[index]) sharedArchive = false;
  }));
  const result = await withFrameDigests(work, 'source', function* (group) {
    const content = yield* group.createDigest(), archived = sharedArchive ? yield* group.createDigest() : undefined;
    const contentEmit = group.emit(content);
    yield* textWork('["normalization-content-v1",["projects",', contentEmit);
    if (archived) {
      const emit = group.emit(archived); yield* archivePrefix(archive)(emit); yield* textWork('["fresh-seed",', emit);
    }
    const sourceProjects: NormalizationSourceProject[] = [];
    for (let index = 0; index < input.projects.length; index++) {
      const row = input.projects[index], projectDigest = yield* group.createDigest();
      const rowEmit = archived ? group.emit(projectDigest, archived) : group.emit(projectDigest);
      yield* textWork('["normalization-project-v1",', group.emit(projectDigest));
      if (index) yield* textWork(',', contentEmit);
      yield* textWork('["envelope",', contentEmit);
      if (archived) {
        const emit = group.emit(archived); if (index) yield* textWork(',', emit); yield* textWork('["envelope",', emit);
      }
      yield* textWork('{', rowEmit);
      const entries = yield* stableSortWork(yield* enumerableEntriesWork(row as unknown as Record<string, unknown>),
        (a, b) => compareStringsWork(a[0], b[0]));
      let projectSeen = false;
      for (let field = 0; field < entries.length; field++) {
        const [key, value] = entries[field]; if (field) yield* textWork(',', rowEmit);
        yield* quoteWork(key, rowEmit); yield* textWork(':', rowEmit);
        if (key === 'project') {
          projectSeen = true;
          // Stored-record and content envelopes differ only outside this body.
          // Full wrapper depth was validated before hashing; its canonical bytes
          // equal the content envelope's sorted per-field bytes.
          yield* canonicalWork(value, archived ? group.emit(projectDigest, archived, content) : group.emit(projectDigest, content));
        } else yield* canonicalWork(value, rowEmit);
      }
      requireContract(projectSeen, 'Missing source project body');
      yield* textWork('}]', rowEmit); yield* textWork(']', contentEmit);
      const digest = yield* group.finish(projectDigest);
      yield* effect(1, () => { sourceProjects.push({ projectId: row.id, incarnation: row.incarnation, revision: row.storageRevision, digest }); });
    }
    yield* textWork('],', contentEmit); yield* orderedFrame(input.snapshot.activeProjectId)(contentEmit);
    yield* textWork(',', contentEmit); yield* listFrame('presets', input.snapshot.customPresets)(contentEmit);
    yield* textWork(',', contentEmit); yield* listFrame('imports', input.snapshot.pendingImports)(contentEmit); yield* textWork(']', contentEmit);
    const contentDigest = yield* group.finish(content);
    let sourceArchiveDigest: string | undefined;
    if (archived) { yield* textWork(']]', group.emit(archived)); sourceArchiveDigest = yield* group.finish(archived); }
    return { sourceProjects, contentDigest, sourceArchiveDigest };
  });
  const sourceArchiveDigest = result.sourceArchiveDigest ?? await hashFrame(work, 'source', function* (emit) {
    yield* archivePrefix(archive)(emit);
    if (archive.sourceKind === 'historical') yield* envelopeFrame('ledger', archive.ledger)(emit);
    else yield* listFrame('fresh-seed', archive.seed)(emit);
    yield* textWork(']', emit);
  });
  return { sourceProjects: result.sourceProjects, contentDigest: result.contentDigest, archive, sourceArchiveDigest };
}

/** Both objects belong to the same immutable source capture. Known borrowed
 * payloads need no second serialization when they are literally the same value;
 * every derived field and every distinct payload still gets exact comparison. */
export function* equalSourceArchiveWork(expected: NormalizationSourceArchive, actual: unknown): Work<boolean> {
  const left = yield* dataObjectWork(expected), right = yield* dataObjectWork(actual);
  const keys = yield* primitive('keys', () => Object.keys(left));
  const otherKeys = yield* primitive('keys', () => Object.keys(right));
  if (!(yield* equalFrameWork(orderedFrame(keys), orderedFrame(otherKeys)))) return false;
  for (const key of keys) {
    const borrowed = yield* effect(2, () => ['seed', 'workspace', 'presets', 'pendingImports', 'ledger'].includes(key) && left[key] === right[key]);
    if (!borrowed && !(yield* equalFrameWork(orderedFrame(left[key]), orderedFrame(right[key])))) return false;
  }
  return true;
}

import { effect, primitive, runSync, type Ownership, type Work, type WorkRuntime } from '../../shared/cooperativeWork.js';
import { copyEnumerableWork, plainJsonBytesWork } from '../../shared/jsonWork.js';
import { digestWorkspaceContent } from './canonical';
import type { WorkspaceSnapshot } from './contracts';
import {
  reconstructWorkspaceRecords,
  reconstructWorkspaceRecordsWork,
  WorkspaceMigrationError,
  type WorkspaceRecordCandidates,
  type WorkspaceRecords,
} from './migration';
import {
  HISTORICAL_WORKSPACE_FORMAT_VERSION,
  type HistoricalMigrationLedgerV1,
  type MigrationLedger,
  type StoredProject,
} from './schema';

export interface LineageRepairPreparationEnvironment {
  crypto: Pick<Crypto, 'subtle'>;
  randomUUID(): string;
  work?: WorkRuntime;
}

export interface ExpectedLineageRepairProject {
  id: string;
  record: unknown;
}

export interface PreparedLineageRepair {
  expectedLedger: HistoricalMigrationLedgerV1;
  expectedProjects: ExpectedLineageRepairProject[];
  replacementProjects: StoredProject[];
  ledger: MigrationLedger;
  snapshot: WorkspaceSnapshot;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const targetError = (message: string, cause?: unknown): WorkspaceMigrationError =>
  new WorkspaceMigrationError(message, 'target-invalid', undefined, undefined, cause);

const generatedIncarnation = (
  environment: LineageRepairPreparationEnvironment,
  index: number,
): string => {
  const incarnation = environment.randomUUID();
  if (typeof incarnation !== 'string' || incarnation.length === 0) {
    throw targetError(`Project record ${index} generated incarnation must be non-empty.`);
  }
  return incarnation;
};

// Historical rows are indivisible native clone boundaries, not whole-workspace
// collections. The arrays themselves are traversed by the cooperative driver.
function* cloneRows(value: unknown): Work<unknown> {
  if (!Array.isArray(value)) return yield* primitive('clone', () => structuredClone(value));
  const rows: unknown[] = new Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    yield* effect(1, () => {});
    if (index in value) rows[index] = yield* primitive('clone', () => structuredClone(value[index]));
  }
  return rows;
}

function* captureLineageRecords(
  records: WorkspaceRecordCandidates,
): Work<{ expectedRawProjects: unknown[]; validationRecords: WorkspaceRecordCandidates }> {
  if (!Array.isArray(records.projects)) {
    throw targetError('Project records must be an array.');
  }

  const expectedRawProjects = (yield* cloneRows(records.projects)) as unknown[];
  const validationProjects: Record<string, unknown>[] = new Array(records.projects.length);
  for (let index = 0; index < records.projects.length; index += 1) {
    yield* effect(1, () => {});
    if (!(index in records.projects)) continue;
    const rawRecord = records.projects[index];
    if (!isPlainObject(rawRecord)) {
      throw targetError(`Project record ${index} must be an object.`);
    }
    const cloned = yield* primitive('clone', () => structuredClone(rawRecord));
    validationProjects[index] = Object.hasOwn(cloned, 'incarnation')
      ? cloned
      : Object.assign(yield* copyEnumerableWork(cloned), { incarnation: 'historical-lineage-validation' });
  }
  const validationRecords: WorkspaceRecordCandidates = {
    projects: validationProjects,
    workspace: yield* primitive('clone', () => structuredClone(records.workspace)),
    presets: yield* cloneRows(records.presets),
    pendingImports: yield* cloneRows(records.pendingImports),
  };
  return { expectedRawProjects, validationRecords };
}

function* upgradeLineageRecords(
  validatedRecords: WorkspaceRecords,
  records: WorkspaceRecordCandidates,
  environment: LineageRepairPreparationEnvironment,
): Work<{ replacementProjects: StoredProject[]; upgradedProjects: StoredProject[] }> {
  const replacementProjects: StoredProject[] = [];
  const upgradedProjects: StoredProject[] = [];
  for (const [index, validatedRecord] of validatedRecords.projects.entries()) {
    yield* effect(1, () => {});
    if (Object.hasOwn(records.projects[index], 'incarnation')) {
      upgradedProjects.push(validatedRecord);
      continue;
    }
    const replacement = Object.assign(yield* copyEnumerableWork(validatedRecord), {
      // Environment callback, not a native primitive exception. Driver guards
      // on both sides prevent allocation continuing after lifecycle loss.
      incarnation: yield* effect(1, () => generatedIncarnation(environment, index)),
    });
    replacementProjects.push(yield* primitive('clone', () => structuredClone(replacement)));
    upgradedProjects.push(replacement);
  }
  return { replacementProjects, upgradedProjects };
}

function* finishLineageRepair(
  ledger: HistoricalMigrationLedgerV1,
  expectedRawProjects: unknown[],
  upgradedProjects: StoredProject[],
  replacementProjects: StoredProject[],
  snapshot: WorkspaceSnapshot,
): Work<PreparedLineageRepair> {
  const clonedLedger: Omit<HistoricalMigrationLedgerV1, 'indexedDbVersion'> = yield* copyEnumerableWork(
    yield* primitive('clone', () => structuredClone(ledger)),
  );
  const nextLedger: MigrationLedger = Object.assign(clonedLedger, {
    indexedDbVersion: HISTORICAL_WORKSPACE_FORMAT_VERSION,
    ledgerRevision: ledger.ledgerRevision + 1,
  } as const);
  const expectedLedger = yield* primitive('clone', () => structuredClone(ledger));
  const expectedProjects: ExpectedLineageRepairProject[] = [];
  for (const [index, record] of expectedRawProjects.entries()) {
    yield* effect(1, () => { expectedProjects.push({ id: upgradedProjects[index].id, record }); });
  }
  return {
    expectedLedger,
    expectedProjects,
    replacementProjects,
    ledger: nextLedger,
    snapshot,
  };
}

export async function prepareLineageRepair(
  ledger: HistoricalMigrationLedgerV1,
  records: WorkspaceRecordCandidates,
  environment: LineageRepairPreparationEnvironment,
): Promise<PreparedLineageRepair> {
  const work = environment.work;
  let snapshotOwnership: Ownership | undefined;
  function* retainSnapshot(snapshot: WorkspaceSnapshot): Work<void> {
    const bytes = yield* plainJsonBytesWork(snapshot);
    yield { visits: 1, utf8Bytes: 0, run(runtime) { snapshotOwnership = runtime?.own(bytes); } };
  }
  work?.assertCurrent();
  try {
    const captured = work
      ? await work.run(captureLineageRecords(records))
      : runSync(captureLineageRecords(records));
    let validation = work
      ? await work.run(reconstructWorkspaceRecordsWork(captured.validationRecords))
      : reconstructWorkspaceRecords(captured.validationRecords);
    const validatedRecords = validation.records;
    if (work) await work.run(retainSnapshot(validation.snapshot));
    const validationDigest = await digestWorkspaceContent(validation.snapshot, environment.crypto.subtle, work);
    work?.assertCurrent();
    // The first loaded snapshot is no longer required after its independent
    // digest check; the final reconstruction must not reuse it as authority.
    validation = undefined;
    snapshotOwnership?.release();
    snapshotOwnership = undefined;
    if (validationDigest !== ledger.expectedTargetDigest) {
      throw new WorkspaceMigrationError(
        'Historical workspace digest changed before lineage preparation.', 'verification-failed',
      );
    }
    const upgrade = work
      ? await work.run(upgradeLineageRecords(validatedRecords, records, environment))
      : runSync(upgradeLineageRecords(validatedRecords, records, environment));
    const upgradedRecords: WorkspaceRecords = { ...validatedRecords, projects: upgrade.upgradedProjects };
    const { snapshot } = work
      ? await work.run(reconstructWorkspaceRecordsWork(upgradedRecords))
      : reconstructWorkspaceRecords(upgradedRecords);
    if (work) await work.run(retainSnapshot(snapshot));
    const observedDigest = await digestWorkspaceContent(snapshot, environment.crypto.subtle, work);
    work?.assertCurrent();
    if (observedDigest !== ledger.expectedTargetDigest) {
      throw new WorkspaceMigrationError(
        'Historical workspace digest changed during lineage preparation.', 'verification-failed',
      );
    }
    const program = finishLineageRepair(
      ledger, captured.expectedRawProjects, upgrade.upgradedProjects, upgrade.replacementProjects, snapshot,
    );
    const prepared = work ? await work.run(program) : runSync(program);
    work?.assertCurrent();
    return prepared;
  } catch (error) {
    if (work?.stopped()) work.assertCurrent();
    throw error;
  } finally {
    snapshotOwnership?.release();
  }
}

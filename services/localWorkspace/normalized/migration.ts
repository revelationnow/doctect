import { WorkspaceStoreError, type WorkspaceSnapshot } from '../contracts';
import { recovery, unavailable, type HistoricalNonReady, type createHistoricalBootstrap } from '../historicalBootstrap';
import { LEGACY_DOCUMENT_KEYS } from '../legacyTypes';
import { assertWorkRuntime, createWorkRuntime, type Ownership, type WorkRuntime } from '../../../shared/cooperativeWork.js';
import type { NormalizedRepository } from './repository';
import { normalizationRecoverySources, type NormalizationRecoverySource } from '../recovery';
import type { NormalizedWorkspaceManifest } from './workspaceManifest';

export type NormalizationCheckpoint = 'after-stage' | 'after-verify' | 'after-cutover';
export interface NormalizationEnvironment {
  repository: Pick<NormalizedRepository, 'openNormalizationSession' | 'readActiveSnapshot' | 'readRetainedSource'>;
  historical: ReturnType<typeof createHistoricalBootstrap>;
  ensurePhysicalLayout(): Promise<unknown>;
  assertCurrent?(): void;
  signal?: AbortSignal;
  work?: WorkRuntime;
  onProgress?(progress: { phase: 'discovering' | 'staging' | 'verifying' | 'activating' | 'active'; completed?: number; total?: number }): void;
  checkpoint?(point: NormalizationCheckpoint): void;
}
export type NormalizationResult = (HistoricalNonReady & { normalizationExports: NormalizationRecoverySource[] }) | {
  status: 'active'; storageGeneration: string; workspace: NormalizedWorkspaceManifest; snapshot: WorkspaceSnapshot;
};
const repositoryConflict = (error: unknown, reason: string): boolean => error instanceof Error
  && error.name === 'RepositoryConflict' && 'reason' in error && error.reason === reason;

/** Resume is this same algorithm on a new owner. No independent writer or rollback path. */
export async function normalizeWorkspace(environment: NormalizationEnvironment): Promise<NormalizationResult> {
  const work = environment.work ?? createWorkRuntime({ assertCurrent() {} });
  assertWorkRuntime(work);
  let expectedLegacyGeneration: number | undefined;
  const current = () => {
    if (environment.signal?.aborted) throw new DOMException('Normalization cancelled', 'AbortError');
    environment.assertCurrent?.();
    if (expectedLegacyGeneration !== undefined && environment.historical.currentGeneration() !== expectedLegacyGeneration) {
      throw new DOMException('Normalization legacy generation changed', 'AbortError');
    }
  };
  const removeGuard = work.addGuard(current);
  let layoutAvailable = false;
  const input = { ...environment, ensurePhysicalLayout: async () => {
    await environment.ensurePhysicalLayout(); layoutAvailable = true;
  } };
  const recover = async (result: HistoricalNonReady): Promise<NormalizationResult> => {
    if (work.stopped()) return { ...unavailable(), normalizationExports: [] };
    try { work.assertCurrent(); } catch { return { ...unavailable(), normalizationExports: [] }; }
    if (!layoutAvailable) return { ...result, normalizationExports: [] };
    try { return { ...result, normalizationExports: await normalizationRecoverySources(environment.repository, work) }; }
    catch (error) { if (work.stopped()) return { ...unavailable(), normalizationExports: [] }; throw error; }
  };
  try {
  // One runtime accumulates retries; a fresh session independently reads durable facts.
  for (let retry = 0; retry < 8; retry++) {
    try {
      if (retry) work.note('retries');
      expectedLegacyGeneration = undefined;
      const result = await runNormalization(input, work, current, generation => { expectedLegacyGeneration = generation; });
      if (result.status === 'active') return result;
      return await recover(result);
    }
    catch (error) {
      if (!repositoryConflict(error, 'normalization-contention')) throw error;
    }
  }
  return await recover(recovery('verification-failed', { message: 'Normalization authority kept changing.' }));
  } finally { removeGuard(); if (!environment.work) work.dispose(); }
}

async function runNormalization(environment: NormalizationEnvironment, work: WorkRuntime, current: () => void,
  observeGeneration: (generation: number) => void): Promise<HistoricalNonReady | Extract<NormalizationResult, { status: 'active' }>> {
  const repository = environment.repository;
  let session: ReturnType<NormalizedRepository['openNormalizationSession']> | undefined;
  let discoveryOwner: Ownership | undefined;
  const progress = (phase: Parameters<NonNullable<NormalizationEnvironment['onProgress']>>[0]['phase'], completed?: number, total?: number) => {
    try { environment.onProgress?.({ phase, ...(completed === undefined ? {} : { completed, total }) }); } catch { /* Passive observer. */ }
    work.assertCurrent();
  };
  try {
    progress('discovering');
    await work.wait(environment.ensurePhysicalLayout); work.setContext('discovery');
    const before = work.snapshot().legacyReadBytes;
    const capturedLegacy = await environment.historical.captureObservedLegacy(current, work);
    // Each successful capture measured three equal raw images. Prior generation
    // retries can only make this reservation conservative, never undercount it.
    discoveryOwner = work.own(Math.ceil((work.snapshot().legacyReadBytes - before) / 3));
    observeGeneration(capturedLegacy.generation); work.assertCurrent();
    const hasLegacy = LEGACY_DOCUMENT_KEYS.some(key => capturedLegacy.snapshot[key].present);
    const fence = async () => {
      work.setContext('legacy-fence'); work.assertCurrent();
      await environment.historical.captureObservedLegacy(current, work, capturedLegacy);
      work.assertCurrent();
    };
    session = repository.openNormalizationSession(work);
    const info = await session.prepare({ allowFresh: !hasLegacy }).catch(async error => {
      if (!repositoryConflict(error, 'historical-admission-required')) throw error;
      session!.dispose();
      const result = await environment.historical.bootstrap(() => {}, { allowCopiedReplacement: false, work });
      try { work.assertCurrent(); if (result.status !== 'admitted') throw result; }
      finally { if (result.status === 'admitted') result.release?.(); }
      session = repository.openNormalizationSession(work);
      return session.prepare({ allowFresh: false });
    });
    const publish = async () => {
      const active = await session!.reopen(); work.assertCurrent();
      if (!active) throw new Error('Missing active normalization authority');
      const acceptance = active.workspace.legacyAcceptance;
      if (acceptance.kind === 'fresh' ? hasLegacy : capturedLegacy.digest !== acceptance.digest) {
        throw new Error('Legacy source no longer matches normalization');
      }
      progress('active'); work.notify(); work.assertCurrent();
      session!.dispose(); session = undefined;
      await work.quiet(fence);
      current();
      return { status: 'active' as const, storageGeneration: active.authority.storageGeneration, workspace: active.workspace, snapshot: active.snapshot };
    };
    if (info.state === 'active') return await publish();
    if (info.source.kind === 'fresh' ? hasLegacy : info.source.acceptedLegacyDigest !== capturedLegacy.digest) {
      throw new Error('Legacy source no longer matches normalization');
    }
    await fence(); let attempt = await session.reserve(); work.assertCurrent();
    while (attempt.state === 'staging' && attempt.nextRecord < attempt.recordCount) {
      attempt = await session.stageNext(); work.assertCurrent();
      progress('staging', attempt.nextRecord, attempt.recordCount);
      environment.checkpoint?.('after-stage'); work.assertCurrent();
    }
    if (attempt.state === 'staging') {
      progress('verifying');
      await fence(); attempt = await session.verify(); work.assertCurrent();
      environment.checkpoint?.('after-verify'); work.assertCurrent();
    }
    progress('activating'); await fence(); await session.activate(); work.assertCurrent();
    environment.checkpoint?.('after-cutover'); work.assertCurrent();
    return await publish();
  } catch (error) {
    if (work.stopped()) return unavailable();
    if (repositoryConflict(error, 'normalization-contention')) throw error;
    if (error && typeof error === 'object' && 'status' in error && (error.status === 'recovery' || error.status === 'unavailable')) return error as HistoricalNonReady;
    if (error instanceof WorkspaceStoreError && ['unavailable', 'quota', 'clone', 'io', 'authority-lost'].includes(error.code)) return unavailable([], error.message);
    if (error instanceof DOMException && ['QuotaExceededError', 'AbortError', 'InvalidStateError', 'DataCloneError'].includes(error.name)) return unavailable();
    return recovery('verification-failed', { message: error instanceof Error ? error.message : 'Normalization failed.' });
  } finally { session?.dispose(); discoveryOwner?.release(); }
}

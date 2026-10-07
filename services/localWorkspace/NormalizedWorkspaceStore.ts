import type { LocalWorkspaceEnvironment } from './LocalWorkspaceStore';
import { createIndexedDbAdapter } from './indexedDbAdapter';
import { createHistoricalBootstrap, receiptFor, recovery } from './historicalBootstrap';
import { normalizeWorkspace } from './normalized/migration';
import { createWorkspaceWorkerClient, type WorkspaceWorkerFactory } from './workspaceWorkerClient';
import { createWorkspaceStartupRepository } from './workspaceStartup';
import { createWorkspaceEditingSession, type WorkspaceEditingSession } from './workspaceEditingSession';
import { prepareProjectInModuleWorker } from './projectPreparationClient';
import { captureStableLegacySnapshotWithDigest, monitorLegacyKeys } from './legacy';
import { createLegacyRecoveryBundle, createIndexedDbRecoveryBundle, exportNormalizationRecovery } from './recovery';
import { createWorkspaceRecoveryAdmission } from './workspaceRecoveryAdmission';
import { WorkspaceStoreError, type LocalWorkspaceStore, type WorkspaceBootstrapResult, type WorkspaceBootstrapObserver,
  type MigrationReceipt, type WorkspaceCommit, type WorkspaceCommand, type WorkspaceSnapshot } from './contracts';
import type { NormalizedRepository } from './normalized/repository';

const stores = new WeakMap<LocalWorkspaceStore, { session(): WorkspaceEditingSession | undefined; retry(): Promise<void> }>();
export const isNormalizedWorkspaceStore = (store: LocalWorkspaceStore): boolean => stores.has(store);
export const getNormalizedWorkspaceSession = (store: LocalWorkspaceStore): WorkspaceEditingSession | undefined => stores.get(store)?.session();
type Blocking = Exclude<WorkspaceBootstrapResult, { status: 'ready' }>;

/** Single production authority. Historical adapter is used only for the existing
 * guarded prerequisite/physical upgrade, never as an editing fallback. */
export function createNormalizedWorkspaceStore(environment: LocalWorkspaceEnvironment, options: { workerFactory?: WorkspaceWorkerFactory } = {}): LocalWorkspaceStore & { dispose(): void } {
  const observers = new Set<WorkspaceBootstrapObserver>(); let disposed = false, sourceGeneration = 0;
  let client = createWorkspaceWorkerClient(options.workerFactory), repository = createWorkspaceStartupRepository(client);
  let session: WorkspaceEditingSession | undefined, last: WorkspaceBootstrapResult | undefined, inFlight: Promise<WorkspaceBootstrapResult> | undefined;
  let sourceLifetime = new AbortController();
  // Every ready result carries the migration receipt; the gate decides whether it was already seen.
  let receipt: MigrationReceipt | undefined;
  const ready = (snapshot: WorkspaceSnapshot): WorkspaceBootstrapResult => ({ status: 'ready', snapshot, ...(receipt ? { receipt } : {}) });
  let confirmation: { id: string; lifetime: AbortController; generation: number; snapshot: import('./legacyTypes').LegacySnapshot; digest: string } | undefined;
  const current = () => { if (disposed) throw new WorkspaceStoreError('Workspace store stopped.', 'authority-lost'); };
  const notify = (result: Blocking) => { last = result; for (const observer of observers) if (!observer.signal?.aborted) {
    try { observer.onAuthorityLost?.(result); } catch { /* Passive UI notification. */ }
  } };
  const nonready = (error: unknown): Blocking => {
    const message = error instanceof Error ? error.message : 'Local workspace is unavailable.';
    return session && !disposed ? { status: 'recovery', recovery: { recoveryId: environment.randomUUID(), kind: 'verification-failed',
      category: 'editor-readmission-failed', message, availableExports: ['legacy-current', 'normalized-active', 'normalization-source'],
      canRetry: true, canRecoverLegacyAsCopies: false } } : { status: 'unavailable', message, availableExports: [] };
  };
  let stopLegacy: (() => void) | undefined;
  const observeLegacy = () => { stopLegacy ??= monitorLegacyKeys(environment.addStorageListener, () => {
    sourceGeneration++; sourceLifetime.abort(); sourceLifetime = new AbortController(); confirmation = undefined;
    if (session) { session.pause(); notify({ status: 'recovery', recovery: { recoveryId: environment.randomUUID(), kind: 'split-brain', category: 'legacy-drift',
      message: 'Legacy workspace data changed. Current working projects were preserved.', availableExports: ['legacy-current', 'normalized-active', 'normalization-source'],
      canRetry: true, canRecoverLegacyAsCopies: false } }); }
  }); };
  const sessionOptions = () => ({ uuid: environment.randomUUID, assertCurrent: current, prepareProject: prepareProjectInModuleWorker,
    retry: async () => { const result = await initialize(true); if (result.status !== 'ready') notify(result); } });
  const freshClient = () => {
    if (!session?.ownsClient(client)) client.dispose();
    client = createWorkspaceWorkerClient(options.workerFactory); repository = createWorkspaceStartupRepository(client);
  };
  function initialize(retry = false, reenter = false): Promise<WorkspaceBootstrapResult> {
    if (inFlight) return inFlight;
    // Publish custody before invoking pause/listeners or opening a worker.
    const pending = Promise.resolve().then(async () => {
      current();
      if (reenter && last?.status === 'ready' && session && !session.hasWorkingOwners()) {
        await session.flush().catch(() => {}); session.dispose(); session = undefined; freshClient();
      }
      return initializeAttempt(retry);
    }).finally(() => { if (inFlight === pending) inFlight = undefined; });
    inFlight = pending; return pending;
  }
  async function initializeAttempt(retry: boolean): Promise<WorkspaceBootstrapResult> {
    current();
    const sourceLease = sourceLifetime, sourceVersion = sourceGeneration;
    const sourceCurrent = () => { current(); if (sourceLease.signal.aborted || sourceLease !== sourceLifetime || sourceVersion !== sourceGeneration)
      throw new WorkspaceStoreError('Legacy source changed during editor admission.', 'authority-lost'); };
    // An older tab rewrote legacy projects mid-upgrade: retryable against the new source, not a storage failure.
    const legacyChanging = (): Blocking | undefined => !session && !disposed && (sourceLease.signal.aborted || sourceVersion !== sourceGeneration)
      ? recovery('legacy-changing', { availableExports: ['legacy-current'] }) : undefined;
    if (retry && session && last?.status === 'ready') {
      try {
        if (await session.tryResumeAborted(sourceCurrent)) {
          sourceCurrent(); last = ready(session.getSnapshot().workspace); session.unblock(); return last;
        }
      } catch (error) { session.pause(); const result = nonready(error); last = result; return result; }
    }
    if (retry && session) { const cut = session.pause(); await cut.whenQuiescent; freshClient(); }
    else if (last && last.status !== 'ready') freshClient();
    repository = createWorkspaceStartupRepository(client, { forEditing: true, onProgress() { current(); } });
    const adapter = createIndexedDbAdapter({ indexedDB: environment.indexedDB, now: environment.now }, 3);
    const historical = createHistoricalBootstrap({ ...environment, adapter: () => adapter, generation: () => sourceGeneration });
    try {
      const normalized = await normalizeWorkspace({ repository, historical, ensurePhysicalLayout: () => adapter.open(), assertCurrent: sourceCurrent,
        onProgress(value) { const phase = value.phase === 'opening' ? 'opening-local-storage' : value.phase === 'discovering' ? 'checking-existing-projects' : value.phase === 'staging' ? 'copying-projects'
          : value.phase === 'verifying' ? 'verifying-projects' : 'finishing-upgrade';
          for (const observer of observers) if (!observer.signal?.aborted) try { observer.onPhase?.(phase); } catch { /* Passive progress. */ }
        } });
      current();
      if (normalized.status !== 'active') {
        try {
          const active = await repository.readActiveSnapshot();
          if (active) {
            const lease = sourceLifetime, version = sourceGeneration;
            const source = await captureStableLegacySnapshotWithDigest(environment.legacyStorage, environment.crypto.subtle, { generation: () => sourceGeneration, assertCurrent: current });
            const acceptance = active.workspace.legacyAcceptance;
            if (acceptance.kind === 'fresh' || source.digest !== acceptance.digest) {
              if (!session) session = await createWorkspaceEditingSession(client, active.snapshot, active.authority.storageGeneration, sessionOptions());
              const recoveryId = environment.randomUUID();
              const canRecover = await session.validateRecoverySource(recoveryId, source.snapshot, source.digest); session.pause();
              if (lease.signal.aborted || lease !== sourceLifetime || version !== sourceGeneration) throw new WorkspaceStoreError('Recovery source changed.', 'authority-lost');
              confirmation = canRecover ? { id: recoveryId, lifetime: lease, generation: version, ...source } : undefined;
              last = { status: 'recovery', recovery: { recoveryId, kind: 'split-brain', category: 'legacy-drift',
                message: 'Legacy and normalized projects differ. Current projects were not overwritten.', canRetry: true, canRecoverLegacyAsCopies: canRecover,
                availableExports: ['legacy-current', 'normalized-active', 'normalization-source'] } }; return last;
            }
          }
        } catch { current(); /* A failed independent read cannot grant recovery admission. */ }
        const result: WorkspaceBootstrapResult = normalized.status === 'recovery' ? { status: 'recovery', recovery: { ...normalized.recovery,
          availableExports: ['legacy-current', ...normalized.normalizationExports.map(value => value.kind === 'normalized-active' ? 'normalized-active' as const : 'normalization-source' as const)] } }
          : normalized.status === 'unavailable' && session ? nonready(new WorkspaceStoreError(normalized.message, 'unavailable'))
          : normalized.status === 'unavailable' ? legacyChanging() ?? normalized : normalized;
        last = result; return result;
      }
      let candidate = session;
      if (retry && candidate) await candidate.restart(client, normalized.snapshot, true);
      else candidate = await createWorkspaceEditingSession(client, normalized.snapshot, normalized.storageGeneration, sessionOptions());
      try {
        const final = await captureStableLegacySnapshotWithDigest(environment.legacyStorage, environment.crypto.subtle,
          { generation: () => sourceGeneration, assertCurrent: sourceCurrent });
        sourceCurrent();
        const acceptance = normalized.workspace.legacyAcceptance;
        if (acceptance.kind === 'accepted' && final.digest !== acceptance.digest
          || acceptance.kind === 'fresh' && Object.values(final.snapshot).some(value => value.present)) throw new WorkspaceStoreError('Legacy source changed before publication.', 'authority-lost');
        // The one-time migration receipt is keyed by the accepted legacy source; the gate shows it once.
        const ledger = acceptance.kind === 'accepted' ? await historical.readRecognizedLedger().catch(() => undefined) : undefined;
        sourceCurrent();
        receipt = ledger?.state === 'verified' ? receiptFor(ledger) : undefined;
        session = candidate; last = ready(session.getSnapshot().workspace); session.unblock(); return last;
      } catch (error) { if (candidate !== session) candidate?.dispose(); else session?.pause(); throw error; }
    } catch (error) { const result = legacyChanging() ?? nonready(error); last = result; return result; }
    finally { adapter.close(); }
  }
  async function snapshot(): Promise<WorkspaceSnapshot> {
    current(); const read = async () => {
      const active = await repository.readActiveSnapshot(); current();
      if (!active) throw new WorkspaceStoreError('No verified normalized workspace.', 'authority-lost'); return active.snapshot;
    };
    return session ? session.exclusiveRead(read) : read();
  }
  const commit = (async (command: WorkspaceCommand) => {
    current(); const type = Object.getOwnPropertyDescriptor(command, 'type')?.value;
    if (type === 'save-project') throw new WorkspaceStoreError('Whole-project autosaves are disabled for normalized editing.', 'validation');
    if (!session) throw new WorkspaceStoreError('Workspace editing authority is unavailable.', 'authority-lost');
    if (type === 'save-document-changes' || type === 'save-editor-preferences' || type === 'replace-document' || type === 'update-project-metadata' || type === 'workspace-lifecycle') return session.commit(command);
    if (command.type === 'recover-legacy-as-copies') {
      const captured = confirmation;
      if (!captured || last?.status !== 'recovery') throw new WorkspaceStoreError('Recovery confirmation changed.', 'authority-lost');
      const originalRecovery = last.recovery;
      const confirmed = () => { current(); if (!captured || confirmation !== captured || captured.lifetime.signal.aborted
        || captured.lifetime !== sourceLifetime || captured.generation !== sourceGeneration || last?.status !== 'recovery'
        || last.recovery.recoveryId !== command.recoveryId || captured.id !== command.recoveryId) throw new WorkspaceStoreError('Recovery confirmation changed.', 'authority-lost'); };
      confirmed();
      freshClient();
      const active = await repository.readActiveSnapshot(); if (!active) throw new WorkspaceStoreError('Current workspace is invalid.', 'authority-lost');
      confirmed();
      await session.restart(client, active.snapshot, true);
      confirmed();
      const recovery = createWorkspaceRecoveryAdmission({ workspace: session.getLifecycle(), legacyStorage: environment.legacyStorage,
        generation: () => sourceGeneration, assertCurrent: confirmed, signal: captured!.lifetime.signal, subtle: environment.crypto.subtle,
        expected: { snapshot: captured!.snapshot, digest: captured!.digest, generation: captured!.generation } });
      const capability = await recovery.prepare(command.recoveryId), result = await recovery.commit(capability);
      await session.applyRecovery(result);
      const accepted = await repository.readActiveSnapshot();
      const source = await captureStableLegacySnapshotWithDigest(environment.legacyStorage, environment.crypto.subtle, { generation: () => sourceGeneration, assertCurrent: current });
      if (accepted?.workspace.legacyAcceptance.kind !== 'accepted' || accepted.workspace.legacyAcceptance.digest !== source.digest) {
        notify({ status: 'recovery', recovery: { ...originalRecovery, recoveryId: environment.randomUUID(), message: 'New legacy changes need a new confirmation.' } });
        throw new WorkspaceStoreError('Recovery committed; newer legacy changes need confirmation.', 'authority-lost');
      }
      session.unblock(); last = ready(accepted.snapshot); return accepted.snapshot;
    }
    await session.commitStructural(command as Exclude<WorkspaceCommand, { type: 'save-project' }> & Parameters<WorkspaceEditingSession['commitStructural']>[0]);
    // Snapshot-shaped callers are explicit import/bootstrap boundaries, never editor autosaves.
    return snapshot();
  }) as WorkspaceCommit;
  const api: LocalWorkspaceStore & { dispose(): void } = {
    bootstrap(observer) {
      try { current(); observeLegacy(); } catch (error) { return Promise.resolve(nonready(error)); }
      if (observer && !observer.signal?.aborted) { observers.add(observer); observer.signal?.addEventListener('abort', () => observers.delete(observer), { once: true }); }
      if (inFlight) return inFlight;
      if (last?.status === 'ready' && session?.hasWorkingOwners()) return snapshot().then(ready);
      // Reentry without a live editor never mounts its stale initializer.
      return initialize(Boolean(session), true);
    }, commit,
    async exportRecoveryBundle(source) {
      current(); const now = environment.now();
      if (source === 'legacy-current') {
        const capture = await captureStableLegacySnapshotWithDigest(environment.legacyStorage, environment.crypto.subtle, { generation: () => sourceGeneration, assertCurrent: current });
        return createLegacyRecoveryBundle(capture.snapshot, now, environment.crypto.subtle);
      }
      if (source === 'normalized-active') {
        const read = async () => {
          const active = await repository.readActiveSnapshot(); if (!active) throw new WorkspaceStoreError('Current normalized data is unavailable.', 'unavailable');
          const bundle = await exportNormalizationRecovery(repository, { kind: 'normalized-active', storageGeneration: active.authority.storageGeneration,
            cutoverRevision: active.authority.cutoverRevision }, now);
          return new Blob([JSON.stringify(bundle)], { type: 'application/json;charset=utf-8' });
        };
        return session ? session.exclusiveRead(read) : read();
      }
      const retained = await repository.readRetainedSource();
      if (source === 'legacy-original') {
        const backup = retained.backups.find(value => value.id === retained.ledger?.originalLegacyBackupId);
        if (!backup) throw new WorkspaceStoreError('Original legacy source is unavailable.', 'unavailable');
        return createLegacyRecoveryBundle(backup.snapshot, now, environment.crypto.subtle);
      }
      if (source === 'normalization-source') {
        const bundle = await exportNormalizationRecovery(repository, { kind: retained.kind === 'historical' ? 'historical-indexeddb' : 'fresh-seed',
          sourceDigest: retained.sourceDigest, authority: 'historical', rollbackReady: false }, now);
        return new Blob([JSON.stringify(bundle)], { type: 'application/json;charset=utf-8' });
      }
      if (source === 'indexeddb-workspace' && !await repository.readActiveSnapshot()) return createIndexedDbRecoveryBundle(retained.snapshot, now);
      throw new WorkspaceStoreError('Recovery source is unavailable.', 'unavailable');
    },
    dispose() { if (disposed) return; disposed = true; sourceLifetime.abort(); stopLegacy?.(); session?.dispose(); client.dispose(); for (const observer of observers) observers.delete(observer); },
  };
  stores.set(api, { session: () => session, retry: async () => { await initialize(true); } }); return api;
}

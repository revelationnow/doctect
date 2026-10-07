import React, { useEffect, useRef, useState } from 'react';
import type { WorkspaceBootstrapGateProps } from './WorkspaceBootstrapGate';
import type { MigrationReceipt, RecoverySource, WorkspaceBootstrapPhase, WorkspaceBootstrapResult, WorkspaceSnapshot } from '../../services/localWorkspace/contracts';
import { markMigrationReceiptSeen, wasMigrationReceiptSeen } from '../../services/browserPreferences';
import { MigrationReceipt as MigrationReceiptScreen } from './MigrationReceipt';
import { getNormalizedWorkspaceSession } from '../../services/localWorkspace/NormalizedWorkspaceStore';
import { downloadBlob, downloadJson } from '../../services/browserDownload';
import { WorkspaceBootstrapScreen } from './WorkspaceBootstrapScreen';
import { WorkspaceRecoveryScreen, type WorkspaceBlockingResult } from './WorkspaceRecoveryScreen';
import { OPEN_WORKSPACE_PRESENTATION, RECOVERY_SOURCE_PRESENTATION } from './recoverySourcePresentation';

/** Keep a verified live editor mounted underneath recovery. Its own source guards
 * block actions; exports and authentic retry still have the actual working owner. */
export function NormalizedWorkspaceBootstrapGate({ store, renderEditor }: WorkspaceBootstrapGateProps) {
  const [initial, setInitial] = useState<{ store: typeof store; snapshot: WorkspaceSnapshot; warnings: string[] }>();
  const [phase, setPhase] = useState<WorkspaceBootstrapPhase>('opening-local-storage');
  const [receipt, setReceipt] = useState<{ receipt: MigrationReceipt; resume(): void }>();
  const [blocking, setBlocking] = useState<WorkspaceBlockingResult>();
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [activeExport, setActiveExport] = useState<RecoverySource | null>(null);
  const lifetime = useRef<AbortController | undefined>(undefined);
  const authorityVersion = useRef(0), attemptVersion = useRef(0);
  const failure = (value: unknown): WorkspaceBlockingResult => ({ status: 'unavailable', message: value instanceof Error ? value.message : 'Local workspace is unavailable.', availableExports: ['legacy-current'] });
  /** `acknowledged` resumes a ready result held behind the migration receipt without bootstrapping again. */
  async function start(acknowledged?: WorkspaceBootstrapResult) {
    const controller = lifetime.current; if (!controller || controller.signal.aborted) return;
    const authority = authorityVersion.current, attempt = ++attemptVersion.current;
    const current = () => !controller.signal.aborted && authorityVersion.current === authority && attemptVersion.current === attempt;
    setBusy(true); setError(null);
    try {
      let result = acknowledged ?? await store.bootstrap({ signal: controller.signal, onPhase: value => { if (!controller.signal.aborted) setPhase(value); },
        onAuthorityLost: value => { if (!controller.signal.aborted) { authorityVersion.current++; setBlocking(value); } } });
      if (!current()) return;
      if (!acknowledged && result.status === 'ready' && result.receipt && !wasMigrationReceiptSeen(result.receipt.id)) {
        // Pending imports stay pending until the one-time receipt is acknowledged.
        const held = result, shown = result.receipt;
        setReceipt({ receipt: shown, resume() {
          markMigrationReceiptSeen(shown.id); setReceipt(undefined);
          void start(authorityVersion.current === authority ? held : undefined);
        } });
        return;
      }
      if (result.status === 'ready') {
        const warnings: string[] = [];
        for (const pending of result.snapshot.pendingImports) {
          const snapshot = await store.commit({ type: 'consume-import', importId: pending.id });
          if (!current()) return; warnings.push(...pending.warnings); result = { status: 'ready', snapshot };
        }
        if (result.status !== 'ready') throw Error('Workspace readiness changed');
        const snapshot = result.snapshot;
        setInitial(previous => previous?.store === store ? previous : { store, snapshot, warnings }); setBlocking(undefined);
      } else setBlocking(result);
    } catch (value) { if (current()) setBlocking(failure(value)); }
    finally { if (!controller.signal.aborted && attemptVersion.current === attempt) setBusy(false); }
  }
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller; setBlocking(undefined); setReceipt(undefined); void start();
    return () => controller.abort();
  }, [store]);
  const mounted = initial?.store === store ? initial : undefined;
  const exportSource = async (source: RecoverySource) => {
    setActiveExport(source); setError(null);
    try { downloadBlob(await store.exportRecoveryBundle(source), RECOVERY_SOURCE_PRESENTATION[source].filename); }
    catch (value) { setError(value instanceof Error ? value.message : 'Download failed.'); }
    finally { setActiveExport(null); }
  };
  const recover = async () => {
    if (blocking?.status !== 'recovery') return; setBusy(true); setError(null);
    try { await store.commit({ type: 'recover-legacy-as-copies', recoveryId: blocking.recovery.recoveryId }); await start(); }
    catch (value) { setError(value instanceof Error ? value.message : 'Recovery failed.'); }
    finally { setBusy(false); }
  };
  return <>
    {mounted && <div inert={Boolean(blocking) || undefined} aria-hidden={blocking ? true : undefined} style={blocking ? { display: 'none' } : undefined}>
      {renderEditor({ store, initialWorkspace: mounted.snapshot, initialWarnings: mounted.warnings, onWorkspaceChange() {} })}
    </div>}
    {blocking ? <WorkspaceRecoveryScreen result={blocking} onRetry={busy ? undefined : () => { void start(); }}
      onExport={source => { void exportSource(source); }} activeExport={activeExport} isRecovering={busy} actionError={error}
      onExportOpenWorkspace={mounted ? () => { try { const value = getNormalizedWorkspaceSession(store)?.readWorkingWorkspace(); if (!value) throw Error('Open work unavailable.');
        downloadJson(value, OPEN_WORKSPACE_PRESENTATION.filename); } catch (value) { setError(value instanceof Error ? value.message : 'Download failed.'); } } : undefined}
      onRecoverAsCopies={blocking.status === 'recovery' && blocking.recovery.canRecoverLegacyAsCopies ? () => { void recover(); } : undefined} />
      : !mounted && (receipt ? <MigrationReceiptScreen receipt={receipt.receipt} onContinue={receipt.resume}
        onDownloadOriginal={() => { void exportSource('legacy-original'); }} isDownloading={activeExport === 'legacy-original'} downloadError={error} />
        : <WorkspaceBootstrapScreen phase={phase} />)}
  </>;
}

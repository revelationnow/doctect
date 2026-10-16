import React, { useEffect, useRef, useState } from 'react';
import type { WorkspaceBootstrapGateProps } from './WorkspaceBootstrapGate';
import type { MigrationReceipt, RecoverySource, WorkspaceBootstrapPhase, WorkspaceBootstrapResult, WorkspaceSnapshot } from '../../services/localWorkspace/contracts';
import { markMigrationReceiptSeen, wasMigrationReceiptSeen } from '../../services/browserPreferences';
import { MigrationReceipt as MigrationReceiptScreen } from './MigrationReceipt';
import { getNormalizedWorkspaceSession } from '../../services/localWorkspace/NormalizedWorkspaceStore';
import { downloadBlob, downloadJson } from '../../services/browserDownload';
import { loadGalleryProject, openGalleryRequest, type GalleryOpenProgress } from '../../services/galleryOpen';
import { GalleryOpenErrorScreen } from './GalleryOpenErrorScreen';
import { GALLERY_OPEN_STEPS, PENDING_OPEN_STEPS, WorkspaceBootstrapScreen, type OpeningProgress } from './WorkspaceBootstrapScreen';
import { WorkspaceRecoveryScreen, type WorkspaceBlockingResult } from './WorkspaceRecoveryScreen';
import { OPEN_WORKSPACE_PRESENTATION, RECOVERY_SOURCE_PRESENTATION } from './recoverySourcePresentation';

/** Keep a verified live editor mounted underneath recovery. Its own source guards
 * block actions; exports and authentic retry still have the actual working owner. */
export function NormalizedWorkspaceBootstrapGate({ store, renderEditor, galleryOpen, onGalleryOpenSettled, onBackToGallery }: WorkspaceBootstrapGateProps) {
  const [initial, setInitial] = useState<{ store: typeof store; snapshot: WorkspaceSnapshot; warnings: string[] }>();
  const [phase, setPhase] = useState<WorkspaceBootstrapPhase>('opening-local-storage');
  const [receipt, setReceipt] = useState<{ receipt: MigrationReceipt; resume(): void }>();
  const [blocking, setBlocking] = useState<WorkspaceBlockingResult>();
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [activeExport, setActiveExport] = useState<RecoverySource | null>(null);
  const lifetime = useRef<AbortController | undefined>(undefined);
  const authorityVersion = useRef(0), attemptVersion = useRef(0);
  // Gallery Direct Open (spec section 2). The request is read once; `settled` marks it opened or dropped, so a later
  // bootstrap (retry, recovery) never opens it twice. `readyFor` is the workspace as bootstrapped, for "Continue to
  // editor" after a failed open. The opening screen stays over the mounted editor until it reports its first frame.
  const request = useRef(galleryOpen), settled = useRef(false);
  const readyFor = useRef<{ snapshot: WorkspaceSnapshot; warnings: string[] } | undefined>(undefined);
  const [opening, setOpening] = useState<OpeningProgress | undefined>(() => request.current
    ? { name: request.current.name, steps: GALLERY_OPEN_STEPS, step: 'workspace' } : undefined);
  const [galleryFailure, setGalleryFailure] = useState(false), [editorReady, setEditorReady] = useState(false);
  const failure = (value: unknown): WorkspaceBlockingResult => ({ status: 'unavailable', message: value instanceof Error ? value.message : 'Local workspace is unavailable.', availableExports: ['legacy-current'] });
  /** `acknowledged` resumes a ready result held behind the migration receipt without bootstrapping again. */
  async function start(acknowledged?: WorkspaceBootstrapResult) {
    const controller = lifetime.current; if (!controller || controller.signal.aborted) return;
    const authority = authorityVersion.current, attempt = ++attemptVersion.current;
    const current = () => !controller.signal.aborted && authorityVersion.current === authority && attemptVersion.current === attempt;
    // Every attempt (a gallery retry, a recovery retry, a receipt resume) starts from a clean gallery state.
    setBusy(true); setError(null); setGalleryFailure(false);
    try {
      // The download starts now, overlapping the local bootstrap. `openGalleryRequest` ignores it when the target
      // already exists, and an attempt may be superseded, so its rejection is never left unhandled.
      const requested = settled.current ? undefined : request.current;
      const download = requested && loadGalleryProject(requested.galleryId);
      void download?.catch(() => {});
      if (requested) setOpening({ name: requested.name, steps: GALLERY_OPEN_STEPS, step: 'workspace' });
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
        const imports = result.snapshot.pendingImports;
        if (imports.length > 0 && !request.current) setOpening(previous => previous ?? { name: imports[0].name, steps: PENDING_OPEN_STEPS, step: 'prepare' });
        for (const pending of result.snapshot.pendingImports) {
          const snapshot = await store.commit({ type: 'consume-import', importId: pending.id });
          if (!current()) return; warnings.push(...pending.warnings); result = { status: 'ready', snapshot };
        }
        if (result.status !== 'ready') throw Error('Workspace readiness changed');
        readyFor.current = { snapshot: result.snapshot, warnings: [...warnings] };
        if (requested && download) {
          const progress = (step: GalleryOpenProgress) => { if (current()) setOpening(previous => previous && { ...previous, step }); };
          let opened: Awaited<ReturnType<typeof openGalleryRequest>>;
          try { opened = await openGalleryRequest(store, result.snapshot, requested, download, progress); }
          catch (value) { if (current()) { console.error('Could not open the gallery project:', value); setGalleryFailure(true); } return; }
          if (!current()) return;
          settled.current = true; onGalleryOpenSettled?.();
          result = { status: 'ready', snapshot: opened.snapshot }; warnings.push(...opened.warnings);
        }
        setOpening(previous => previous && { ...previous, step: 'editor' });
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
  const continueToEditor = () => {
    const ready = readyFor.current; if (!ready) return;
    request.current = undefined; settled.current = true; onGalleryOpenSettled?.();
    setGalleryFailure(false); setOpening(undefined);
    setInitial(previous => previous?.store === store ? previous : { store, snapshot: ready.snapshot, warnings: ready.warnings });
  };
  // Under recovery the editor is hidden outright; under the opening screen (spec section 3) it stays painted, so its
  // first frame means "drawn", but takes no input and is out of the accessibility tree until the screen lifts.
  const covered = Boolean(blocking || (opening && !editorReady));
  return <>
    {mounted && <div inert={covered || undefined} aria-hidden={covered ? true : undefined} style={blocking ? { display: 'none' } : undefined}>
      {renderEditor({ store, initialWorkspace: mounted.snapshot, initialWarnings: mounted.warnings, onWorkspaceChange() {}, onReady: () => setEditorReady(true) })}
    </div>}
    {blocking ? <WorkspaceRecoveryScreen result={blocking} onRetry={busy ? undefined : () => { void start(); }}
      onExport={source => { void exportSource(source); }} activeExport={activeExport} isRecovering={busy} actionError={error}
      onExportOpenWorkspace={mounted ? () => { try { const value = getNormalizedWorkspaceSession(store)?.readWorkingWorkspace(); if (!value) throw Error('Open work unavailable.');
        downloadJson(value, OPEN_WORKSPACE_PRESENTATION.filename); } catch (value) { setError(value instanceof Error ? value.message : 'Download failed.'); } } : undefined}
      onRecoverAsCopies={blocking.status === 'recovery' && blocking.recovery.canRecoverLegacyAsCopies ? () => { void recover(); } : undefined} />
      : galleryFailure ? <GalleryOpenErrorScreen name={request.current?.name ?? ''} onRetry={() => { void start(); }} onContinue={continueToEditor}
        onBack={() => { if (request.current) onBackToGallery?.(request.current.galleryId); }} />
      : !mounted ? (receipt ? <MigrationReceiptScreen receipt={receipt.receipt} onContinue={receipt.resume}
        onDownloadOriginal={() => { void exportSource('legacy-original'); }} isDownloading={activeExport === 'legacy-original'} downloadError={error} />
        : <WorkspaceBootstrapScreen phase={phase} opening={opening} />)
      : opening && !editorReady && <WorkspaceBootstrapScreen phase={phase} opening={opening} overlay />}
  </>;
}

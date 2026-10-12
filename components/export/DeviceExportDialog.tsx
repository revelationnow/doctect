import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Tablet, X } from 'lucide-react';
import type { AppState } from '../../types';
import { useFormFactor } from '../editor-layout/FormFactorContext';
import { useBackDismiss } from '../editor-layout/useBackDismiss';
import { trapTab } from '../editor-layout/focusTrap';
import { DEVICE_PROFILES, PLATFORMS, PLATFORM_LABELS, getProfile } from '../../services/deviceExport/deviceProfiles';
import { buildPageGroups, defaultSelection, exportBlockReason, filterGroups, imageCount, type TemplateGroup } from '../../services/deviceExport/selection';
import { readDeviceExportSettings, writeDeviceExportSettings } from '../../services/deviceExport/settings';
import { runDeviceExport, type DeviceExportProgress } from '../../services/deviceExport/exportJob';
import { downloadBlob } from '../../services/browserDownload';
import { trackEvent } from '../../services/analytics';

const COLLAPSED_PAGES = 3;

export interface DeviceExportDialogProps {
    isOpen: boolean;
    onClose: () => void;
    /** Read when the dialog opens: the export uses the project as it was then. */
    getState: () => AppState;
    projectName: string;
    /** "Force greyscale" starts here until the picker has remembered its own choice. */
    initialForceGreyscale: boolean;
    runExport?: typeof runDeviceExport;
    download?: typeof downloadBlob;
}

type Phase = { kind: 'idle' } | { kind: 'running'; progress: DeviceExportProgress } | { kind: 'error'; message: string };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const toggled = (set: ReadonlySet<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
};

/**
 * "Export for device": pick template/page combinations and e-ink models, then download one zip.
 * A centred modal on desktop and tablet, full screen on phone. Keydown stops at the dialog so the
 * editor's shortcuts (Delete, undo) never act on the canvas behind it.
 */
export function DeviceExportDialog(props: DeviceExportDialogProps) {
    if (!props.isOpen) return null;
    return <OpenDeviceExportDialog {...props} />;
}

function OpenDeviceExportDialog({ onClose, getState, projectName, initialForceGreyscale, runExport = runDeviceExport, download = downloadBlob }: DeviceExportDialogProps) {
    const phone = useFormFactor() === 'phone';
    const [state] = useState(getState);
    const groups = useMemo(() => buildPageGroups(state), [state]);
    const [settings] = useState(() => readDeviceExportSettings(initialForceGreyscale));
    const [pages, setPages] = useState(() => defaultSelection(groups));
    const [devices, setDevices] = useState<Set<string>>(() => new Set(settings.devices));
    const [forceGreyscale, setForceGreyscale] = useState(settings.forceGreyscale);
    const [includePdf, setIncludePdf] = useState(settings.includePdf);
    const [query, setQuery] = useState('');
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
    const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
    const run = useRef<AbortController | null>(null);
    const dialog = useRef<HTMLDivElement>(null);
    const exportButton = useRef<HTMLButtonElement>(null);

    const running = phase.kind === 'running';
    const visible = filterGroups(groups, query);
    const count = imageCount(pages.size, devices.size);
    const blocked = exportBlockReason(pages.size, devices.size);
    const pdfCapable = [...devices].some(id => getProfile(id)?.platform !== 'remarkable');

    const close = () => { run.current?.abort(); run.current = null; onClose(); };
    useBackDismiss(true, () => { close(); });
    useLayoutEffect(() => {
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.current?.focus();
        return () => { if (previous?.isConnected) previous.focus(); };
    }, []);
    // A failed run brings Export back: put focus on it so a retry is one keypress away.
    useLayoutEffect(() => { if (phase.kind === 'error') exportButton.current?.focus(); }, [phase.kind]);
    useEffect(() => () => run.current?.abort(), []);

    const setGroup = (group: TemplateGroup, on: boolean) => setPages(current => {
        const next = new Set(current);
        for (const page of group.pages) if (on) next.add(page.nodeId); else next.delete(page.nodeId);
        return next;
    });

    const startExport = async () => {
        if (blocked || running) return;
        const withPdf = includePdf && pdfCapable;
        writeDeviceExportSettings({ devices: [...devices], forceGreyscale, includePdf });
        // The Export button leaves the DOM while the run is on; keep focus (and the Tab trap) inside the dialog.
        dialog.current?.focus();
        const controller = new AbortController();
        run.current = controller;
        setPhase({ kind: 'running', progress: { phase: 'preparing', done: 0, total: count } });
        try {
            const result = await runExport(
                { state, projectName, pageNodeIds: [...pages], deviceIds: [...devices], forceGreyscale, includePdf: withPdf },
                { signal: controller.signal, onProgress: progress => { if (!controller.signal.aborted) setPhase({ kind: 'running', progress }); } },
            );
            if (controller.signal.aborted) return;
            download(result.blob, result.fileName);
            void trackEvent('device_templates_exported', {
                pageCount: pages.size, deviceIds: [...devices], imageCount: result.imageCount,
                forcedGreyscale: forceGreyscale, includePdf: withPdf, failures: result.failures,
            });
            onClose();
        } catch (error) {
            if (controller.signal.aborted) return;
            setPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
        } finally {
            if (run.current === controller) run.current = null;
        }
    };
    const cancelRun = () => { run.current?.abort(); run.current = null; setPhase({ kind: 'idle' }); };

    const progressText = phase.kind !== 'running' ? null
        : phase.progress.phase === 'preparing' ? 'Preparing pages…'
            : phase.progress.phase === 'packaging' ? 'Packaging…'
                : `Rendering ${phase.progress.done} / ${phase.progress.total}`;
    const statusText = progressText ?? blocked ?? `${plural(pages.size, 'page')} × ${plural(devices.size, 'device')} = ${plural(count, 'template')} (.zip)`;
    const row = clsx('flex items-center gap-2 text-sm text-slate-700', phone && 'min-h-11');

    return createPortal(
        <div className={clsx('fixed inset-0 z-50 flex bg-black/50', !phone && 'items-center justify-center p-4')}>
            <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="device-export-title" aria-busy={running || undefined} tabIndex={-1}
                onKeyDown={event => {
                    event.stopPropagation();
                    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
                    trapTab(event, dialog.current);
                }}
                className={clsx('flex flex-col bg-white outline-none', phone ? 'h-full w-full' : 'max-h-[90dvh] w-full max-w-2xl rounded-xl shadow-2xl')}>
                <div className="flex items-center justify-between border-b px-4 py-3">
                    <h2 id="device-export-title" className="flex items-center gap-2 text-lg font-bold text-slate-800">
                        <Tablet size={18} className="text-blue-600" /> Export for device
                    </h2>
                    <button type="button" onClick={close} aria-label="Close export for device"
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                        <X size={20} />
                    </button>
                </div>
                <div className="flex-1 space-y-5 overflow-y-auto px-4 py-3">
                    <section aria-labelledby="device-export-pages">
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <h3 id="device-export-pages" className="text-sm font-semibold text-slate-800">Pages</h3>
                            <input type="search" aria-label="Search pages" placeholder="Search pages" value={query} onChange={event => setQuery(event.target.value)}
                                className="w-48 rounded border border-slate-300 px-2 py-1 text-sm" />
                        </div>
                        {groups.length === 0 && <p className="text-sm text-slate-500">This project has no pages to export.</p>}
                        {visible.map(group => (
                            <PageGroup key={group.templateId} group={group} selected={pages} disabled={running} rowClass={row}
                                showAll={query.trim() !== '' || expanded.has(group.templateId)}
                                onToggle={id => setPages(current => toggled(current, id))}
                                onSetAll={on => setGroup(group, on)}
                                onExpand={() => setExpanded(current => new Set(current).add(group.templateId))} />
                        ))}
                    </section>
                    <section aria-labelledby="device-export-devices">
                        <h3 id="device-export-devices" className="mb-2 text-sm font-semibold text-slate-800">Devices</h3>
                        {PLATFORMS.map(platform => (
                            <fieldset key={platform} className="mb-2">
                                <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">{PLATFORM_LABELS[platform]}</legend>
                                <div className="flex flex-wrap gap-x-4">
                                    {DEVICE_PROFILES.filter(profile => profile.platform === platform).map(profile => (
                                        <label key={profile.id} className={row}>
                                            <input type="checkbox" checked={devices.has(profile.id)} disabled={running}
                                                onChange={() => setDevices(current => toggled(current, profile.id))} />
                                            {profile.name}
                                        </label>
                                    ))}
                                </div>
                            </fieldset>
                        ))}
                        <label className={row}>
                            <input type="checkbox" checked={forceGreyscale} disabled={running} onChange={event => setForceGreyscale(event.target.checked)} />
                            Force greyscale
                        </label>
                        {pdfCapable && (
                            <label className={row}>
                                <input type="checkbox" checked={includePdf} disabled={running} onChange={event => setIncludePdf(event.target.checked)} />
                                Also include a PDF template
                            </label>
                        )}
                    </section>
                </div>
                <div className="space-y-2 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                    <p role="status" className="text-sm text-slate-600">{statusText}</p>
                    {phase.kind === 'error' && <p role="alert" className="text-sm text-red-600">Export failed: {phase.message}</p>}
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={running ? cancelRun : close}
                            className="min-h-11 rounded px-4 text-sm font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">Cancel</button>
                        {!running && (
                            <button ref={exportButton} type="button" onClick={() => { void startExport(); }} disabled={blocked !== null}
                                className="min-h-11 rounded bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">Export</button>
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}

function PageGroup({ group, selected, disabled, rowClass, showAll, onToggle, onSetAll, onExpand }: {
    group: TemplateGroup; selected: ReadonlySet<string>; disabled: boolean; rowClass: string; showAll: boolean;
    onToggle: (nodeId: string) => void; onSetAll: (on: boolean) => void; onExpand: () => void;
}) {
    const ticked = group.pages.filter(page => selected.has(page.nodeId)).length;
    const all = useRef<HTMLInputElement>(null);
    useEffect(() => { if (all.current) all.current.indeterminate = ticked > 0 && ticked < group.pages.length; });
    const shown = showAll ? group.pages : group.pages.slice(0, COLLAPSED_PAGES);
    const hidden = group.pages.length - shown.length;
    // "… N more" removes itself when pressed; focus would fall to <body>, taking Escape and the Tab
    // trap with it. Hand focus to the first page it revealed instead.
    const revealed = useRef<HTMLInputElement>(null);
    const focusRevealed = useRef(false);
    useLayoutEffect(() => {
        if (!focusRevealed.current) return;
        focusRevealed.current = false;
        revealed.current?.focus();
    }, [showAll]);
    return (
        <div role="group" aria-label={group.name} className="mb-2">
            <div className="flex items-center gap-3">
                <label className={clsx(rowClass, 'font-medium')}>
                    <input ref={all} type="checkbox" checked={ticked === group.pages.length} disabled={disabled} onChange={event => onSetAll(event.target.checked)} />
                    {group.name} ({group.pages.length})
                </label>
                <button type="button" disabled={disabled} onClick={() => onSetAll(true)} aria-label={`Select all pages of ${group.name}`} className="text-xs text-blue-600 hover:underline">all</button>
                <button type="button" disabled={disabled} onClick={() => onSetAll(false)} aria-label={`Clear pages of ${group.name}`} className="text-xs text-blue-600 hover:underline">none</button>
            </div>
            <ul className="ml-6">
                {shown.map((page, index) => (
                    <li key={page.nodeId}>
                        <label className={rowClass}>
                            <input ref={index === COLLAPSED_PAGES ? revealed : undefined} type="checkbox" checked={selected.has(page.nodeId)} disabled={disabled} onChange={() => onToggle(page.nodeId)} />
                            {page.title}
                        </label>
                    </li>
                ))}
            </ul>
            {hidden > 0 && (
                <button type="button" onClick={() => { focusRevealed.current = true; onExpand(); }} className="ml-6 text-xs text-blue-600 hover:underline">… {hidden} more</button>
            )}
        </div>
    );
}

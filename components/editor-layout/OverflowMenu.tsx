import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { TouchEditorActions } from './touchActions';
import type { EditorChrome } from './EditorChromeContext';

/** Elements that use Escape themselves (the preview-node select closes its own dropdown). */
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const isEditableTarget = (target: EventTarget | null): boolean =>
    target instanceof Element && target.closest(EDITABLE_SELECTOR) !== null;

const Item = ({ label, onClick, checked, disabled }: { label: string; onClick: () => void; checked?: boolean; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={checked}
        className="flex min-h-11 w-full items-center justify-between px-4 text-left text-sm text-slate-700 disabled:opacity-40">
        <span>{label}</span>
        {/* Visual echo of aria-pressed; hidden from the name so toggles stay reachable by label. */}
        {checked !== undefined && <span aria-hidden="true" className="text-xs text-slate-400">{checked ? 'On' : 'Off'}</span>}
    </button>
);

const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="border-b border-slate-100 py-1">
        <h3 className="px-4 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
        {children}
    </section>
);

/**
 * The ⋯ bottom sheet on phone and tablet. One-shot actions close the sheet; toggles keep it
 * open so their On/Off state can be read back. Closes on backdrop tap or Escape.
 * `chrome` is null on tablet, which keeps the desktop page header (cloud/account live there).
 *
 * The overlay is portalled to document.body: the bars that own this menu are flex items, and
 * any z-index on them would make a stacking context that traps a `fixed` child beneath the
 * sidebar drawer and properties sheet. Focus moves into the sheet on open and returns to
 * whatever had it (the ⋯ trigger) on every close path.
 */
export function OverflowMenu({ open, onClose, actions, chrome }: {
    open: boolean; onClose: () => void; actions: TouchEditorActions; chrome: EditorChrome | null;
}) {
    const svgInput = useRef<HTMLInputElement>(null);
    const dialog = useRef<HTMLDivElement>(null);
    // Latest onClose without re-running the open/close effect when the parent passes a new closure.
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; });

    useEffect(() => {
        if (!open) return;
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.current?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (event.defaultPrevented || isEditableTarget(event.target)) return;
            onCloseRef.current();
        };
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('keydown', onKey);
            if (previouslyFocused?.isConnected) previouslyFocused.focus();
        };
    }, [open]);

    if (!open) return null;
    const run = (fn: () => void) => () => { fn(); onClose(); };

    return createPortal(
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
            <div data-testid="overflow-menu-backdrop" aria-hidden="true" className="flex-1 bg-black/30" onClick={onClose} />
            <div ref={dialog} role="dialog" aria-modal="true" aria-label="More actions" tabIndex={-1}
                className="max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] outline-none">
                {actions.hasSelection && (
                    <Group title="Selection">
                        <Item label="Duplicate selection" onClick={run(actions.duplicateSelection)} />
                        <Item label="Delete selection" onClick={run(actions.deleteSelection)} />
                    </Group>
                )}
                <Group title="Export">
                    <Item label="Export PDF" onClick={run(actions.exportPdf)} disabled={actions.isExporting} />
                    <Item label="Export all variants" onClick={run(actions.exportAllVariants)}
                        disabled={actions.isExporting || !actions.canExportAllVariants} />
                    <Item label="Greyscale export" onClick={actions.toggleGreyscale} checked={actions.greyscale} />
                </Group>
                <Group title="Canvas">
                    <Item label="Snap to grid" onClick={actions.toggleSnap} checked={actions.snapToGrid} />
                    <Item label="Show grid" onClick={actions.toggleGrid} checked={actions.showGrid} />
                    {actions.preview && (
                        <label className="flex min-h-11 items-center justify-between gap-3 px-4 text-sm text-slate-700">
                            <span>Preview node</span>
                            <select value={actions.preview.selectedId} aria-label="Preview node"
                                onChange={event => actions.preview!.onSelect(event.target.value)}
                                className="min-h-11 max-w-[55%] rounded border border-slate-200">
                                {actions.preview.options.map(option => (
                                    <option key={option.id} value={option.id}>{option.title}</option>
                                ))}
                            </select>
                        </label>
                    )}
                </Group>
                <Group title="Project">
                    <Item label="JSON" onClick={run(actions.openJson)} />
                    <Item label="Generator" onClick={run(actions.openGenerator)} />
                    <Item label="Save preset" onClick={run(actions.savePreset)} />
                    <Item label="Import SVG" onClick={() => svgInput.current?.click()} />
                    <Item label="Insert SVG placeholder" onClick={run(actions.insertSvgPlaceholder)} />
                    <input ref={svgInput} type="file" accept=".svg,image/svg+xml" hidden
                        onChange={event => {
                            const file = event.target.files?.[0];
                            if (file) { actions.importSvg(file); onClose(); }
                            event.target.value = '';
                        }} />
                </Group>
                {chrome && (
                    <>
                        <Group title="Cloud"><div className="px-4 py-2">{chrome.cloudMenu}</div></Group>
                        <Group title="Account"><div className="px-4 py-2">{chrome.accountMenu}</div></Group>
                    </>
                )}
            </div>
        </div>,
        document.body,
    );
}

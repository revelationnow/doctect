import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import type { TouchEditorActions } from './touchActions';
import type { EditorChrome } from './EditorChromeContext';
import { useBackDismiss } from './useBackDismiss';
import { trapTab } from './focusTrap';
import { MENU_ROW_CLASS, MenuListContext, type MenuListHost } from './MenuListContext';
import { ALIGN_ACTIONS } from '../../services/alignElements';

/** Elements that use Escape themselves (the preview-node select closes its own dropdown). */
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const isEditableTarget = (target: EventTarget | null): boolean =>
    target instanceof Element && target.closest(EDITABLE_SELECTOR) !== null;

const Item = ({ label, onClick, checked, disabled }: { label: string; onClick: () => void; checked?: boolean; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={checked}
        className={clsx(MENU_ROW_CLASS, 'justify-between disabled:opacity-40')}>
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
 * whatever had it (the ⋯ trigger) on every close path; while open, Tab cycles within the sheet,
 * Cloud and Account rows included (a modal one of those rows opens keeps its own trap: see trapTab).
 *
 * The focus hand-off is a layout effect on purpose: items like "Save preset" and "Generator"
 * close the sheet and mount a modal in the same commit, and those modals focus themselves in a
 * useLayoutEffect. Layout cleanups run in the mutation phase, before any new layout effect, so
 * the trigger gets focus back first and the modal then takes it. A passive cleanup would run
 * after the modal's focus and steal it back behind the modal.
 */
export function OverflowMenu({ open, onClose, actions, chrome }: {
    open: boolean; onClose: () => void; actions: TouchEditorActions; chrome: EditorChrome | null;
}) {
    const svgInput = useRef<HTMLInputElement>(null);
    const dialog = useRef<HTMLDivElement>(null);
    // Latest onClose without re-running the open/close effect when the parent passes a new closure.
    const onCloseRef = useRef(onClose);
    useLayoutEffect(() => { onCloseRef.current = onClose; });
    // Touch: the back gesture closes the sheet; any other close consumes its history entry.
    useBackDismiss(open, onClose);
    // Cloud and Account render as rows of this sheet rather than as the header's popovers, and a
    // completed action or a followed link in them closes the sheet like its own one-shot rows.
    const listHost = useMemo<MenuListHost>(() => ({ onDismiss: () => onCloseRef.current() }), []);

    useLayoutEffect(() => {
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
                onKeyDown={event => trapTab(event, dialog.current)}
                className="max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] outline-none">
                {actions.hasSelection && (
                    <Group title="Selection">
                        <Item label="Duplicate selection" onClick={run(actions.duplicateSelection)} />
                        <Item label="Delete selection" onClick={run(actions.deleteSelection)} />
                        {/* The only way to empty the selection while "Select multiple" is on (empty-canvas taps are inert then). */}
                        <Item label="Clear selection" onClick={run(actions.clearSelection)} />
                    </Group>
                )}
                {actions.canAlign && (
                    // The desktop toolbar's align/distribute row, which appears there at two or more selected.
                    <Group title="Arrange">
                        {ALIGN_ACTIONS.map(({ type, label }) => (
                            <Item key={type} label={label} onClick={run(() => actions.align(type))} />
                        ))}
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
                        <MenuListContext.Provider value={listHost}>
                            <Group title="Cloud">{chrome.cloudMenu}</Group>
                            <Group title="Account">{chrome.accountMenu}</Group>
                        </MenuListContext.Provider>
                        {chrome.navigation && chrome.navigation.length > 0 && (
                            // Router links, like the desktop header: the unsaved-work blocker applies.
                            // The sheet closes first so a blocker dialog is not hidden beneath it.
                            <Group title="Navigate">
                                {chrome.navigation.map(target => (
                                    <Link key={target.to} to={target.to} onClick={onClose} className={MENU_ROW_CLASS}>
                                        {target.label}
                                    </Link>
                                ))}
                            </Group>
                        )}
                    </>
                )}
            </div>
        </div>,
        document.body,
    );
}

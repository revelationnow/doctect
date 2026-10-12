import React, { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useBackDismiss } from '../editor-layout/useBackDismiss';
import { trapTab } from '../editor-layout/focusTrap';
import { MENU_ROW_BASE_CLASS, MENU_ROW_CLASS } from '../editor-layout/MenuListContext';

export interface RowAction {
    label: string;
    onSelect: () => void;
    destructive?: boolean;
}

/**
 * The bottom sheet behind a sidebar row's ⋯ button on phone and tablet, where the row's hover
 * actions would otherwise crowd its name out of the drawer. Titled with the row's full name; every
 * action is one-shot and closes the sheet. Closes on backdrop tap, Escape or the back gesture.
 *
 * Portalled to document.body, above the drawer. React still bubbles the sheet's events through the
 * row that owns it, so clicks stop at the sheet (a tap on an action must not also select the row),
 * and Escape is marked handled so the drawer underneath stays open. Focus moves into the sheet on
 * open and returns to the ⋯ trigger on close, in a layout effect so that an action which mounts a
 * focused field in the same commit (Rename's input) keeps the focus.
 */
export function RowActionSheet({ open, title, actions, onClose }: {
    open: boolean; title: string; actions: RowAction[]; onClose: () => void;
}) {
    const dialog = useRef<HTMLDivElement>(null);
    useBackDismiss(open, onClose);

    useLayoutEffect(() => {
        if (!open) return;
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.current?.focus();
        return () => { if (previouslyFocused?.isConnected) previouslyFocused.focus(); };
    }, [open]);

    if (!open) return null;

    return createPortal(
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={event => event.stopPropagation()}>
            <div data-testid="row-action-sheet-backdrop" aria-hidden="true" className="flex-1 bg-black/30" onClick={onClose} />
            <div ref={dialog} role="dialog" aria-modal="true" aria-label={`Actions for ${title}`} tabIndex={-1}
                onKeyDown={event => {
                    if (event.key === 'Escape' && !event.defaultPrevented) {
                        event.preventDefault();
                        onClose();
                        return;
                    }
                    trapTab(event, dialog.current);
                }}
                className="max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] outline-none">
                <h3 className="break-words border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">{title}</h3>
                <div className="py-1">
                    {actions.map(action => (
                        <button key={action.label} type="button"
                            onClick={() => { onClose(); action.onSelect(); }}
                            className={action.destructive ? clsx(MENU_ROW_BASE_CLASS, 'text-red-600') : MENU_ROW_CLASS}>
                            {action.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>,
        document.body,
    );
}

import React, { useEffect } from 'react';

/** Elements that use Escape themselves (e.g. the Sidebar's rename input cancels its edit). */
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const isEditableTarget = (target: EventTarget | null): boolean =>
    target instanceof Element && target.closest(EDITABLE_SELECTOR) !== null;

/**
 * Left overlay drawer that hosts the unchanged `Sidebar` on phone and tablet.
 * Presentational only: the owner decides when it is open; it closes on backdrop
 * tap or Escape (the spec's third close path, picking a page, is the owner's job).
 */
export function SidebarDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            // Escape already consumed by a child, or aimed at a field that handles it (the Sidebar's
            // rename input cancels the rename on Escape without stopping propagation): keep the drawer.
            if (event.defaultPrevented || isEditableTarget(event.target)) return;
            onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;
    return (
        <div className="absolute inset-0 z-40 flex">
            <div role="dialog" aria-modal="true" aria-label="Pages and templates"
                className="relative flex h-full w-[min(85vw,320px)] flex-col bg-white shadow-2xl">
                {children}
            </div>
            <div data-testid="sidebar-drawer-backdrop" aria-hidden="true" className="flex-1 bg-black/30" onClick={onClose} />
        </div>
    );
}

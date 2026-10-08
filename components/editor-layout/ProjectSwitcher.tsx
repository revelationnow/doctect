import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Plus, X } from 'lucide-react';
import type { EditorChrome } from './EditorChromeContext';
import { useBackDismiss } from './useBackDismiss';

const MENU_WIDTH_PX = 256;
const MENU_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;

/**
 * Phone replacement for the tab strip: the active project's name opens a menu listing the open
 * projects with per-project Close and a New project entry. The menu closes after any choice,
 * on a tap outside it, or on Escape.
 *
 * The menu is portalled to document.body and positioned `fixed` from the trigger's rect, so no
 * stacking context created by the top bar can trap it beneath the drawer or properties sheet.
 */
export function ProjectSwitcher({ chrome }: { chrome: EditorChrome }) {
    const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
    const open = position !== null;
    const trigger = useRef<HTMLButtonElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    const active = chrome.projects.find(project => project.id === chrome.activeProjectId);

    const close = () => setPosition(null);
    // Touch: the back gesture closes the menu; a choice or an outside tap consumes its entry.
    useBackDismiss(open, close);
    const toggle = () => {
        if (open) { close(); return; }
        const rect = trigger.current?.getBoundingClientRect();
        const maxLeft = Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - MENU_WIDTH_PX - VIEWPORT_MARGIN_PX);
        setPosition({
            top: (rect?.bottom ?? 0) + MENU_GAP_PX,
            left: Math.min(Math.max(VIEWPORT_MARGIN_PX, rect?.left ?? 0), maxLeft),
        });
    };

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: Event) => {
            if (!(event.target instanceof Node)) return;
            if (trigger.current?.contains(event.target) || menu.current?.contains(event.target)) return;
            close();
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !event.defaultPrevented) close();
        };
        // Capture phase so a canvas gesture handler that stops propagation cannot keep the menu open.
        document.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('keydown', onKey);
        // The menu's position is measured once at open; a resize (orientation change, keyboard)
        // or a scroll elsewhere would leave it stale, so both simply dismiss it. Scroll does not
        // bubble, hence the capture-phase listener on the document; scrolling the menu's own
        // list moves nothing it is anchored to, so that is ignored.
        const onScroll = (event: Event) => {
            if (event.target instanceof Node && menu.current?.contains(event.target)) return;
            close();
        };
        window.addEventListener('resize', close);
        document.addEventListener('scroll', onScroll, true);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('resize', close);
            document.removeEventListener('scroll', onScroll, true);
        };
    }, [open]);

    const choose = (fn: () => void) => () => { fn(); close(); };

    return (
        <div className="min-w-0 flex-1">
            <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} onClick={toggle}
                className="flex min-h-11 max-w-full items-center gap-1 truncate px-1 text-sm font-semibold text-slate-800">
                <span className="truncate">{active?.name || 'Untitled'}</span>
                <ChevronDown size={16} className="shrink-0" />
            </button>
            {position && createPortal(
                <div ref={menu} role="menu" style={{ position: 'fixed', top: position.top, left: position.left, width: MENU_WIDTH_PX }}
                    className="z-50 max-h-[60dvh] overflow-y-auto rounded-xl border bg-white py-1 shadow-xl">
                    {/* Every row of the menu is a menuitem, the per-project Close included; the
                        flex wrapper pairing a project with its Close is transparent to the tree. */}
                    {chrome.projects.map(project => (
                        <div key={project.id} role="none" className="flex items-center">
                            <button type="button" role="menuitem" className="min-h-11 flex-1 truncate px-3 text-left text-sm"
                                onClick={choose(() => chrome.onSelectProject(project.id))}>
                                {project.name || 'Untitled'}
                            </button>
                            <button type="button" role="menuitem" aria-label={`Close ${project.name || 'Untitled'}`}
                                onClick={choose(() => chrome.onCloseProject(project.id))}
                                className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-400">
                                <X size={16} />
                            </button>
                        </div>
                    ))}
                    <button type="button" role="menuitem" className="flex min-h-11 w-full items-center gap-2 px-3 text-sm text-blue-600"
                        onClick={choose(chrome.onNewProject)}>
                        <Plus size={16} /> New project
                    </button>
                </div>,
                document.body,
            )}
        </div>
    );
}

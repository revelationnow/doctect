import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import type { EditorChrome } from './EditorChromeContext';

/**
 * Phone replacement for the tab strip: the active project's name opens a menu listing the open
 * projects with per-project Close and a New project entry. The menu closes after any choice,
 * on a tap outside it, or on Escape.
 */
export function ProjectSwitcher({ chrome }: { chrome: EditorChrome }) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const active = chrome.projects.find(project => project.id === chrome.activeProjectId);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: Event) => {
            if (event.target instanceof Node && root.current?.contains(event.target)) return;
            setOpen(false);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !event.defaultPrevented) setOpen(false);
        };
        // Capture phase so a canvas gesture handler that stops propagation cannot keep the menu open.
        document.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const choose = (fn: () => void) => () => { fn(); setOpen(false); };

    return (
        <div ref={root} className="relative min-w-0 flex-1">
            <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)}
                className="flex min-h-11 max-w-full items-center gap-1 truncate px-1 text-sm font-semibold text-slate-800">
                <span className="truncate">{active?.name || 'Untitled'}</span>
                <ChevronDown size={16} className="shrink-0" />
            </button>
            {open && (
                <div role="menu" className="absolute left-0 top-full z-50 mt-1 w-64 rounded-xl border bg-white py-1 shadow-xl">
                    {chrome.projects.map(project => (
                        <div key={project.id} className="flex items-center">
                            <button type="button" role="menuitem" className="min-h-11 flex-1 truncate px-3 text-left text-sm"
                                onClick={choose(() => chrome.onSelectProject(project.id))}>
                                {project.name || 'Untitled'}
                            </button>
                            <button type="button" aria-label={`Close ${project.name || 'Untitled'}`}
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
                </div>
            )}
        </div>
    );
}

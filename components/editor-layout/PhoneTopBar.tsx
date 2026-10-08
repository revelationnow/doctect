import React, { useState } from 'react';
import { Menu, MoreHorizontal, Redo2, Undo2 } from 'lucide-react';
import type { TouchEditorActions } from './touchActions';
import { useEditorChrome } from './EditorChromeContext';
import { ProjectSwitcher } from './ProjectSwitcher';
import { OverflowMenu } from './OverflowMenu';

/**
 * The single ~48px phone top bar that replaces both the EditorPage header and the editor bar:
 * ☰ · project name ▾ · save status · undo · redo · ⋯. Page-level pieces come from
 * EditorChromeContext and are omitted when it is absent.
 */
export function PhoneTopBar({ actions, onOpenSidebar }: { actions: TouchEditorActions; onOpenSidebar: () => void }) {
    const chrome = useEditorChrome();
    const [menuOpen, setMenuOpen] = useState(false);
    return (
        <header className="flex h-12 shrink-0 items-center gap-1 border-b bg-white px-1">
            <button type="button" aria-label="Open pages and templates" onClick={onOpenSidebar}
                className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-600"><Menu size={20} /></button>
            {chrome ? <ProjectSwitcher chrome={chrome} /> : <div className="flex-1" />}
            {chrome?.saveStatus}
            <button type="button" aria-label="Undo" onClick={actions.undo} disabled={!actions.canUndo}
                className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-600 disabled:opacity-30"><Undo2 size={18} /></button>
            <button type="button" aria-label="Redo" onClick={actions.redo} disabled={!actions.canRedo}
                className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-600 disabled:opacity-30"><Redo2 size={18} /></button>
            <button type="button" aria-label="More actions" onClick={() => setMenuOpen(true)}
                className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-600"><MoreHorizontal size={20} /></button>
            <OverflowMenu open={menuOpen} onClose={() => setMenuOpen(false)} actions={actions} chrome={chrome} />
        </header>
    );
}

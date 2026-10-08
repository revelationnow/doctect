import React, { useState } from 'react';
import { Download, Menu, MoreHorizontal, Redo2, Undo2 } from 'lucide-react';
import type { TouchEditorActions } from './touchActions';
import { TouchToolButtons } from './TouchToolButtons';
import { OverflowMenu } from './OverflowMenu';

/**
 * Tablet collapses the editor bar and EditorToolbar into one row: ☰, tools, undo/redo,
 * Export PDF, ⋯. Tablet keeps the desktop page header (tab strip, cloud, account), so the
 * overflow sheet gets no page chrome here. Tagged as the layout's top bar, like PhoneTopBar, so
 * the quick format bar's visible band stops under it.
 */
export function TabletToolbar({ actions, onOpenSidebar }: { actions: TouchEditorActions; onOpenSidebar: () => void }) {
    const [menuOpen, setMenuOpen] = useState(false);
    return (
        <div data-touch-chrome="top-bar" className="flex h-14 shrink-0 items-center gap-2 border-b bg-white px-2">
            <button type="button" aria-label="Open pages and templates" onClick={onOpenSidebar}
                className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-600"><Menu size={20} /></button>
            <TouchToolButtons actions={actions} showFit />
            <div className="flex-1" />
            <button type="button" aria-label="Undo" onClick={actions.undo} disabled={!actions.canUndo}
                className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-600 disabled:opacity-30"><Undo2 size={18} /></button>
            <button type="button" aria-label="Redo" onClick={actions.redo} disabled={!actions.canRedo}
                className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-600 disabled:opacity-30"><Redo2 size={18} /></button>
            <button type="button" onClick={actions.exportPdf} disabled={actions.isExporting}
                className="flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white disabled:opacity-50">
                <Download size={16} /> Export PDF
            </button>
            <button type="button" aria-label="More actions" onClick={() => setMenuOpen(true)}
                className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-600"><MoreHorizontal size={20} /></button>
            <OverflowMenu open={menuOpen} onClose={() => setMenuOpen(false)} actions={actions} chrome={null} />
        </div>
    );
}

import React, { useState } from 'react';
import { Download, Menu, MoreHorizontal, Redo2, Undo2 } from 'lucide-react';
import type { TouchEditorActions } from './touchActions';
import { TouchFitButton, TouchToolButtons } from './TouchToolButtons';
import { ToolPillScroller } from './ToolPillScroller';
import { OverflowMenu } from './OverflowMenu';

/**
 * Tablet collapses the editor bar and EditorToolbar into one row: ☰, tools, undo/redo,
 * Export PDF, ⋯. Tablet keeps the desktop page header (tab strip, cloud, account), so the
 * overflow sheet gets no page chrome here. Tagged as the layout's top bar, like PhoneTopBar, so
 * the quick format bar's visible band stops under it.
 *
 * The row's natural width (768px with a mouse, 814px with touch's Select multiple, label included)
 * is more than a classic 768px tablet, an 810px iPad or a tablet-layout mouse window down to 640px
 * offers. The tools therefore sit in the phone pill's scroller, in a slot that takes the row's spare
 * width and is the only thing that gives width up (min-w-0 flex-1), with Fit pinned beside the
 * scroller as the pill pins it: the trailing Undo, Redo, Export PDF and ⋯ (the only way to the
 * export, project and canvas actions) never leave the screen. Below 840px Export PDF keeps only its
 * icon (the row then fits any tablet from 734px, any mouse window from 684px; the margin covers
 * fonts that set the label wider than Chromium's 124px); its accessible name stays "Export PDF".
 */
export function TabletToolbar({ actions, onOpenSidebar }: { actions: TouchEditorActions; onOpenSidebar: () => void }) {
    const [menuOpen, setMenuOpen] = useState(false);
    return (
        <div data-touch-chrome="top-bar" className="flex h-14 shrink-0 items-center gap-2 border-b bg-white px-2">
            <button type="button" aria-label="Open pages and templates" title="Open pages and templates" onClick={onOpenSidebar}
                className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-600"><Menu size={20} /></button>
            <div className="flex min-w-0 flex-1 items-center gap-0.5">
                <ToolPillScroller activeKey={`${actions.tool}:${actions.multiSelect}`}>
                    <TouchToolButtons actions={actions} />
                </ToolPillScroller>
                <TouchFitButton actions={actions} />
            </div>
            <button type="button" aria-label="Undo" title="Undo (Ctrl+Z)" onClick={actions.undo} disabled={!actions.canUndo}
                className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-600 disabled:opacity-30"><Undo2 size={18} /></button>
            <button type="button" aria-label="Redo" title="Redo (Ctrl+Y)" onClick={actions.redo} disabled={!actions.canRedo}
                className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-600 disabled:opacity-30"><Redo2 size={18} /></button>
            <button type="button" aria-label="Export PDF" title="Export PDF" onClick={actions.exportPdf} disabled={actions.isExporting}
                className="flex h-11 shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white disabled:opacity-50">
                <Download size={16} /><span className="hidden min-[840px]:inline">Export PDF</span>
            </button>
            <button type="button" aria-label="More actions" title="More actions" onClick={() => setMenuOpen(true)}
                className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-600"><MoreHorizontal size={20} /></button>
            <OverflowMenu open={menuOpen} onClose={() => setMenuOpen(false)} actions={actions} chrome={null} />
        </div>
    );
}

import React, { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import type { EditorScalarPreferencePatch } from '../services/document/contracts';
import { GRID_QUICK_PICKS, MAX_GRID_SIZE, MIN_GRID_SIZE, parseGridSize } from '../services/snapping/settings';
import { formatGuideValue } from './canvas/SnapGuides';

interface Props { snapToGrid: boolean; smartGuides: boolean; showGrid: boolean; gridSize: number; onChange: (patch: EditorScalarPreferencePatch) => void }

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const Switch = ({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) => (
    <button type="button" role="switch" aria-checked={checked} onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
        <span>{label}</span>
        <span aria-hidden="true" className={clsx('relative h-4 w-7 rounded-full transition-colors', checked ? 'bg-blue-600' : 'bg-slate-300')}>
            <span className={clsx('absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all', checked ? 'left-3.5' : 'left-0.5')} />
        </span>
    </button>
);

/** The chevron beside the magnet: snapping switches and the grid size, saved per project. */
export const SnappingPopover: React.FC<Props> = ({ snapToGrid, smartGuides, showGrid, gridSize, onChange }) => {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(String(gridSize));
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => { setDraft(String(gridSize)); }, [gridSize]);
    // Listeners exist only while open, so a closed popover never sees the editor's keys.
    useEffect(() => {
        if (!open) return;
        const outside = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape);
        return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
    }, [open]);
    const commit = () => {
        const parsed = parseGridSize(draft);
        if (parsed === null) { setDraft(String(gridSize)); return; }
        setDraft(String(parsed));
        if (parsed !== gridSize) onChange({ gridSize: parsed });
    };
    return (
        <div className="relative" ref={ref}>
            <button type="button" title="Snapping options" aria-label="Snapping options" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)}
                className={clsx('flex h-7 items-center rounded px-1.5 transition-all', open ? 'bg-slate-100 text-slate-700' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100')}>
                <ChevronDown size={10} />
            </button>
            {open && (
                <div role="dialog" aria-label="Snapping" className="absolute right-0 top-full z-30 mt-1 w-56 rounded border border-slate-200 bg-white py-1 shadow-lg">
                    <Switch label="Snap to grid" checked={snapToGrid}
                        onToggle={() => onChange(snapToGrid ? { snapToGrid: false } : { snapToGrid: true, showGrid: true })} />
                    <Switch label="Smart guides" checked={smartGuides} onToggle={() => onChange({ smartGuides: !smartGuides })} />
                    <Switch label="Show grid" checked={showGrid} onToggle={() => onChange({ showGrid: !showGrid })} />
                    <div className="border-t border-slate-100 px-3 pb-2 pt-2">
                        <label className="flex items-center justify-between gap-2 text-xs text-slate-700">
                            <span>Grid size</span>
                            <span className="flex items-center gap-1">
                                <input type="number" aria-label="Grid size (pt)" min={MIN_GRID_SIZE} max={MAX_GRID_SIZE} step={0.5} value={draft}
                                    onChange={e => setDraft(e.target.value)} onBlur={commit}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
                                    className="w-16 rounded border border-slate-200 px-1 py-0.5 text-right" />
                                <span className="text-slate-400">pt</span>
                            </span>
                        </label>
                        <div className="mt-2 flex gap-1">
                            {GRID_QUICK_PICKS.map(size => (
                                <button key={size} type="button" aria-pressed={gridSize === size} onClick={() => onChange({ gridSize: size })}
                                    className={clsx('flex-1 rounded border px-1 py-0.5 text-[11px]', gridSize === size ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
                                    {formatGuideValue(size)} pt
                                </button>
                            ))}
                        </div>
                        <p className="mt-2 text-[11px] text-slate-400">Hold {isMac ? '⌥ Option' : 'Alt'} to move without snapping</p>
                    </div>
                </div>
            )}
        </div>
    );
};

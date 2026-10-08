import React from 'react';
import clsx from 'clsx';
import { Circle, Grid3X3, Hand, Maximize2, Minus, MousePointer2, Square, Triangle, Type } from 'lucide-react';
import type { TouchEditorActions } from './touchActions';

const TOOLS = [
    { tool: 'select', label: 'Select', icon: MousePointer2 },
    { tool: 'hand', label: 'Pan', icon: Hand },
    { tool: 'text', label: 'Text', icon: Type },
    { tool: 'rect', label: 'Rectangle', icon: Square },
    { tool: 'ellipse', label: 'Ellipse', icon: Circle },
    { tool: 'triangle', label: 'Triangle', icon: Triangle },
    { tool: 'line', label: 'Line', icon: Minus },
    { tool: 'grid', label: 'Grid', icon: Grid3X3 },
];

/**
 * The touch tool row shared by the tablet toolbar and the phone tool pill. `fitToWidth` is the
 * only zoom control on touch: zoom is local to the touch viewport and never written to state.
 */
export function TouchToolButtons({ actions, showFit = false }: { actions: TouchEditorActions; showFit?: boolean }) {
    return (
        <div className="flex items-center gap-0.5">
            {TOOLS.map(({ tool, label, icon: Icon }) => (
                <button key={tool} type="button" aria-label={label} aria-pressed={actions.tool === tool}
                    onClick={() => actions.setTool(tool)}
                    className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
                        actions.tool === tool ? 'bg-blue-600 text-white' : 'text-slate-600')}>
                    <Icon size={18} />
                </button>
            ))}
            {showFit && (
                <button type="button" aria-label="Fit page to width" onClick={actions.fitToWidth}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600">
                    <Maximize2 size={18} />
                </button>
            )}
        </div>
    );
}

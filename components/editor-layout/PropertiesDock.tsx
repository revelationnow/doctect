import React, { useState } from 'react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { readBrowserPreference, writeBrowserPreference } from '../../services/browserPreferences';
import { useInputMode } from './FormFactorContext';
import { MIN_CANVAS_WIDTH } from './usePanelResize';

export const PROPERTIES_COLLAPSED_KEY = 'doctect-properties-panel-collapsed';

/** Collapsed or not is a per-browser choice, shared by the desktop and tablet layouts; it never reaches the project. */
function usePropertiesCollapsed(): [boolean, (collapsed: boolean) => void] {
    const [collapsed, setCollapsed] = useState(() => readBrowserPreference(PROPERTIES_COLLAPSED_KEY) === '1');
    const update = (next: boolean) => {
        setCollapsed(next);
        writeBrowserPreference(PROPERTIES_COLLAPSED_KEY, next ? '1' : '0');
    };
    return [collapsed, update];
}

const iconButton = 'flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800';

/**
 * The properties panel docked at the right of the desktop and tablet layouts: drag its left edge
 * to resize (mouse or finger), or hide it to a slim rail. `capToCanvas` (tablet) keeps the canvas
 * at least MIN_CANVAS_WIDTH wide whatever the saved width.
 */
export function PropertiesDock({ width, onStartResize, capToCanvas = false, children }: {
    width: number;
    onStartResize: () => void;
    capToCanvas?: boolean;
    children: React.ReactNode;
}) {
    const touch = useInputMode() === 'touch';
    const [collapsed, setCollapsed] = usePropertiesCollapsed();

    if (collapsed) {
        return (
            <div data-properties-dock="collapsed" className={`flex shrink-0 flex-col items-center border-l bg-white py-1 ${touch ? 'w-11' : 'w-8'}`}>
                <button type="button" className={iconButton} aria-label="Show properties panel" title="Show properties panel" aria-expanded={false} onClick={() => setCollapsed(false)}>
                    <ChevronsLeft size={16} />
                </button>
            </div>
        );
    }

    return (
        <div
            data-properties-dock="open"
            style={{ width, maxWidth: capToCanvas ? `calc(100% - ${MIN_CANVAS_WIDTH}px)` : undefined }}
            className="relative flex shrink-0 flex-col"
        >
            {/* A finger needs a 44px target; it straddles the edge so neither the canvas nor the panel loses much. */}
            <div
                data-properties-resize-handle=""
                title="Drag to resize"
                style={{ touchAction: 'none' }}
                className={touch
                    ? 'absolute -left-[22px] top-0 bottom-0 z-30 flex w-11 cursor-col-resize items-center justify-center'
                    : 'absolute left-0 top-0 bottom-0 z-30 w-1 cursor-col-resize transition-colors hover:bg-blue-400'}
                onPointerDown={event => { event.preventDefault(); onStartResize(); }}
            >
                {touch && <span className="h-10 w-1 rounded-full bg-slate-300" />}
            </div>
            <div className="flex shrink-0 items-center justify-between border-b border-l bg-white py-1 pl-4 pr-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Properties</span>
                <button type="button" className={iconButton} aria-label="Hide properties panel" title="Hide properties panel" aria-expanded={true} onClick={() => setCollapsed(true)}>
                    <ChevronsRight size={16} />
                </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </div>
    );
}

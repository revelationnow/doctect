import React, { useState } from 'react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { readBrowserPreference, writeBrowserPreference } from '../../services/browserPreferences';
import { useInputMode } from './FormFactorContext';
import { MIN_CANVAS_WIDTH, type ResizablePanel } from './usePanelResize';

export const PROPERTIES_COLLAPSED_KEY = 'doctect-properties-panel-collapsed';
export const SIDEBAR_COLLAPSED_KEY = 'doctect-sidebar-collapsed';

const PANELS = {
    sidebar: {
        label: 'Pages and templates', key: SIDEBAR_COLLAPSED_KEY, hide: 'Hide pages and templates', show: 'Show pages and templates',
        HideIcon: ChevronsLeft, ShowIcon: ChevronsRight, border: 'border-r',
        handle: { touch: '-right-[22px]', mouse: 'right-0' },
    },
    properties: {
        label: 'Properties', key: PROPERTIES_COLLAPSED_KEY, hide: 'Hide properties panel', show: 'Show properties panel',
        HideIcon: ChevronsRight, ShowIcon: ChevronsLeft, border: 'border-l',
        handle: { touch: '-left-[22px]', mouse: 'left-0' },
    },
} as const;

/** Collapsed or not is a per-browser choice for each panel; it never reaches the project. */
function useCollapsed(key: typeof PANELS[ResizablePanel]['key']): [boolean, (collapsed: boolean) => void] {
    const [collapsed, setCollapsed] = useState(() => readBrowserPreference(key) === '1');
    const update = (next: boolean) => {
        setCollapsed(next);
        writeBrowserPreference(key, next ? '1' : '0');
    };
    return [collapsed, update];
}

const iconButton = 'flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800';

/**
 * A side panel docked beside the canvas: the sidebar on the left (desktop layout) or properties on
 * the right (desktop and tablet layouts). Drag its inner edge to resize (mouse or finger), or hide
 * it to a slim rail. `capToCanvas` (tablet) keeps the canvas at least MIN_CANVAS_WIDTH wide
 * whatever the saved width.
 */
export function PanelDock({ panel, width, onStartResize, capToCanvas = false, children }: {
    panel: ResizablePanel;
    width: number;
    onStartResize: () => void;
    capToCanvas?: boolean;
    children: React.ReactNode;
}) {
    const touch = useInputMode() === 'touch';
    const config = PANELS[panel];
    const [collapsed, setCollapsed] = useCollapsed(config.key);

    if (collapsed) {
        return (
            <div {...{ [`data-${panel}-dock`]: 'collapsed' }} className={`flex shrink-0 flex-col items-center ${config.border} bg-white py-1 ${touch ? 'w-11' : 'w-8'}`}>
                <button type="button" className={iconButton} aria-label={config.show} title={config.show} aria-expanded={false} onClick={() => setCollapsed(false)}>
                    <config.ShowIcon size={16} />
                </button>
            </div>
        );
    }

    return (
        <div
            {...{ [`data-${panel}-dock`]: 'open' }}
            style={{ width, maxWidth: capToCanvas ? `calc(100% - ${MIN_CANVAS_WIDTH}px)` : undefined }}
            className="relative flex shrink-0 flex-col"
        >
            {/* A finger needs a 44px target; it straddles the edge so neither the canvas nor the panel loses much. */}
            <div
                {...{ [`data-${panel}-resize-handle`]: '' }}
                title="Drag to resize"
                style={{ touchAction: 'none' }}
                className={touch
                    ? `absolute ${config.handle.touch} top-0 bottom-0 z-30 flex w-11 cursor-col-resize items-center justify-center`
                    : `absolute ${config.handle.mouse} top-0 bottom-0 z-30 w-1 cursor-col-resize transition-colors hover:bg-blue-400`}
                onPointerDown={event => { event.preventDefault(); onStartResize(); }}
            >
                {touch && <span className="h-10 w-1 rounded-full bg-slate-300" />}
            </div>
            <div className={`flex shrink-0 items-center justify-between border-b ${config.border} bg-white py-1 pl-4 pr-1`}>
                <span className="truncate text-xs font-semibold uppercase tracking-wide text-slate-500">{config.label}</span>
                <button type="button" className={iconButton} aria-label={config.hide} title={config.hide} aria-expanded={true} onClick={() => setCollapsed(true)}>
                    <config.HideIcon size={16} />
                </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </div>
    );
}

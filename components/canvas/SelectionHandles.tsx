
import React from 'react';
import { TemplateElement } from '../../types';
import { RotateCw } from 'lucide-react';

export const TOUCH_HANDLE_PX = 44;
/** Each touch zone's centre sits this many screen px outside the box, so zones never cover the interior. */
export const TOUCH_HANDLE_OUTSET_PX = 14;
/** Mid-edge touch zones appear only when the edge is at least this long on screen. */
export const TOUCH_EDGE_MIN_PX = 132;

export const SelectionHandles: React.FC<{ element: TemplateElement; touchScale?: number }> = ({ element, touchScale }) => {
    if (touchScale !== undefined) return <TouchSelectionHandles element={element} scale={touchScale} />;
    return (
        <div className="pointer-events-auto">
            {/* Standard Resize Handles (Not for lines) */}
            {element.type !== 'line' && (
                <>
                    {/* Corner Handles (L-shapes) - Outset further for gap */}
                    <div data-resize-handle="ne" className="absolute -right-2 -top-2 w-3 h-3 border-t-2 border-r-2 border-blue-500 cursor-ne-resize z-20" />
                    <div data-resize-handle="sw" className="absolute -left-2 -bottom-2 w-3 h-3 border-b-2 border-l-2 border-blue-500 cursor-sw-resize z-20" />
                    <div data-resize-handle="nw" className="absolute -left-2 -top-2 w-3 h-3 border-t-2 border-l-2 border-blue-500 cursor-nw-resize z-20" />
                    <div data-resize-handle="se" className="absolute -right-2 -bottom-2 w-3 h-3 border-b-2 border-r-2 border-blue-500 cursor-se-resize z-20" />

                    {/* Center Handles (Flat Lines) - Thinner (2px) */}
                    <div data-resize-handle="n" className="absolute left-1/2 -top-2 w-3 h-0.5 bg-blue-500 cursor-n-resize z-20 -translate-x-1/2" />
                    <div data-resize-handle="s" className="absolute left-1/2 -bottom-2 w-3 h-0.5 bg-blue-500 cursor-s-resize z-20 -translate-x-1/2" />
                    <div data-resize-handle="w" className="absolute -left-2 top-1/2 w-0.5 h-3 bg-blue-500 cursor-w-resize z-20 -translate-y-1/2" />
                    <div data-resize-handle="e" className="absolute -right-2 top-1/2 w-0.5 h-3 bg-blue-500 cursor-e-resize z-20 -translate-y-1/2" />
                </>
            )}

            {/* Line Specific Handles (Start/End) */}
            {element.type === 'line' && (
                <>
                    <div
                        data-resize-handle="start"
                        className="absolute w-2.5 h-2.5 bg-blue-500 border border-white cursor-move z-20 shadow-sm"
                        style={{
                            left: -5,
                            top: element.flip ? 'calc(100% - 5px)' : -5
                        }}
                    />
                    <div
                        data-resize-handle="end"
                        className="absolute w-2.5 h-2.5 bg-blue-500 border border-white cursor-move z-20 shadow-sm"
                        style={{
                            right: -5,
                            top: element.flip ? -5 : 'calc(100% - 5px)'
                        }}
                    />
                </>
            )}

            {/* Pivot/Anchor Point (Transform Origin) - Only show for single selection (real/group) */}
            <div
                data-pivot-handle
                className="absolute w-3 h-3 bg-white border border-blue-500 rounded-full cursor-crosshair z-30 flex items-center justify-center shadow-sm"
                title="Transform Origin"
                style={{
                    left: `${(element.transformOrigin?.x ?? 0.5) * 100}%`,
                    top: `${(element.transformOrigin?.y ?? 0.5) * 100}%`,
                    transform: 'translate(-50%, -50%)'
                }}
            >
                <div className="w-1 h-1 bg-blue-500 rounded-full" />
            </div>

            {/* Rotation Handle with larger Hit Box */}
            <div
                data-rotate-handle
                className="absolute left-1/2 -top-11 w-8 h-8 cursor-pointer z-30 -translate-x-1/2 flex items-center justify-center group/rotate"
                title="Rotate"
            >
                <div className="w-6 h-6 bg-white border border-blue-500 rounded-full flex items-center justify-center shadow-sm group-hover/rotate:bg-blue-50">
                    <RotateCw size={12} className="text-blue-600" />
                </div>
            </div>
            {/* Connection Line to Rotate Handle */}
            <div className="absolute left-1/2 -top-10 h-10 w-px bg-blue-500 z-10 -translate-x-1/2 pointer-events-none" />
        </div>
    );
};

// Touch variant: each handle is a transparent 44-screen-px square carrying data-resize-handle,
// centred on the visual handle; the visual is pointer-events-none so the square is the event target.
// Zones are anchored at the corner / edge midpoint by percentage and pushed outward by a canvas-px
// margin (TOUCH_HANDLE_OUTSET_PX / scale) along the outward normal (diagonally at corners), so a drag
// on the element's interior still reaches the move path. Mid-edge zones only appear once the edge
// is TOUCH_EDGE_MIN_PX long on screen. No rotate or pivot handles on touch (out of scope).
const TouchSelectionHandles: React.FC<{ element: TemplateElement; scale: number }> = ({ element, scale }) => {
    const s = scale > 0 ? scale : 1;
    const size = TOUCH_HANDLE_PX / s;
    const outset = TOUCH_HANDLE_OUTSET_PX / s;
    const zone = (handle: string, left: string, top: string, dx: number, dy: number) => (
        <div
            key={handle}
            data-resize-handle={handle}
            className="absolute z-20"
            style={{ left, top, marginLeft: dx, marginTop: dy, width: size, height: size, transform: 'translate(-50%, -50%)' }}
        >
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-blue-500 bg-white" />
        </div>
    );
    if (element.type === 'line') {
        // Unit vector along the line from start to end; zones are pushed past each endpoint.
        const length = Math.hypot(element.w, element.h);
        const ux = length > 0 ? element.w / length : 1;
        const uy = length > 0 ? (element.flip ? -element.h : element.h) / length : 0;
        return (
            <div className="pointer-events-auto">
                {zone('start', '0%', element.flip ? '100%' : '0%', -ux * outset, -uy * outset)}
                {zone('end', '100%', element.flip ? '0%' : '100%', ux * outset, uy * outset)}
            </div>
        );
    }
    const showNorthSouth = element.w * s >= TOUCH_EDGE_MIN_PX;
    const showWestEast = element.h * s >= TOUCH_EDGE_MIN_PX;
    return (
        <div className="pointer-events-auto">
            {zone('nw', '0%', '0%', -outset, -outset)}
            {showNorthSouth && zone('n', '50%', '0%', 0, -outset)}
            {zone('ne', '100%', '0%', outset, -outset)}
            {showWestEast && zone('w', '0%', '50%', -outset, 0)}
            {showWestEast && zone('e', '100%', '50%', outset, 0)}
            {zone('sw', '0%', '100%', -outset, outset)}
            {showNorthSouth && zone('s', '50%', '100%', 0, outset)}
            {zone('se', '100%', '100%', outset, outset)}
        </div>
    );
};

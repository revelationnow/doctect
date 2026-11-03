import React from 'react';
import type { Guide, Point } from '../../services/snapping/types';
import { formatGuideValue } from '../../services/snapping/settings';

const GUIDE_COLOR = '#f43f5e'; // rose-500: distinct from selection blue and the slate grid

interface Props { guides: Guide[]; scale: number; touch: boolean; pointer: Point | null; width: number; height: number }

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));

/**
 * Snap guides over the page, in page units inside the scaled layer. Stroke widths, label sizes and
 * offsets are divided by `scale` so they read the same at every zoom. On touch, a label that would
 * sit under the finger (44 screen px) moves to the other side of its segment, or to whichever side
 * is farther from the finger when both are covered; the mouse never shifts a label. Labels are
 * clamped into the page so the container's overflow clipping cannot hide them.
 */
export const SnapGuides = React.memo(function SnapGuides({ guides, scale, touch, pointer, width, height }: Props) {
    if (guides.length === 0) return null;
    const sw = (touch ? 1.5 : 1) / scale;
    const font = 10 / scale, pad = 2 / scale, gapPx = 4 / scale, avoid = 44 / scale, tick = 3 / scale;
    const labelH = font + pad * 2;
    const finger = touch ? pointer : null;

    const label = (key: string, x: number, y: number, text: string, side: 'h' | 'v') => {
        const w = text.length * font * 0.6 + pad * 2, h = labelH;
        // Candidate anchors: right of / below the point first, then left of / above it.
        const options = side === 'v'
            ? [{ x: x + gapPx, y: y - h / 2 }, { x: x - gapPx - w, y: y - h / 2 }]
            : [{ x: x - w / 2, y: y + gapPx }, { x: x - w / 2, y: y - gapPx - h }];
        const dist = (o: { x: number; y: number }) => finger ? Math.hypot(o.x + w / 2 - finger.x, o.y + h / 2 - finger.y) : Infinity;
        // First candidate clear of the finger; when both are covered, the one farther from it.
        const chosen = options.find(o => dist(o) > avoid) ?? options.reduce((best, o) => dist(o) > dist(best) ? o : best);
        const at = { x: clamp(chosen.x, 0, width - w), y: clamp(chosen.y, 0, height - h) };
        return (
            <g key={key}>
                <rect x={at.x} y={at.y} width={w} height={h} rx={pad} fill={GUIDE_COLOR} />
                <text data-guide-label x={at.x + pad} y={at.y + pad + font * 0.85} fontSize={font} fill="#fff"
                    fontFamily="ui-sans-serif, system-ui, sans-serif">{text}</text>
            </g>
        );
    };
    const line = (key: string, kind: string, x1: number, y1: number, x2: number, y2: number) => (
        <line key={key} data-guide-kind={kind} x1={x1} y1={y1} x2={x2} y2={y2} stroke={GUIDE_COLOR} strokeWidth={sw} />
    );
    // A measured segment with end ticks; `along` is the axis the segment runs on.
    const measured = (key: string, kind: string, along: 'x' | 'y', at: number, from: number, to: number, text: string) => {
        const mid = (from + to) / 2;
        return along === 'y'
            ? [line(`${key}l`, kind, at, from, at, to), line(`${key}a`, kind, at - tick, from, at + tick, from),
                line(`${key}b`, kind, at - tick, to, at + tick, to), label(`${key}t`, at, mid, text, 'v')]
            : [line(`${key}l`, kind, from, at, to, at), line(`${key}a`, kind, from, at - tick, from, at + tick),
                line(`${key}b`, kind, to, at - tick, to, at + tick), label(`${key}t`, mid, at, text, 'h')];
    };

    return (
        <svg data-testid="snap-guides" className="absolute left-0 top-0 overflow-visible" width={width} height={height}
            style={{ pointerEvents: 'none', zIndex: 10001 }}>
            {guides.flatMap((g, i) => {
                const k = `g${i}`;
                switch (g.kind) {
                    case 'align':
                        return [g.axis === 'x' ? line(k, 'align', g.at, g.from, g.at, g.to) : line(k, 'align', g.from, g.at, g.to, g.at)];
                    case 'distance':
                        return measured(k, 'distance', g.axis, g.at, g.from, g.to, formatGuideValue(g.to - g.from));
                    case 'spacing':
                        return g.segments.flatMap((s, j) => measured(`${k}s${j}`, 'spacing', g.axis, s.at, s.from, s.to, formatGuideValue(g.gap)));
                    case 'size':
                        // Width match: anchored so the preferred (below-the-anchor) label sits wholly above the box,
                        // its bottom one gap clear of the top edge. Height match: beside the right edge, centred.
                        return g.boxes.map((b, j) => g.axis === 'x'
                            ? label(`${k}b${j}`, b.x + b.w / 2, b.y - 2 * gapPx - labelH, `= ${formatGuideValue(g.size)}`, 'h')
                            : label(`${k}b${j}`, b.x + b.w, b.y + b.h / 2, `= ${formatGuideValue(g.size)}`, 'v'));
                }
            })}
        </svg>
    );
});

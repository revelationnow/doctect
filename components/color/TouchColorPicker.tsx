import React, { useEffect, useId, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from './colorMath';
import { trapTab } from '../editor-layout/focusTrap';

export const COLOUR_PALETTE = [
    '#000000', '#475569', '#94a3b8', '#e2e8f0', '#ffffff', '#ef4444', '#f97316', '#f59e0b',
    '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#3b82f6', '#6366f1', '#a855f7', '#ec4899',
] as const;

/** The hue track stops short of the bar's ends so its 32px thumb is never clipped at 0° or 360°. */
const HUE_INSET_PX = 16;
const HUE_GRADIENT = 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)';

/**
 * Pointer tracking over a box: reports the pointer's 0–1 position on every move and once more on
 * release. `insetX` px at each side are outside the 0–1 range (room for a thumb at either end).
 */
function useDragArea(onMove: (x: number, y: number) => void, onRelease: () => void, insetX = 0) {
    const dragging = useRef(false);
    const at = (event: React.PointerEvent<HTMLElement>) => {
        const box = event.currentTarget.getBoundingClientRect();
        const span = box.width - 2 * insetX;
        const x = span > 0 ? (event.clientX - box.left - insetX) / span : 0;
        const y = box.height ? (event.clientY - box.top) / box.height : 0;
        onMove(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)));
    };
    return {
        onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
            if (event.isPrimary === false) return;
            event.preventDefault();
            dragging.current = true;
            try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* the pointer is already gone */ }
            at(event);
        },
        onPointerMove: (event: React.PointerEvent<HTMLElement>) => { if (dragging.current) at(event); },
        onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
            if (!dragging.current) return;
            dragging.current = false;
            at(event);
            onRelease();
        },
        onPointerCancel: () => {
            if (!dragging.current) return;
            dragging.current = false;
            onRelease();
        },
    };
}

/**
 * Touch colour picker: a saturation/brightness square, a hue bar, recent colours, a preset palette
 * and a hex field. The preview follows a drag live; `onCommit` runs once per gesture (a drag's
 * release, a swatch tap, a valid hex, an arrow key), so each pick is one undo step. It stays open
 * for further picks until Done, the backdrop, Escape or the back gesture (`onClose`).
 */
export function TouchColorPicker({ value, label, recents, onCommit, onClose }: {
    value: string; label: string; recents: readonly string[];
    onCommit: (hex: string) => void; onClose: () => void;
}) {
    const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
    const hsvRef = useRef(hsv);
    hsvRef.current = hsv;
    const hex = hsvToHex(hsv);
    const [draftHex, setDraftHex] = useState(hex.slice(1));
    useEffect(() => { setDraftHex(hex.slice(1)); }, [hex]);
    const panel = useRef<HTMLDivElement>(null);
    const done = useRef<HTMLButtonElement>(null);
    const titleId = useId();
    useEffect(() => { done.current?.focus({ preventScroll: true }); }, []);

    const commitHsv = (next: Hsv) => { setHsv(next); onCommit(hsvToHex(next)); };
    const commitHex = (candidate: string) => {
        const normal = normalizeHex(candidate);
        if (!normal) return false;
        commitHsv(hexToHsv(normal, hsvRef.current));
        return true;
    };
    const commitCurrent = () => onCommit(hsvToHex(hsvRef.current));

    // The ref moves with the pointer synchronously: a release commits the colour under the finger,
    // not the last rendered one.
    const preview = (apply: (current: Hsv) => Hsv) => { hsvRef.current = apply(hsvRef.current); setHsv(hsvRef.current); };
    const square = useDragArea((x, y) => preview(current => ({ ...current, s: x, v: 1 - y })), commitCurrent);
    const hueBar = useDragArea(x => preview(current => ({ ...current, h: x * 360 })), commitCurrent, HUE_INSET_PX);

    const nudge = (event: React.KeyboardEvent, apply: (step: number) => Hsv | null) => {
        const step = event.shiftKey ? 10 : 1;
        const next = apply(step);
        if (!next) return;
        event.preventDefault();
        commitHsv(next);
    };
    const onSquareKey = (event: React.KeyboardEvent) => nudge(event, step => {
        const { s, v } = hsv;
        const d = step / 100;
        switch (event.key) {
            case 'ArrowLeft': return { ...hsv, s: Math.max(0, s - d) };
            case 'ArrowRight': return { ...hsv, s: Math.min(1, s + d) };
            case 'ArrowUp': return { ...hsv, v: Math.min(1, v + d) };
            case 'ArrowDown': return { ...hsv, v: Math.max(0, v - d) };
            default: return null;
        }
    });
    const onHueKey = (event: React.KeyboardEvent) => nudge(event, step => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') return { ...hsv, h: Math.max(0, hsv.h - step) };
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') return { ...hsv, h: Math.min(360, hsv.h + step) };
        return null;
    });

    const swatch = (colour: string, name: string) => (
        <button key={name} type="button" aria-label={`${name} ${colour}`} aria-pressed={colour === hex}
            onClick={() => commitHex(colour)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300" style={{ backgroundColor: colour }}>
                {colour === hex && <Check size={16} aria-hidden className={hexToHsv(colour).v > 0.6 && hexToHsv(colour).s < 0.5 ? 'text-slate-900' : 'text-white'} />}
            </span>
        </button>
    );

    return (
        <div className="fixed inset-0 z-[70] flex items-end justify-center" data-touch-colour-picker="">
            <div className="absolute inset-0 bg-slate-900/20" data-testid="colour-picker-backdrop" onClick={onClose} />
            <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId}
                onKeyDown={event => {
                    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return; }
                    trapTab(event, panel.current);
                }}
                className="relative max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white px-4 pt-3 shadow-[0_-8px_24px_rgba(15,23,42,0.18)]"
                style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
                <div className="mb-3 flex items-center gap-3">
                    <span aria-hidden data-testid="colour-picker-preview" className="h-9 w-9 shrink-0 rounded-lg border border-slate-300" style={{ backgroundColor: hex }} />
                    <div className="min-w-0 flex-1">
                        <div id={titleId} className="truncate text-sm font-semibold text-slate-700">{label}</div>
                        <div className="font-mono text-xs text-slate-500">{hex.toUpperCase()}</div>
                    </div>
                    <button ref={done} type="button" onClick={onClose}
                        className="min-h-11 rounded-xl border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700">Done</button>
                </div>

                <div role="slider" tabIndex={0} aria-label="Saturation and brightness"
                    aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
                    data-testid="colour-picker-square" onKeyDown={onSquareKey} {...square}
                    className="relative h-40 w-full touch-none select-none rounded-lg"
                    style={{ backgroundColor: hsvToHex({ h: hsv.h, s: 1, v: 1 }), backgroundImage: 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)' }}>
                    <span aria-hidden className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
                        style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: hex }} />
                </div>

                <div role="slider" tabIndex={0} aria-label="Hue" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsv.h)}
                    data-testid="colour-picker-hue" onKeyDown={onHueKey} {...hueBar}
                    className="relative mt-4 h-11 w-full touch-none select-none">
                    <span aria-hidden className="pointer-events-none absolute top-1/2 h-6 -translate-y-1/2 rounded-full"
                        style={{ left: HUE_INSET_PX, right: HUE_INSET_PX, backgroundImage: HUE_GRADIENT }} />
                    <span aria-hidden className="pointer-events-none absolute top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
                        style={{ left: `calc(${HUE_INSET_PX}px + (100% - ${2 * HUE_INSET_PX}px) * ${hsv.h / 360})`, backgroundColor: hsvToHex({ h: hsv.h, s: 1, v: 1 }) }} />
                </div>

                {recents.length > 0 && (
                    <div className="mt-3">
                        <div className="text-xs font-semibold uppercase text-slate-500">Recent</div>
                        <div role="group" aria-label="Recent colours" className="flex flex-wrap gap-1">{recents.map(c => swatch(c, 'Recent'))}</div>
                    </div>
                )}
                <div className="mt-3">
                    <div className="text-xs font-semibold uppercase text-slate-500">Palette</div>
                    <div role="group" aria-label="Palette" className="flex flex-wrap gap-1">{COLOUR_PALETTE.map(c => swatch(c, 'Palette'))}</div>
                </div>

                <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                    Hex
                    <span className="flex min-h-11 flex-1 items-center rounded-lg border px-3 focus-within:ring-2 focus-within:ring-blue-500">
                        <span aria-hidden className="text-slate-400">#</span>
                        <input type="text" aria-label="Hex colour" value={draftHex} maxLength={7} autoCapitalize="off" autoCorrect="off" spellCheck={false}
                            onChange={event => setDraftHex(event.target.value.replace(/^#/, ''))}
                            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (!commitHex(draftHex)) setDraftHex(hex.slice(1)); } }}
                            onBlur={() => { if (draftHex !== hex.slice(1) && !commitHex(draftHex)) setDraftHex(hex.slice(1)); }}
                            className="w-full min-w-0 bg-transparent font-mono text-base uppercase outline-none" />
                    </span>
                </label>
            </div>
        </div>
    );
}

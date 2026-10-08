import React from 'react';
import { ChevronDown, ChevronUp, Link2 } from 'lucide-react';
import { TEXT_PADDING_SIDES, type TextPaddingSide } from '../../services/textPadding';
import { TouchStepper, useHoldRepeat } from './TouchStepper';
import { useFormFactor } from '../editor-layout/FormFactorContext';

export type TextPaddingSelection = Record<TextPaddingSide, number | 'mixed'>;

interface TextPaddingControlsProps {
    values: TextPaddingSelection;
    disabled: boolean;
    selectionKey: string;
    onCommit: (side: TextPaddingSide, value: number, linked: boolean) => void;
}

const LABELS: Record<TextPaddingSide, string> = {
    top: 'Top',
    right: 'Right',
    bottom: 'Bottom',
    left: 'Left',
};

const SHORT_LABELS: Record<TextPaddingSide, string> = {
    top: 'T',
    right: 'R',
    bottom: 'B',
    left: 'L',
};

export const TextPaddingControls: React.FC<TextPaddingControlsProps> = ({
    values,
    disabled,
    selectionKey,
    onCommit,
}) => {
    const [linked, setLinked] = React.useState(true);
    const [drafts, setDrafts] = React.useState<Partial<Record<TextPaddingSide, string>>>({});
    const tooltipId = React.useId();
    const draftsRef = React.useRef<Partial<Record<TextPaddingSide, string>>>({});
    const onCommitRef = React.useRef(onCommit);
    const repeat = useHoldRepeat();
    const stopRepeat = repeat.stop;
    const touch = useFormFactor() !== 'desktop';

    React.useEffect(() => {
        onCommitRef.current = onCommit;
    }, [onCommit]);

    React.useEffect(() => {
        stopRepeat();
        setLinked(true);
        setDrafts({});
        draftsRef.current = {};
    }, [selectionKey, stopRepeat]);

    const setDraft = (side: TextPaddingSide, value: string) => {
        const next = { ...draftsRef.current, [side]: value };
        draftsRef.current = next;
        setDrafts(next);
    };

    const clearDraft = (side: TextPaddingSide) => {
        const next = { ...draftsRef.current };
        delete next[side];
        draftsRef.current = next;
        setDrafts(next);
    };

    const nudge = (side: TextPaddingSide, delta: number) => {
        const draft = draftsRef.current[side];
        const parsedDraft = draft === undefined ? NaN : Number(draft);
        const base = Number.isFinite(parsedDraft)
            ? parsedDraft
            : values[side] === 'mixed' ? 0 : values[side];
        const next = Math.max(0, base + delta);
        setDraft(side, String(next));
        onCommitRef.current(side, next, linked);
    };

    const startRepeat = (side: TextPaddingSide, delta: number) => {
        if (disabled) return;
        repeat.start(() => nudge(side, delta));
    };

    return (
        <div
            className={touch
                ? `group relative flex flex-wrap items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1 ${disabled ? 'cursor-help' : ''}`
                : `group relative flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1 ${disabled ? 'cursor-help' : ''}`}
            data-testid="text-padding-controls"
            tabIndex={disabled ? 0 : undefined}
            aria-describedby={disabled ? tooltipId : undefined}
        >
            <span className="mr-auto text-[10px] font-medium text-slate-500">Padding</span>
            <label
                className={`flex ${touch ? 'h-11 w-11' : 'h-7 w-7'} shrink-0 items-center justify-center rounded border border-slate-200 bg-white focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400 ${
                    disabled
                        ? 'cursor-not-allowed text-slate-300'
                        : 'cursor-pointer text-slate-500 hover:bg-slate-50'
                }`}
                title="Link padding sides"
            >
                <input
                    type="checkbox"
                    aria-label="Link padding sides"
                    className="sr-only"
                    checked={linked}
                    disabled={disabled}
                    onChange={event => setLinked(event.target.checked)}
                />
                <Link2
                    aria-hidden="true"
                    size={13}
                    className={linked && !disabled ? 'text-blue-600' : undefined}
                />
            </label>
            {TEXT_PADDING_SIDES.map(side => {
                const value = Object.hasOwn(drafts, side)
                    ? drafts[side]!
                    : values[side] === 'mixed' ? '' : String(values[side]);
                const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
                    const raw = event.target.value;
                    setDraft(side, raw);
                    if (raw.trim() === '') return;
                    const parsed = Number(raw);
                    if (Number.isFinite(parsed)) onCommit(side, Math.max(0, parsed), linked);
                };
                const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
                    if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        nudge(side, 1);
                    } else if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        nudge(side, -1);
                    }
                };
                if (touch) {
                    // Phone and tablet: one full-width row per side, with the −/+ at 44px and the
                    // input at 16px; the four-up desktop row has no room for three touch targets each.
                    return (
                        <div key={side} className="flex basis-full items-center gap-2">
                            <span aria-hidden="true" className={`w-14 shrink-0 text-xs ${disabled ? 'text-slate-300' : 'text-slate-500'}`}>
                                {LABELS[side]}
                            </span>
                            <TouchStepper
                                name={`${side} padding`}
                                repeat={repeat}
                                disabled={disabled}
                                onNudge={delta => nudge(side, delta)}
                                className="min-w-0 flex-1"
                            >
                                <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    aria-label={`Padding ${side}`}
                                    className="h-11 w-full min-w-0 rounded border border-slate-200 bg-white px-2 text-center text-base text-slate-700 [appearance:textfield] focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:cursor-not-allowed disabled:text-slate-400 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                    value={value}
                                    placeholder={values[side] === 'mixed' ? 'Mixed' : undefined}
                                    disabled={disabled}
                                    onChange={onChange}
                                    onKeyDown={onKeyDown}
                                    onBlur={() => clearDraft(side)}
                                />
                            </TouchStepper>
                        </div>
                    );
                }
                return (
                    <div key={side} className="group/stepper relative min-w-0 flex-1">
                        <label
                            className={`flex h-7 min-w-0 items-center rounded border border-slate-200 bg-white pl-1.5 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400 ${
                                disabled ? 'text-slate-300' : 'text-slate-500'
                            }`}
                        >
                            <span aria-hidden="true" className="text-[10px] font-medium">
                                {SHORT_LABELS[side]}
                            </span>
                            <input
                                type="number"
                                min="0"
                                step="any"
                                aria-label={`Padding ${side}`}
                                className="w-0 min-w-0 flex-1 border-0 bg-transparent py-0 pl-1 pr-5 text-right text-xs text-slate-700 [appearance:textfield] focus:outline-none disabled:cursor-not-allowed disabled:text-slate-400 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                value={value}
                                placeholder={values[side] === 'mixed' ? 'Mixed' : undefined}
                                disabled={disabled}
                                onChange={onChange}
                                onKeyDown={onKeyDown}
                                onBlur={() => clearDraft(side)}
                            />
                        </label>
                        <div data-micro-stepper className={`absolute bottom-0.5 right-0.5 top-0.5 flex w-3 flex-col justify-center rounded-sm border-l bg-white px-0.5 transition-opacity ${
                            disabled
                                ? 'opacity-0'
                                : 'opacity-0 group-focus-within/stepper:opacity-100 group-hover/stepper:opacity-100'
                        }`}>
                            <button
                                type="button"
                                aria-label={`Increase ${side} padding`}
                                className="flex h-2.5 items-center justify-center rounded-sm text-slate-500 hover:bg-slate-100 active:bg-slate-200 disabled:text-slate-300"
                                disabled={disabled}
                                tabIndex={-1}
                                onMouseDown={event => {
                                    event.preventDefault();
                                    startRepeat(side, 1);
                                }}
                                onMouseUp={stopRepeat}
                                onMouseLeave={stopRepeat}
                                onClick={event => {
                                    if (event.detail === 0) nudge(side, 1);
                                }}
                            >
                                <ChevronUp size={10} />
                            </button>
                            <button
                                type="button"
                                aria-label={`Decrease ${side} padding`}
                                className="flex h-2.5 items-center justify-center rounded-sm text-slate-500 hover:bg-slate-100 active:bg-slate-200 disabled:text-slate-300"
                                disabled={disabled}
                                tabIndex={-1}
                                onMouseDown={event => {
                                    event.preventDefault();
                                    startRepeat(side, -1);
                                }}
                                onMouseUp={stopRepeat}
                                onMouseLeave={stopRepeat}
                                onClick={event => {
                                    if (event.detail === 0) nudge(side, -1);
                                }}
                            >
                                <ChevronDown size={10} />
                            </button>
                        </div>
                    </div>
                );
            })}
            {disabled && (
                <div
                    id={tooltipId}
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 w-full rounded bg-slate-800 px-2 py-1.5 text-[11px] leading-4 text-white opacity-0 shadow-lg transition-opacity group-focus:opacity-100 group-hover:opacity-100"
                >
                    Padding applies only to fixed-size text. Turn off Auto width to edit it.
                </div>
            )}
        </div>
    );
};

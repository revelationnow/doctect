import React from 'react';
import { Minus, Plus } from 'lucide-react';

/** Hold-to-repeat timing shared by the desktop micro-steppers and the touch steppers. */
export const STEPPER_REPEAT_DELAY_MS = 300;
export const STEPPER_REPEAT_INTERVAL_MS = 50;

export interface HoldRepeat {
    /** Runs `action` once now, then every STEPPER_REPEAT_INTERVAL_MS after STEPPER_REPEAT_DELAY_MS until `stop`. */
    start(action: () => void): void;
    stop(): void;
}

/**
 * One press-and-hold timer per control. Starting a hold cancels any hold in progress, and the
 * timers clear on unmount, so a repeat can never outlive its field.
 */
export function useHoldRepeat(): HoldRepeat {
    const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

    const stop = React.useCallback(() => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        intervalRef.current = null;
        timeoutRef.current = null;
    }, []);

    const start = React.useCallback((action: () => void) => {
        stop();
        action();
        timeoutRef.current = setTimeout(() => {
            intervalRef.current = setInterval(action, STEPPER_REPEAT_INTERVAL_MS);
        }, STEPPER_REPEAT_DELAY_MS);
    }, [stop]);

    React.useEffect(() => stop, [stop]);

    return React.useMemo(() => ({ start, stop }), [start, stop]);
}

interface TouchStepperProps {
    /** Names the buttons: "Decrease {name}" / "Increase {name}". */
    name: string;
    /** The editable input for the value. */
    children: React.ReactNode;
    /** Nudges the value once by the given delta (a tap, each tick of a hold, keyboard activation). */
    onNudge: (delta: number) => void;
    /** The owner's hold timer, shared with its desktop stepper so a selection change can stop either. */
    repeat: HoldRepeat;
    step?: number;
    disabled?: boolean;
    className?: string;
}

const BUTTON_CLASS = 'flex h-11 w-11 shrink-0 select-none touch-none items-center justify-center rounded border border-slate-200 bg-white text-slate-600 active:bg-slate-100 disabled:text-slate-300';

interface StepButtonProps extends Pick<TouchStepperProps, 'onNudge' | 'repeat' | 'disabled'> {
    delta: number;
    label: string;
    Icon: typeof Minus;
}

/**
 * The press starts the hold on `pointerdown` (so a tap nudges at once and a hold can repeat) and
 * cancels it, which keeps focus where it is: the input neither loses nor gains it, so the
 * on-screen keyboard stays as it was. The tap's trailing `click` is consumed: a touch tap's click
 * is not told apart by `detail` (Chromium reports 0, as for a keyboard) and `pointerType` is not
 * on every browser's click. A click with no press before it (keyboard, assistive technology)
 * nudges once. A cancelled press, or one that slides off the button while still down, gets no
 * click, so those drop the pending flag; a touch pointer also "leaves" when it is lifted, after
 * pointerup and before its click, and that leave keeps the flag.
 */
function StepButton({ delta, label, Icon, onNudge, repeat, disabled }: StepButtonProps) {
    const pressed = React.useRef(false);
    const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (disabled || event.isPrimary === false || event.button > 0) return;
        event.preventDefault();
        pressed.current = true;
        repeat.start(() => onNudge(delta));
    };
    const cancel = () => {
        repeat.stop();
        pressed.current = false;
    };
    const onPointerLeave = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.buttons !== 0) cancel();
        else repeat.stop();
    };
    const onClick = () => {
        if (pressed.current) {
            pressed.current = false;
            return;
        }
        if (!disabled) onNudge(delta);
    };
    return (
        <button
            type="button"
            aria-label={label}
            className={BUTTON_CLASS}
            disabled={disabled}
            onPointerDown={onPointerDown}
            onPointerUp={repeat.stop}
            onPointerCancel={cancel}
            onPointerLeave={onPointerLeave}
            onContextMenu={event => event.preventDefault()}
            onClick={onClick}
        >
            <Icon size={18} aria-hidden="true" />
        </button>
    );
}

/**
 * Touch-sized `[−] [input] [+]` row for a numeric property field (phone and tablet only; desktop
 * keeps its hover micro-steppers). A tap nudges once; holding repeats at the desktop delay and
 * rate; the buttons never move focus (see StepButton).
 */
export function TouchStepper({ name, children, onNudge, repeat, step = 1, disabled = false, className }: TouchStepperProps) {
    const shared = { onNudge, repeat, disabled };
    return (
        <div data-touch-stepper className={className ? `flex items-center gap-2 ${className}` : 'flex items-center gap-2'}>
            <StepButton delta={-step} label={`Decrease ${name}`} Icon={Minus} {...shared} />
            {children}
            <StepButton delta={step} label={`Increase ${name}`} Icon={Plus} {...shared} />
        </div>
    );
}

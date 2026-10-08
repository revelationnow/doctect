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
 * One press-and-hold timer per control. Starting a hold cancels any hold in progress. A hold also
 * ends when the page is hidden or the window loses focus, since a finger lifted during an app
 * switch or under a system dialog sends no pointer event, and the timers clear on unmount, so a
 * repeat can never outlive its field or run unseen.
 */
export function useHoldRepeat(): HoldRepeat {
    const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

    const stop = React.useCallback(function end() {
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        intervalRef.current = null;
        timeoutRef.current = null;
        document.removeEventListener('visibilitychange', end);
        window.removeEventListener('blur', end);
    }, []);

    const start = React.useCallback((action: () => void) => {
        stop();
        action();
        timeoutRef.current = setTimeout(() => {
            intervalRef.current = setInterval(action, STEPPER_REPEAT_INTERVAL_MS);
        }, STEPPER_REPEAT_DELAY_MS);
        document.addEventListener('visibilitychange', stop);
        window.addEventListener('blur', stop);
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

const BUTTON_CLASS = 'flex h-11 w-11 shrink-0 select-none items-center justify-center rounded border border-slate-200 bg-white text-slate-600 active:bg-slate-100 disabled:text-slate-300';

interface StepButtonProps extends Pick<TouchStepperProps, 'onNudge' | 'repeat' | 'disabled'> {
    delta: number;
    label: string;
    Icon: typeof Minus;
}

/**
 * The press starts the hold on `pointerdown` (so a tap nudges at once and a hold can repeat) and
 * cancels it, which keeps focus where it is: the input neither loses nor gains it, so the
 * on-screen keyboard stays as it was. The hold ends on pointerup, on pointercancel (the browser
 * claimed the finger for a scroll: the button keeps the default touch-action so the sheet or
 * panel can scroll from it) and on pointerleave (a mouse, or a finger whose implicit capture the
 * press released, slid off).
 *
 * The tap's trailing `click` is consumed by the press that produced it: a touch tap's click is
 * not told apart by `detail` (Chromium reports 0, as for a keyboard) and `pointerType` is not on
 * every browser's click. A click with no press before it (keyboard, assistive technology) nudges
 * once. The flag is cleared only by that click or by a keydown, so a press that ends without a
 * click (a slide-off, a claimed scroll, a long Android hold) cannot swallow the keyboard
 * activation that follows, and a mouse that slides off and back before releasing (which does
 * click) still nudges once.
 */
function StepButton({ delta, label, Icon, onNudge, repeat, disabled }: StepButtonProps) {
    const pressed = React.useRef(false);
    const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (disabled || event.isPrimary === false || event.button > 0) return;
        event.preventDefault();
        // A touch pointer is implicitly captured by its pointerdown target, which would keep a
        // finger that slides off the button "on" it (no pointerleave) until it lifts. Browsers
        // refuse the call for an uncaptured (mouse) or unknown pointer.
        try {
            event.currentTarget.releasePointerCapture?.(event.pointerId);
        } catch {
            /* not captured */
        }
        pressed.current = true;
        repeat.start(() => onNudge(delta));
    };
    const onClick = () => {
        if (pressed.current) {
            pressed.current = false;
            return;
        }
        if (!disabled) onNudge(delta);
    };
    const onKeyDown = () => {
        pressed.current = false;
    };
    return (
        <button
            type="button"
            aria-label={label}
            className={BUTTON_CLASS}
            disabled={disabled}
            onPointerDown={onPointerDown}
            onPointerUp={repeat.stop}
            onPointerCancel={repeat.stop}
            onPointerLeave={repeat.stop}
            onKeyDown={onKeyDown}
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

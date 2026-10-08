import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Tabbable descendants in document order: focusable and not inside a hidden or aria-hidden subtree. */
export const tabbableWithin = (container: HTMLElement): HTMLElement[] =>
    Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter(element => element.closest('[hidden], [aria-hidden="true"]') === null);

/**
 * Keeps Tab inside a modal dialog (the touch drawer and ⋯ sheet, `aria-modal` with no inert
 * backdrop): from the dialog's last tabbable, or from the dialog element itself, Tab wraps to the
 * first, and Shift+Tab wraps the other way. Everything else is the browser's: a Tab between two
 * inner controls, one a nested dialog already handled (`defaultPrevented`, e.g. a cloud modal
 * rendered by a sheet row with its own trap), and one whose focus is not inside the container at
 * all (a portal rendered by a child but living elsewhere in the DOM). It only ever acts on the
 * Tab key, so focus hand-offs on open and close are untouched.
 */
export function trapTab(event: ReactKeyboardEvent, container: HTMLElement | null): void {
    if (event.key !== 'Tab' || event.defaultPrevented || !container) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !container.contains(active)) return;
    const tabbable = tabbableWithin(container);
    if (tabbable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
    }
    const first = tabbable[0];
    const last = tabbable[tabbable.length - 1];
    const atEdge = active === container || active === (event.shiftKey ? first : last);
    if (!atEdge) return;
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
}

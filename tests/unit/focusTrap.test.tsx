import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { tabbableWithin, trapTab } from '../../components/editor-layout/focusTrap';
import { layOutEveryElement } from '../helpers/jsdomLayout';

layOutEveryElement();

const tabEvent = (overrides: Partial<React.KeyboardEvent> = {}) => ({
    key: 'Tab', shiftKey: false, defaultPrevented: false, preventDefault: vi.fn(), ...overrides,
}) as unknown as React.KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> };

describe('tabbableWithin', () => {
    it('lists the controls in the Tab sequence, in document order, and nothing hidden or inert', () => {
        render(
            <div data-testid="container">
                <a href="/docs">Link</a>
                <a>Anchor without href</a>
                <button type="button">Button</button>
                <button type="button" disabled>Disabled</button>
                <button type="button" tabIndex={-1}>Programmatic</button>
                <input aria-label="Field" />
                <input aria-label="Hidden" hidden />
                <select aria-label="Choice"><option>a</option></select>
                <textarea aria-label="Notes" />
                <details><summary>Summary</summary>body</details>
                <iframe title="Frame" />
                <audio controls aria-label="Audio" />
                <audio aria-label="Silent audio" />
                <video controls aria-label="Video" />
                <div contentEditable="true" aria-label="Editable" />
                <div contentEditable="false" aria-label="Read only" />
                <div tabIndex={0} aria-label="Tabbable box" />
                <div tabIndex={-1} aria-label="Focusable box" />
                <span aria-hidden="true"><button type="button">Decorative</button></span>
                <div style={{ display: 'none' }}><button type="button">Collapsed</button></div>
                <div inert><button type="button">Inert</button></div>
                <button type="button" style={{ visibility: 'hidden' }}>Invisible</button>
                <button type="button">Last</button>
            </div>,
        );
        const names = tabbableWithin(screen.getByTestId('container'))
            .map(element => element.getAttribute('aria-label') ?? element.getAttribute('title') ?? element.textContent?.trim());
        expect(names).toEqual([
            'Link', 'Button', 'Field', 'Choice', 'Notes', 'Summary', 'Frame', 'Audio', 'Video', 'Editable', 'Tabbable box', 'Last',
        ]);
    });
});

describe('trapTab', () => {
    it('does nothing when focus is outside the container, even one with nothing tabbable', () => {
        // The only branch where the containment guard is load-bearing: an empty container would
        // otherwise swallow the key and pull focus onto itself.
        render(
            <>
                <button type="button">Outside</button>
                <div role="dialog" tabIndex={-1} data-testid="empty"><p>nothing to focus</p></div>
            </>,
        );
        const outside = screen.getByRole('button', { name: 'Outside' });
        const container = screen.getByTestId('empty');
        outside.focus();
        const event = tabEvent();
        trapTab(event, container);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(outside);
        // With focus inside, the same container keeps it: the key is swallowed and focus stays put.
        container.focus();
        trapTab(event, container);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(container);
    });

    it('stands down for a Tab a child already handled, and for other keys and a missing container', () => {
        render(<div role="dialog" tabIndex={-1} data-testid="box"><button type="button">Only</button></div>);
        const container = screen.getByTestId('box');
        const only = screen.getByRole('button', { name: 'Only' });
        only.focus();
        const handled = tabEvent({ defaultPrevented: true });
        trapTab(handled, container);
        expect(handled.preventDefault).not.toHaveBeenCalled();
        const enter = tabEvent({ key: 'Enter' });
        trapTab(enter, container);
        expect(enter.preventDefault).not.toHaveBeenCalled();
        const noContainer = tabEvent();
        trapTab(noContainer, null);
        expect(noContainer.preventDefault).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(only);
        // Unhandled Tab from the single control wraps onto itself (prevented, still focused).
        const wrap = tabEvent();
        trapTab(wrap, container);
        expect(wrap.preventDefault).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(only);
    });
});

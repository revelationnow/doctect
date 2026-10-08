import React from 'react';
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { Router } from '@remix-run/router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EditorPage } from '../../pages/EditorPage';
import { createNormalizedAppHarness } from '../helpers/normalizedAppHarness';
import { overlayDepthOf } from '../../components/editor-layout/useBackDismiss';

// Router interop of the touch overlays' back gesture on the real editor page (normalized store,
// data router, `useBlocker`): with unsaved work, back from an overlay entry closes the overlay
// without the "Leave editor?" prompt and without remounting the editor, while back with nothing
// open prompts exactly as before. Desktop pushes nothing and prompts as before.

vi.mock('../../components/AccountMenu', () => ({ AccountMenu: () => null }));
vi.mock('../../components/cloud/CloudMenu', () => ({ CloudMenu: () => null }));
vi.mock('../../services/analytics', () => ({ trackEvent: vi.fn() }));

const installMatchMedia = (coarse: boolean) => {
    (window as any).matchMedia = (query: string) => ({
        matches: query === '(pointer: coarse)' ? coarse : query === '(max-width: 639px)' ? coarse : false,
        media: query, addEventListener() {}, removeEventListener() {},
    });
};

let h: Awaited<ReturnType<typeof createNormalizedAppHarness>>;
let router: Router;

const mountEditor = async (coarse: boolean) => {
    installMatchMedia(coarse);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ font: '', measureText: (value: string) => ({ width: value.length * 6 }) } as CanvasRenderingContext2D);
    h = await createNormalizedAppHarness();
    router = createMemoryRouter([
        { path: '/app', element: <EditorPage store={h.store} initialWorkspace={h.ready.snapshot} initialWarnings={[]} /> },
        { path: '/', element: <div>Home route</div> },
    ], { initialEntries: ['/', '/app'], initialIndex: 1 });
    render(<RouterProvider router={router} />);
    await act(async () => { await h.editing.flush(); });
    h.messages.length = 0;
};

const activeCanvas = () => screen.getAllByTestId('project-pane').find(pane => pane.dataset.active === 'true')!.querySelector('[data-testid="editor-canvas"]')!;
/** `hidden` includes a dialog the unsaved-work prompt has put behind `aria-hidden`. */
const jsonHeading = (hidden = false) => screen.queryByRole('heading', { name: 'Project JSON Editor', hidden });
const back = () => act(() => { void router.navigate(-1); });

/**
 * Edits the first element's text with its worker reply held, so the document stays unsaved. The
 * layers list and the text field live in the properties slot on every layout (the phone sheet
 * keeps them mounted, hidden, at its peek detent).
 */
const createUnsavedWork = async () => {
    fireEvent.click(screen.getByTitle('Layers'));
    fireEvent.click(screen.getByTestId('element-row-title'));
    h.holdDocumentReplies(true);
    fireEvent.change(screen.getByPlaceholderText('Text content or {{field}}'), { target: { value: 'Unsaved text' } });
    await waitFor(() => expect(h.held).toHaveLength(1), { timeout: 2000 });
    expect(h.editing.getSnapshot().hasUnsavedWork).toBe(true);
};

beforeEach(() => { vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => { cleanup(); h?.dispose(); vi.restoreAllMocks(); delete (window as any).matchMedia; document.documentElement.removeAttribute('data-form-factor'); });

it('phone: back closes the JSON dialog opened from ⋯ without the unsaved-work prompt or an editor remount; back with nothing open prompts as before', async () => {
    await mountEditor(true);
    expect(document.documentElement.getAttribute('data-form-factor')).toBe('phone');
    const canvas = activeCanvas();
    const openJsonFromOverflow = () => {
        fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
        fireEvent.click(within(screen.getByRole('dialog', { name: 'More actions' })).getByRole('button', { name: 'JSON' }));
    };
    await createUnsavedWork();
    expect(overlayDepthOf(router.state.location)).toBe(0);

    openJsonFromOverflow();
    expect(screen.queryByRole('dialog', { name: 'More actions' })).toBeNull();
    expect(jsonHeading()).toBeTruthy();
    expect(overlayDepthOf(router.state.location)).toBe(1);
    expect(router.state.location.pathname).toBe('/app');
    expect(h.editing.getSnapshot().hasUnsavedWork).toBe(true);

    back();
    expect(jsonHeading()).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(router.state.location.pathname).toBe('/app');
    expect(overlayDepthOf(router.state.location)).toBe(0);
    expect(activeCanvas()).toBe(canvas);
    expect(h.editing.getSnapshot().hasUnsavedWork).toBe(true);

    // The drawer too: open, back, closed, still /app.
    fireEvent.click(screen.getByRole('button', { name: 'Open pages and templates' }));
    expect(screen.getByRole('dialog', { name: 'Pages and templates' })).toBeTruthy();
    expect(overlayDepthOf(router.state.location)).toBe(1);
    back();
    expect(screen.queryByRole('dialog', { name: 'Pages and templates' })).toBeNull();
    expect(router.state.location.pathname).toBe('/app');
    expect(activeCanvas()).toBe(canvas);

    // Nothing open: the unsaved-work prompt, exactly as before.
    back();
    const prompt = await screen.findByRole('alertdialog', { name: 'Leave editor?' });
    expect(router.state.location.pathname).toBe('/app');
    fireEvent.click(within(prompt).getByRole('button', { name: 'Stay' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(router.state.location.pathname).toBe('/app');
    expect(activeCanvas()).toBe(canvas);

    await act(async () => { h.holdDocumentReplies(false); while (h.held.length > 0) h.releaseDocumentReply(); });
});

it('desktop: overlays push no entries and back with unsaved work prompts as before', async () => {
    await mountEditor(false);
    expect(document.documentElement.hasAttribute('data-form-factor')).toBe(false);
    const key = router.state.location.key;
    await createUnsavedWork();
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    expect(jsonHeading()).toBeTruthy();
    expect(router.state.location.key).toBe(key);
    expect(overlayDepthOf(router.state.location)).toBe(0);
    back();
    // Desktop: the dialog is untouched by history, and the page prompts before leaving.
    const prompt = await screen.findByRole('alertdialog', { name: 'Leave editor?' });
    expect(jsonHeading(true)).toBeTruthy();
    expect(router.state.location.pathname).toBe('/app');
    fireEvent.click(within(prompt).getByRole('button', { name: 'Stay' }));
    expect(jsonHeading()).toBeTruthy();
    expect(router.state.location.key).toBe(key);
    await act(async () => { h.holdDocumentReplies(false); while (h.held.length > 0) h.releaseDocumentReply(); });
});

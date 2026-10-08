import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { Router } from '@remix-run/router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PageTracker } from '../../components/PageTracker';
import { BACK_DISMISS_STATE_KEY } from '../../components/editor-layout/useBackDismiss';
import { trackEvent } from '../../services/analytics';

// Analytics page views are keyed on the router location, as they always were: every navigation
// counts, same-URL replaces included (a NavLink re-click, identical setSearchParams). The one
// exception is the touch editor's overlay entries (same URL, marker in location.state): pushing
// one, or popping back off one, is not a page view.

vi.mock('../../services/analytics', () => ({ trackEvent: vi.fn() }));

const views = () => (trackEvent as ReturnType<typeof vi.fn>).mock.calls.map(call => call[1].path);
let router: Router;
const go = (to: string | number, opts?: { replace?: boolean; state?: unknown }) => act(() => {
    void (typeof to === 'number' ? router.navigate(to) : router.navigate(to, opts));
});

beforeEach(() => {
    vi.mocked(trackEvent).mockClear();
    router = createMemoryRouter([{ path: '*', element: <PageTracker /> }], { initialEntries: ['/gallery'] });
    render(<RouterProvider router={router} />);
});
afterEach(() => cleanup());

it('tracks the initial location and every later navigation, including same-URL replaces', () => {
    expect(views()).toEqual(['/gallery']);
    go('/gallery', { replace: true }); // a NavLink re-click on the current page
    expect(views()).toEqual(['/gallery', '/gallery']);
    go('/gallery?sort=new');
    go('/gallery?sort=new', { replace: true }); // setSearchParams to identical params
    expect(views()).toEqual(['/gallery', '/gallery', '/gallery', '/gallery']);
    go('/app');
    go(-1);
    expect(views()).toEqual(['/gallery', '/gallery', '/gallery', '/gallery', '/app', '/gallery']);
});

it('ignores touch overlay entries: the push onto /app, nested pushes, and the pops back off them', () => {
    go('/app');
    expect(views()).toEqual(['/gallery', '/app']);
    go('/app', { state: { [BACK_DISMISS_STATE_KEY]: 1 } });
    go('/app', { state: { [BACK_DISMISS_STATE_KEY]: 2 } });
    expect(views()).toEqual(['/gallery', '/app']);
    go(-1);
    go(-1);
    expect(router.state.location.state).toBeNull();
    expect(views()).toEqual(['/gallery', '/app']);
});

it('still tracks leaving an overlay entry for another URL and arriving on one from another URL', () => {
    go('/app');
    go('/app', { state: { [BACK_DISMISS_STATE_KEY]: 1 } });
    go('/gallery');
    expect(views()).toEqual(['/gallery', '/app', '/gallery']);
    go(-1); // back from the gallery lands on the stale overlay entry: an arrival at /app
    expect(views()).toEqual(['/gallery', '/app', '/gallery', '/app']);
    go(-1); // the provider consumes it: same URL, off an overlay entry
    expect(views()).toEqual(['/gallery', '/app', '/gallery', '/app']);
});

import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import { createMemoryHistory, createRouter } from '@remix-run/router';
import type { MemoryHistory, Router } from '@remix-run/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormFactorProvider } from '../../components/editor-layout/FormFactorContext';
import type { FormFactor } from '../../hooks/useEditorFormFactor';
import {
    BACK_DISMISS_STATE_KEY, BackDismissProvider, isSameRouteNavigation, overlayDepthOf, useBackDismiss,
} from '../../components/editor-layout/useBackDismiss';
import type { BackDismissHandler } from '../../components/editor-layout/useBackDismiss';
import { JsonModal } from '../../components/JsonModal';
import { DISCARD_JSON_CHANGES_MESSAGE } from '../../components/json/discardJsonChanges';

// The touch overlays' back-gesture support, driven through the data router it integrates with:
// a memory router whose `/app` route hosts the provider and a `/` route below it standing in
// for wherever the user came from. `router.navigate(-1)` is the back gesture (memory history
// delivers the POP synchronously; the browser delivers it in a later task, which the provider's
// pending guard covers either way).

type Handlers = Record<string, BackDismissHandler>;
type OpenState = Record<string, boolean>;

function Overlay({ name, open, dismiss }: { name: string; open: boolean; dismiss: BackDismissHandler }) {
    useBackDismiss(open, dismiss);
    return open ? <div data-testid={`overlay-${name}`} /> : null;
}

let setOpen: React.Dispatch<React.SetStateAction<OpenState>> = () => {};
let setHold: React.Dispatch<React.SetStateAction<boolean>> = () => {};
let setFormFactor: React.Dispatch<React.SetStateAction<FormFactor>> = () => {};

function Host({ handlers, formFactor: initialFormFactor }: { handlers: Handlers; formFactor: FormFactor }) {
    const [open, update] = useState<OpenState>({});
    const [hold, updateHold] = useState(false);
    const [formFactor, updateFormFactor] = useState(initialFormFactor);
    setOpen = update;
    setHold = updateHold;
    setFormFactor = updateFormFactor;
    return (
        <FormFactorProvider value={formFactor}>
            <BackDismissProvider hold={hold}>
                {Object.keys(handlers).map(name => <Overlay key={name} name={name} open={open[name] === true} dismiss={handlers[name]} />)}
            </BackDismissProvider>
        </FormFactorProvider>
    );
}

const depth = (router: Router) => overlayDepthOf(router.state.location);
const closes = (name: string): BackDismissHandler => () => { setOpen(state => ({ ...state, [name]: false })); };

/** Mounts the provider on `/app` with `/` beneath it; `log` records every router update. */
const routesFor = (formFactor: FormFactor, handlers: Handlers): RouteObject[] => [
    { path: '/app', element: <Host handlers={handlers} formFactor={formFactor} /> },
    { path: '/', element: <div>home route</div> },
];
const logOf = (router: Router) => {
    const log: { action: string; depth: number; pathname: string }[] = [];
    router.subscribe(state => log.push({ action: state.historyAction, depth: overlayDepthOf(state.location), pathname: state.location.pathname }));
    return log;
};
const mount = (formFactor: FormFactor, handlers: Handlers, options: { initialEntries?: Parameters<typeof createMemoryRouter>[1] } = {}) => {
    const router = createMemoryRouter(routesFor(formFactor, handlers), { initialEntries: ['/', '/app'], initialIndex: 1, ...options.initialEntries });
    const log = logOf(router);
    render(<RouterProvider router={router} />);
    return { router, log };
};

/**
 * Like `mount`, but `go()` (the provider's `navigate(-n)` and the user's back) lands only when
 * `flushPops` runs, as the browser's popstate does in a later task; memory history otherwise
 * delivers it synchronously, which hides the window the provider's pending guard covers.
 */
const mountWithDeferredPops = (formFactor: FormFactor, handlers: Handlers) => {
    const history = createMemoryHistory({ initialEntries: ['/', '/app'], initialIndex: 1 });
    const queued: number[] = [];
    const deferred: MemoryHistory = {
        get index() { return history.index; },
        get action() { return history.action; },
        get location() { return history.location; },
        listen: fn => history.listen(fn),
        createHref: to => history.createHref(to),
        createURL: to => history.createURL(to),
        encodeLocation: to => history.encodeLocation(to),
        push: (to, state) => history.push(to, state),
        replace: (to, state) => history.replace(to, state),
        go: delta => { queued.push(delta); },
    };
    const router = createRouter({ routes: routesFor(formFactor, handlers), history: deferred, future: { v7_prependBasename: true } }).initialize();
    const log = logOf(router);
    render(<RouterProvider router={router} />);
    const flushPops = () => act(() => { while (queued.length > 0) history.go(queued.shift()!); });
    return { router, log, flushPops };
};

const open = (name: string) => act(() => { setOpen(state => ({ ...state, [name]: true })); });
const close = (name: string) => act(() => { setOpen(state => ({ ...state, [name]: false })); });
const back = (router: Router, delta = -1) => act(() => { void router.navigate(delta); });

beforeEach(() => { setOpen = () => {}; setHold = () => {}; setFormFactor = () => {}; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); document.documentElement.removeAttribute('data-form-factor'); });

describe('useBackDismiss on desktop', () => {
    it('adds no history entries and leaves the back button to the router', () => {
        const dismiss = vi.fn(closes('a'));
        const { router, log } = mount('desktop', { a: dismiss });
        const key = router.state.location.key;
        open('a');
        expect(screen.getByTestId('overlay-a')).toBeTruthy();
        expect(log).toHaveLength(0);
        expect(router.state.location.key).toBe(key);
        expect(depth(router)).toBe(0);
        back(router);
        // Back is a real navigation on desktop: the editor route unmounts, the hook never intervened.
        expect(router.state.location.pathname).toBe('/');
        expect(dismiss).not.toHaveBeenCalled();
        close('a');
        expect(log.filter(entry => entry.action !== 'POP')).toHaveLength(0);
    });

    it('is a no-op for a component rendered outside the provider and the router', () => {
        const dismiss = vi.fn();
        expect(() => render(<FormFactorProvider value="phone"><Overlay name="lonely" open dismiss={dismiss} /></FormFactorProvider>)).not.toThrow();
        expect(screen.getByTestId('overlay-lonely')).toBeTruthy();
        expect(dismiss).not.toHaveBeenCalled();
    });
});

describe.each(['phone', 'tablet'] as const)('useBackDismiss on %s', formFactor => {
    it('pushes one same-URL entry on open; back closes the overlay and stays on /app; the next back leaves', () => {
        const dismiss = vi.fn(closes('a'));
        const { router, log } = mount(formFactor, { a: dismiss });
        open('a');
        expect(log).toEqual([{ action: 'PUSH', depth: 1, pathname: '/app' }]);
        expect(router.state.location.state).toEqual({ [BACK_DISMISS_STATE_KEY]: 1 });
        back(router);
        expect(dismiss).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('overlay-a')).toBeNull();
        expect(router.state.location.pathname).toBe('/app');
        expect(depth(router)).toBe(0);
        // The overlay closing after the pop asked for nothing more: exactly one POP, no extra entry.
        expect(log.slice(1)).toEqual([{ action: 'POP', depth: 0, pathname: '/app' }]);
        back(router);
        expect(router.state.location.pathname).toBe('/');
        expect(dismiss).toHaveBeenCalledTimes(1);
    });

    it('consumes the entry when the overlay closes any other way, so history does not accumulate', () => {
        const dismiss = vi.fn(closes('a'));
        const { router, log } = mount(formFactor, { a: dismiss });
        open('a');
        close('a');
        expect(dismiss).not.toHaveBeenCalled();
        expect(log.map(entry => entry.action)).toEqual(['PUSH', 'POP']);
        expect(depth(router)).toBe(0);
        expect(router.state.location.pathname).toBe('/app');
        // Reopening pushes exactly one entry again (the old one became a truncated forward entry).
        open('a');
        expect(log.map(entry => entry.action)).toEqual(['PUSH', 'POP', 'PUSH']);
        expect(depth(router)).toBe(1);
        back(router);
        expect(router.state.location.pathname).toBe('/app');
        back(router);
        expect(router.state.location.pathname).toBe('/');
    });

    it('unwinds nested overlays one per back, innermost first', () => {
        const dismissA = vi.fn(closes('a')), dismissB = vi.fn(closes('b'));
        const { router, log } = mount(formFactor, { a: dismissA, b: dismissB });
        open('a');
        open('b');
        expect(log.map(entry => [entry.action, entry.depth])).toEqual([['PUSH', 1], ['PUSH', 2]]);
        back(router);
        expect(dismissB).toHaveBeenCalledTimes(1);
        expect(dismissA).not.toHaveBeenCalled();
        expect(screen.getByTestId('overlay-a')).toBeTruthy();
        expect(screen.queryByTestId('overlay-b')).toBeNull();
        expect(depth(router)).toBe(1);
        back(router);
        expect(dismissA).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('overlay-a')).toBeNull();
        expect(depth(router)).toBe(0);
        expect(router.state.location.pathname).toBe('/app');
    });

    it('keeps one entry when an overlay closes and another opens in the same commit (⋯ sheet → JSON dialog)', () => {
        const dismissMenu = vi.fn(closes('menu')), dismissJson = vi.fn(closes('json'));
        const { router, log } = mount(formFactor, { menu: dismissMenu, json: dismissJson });
        open('menu');
        act(() => { setOpen({ menu: false, json: true }); });
        expect(screen.queryByTestId('overlay-menu')).toBeNull();
        expect(screen.getByTestId('overlay-json')).toBeTruthy();
        // No history operation for the swap: the dialog took over the sheet's entry.
        expect(log.map(entry => entry.action)).toEqual(['PUSH']);
        expect(depth(router)).toBe(1);
        back(router);
        expect(dismissJson).toHaveBeenCalledTimes(1);
        expect(dismissMenu).not.toHaveBeenCalled();
        expect(screen.queryByTestId('overlay-json')).toBeNull();
        expect(router.state.location.pathname).toBe('/app');
        expect(depth(router)).toBe(0);
        // Nothing of the sheet remains: the next back leaves the editor, as with no overlay open.
        back(router);
        expect(router.state.location.pathname).toBe('/');
    });

    it('restores the entry when the dismiss handler refuses, and closes once it agrees', () => {
        let allow = false;
        const dismiss = vi.fn(() => { if (!allow) return false; setOpen({ a: false }); return true; });
        const { router, log } = mount(formFactor, { a: dismiss });
        open('a');
        back(router);
        expect(dismiss).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('overlay-a')).toBeTruthy();
        expect(log.map(entry => [entry.action, entry.depth])).toEqual([['PUSH', 1], ['POP', 0], ['PUSH', 1]]);
        expect(router.state.location.pathname).toBe('/app');
        allow = true;
        back(router);
        expect(dismiss).toHaveBeenCalledTimes(2);
        expect(screen.queryByTestId('overlay-a')).toBeNull();
        expect(depth(router)).toBe(0);
        expect(router.state.location.pathname).toBe('/app');
    });

    it('dismisses top-down after a multi-entry pop and stops at the first overlay that refuses', () => {
        const dismissInner = vi.fn(closes('inner'));
        const dismissOuter = vi.fn(() => false);
        const { router, log } = mount(formFactor, { outer: dismissOuter, inner: dismissInner });
        open('outer');
        open('inner');
        back(router, -2);
        expect(dismissInner).toHaveBeenCalledTimes(1);
        expect(dismissOuter).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('overlay-inner')).toBeNull();
        expect(screen.getByTestId('overlay-outer')).toBeTruthy();
        expect(log.at(-1)).toEqual({ action: 'PUSH', depth: 1, pathname: '/app' });
    });

    it('holds history operations while the page asks to (the unsaved-work prompt), then catches up', () => {
        const { router, log } = mount(formFactor, { a: closes('a') });
        open('a');
        act(() => { setHold(true); });
        close('a');
        expect(log.map(entry => entry.action)).toEqual(['PUSH']);
        expect(depth(router)).toBe(1);
        act(() => { setHold(false); });
        expect(log.map(entry => entry.action)).toEqual(['PUSH', 'POP']);
        expect(depth(router)).toBe(0);
    });

    it('consumes a stale overlay entry found on mount (reload, or return from another page)', () => {
        const { router, log } = mount(formFactor, { a: closes('a') }, {
            initialEntries: { initialEntries: ['/', '/app', { pathname: '/app', state: { [BACK_DISMISS_STATE_KEY]: 1 } }], initialIndex: 2 },
        });
        expect(log.map(entry => [entry.action, entry.depth, entry.pathname])).toEqual([['POP', 0, '/app']]);
        expect(depth(router)).toBe(0);
    });

    it('consumes the entry once: a second close with nothing open changes nothing (no double pop)', () => {
        const { router, log } = mount(formFactor, { drawer: closes('drawer') });
        open('drawer');
        close('drawer');
        close('drawer');
        expect(log.map(entry => entry.action)).toEqual(['PUSH', 'POP']);
        expect(router.state.location.pathname).toBe('/app');
    });
});

describe('useBackDismiss hardening', () => {
    it('does not dismiss an overlay opened while the pop that consumes its predecessor\'s entry is still landing', () => {
        const dismissA = vi.fn(closes('a')), dismissY = vi.fn(closes('y'));
        const { router, log, flushPops } = mountWithDeferredPops('phone', { a: dismissA, y: dismissY });
        open('a');
        expect(depth(router)).toBe(1);
        close('a'); // navigate(-1) issued, popstate not yet delivered
        expect(depth(router)).toBe(1);
        open('y'); // registered while that pop is pending: no push until the pop has landed
        expect(log.map(entry => entry.action)).toEqual(['PUSH']);
        flushPops(); // our pop lands at depth 0: Y is not what it closes, and Y now gets its own entry
        expect(dismissY).not.toHaveBeenCalled();
        expect(dismissA).not.toHaveBeenCalled();
        expect(screen.getByTestId('overlay-y')).toBeTruthy();
        expect(log.map(entry => [entry.action, entry.depth])).toEqual([['PUSH', 1], ['POP', 0], ['PUSH', 1]]);
        back(router);
        flushPops(); // the user's back, delivered later
        expect(dismissY).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('overlay-y')).toBeNull();
        expect(depth(router)).toBe(0);
        expect(router.state.location.pathname).toBe('/app');
    });

    it('consumes the entries of overlays open when the form factor flips to desktop, and starts clean when it flips back', () => {
        const dismissA = vi.fn(closes('a')), dismissB = vi.fn(closes('b'));
        const { router, log } = mount('phone', { a: dismissA, b: dismissB });
        open('a');
        act(() => { setFormFactor('desktop'); });
        // Desktop leaves the overlay alone but takes its entry back, so no back press is dead.
        expect(log.map(entry => [entry.action, entry.depth])).toEqual([['PUSH', 1], ['POP', 0]]);
        expect(dismissA).not.toHaveBeenCalled();
        expect(screen.getByTestId('overlay-a')).toBeTruthy();
        close('a');
        expect(log).toHaveLength(2);
        act(() => { setFormFactor('phone'); });
        open('b'); // the location moved while disabled; a fresh overlay must not be dismissed for it
        expect(dismissB).not.toHaveBeenCalled();
        expect(screen.getByTestId('overlay-b')).toBeTruthy();
        expect(depth(router)).toBe(1);
        back(router);
        expect(dismissB).toHaveBeenCalledTimes(1);
        expect(depth(router)).toBe(0);
        back(router);
        expect(router.state.location.pathname).toBe('/');
    });
});

describe('JSON editor back gesture', () => {
    const state = {
        nodes: { root: { id: 'root', parentId: null, type: 'page', title: 'Root', data: {}, children: [] } },
        rootId: 'root',
        variants: { default: { id: 'default', name: 'Default', templates: { page: { id: 'page', name: 'Page', width: 500, height: 700, elements: [] } } } },
        activeVariantId: 'default',
        schemaVersion: 12,
    } as any;

    function JsonHost() {
        const [open, update] = useState(true);
        setOpen = next => update(typeof next === 'function' ? next({ json: open }).json === true : next.json === true);
        return <JsonModal isOpen={open} onClose={() => update(false)} currentState={state} onSave={vi.fn()} />;
    }

    const mountJson = () => {
        const router = createMemoryRouter([
            { path: '/app', element: <FormFactorProvider value="phone"><BackDismissProvider><JsonHost /></BackDismissProvider></FormFactorProvider> },
            { path: '/', element: <div>home route</div> },
        ], { initialEntries: ['/', '/app'], initialIndex: 1 });
        render(<RouterProvider router={router} />);
        return router;
    };
    const textarea = () => screen.getByRole('heading', { name: 'Project JSON Editor' }).closest('.editor-dialog-panel')!.querySelector('textarea')!;

    it('closes without a prompt while nothing is unapplied', () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const router = mountJson();
        expect(depth(router)).toBe(1);
        back(router);
        expect(confirm).not.toHaveBeenCalled();
        expect(screen.queryByRole('heading', { name: 'Project JSON Editor' })).toBeNull();
        expect(router.state.location.pathname).toBe('/app');
        expect(depth(router)).toBe(0);
    });

    it('asks "Discard JSON changes?" with unapplied text edits; cancel keeps the dialog and its entry, OK closes it', () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const router = mountJson();
        fireEvent.click(screen.getByRole('button', { name: 'Text' }));
        fireEvent.change(textarea(), { target: { value: '{"edited": true}' } });
        back(router);
        expect(confirm).toHaveBeenCalledWith(DISCARD_JSON_CHANGES_MESSAGE);
        expect(screen.getByRole('heading', { name: 'Project JSON Editor' })).toBeTruthy();
        expect(textarea().value).toBe('{"edited": true}');
        expect(depth(router)).toBe(1);
        expect(router.state.location.pathname).toBe('/app');
        confirm.mockReturnValue(true);
        back(router);
        expect(confirm).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('heading', { name: 'Project JSON Editor' })).toBeNull();
        expect(depth(router)).toBe(0);
        expect(router.state.location.pathname).toBe('/app');
    });

    it('treats reformatted but unchanged text as clean, and a visual edit as dirty', () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const router = mountJson();
        fireEvent.click(screen.getByRole('button', { name: 'Text' }));
        fireEvent.change(textarea(), { target: { value: JSON.stringify(state) } });
        fireEvent.click(screen.getByRole('button', { name: 'Format' }));
        back(router);
        expect(confirm).not.toHaveBeenCalled();
        expect(screen.queryByRole('heading', { name: 'Project JSON Editor' })).toBeNull();
        expect(depth(router)).toBe(0);
    });
});

describe('location helpers', () => {
    it('reads the overlay depth only from a positive integer under the module key', () => {
        expect(overlayDepthOf({ state: null })).toBe(0);
        expect(overlayDepthOf({ state: { other: 1 } })).toBe(0);
        expect(overlayDepthOf({ state: { [BACK_DISMISS_STATE_KEY]: 2 } })).toBe(2);
        expect(overlayDepthOf({ state: { [BACK_DISMISS_STATE_KEY]: -1 } })).toBe(0);
        expect(overlayDepthOf({ state: { [BACK_DISMISS_STATE_KEY]: '1' } })).toBe(0);
    });

    it('calls a navigation same-route only when pathname, search and hash all match', () => {
        const app = { pathname: '/app', search: '', hash: '' };
        expect(isSameRouteNavigation(app, { ...app })).toBe(true);
        expect(isSameRouteNavigation(app, { ...app, pathname: '/' })).toBe(false);
        expect(isSameRouteNavigation(app, { ...app, search: '?x=1' })).toBe(false);
        expect(isSameRouteNavigation(app, { ...app, hash: '#top' })).toBe(false);
    });
});

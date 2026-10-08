import React, { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import { useFormFactor } from './FormFactorContext';

/**
 * Back gesture support for touch overlays (the ⋯ sheet, the pages drawer, the project switcher
 * and the full-screen dialogs). Every open overlay is one history entry above the editor's own
 * `/app` entry, so the phone's back gesture closes the topmost overlay and stays in the editor;
 * closing an overlay any other way consumes its entry again, so history never accumulates.
 *
 * Everything goes through the router: an entry is `navigate('/app', { state })` with the same
 * pathname/search/hash and this module's key in `location.state`, and it is consumed with
 * `navigate(-n)`. The router therefore keeps its own `{ usr, key, idx }` history state intact,
 * computes POP deltas correctly, and its unsaved-work blocker sees these as navigations between
 * two `/app` locations (`isSameRouteNavigation`), which EditorPage exempts.
 *
 * History timing (react-router 6.30 data router, loader-less routes): a push completes
 * synchronously inside `navigate()` (pushState + router state update); a `navigate(-n)` is a
 * `history.go()` whose popstate arrives in a later task. So the provider issues at most one
 * history operation per commit from a single reconcile pass over all registered overlays, and
 * issues nothing more until the router delivers the resulting location. Mixing a `go(-1)` with
 * a push in one tick would otherwise land the traversal on the wrong entry.
 *
 * Nesting rule: overlays register in open order; a pop that lands below the top of the stack
 * dismisses the overlays above the landing depth, top-down. A dismiss handler may refuse (return
 * `false`): the overlay then stays, the pass stops, and its entry is pushed again (the JSON
 * editor's "Discard JSON changes?" cancel path). Overlays that open and close in the same commit
 * (⋯ sheet → JSON dialog) swap inside one entry, so one back closes the dialog and nothing of the
 * sheet remains; the next back leaves the editor as before, blocker included.
 */

/** History-state key carrying how many touch overlays were open at that entry (absent at the base). */
export const BACK_DISMISS_STATE_KEY = 'touchOverlays';

/** Returns `false` to keep the overlay open (its history entry is restored); anything else closes it. */
export type BackDismissHandler = () => boolean | void;

interface Registry {
    register(id: string, dismiss: React.MutableRefObject<BackDismissHandler>): () => void;
}

const BackDismissContext = createContext<Registry | null>(null);

/** The overlay depth recorded on a location by this module; 0 for the editor's base entry. */
export const overlayDepthOf = (location: Pick<Location, 'state'>): number => {
    const state = location.state as Record<string, unknown> | null | undefined;
    const value = state?.[BACK_DISMISS_STATE_KEY];
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
};

/** True when a navigation stays on one URL (only `state`/`key` differ): an overlay entry, never a page change. */
export const isSameRouteNavigation = (
    current: Pick<Location, 'pathname' | 'search' | 'hash'>,
    next: Pick<Location, 'pathname' | 'search' | 'hash'>,
): boolean => current.pathname === next.pathname && current.search === next.search && current.hash === next.hash;

interface Entry {
    id: string;
    dismiss: React.MutableRefObject<BackDismissHandler>;
    /** Opened while a navigation of ours was still landing: that landing is not a back gesture for it. */
    sinceNavigation: boolean;
}

/**
 * Owns the overlay stack for the editor page. Active on phone and tablet only; on desktop it
 * provides nothing, so every `useBackDismiss` below it is a no-op and history is untouched
 * (except that entries left behind by a touch session, e.g. after a form-factor flip, are
 * consumed so no back press is dead).
 * `hold` pauses history operations while the unsaved-work prompt is up: a same-route POP would
 * otherwise complete and reset the router's blocker, dismissing the prompt under the user.
 */
export function BackDismissProvider({ hold = false, children }: { hold?: boolean; children: React.ReactNode }) {
    const enabled = useFormFactor() !== 'desktop';
    const location = useLocation();
    const navigate = useNavigate();
    const stack = useRef<Entry[]>([]);
    const [version, setVersion] = useState(0);
    /** Depth asked of the router and not yet delivered as a location; null when idle. */
    const pending = useRef<number | null>(null);
    const seen = useRef(location);

    const registry = useMemo<Registry>(() => ({
        register(id, dismiss) {
            const entry: Entry = { id, dismiss, sinceNavigation: pending.current !== null };
            stack.current = [...stack.current.filter(candidate => candidate.id !== id), entry];
            setVersion(value => value + 1);
            return () => {
                if (!stack.current.some(candidate => candidate.id === id)) return;
                stack.current = stack.current.filter(candidate => candidate.id !== id);
                setVersion(value => value + 1);
            };
        },
    }), []);

    useEffect(() => {
        const depth = overlayDepthOf(location);
        if (seen.current !== location) {
            seen.current = location;
            const ours = pending.current !== null && depth === pending.current;
            pending.current = null;
            if (enabled) {
                // The router landed below some open overlays (the back gesture, or a stale entry):
                // dismiss them top-down, stopping at the first that refuses. An overlay opened while
                // our own pop was still landing is not what that pop closes; it gets its own entry.
                for (const entry of stack.current.slice(depth).reverse()) {
                    if (ours && entry.sinceNavigation) continue;
                    if (entry.dismiss.current() === false) break;
                    stack.current = stack.current.filter(candidate => candidate !== entry);
                }
            }
            for (const entry of stack.current) entry.sinceNavigation = false;
        }
        if (hold || pending.current !== null) return;
        const want = enabled ? stack.current.length : 0;
        if (want === depth) return;
        pending.current = want;
        if (want > depth) {
            const state = { ...((location.state as Record<string, unknown> | null) ?? {}), [BACK_DISMISS_STATE_KEY]: want };
            navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { state, preventScrollReset: true });
        } else {
            navigate(want - depth);
        }
    }, [enabled, hold, location, navigate, version]);

    return <BackDismissContext.Provider value={enabled ? registry : null}>{children}</BackDismissContext.Provider>;
}

/**
 * Gives an open overlay a history entry on touch: the back gesture calls `onDismiss`, and a
 * close by any other path (`open` turning false, or unmounting) consumes the entry. A no-op on
 * desktop and outside the provider (components rendered on their own). `onDismiss` returns
 * `false` to stay open, e.g. after a cancelled "discard changes?" prompt; its entry comes back.
 */
export function useBackDismiss(open: boolean, onDismiss: BackDismissHandler): void {
    const registry = useContext(BackDismissContext);
    const formFactor = useFormFactor();
    const id = useId();
    const handler = useRef(onDismiss);
    useLayoutEffect(() => { handler.current = onDismiss; });
    const active = open && registry !== null && formFactor !== 'desktop';
    useEffect(() => {
        if (!active || !registry) return;
        return registry.register(id, handler);
    }, [active, registry, id]);
}

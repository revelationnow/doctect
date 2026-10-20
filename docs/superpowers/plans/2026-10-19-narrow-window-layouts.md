# Narrow Window Layouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mouse/trackpad editor window narrower than 1024px uses the tablet layout, and narrower than 640px the phone layout, while keeping desktop input behaviour.

**Architecture:** `useEditorFormFactor()` returns two values: `layout` (`'desktop' | 'tablet' | 'phone'`, from viewport + pointer) and `input` (`'mouse' | 'touch'`, from `(pointer: coarse)`). `FormFactorProvider` exposes `useFormFactor()` (layout, unchanged name) and a new `useInputMode()`, and sets `data-form-factor` (layout) and `data-input="touch"` (input) on `<html>`. Every component that today reads "not desktop" as "touch" is re-pointed to the value it actually means.

**Tech Stack:** React 18, TypeScript, Vite, Vitest + Testing Library (jsdom), Playwright (Chromium), Tailwind CDN runtime classes, CSS in `index.html`.

**Spec:** `docs/superpowers/specs/2026-10-19-narrow-window-layouts-design.md`

## Global Constraints

- Mouse breakpoints: width ≤ 639px → `phone`; ≤ 1023px → `tablet`; otherwise `desktop`. Height is never read for a mouse window.
- Touch rule unchanged: shorter side ≤ 639px (`PHONE_MAX_SHORT_SIDE`) → `phone`, otherwise `tablet`.
- Invariant: `input === 'touch'` ⇒ `layout !== 'desktop'`.
- Ruling R40 (hold layout changes while an editable element has focus, then re-read after `KEYBOARD_SETTLE_MS`) applies only when the pointer is coarse before and after the change.
- A mouse window ≥ 1024px renders today's desktop DOM unchanged. `tests/e2e/desktop_layout_guard.spec.js` (1440×900) must pass with **no snapshot updates**. Never run Playwright with `--update-snapshots`.
- Existing touch unit and e2e tests must pass unchanged in meaning (a `FormFactorProvider value="tablet"|"phone"` with no `input` prop still means a touch device).
- Unit tests: `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run <paths>` (absolute TMPDIR is mandatory).
- Type check: `npx tsc --noEmit`.
- E2E: `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp E2E_WEB_PORT=4410 E2E_API_PORT=4411 npx playwright test <spec> --project=chromium`, then `git checkout -- server/analytics.db` (never commit `server/analytics.db`).
- Never use bare `git stash`. Do not commit anything under `.superpowers/`.
- Commit message trailer (every commit):
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_016CZ6oYo4VzPnW7azRr7jQJ
  ```
- The last commit on the branch regenerates the onboarding bundle: `node onboarding/build.mjs`, commit `onboarding/index.html` as `chore(onboarding): regenerate bundle`.

## Plan rulings (refine the spec; Task 7 writes them back into it)

- **R1 Provider API.** The spec says `FormFactorProvider` takes `value: EditorMode`. The plan keeps `value: FormFactor` (the layout) and adds an optional `input?: InputMode` prop defaulting to `value === 'desktop' ? 'mouse' : 'touch'`. Why: 34 existing test renders pass `value="phone"|"tablet"` meaning a touch device; the default keeps them meaning exactly that, and only `EditorPage` passes `input` explicitly. Cost if wrong: one prop shape to change later.
- **R2 Select multiple is touch-only.** The spec enabled the multi-select mode whenever the layout is narrow. But `Canvas` reads `multiSelect` only in its touch tap handlers; a mouse click ignores it, so the toolbar toggle would do nothing visible. The plan enables the mode only for touch input and hides the **Select multiple** button for mouse input (`toggleMultiSelect` becomes optional in `TouchEditorActions`; the button renders only when it is present). Mouse users keep Ctrl/Cmd/Shift-click. Cost if wrong: the button is missing for mouse users in narrow windows.
- **R3 Fit gutter follows input.** `useTouchFit` subtracts `TOUCH_CANVAS_GUTTER` (16px, the touch canvas's `p-4`) each side. The mouse canvas keeps its `p-12` (48px), so a mouse fit subtracts `MOUSE_CANVAS_GUTTER = 48` each side, or the fitted page would overflow sideways by 64px.

## Review Focus

1. A mouse window narrowed past 1024px with a page open: the page must refit to the new width without a horizontal scrollbar (Task 4 unit test on the gutter; Task 6 e2e overflow check).
2. Widening back to ≥ 1024px: the saved desktop zoom (e.g. 80%) and panel widths come back untouched; narrow-window zoom never leaks into the project (Task 4 unit; Task 6 e2e).
3. Inline text editing open when the window crosses a breakpoint: the typed text must survive the canvas remount (Task 6 e2e, with the fix included in the task if it fails).
4. A short but wide mouse window (1440×500) must stay desktop, and a landscape phone (844×390, touch) must stay phone (Task 1 unit).
5. A mouse window resized by a keyboard shortcut while a text field has focus: the layout applies at once rather than waiting for blur forever (Task 1 unit).

---

### Task 1: Detection and context split into layout and input

**Files:**
- Modify: `hooks/useEditorFormFactor.ts` (whole file)
- Modify: `components/editor-layout/FormFactorContext.tsx` (whole file)
- Modify: `pages/EditorPage.tsx:160` and `:432`
- Test: `tests/unit/editorFormFactor.test.tsx`
- Modify (mock shape): `tests/unit/EditorPage.phoneChrome.test.tsx:16`

**Interfaces:**
- Produces (later tasks rely on these exact names):
  - `export type InputMode = 'mouse' | 'touch';` in `hooks/useEditorFormFactor.ts`
  - `export interface EditorMode { layout: FormFactor; input: InputMode }`
  - `export const MOUSE_PHONE_MAX_WIDTH = 639; export const MOUSE_TABLET_MAX_WIDTH = 1023;`
  - `export const MOUSE_PHONE_QUERY = '(max-width: 639px)'; export const MOUSE_TABLET_QUERY = '(max-width: 1023px)';`
  - `export function detectEditorMode(coarsePointer: boolean, viewport: { width: number; height: number }): EditorMode`
  - `export function useEditorFormFactor(): EditorMode`
  - `useFormFactor(): FormFactor` (unchanged), new `useInputMode(): InputMode` in `components/editor-layout/FormFactorContext.tsx`
  - `FormFactorProvider({ value: FormFactor; input?: InputMode; children })`; sets `data-input="touch"` on `<html>` only when `input === 'touch'`.
- `detectFormFactor` is removed (its only caller is the test file, rewritten here).

- [ ] **Step 1: Rewrite the detection tests (failing)**

In `tests/unit/editorFormFactor.test.tsx`:

1. Change the import line to:
```ts
import { detectEditorMode, KEYBOARD_SETTLE_MS, MOUSE_PHONE_QUERY, MOUSE_TABLET_QUERY, PHONE_QUERY, useEditorFormFactor } from '../../hooks/useEditorFormFactor';
import { FormFactorProvider, useFormFactor, useInputMode } from '../../components/editor-layout/FormFactorContext';
```
2. In `installMatchMedia`'s `matches` getter, before `return false;`, add:
```ts
            if (query === MOUSE_PHONE_QUERY) return env.width < 640;
            if (query === MOUSE_TABLET_QUERY) return env.width < 1024;
```
3. In the top-level `afterEach`, also remove `data-input`:
```ts
    document.documentElement.removeAttribute('data-input');
```
4. Replace the whole `describe('detectFormFactor', …)` block with:
```ts
describe('detectEditorMode', () => {
    it('subscribes to the queries the plan names', () => {
        expect(PHONE_QUERY).toBe('(max-width: 639px), (max-height: 639px)');
        expect(MOUSE_PHONE_QUERY).toBe('(max-width: 639px)');
        expect(MOUSE_TABLET_QUERY).toBe('(max-width: 1023px)');
    });

    it.each([
        // A fine pointer: the width alone decides; a short, wide window stays desktop.
        [false, 600, 900, 'phone'], [false, 639, 900, 'phone'], [false, 640, 900, 'tablet'], [false, 800, 900, 'tablet'],
        [false, 1023, 900, 'tablet'], [false, 1024, 900, 'desktop'], [false, 1440, 900, 'desktop'], [false, 1440, 500, 'desktop'],
        [false, 844, 390, 'tablet'], [false, 390, 844, 'phone'],
        // Coarse: the shorter side decides, whichever way the device is held.
        [true, 390, 844, 'phone'], [true, 844, 390, 'phone'], [true, 740, 360, 'phone'], [true, 360, 740, 'phone'],
        [true, 639, 1000, 'phone'], [true, 1000, 639, 'phone'], [true, 639, 639, 'phone'],
        [true, 640, 640, 'tablet'], [true, 640, 1000, 'tablet'], [true, 1000, 640, 'tablet'],
        [true, 768, 1024, 'tablet'], [true, 1024, 768, 'tablet'], [true, 1366, 1024, 'tablet'], [true, 1440, 900, 'tablet'],
    ] as const)('coarse=%s %sx%s -> %s', (coarse, width, height, layout) => {
        expect(detectEditorMode(coarse, { width, height })).toEqual({ layout, input: coarse ? 'touch' : 'mouse' });
    });

    it('never gives a touch device the desktop layout', () => {
        for (const width of [320, 639, 640, 1023, 1024, 1440, 2560]) {
            for (const height of [320, 639, 640, 1024, 1600]) {
                expect(detectEditorMode(true, { width, height }).layout).not.toBe('desktop');
            }
        }
    });
});
```
5. In `describe('useEditorFormFactor', …)`, every `expect(result.current).toBe('<x>')` becomes `expect(result.current.layout).toBe('<x>')` (including inside the R40 block). In the R40 test "waits for the keyboard to finish closing…", change the hook body to `const value = useEditorFormFactor().layout; seen.push(value); return value;` and keep `expect(result.current).toBe('tablet')` there (it now returns the layout string).
6. Replace the test `'is desktop when matchMedia is unavailable'` body's assertion with:
```ts
        expect(result.current).toEqual({ layout: 'desktop', input: 'mouse' });
```
7. Replace the test `'never leaves desktop for a fine pointer at narrow or short sizes'` with:
```ts
    it('follows a mouse window across the width breakpoints, ignoring its height', () => {
        const media = installMatchMedia({ coarse: false, width: 1200, height: 800 });
        const { result } = renderHook(() => useEditorFormFactor());
        expect(result.current).toEqual({ layout: 'desktop', input: 'mouse' });
        act(() => media.set({ width: 900 }));
        expect(result.current).toEqual({ layout: 'tablet', input: 'mouse' });
        act(() => media.set({ width: 600 }));
        expect(result.current).toEqual({ layout: 'phone', input: 'mouse' });
        act(() => media.set({ width: 1200, height: 400 }));
        expect(result.current).toEqual({ layout: 'desktop', input: 'mouse' });
    });

    it('keeps the same object when a query change leaves the mode as it was', () => {
        const media = installMatchMedia({ coarse: false, width: 1200, height: 800 });
        const { result } = renderHook(() => useEditorFormFactor());
        const first = result.current;
        act(() => media.set({ height: 500 }));
        expect(result.current).toBe(first);
    });
```
8. Inside `describe('while the user is typing (R40)', …)` add two tests:
```ts
        it('applies a mouse window resize at once, even while an input has focus', () => {
            const media = installMatchMedia({ coarse: false, width: 1280, height: 800 });
            const input = field<HTMLInputElement>('input');
            const { result } = renderHook(() => useEditorFormFactor());
            act(() => input.focus());
            act(() => media.set({ width: 900 }));
            expect(result.current).toEqual({ layout: 'tablet', input: 'mouse' });
            act(() => media.set({ width: 1280 }));
            expect(result.current).toEqual({ layout: 'desktop', input: 'mouse' });
        });

        it('applies a pointer change at once, even while an input has focus', () => {
            const media = installMatchMedia({ coarse: true, width: 1280, height: 800 });
            const input = field<HTMLInputElement>('input');
            const { result } = renderHook(() => useEditorFormFactor());
            act(() => input.focus());
            act(() => media.set({ coarse: false }));
            expect(result.current).toEqual({ layout: 'desktop', input: 'mouse' });
        });
```
9. Replace `describe('FormFactorProvider', …)` with:
```ts
describe('FormFactorProvider', () => {
    const Probe = () => <span>{`${useFormFactor()}/${useInputMode()}`}</span>;

    it('defaults to desktop and mouse without a provider', () => {
        const { container } = render(<Probe />);
        expect(container.textContent).toBe('desktop/mouse');
    });

    it('sets the layout attribute for narrow layouts and removes it on unmount', () => {
        const { rerender, unmount } = render(<FormFactorProvider value="phone"><Probe /></FormFactorProvider>);
        expect(document.documentElement.getAttribute('data-form-factor')).toBe('phone');
        rerender(<FormFactorProvider value="desktop"><Probe /></FormFactorProvider>);
        expect(document.documentElement.hasAttribute('data-form-factor')).toBe(false);
        rerender(<FormFactorProvider value="tablet"><Probe /></FormFactorProvider>);
        expect(document.documentElement.getAttribute('data-form-factor')).toBe('tablet');
        unmount();
        expect(document.documentElement.hasAttribute('data-form-factor')).toBe(false);
    });

    it('treats a narrow layout without an input as touch, and desktop as mouse', () => {
        const { container, rerender } = render(<FormFactorProvider value="tablet"><Probe /></FormFactorProvider>);
        expect(container.textContent).toBe('tablet/touch');
        expect(document.documentElement.getAttribute('data-input')).toBe('touch');
        rerender(<FormFactorProvider value="desktop"><Probe /></FormFactorProvider>);
        expect(container.textContent).toBe('desktop/mouse');
        expect(document.documentElement.hasAttribute('data-input')).toBe(false);
    });

    it('marks a narrow mouse window with the layout only', () => {
        const { container, unmount } = render(<FormFactorProvider value="tablet" input="mouse"><Probe /></FormFactorProvider>);
        expect(container.textContent).toBe('tablet/mouse');
        expect(document.documentElement.getAttribute('data-form-factor')).toBe('tablet');
        expect(document.documentElement.hasAttribute('data-input')).toBe(false);
        unmount();
        expect(document.documentElement.hasAttribute('data-form-factor')).toBe(false);
    });

    it('removes data-input on unmount', () => {
        const { unmount } = render(<FormFactorProvider value="phone" input="touch"><Probe /></FormFactorProvider>);
        expect(document.documentElement.getAttribute('data-input')).toBe('touch');
        unmount();
        expect(document.documentElement.hasAttribute('data-input')).toBe(false);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/editorFormFactor.test.tsx`
Expected: FAIL — `detectEditorMode` / `MOUSE_PHONE_QUERY` / `useInputMode` are not exported.

- [ ] **Step 3: Implement the hook**

Replace `hooks/useEditorFormFactor.ts` with:
```ts
import { useEffect, useRef, useState } from 'react';

export type FormFactor = 'desktop' | 'tablet' | 'phone';
/** How the user points: a coarse pointer (finger) is touch; anything else (mouse, trackpad, pen) is mouse. */
export type InputMode = 'mouse' | 'touch';
/**
 * The editor's layout (from the viewport, and for touch the device) and its input (from the pointer),
 * decided separately: a narrow mouse window gets a narrow layout but keeps mouse behaviour.
 */
export interface EditorMode { layout: FormFactor; input: InputMode }

/**
 * A coarse-pointer viewport whose shorter side is at most this many px is a phone, whichever way
 * it is held: 390×844 and 844×390 are the same phone. Larger touch viewports are tablets.
 */
export const PHONE_MAX_SHORT_SIDE = 639;
/** A mouse window at most this wide gets the phone layout; its height is never read. */
export const MOUSE_PHONE_MAX_WIDTH = 639;
/** A mouse window at most this wide (and wider than MOUSE_PHONE_MAX_WIDTH) gets the tablet layout. */
export const MOUSE_TABLET_MAX_WIDTH = 1023;
const COARSE_QUERY = '(pointer: coarse)';
/** Matches when either side is at most PHONE_MAX_SHORT_SIDE, i.e. the shorter side is. */
export const PHONE_QUERY = `(max-width: ${PHONE_MAX_SHORT_SIDE}px), (max-height: ${PHONE_MAX_SHORT_SIDE}px)`;
export const MOUSE_PHONE_QUERY = `(max-width: ${MOUSE_PHONE_MAX_WIDTH}px)`;
export const MOUSE_TABLET_QUERY = `(max-width: ${MOUSE_TABLET_MAX_WIDTH}px)`;

/** Elements the user types into; while one has focus the soft keyboard may be resizing the viewport. */
const NON_TEXT_INPUT_TYPES = ['checkbox', 'radio', 'range', 'color', 'button', 'submit', 'reset', 'file', 'image'];
const EDITABLE_SELECTOR = [
    `input${NON_TEXT_INPUT_TYPES.map(type => `:not([type="${type}"])`).join('')}`,
    'textarea',
    'select',
    '[contenteditable]:not([contenteditable="false"])',
].join(', ');
/**
 * How long after focus leaves the fields the queries are re-read. On browsers that resize the
 * viewport for the soft keyboard, `focusout` fires before the keyboard has gone; reading at once
 * would apply the keyboard-sized viewport and flip back a moment later (two remounts).
 */
export const KEYBOARD_SETTLE_MS = 400;
const isEditable = (target: EventTarget | null): boolean =>
    target instanceof Element && (target.matches(EDITABLE_SELECTOR) || (target as HTMLElement).isContentEditable === true);

export function detectEditorMode(coarsePointer: boolean, viewport: { width: number; height: number }): EditorMode {
    if (coarsePointer) {
        return { layout: Math.min(viewport.width, viewport.height) <= PHONE_MAX_SHORT_SIDE ? 'phone' : 'tablet', input: 'touch' };
    }
    const layout = viewport.width <= MOUSE_PHONE_MAX_WIDTH ? 'phone' : viewport.width <= MOUSE_TABLET_MAX_WIDTH ? 'tablet' : 'desktop';
    return { layout, input: 'mouse' };
}

const DESKTOP: EditorMode = { layout: 'desktop', input: 'mouse' };

const read = (): EditorMode => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return DESKTOP;
    const matches = (query: string) => window.matchMedia(query).matches;
    // The queries have already compared the sides; hand the rule an equivalent viewport: the touch
    // rule reads its shorter side, the mouse rule its width.
    const width = matches(MOUSE_PHONE_QUERY) ? MOUSE_PHONE_MAX_WIDTH
        : matches(MOUSE_TABLET_QUERY) ? MOUSE_TABLET_MAX_WIDTH : MOUSE_TABLET_MAX_WIDTH + 1;
    const height = matches(PHONE_QUERY) ? PHONE_MAX_SHORT_SIDE : PHONE_MAX_SHORT_SIDE + 1;
    return detectEditorMode(matches(COARSE_QUERY), { width, height });
};

const same = (a: EditorMode, b: EditorMode) => a.layout === b.layout && a.input === b.input;

/**
 * The editor's layout and input, re-read when any of the media queries changes.
 *
 * Touch only (ruling R40): on browsers that resize the viewport for the soft keyboard, the
 * `(max-height)` term flips for the keyboard alone, and swapping the tablet layout for the phone
 * one would unmount the field under the user. While the pointer is coarse (before and after the
 * change), a change that arrives while an editable element has focus is held until focus leaves
 * editable elements, and the queries are read afresh KEYBOARD_SETTLE_MS later (or at the next query
 * change, whichever comes first), so a keyboard that has closed again by then changes nothing.
 * A mouse window has no soft keyboard: its resize is real and applies at once.
 */
export function useEditorFormFactor(): EditorMode {
    const [mode, setMode] = useState<EditorMode>(read);
    const applied = useRef(mode);

    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return;
        const queries = [COARSE_QUERY, PHONE_QUERY, MOUSE_PHONE_QUERY, MOUSE_TABLET_QUERY].map(query => window.matchMedia(query));
        let held = false;
        let settle: ReturnType<typeof setTimeout> | undefined;
        const onFocusOut = (event: FocusEvent) => {
            if (isEditable(event.relatedTarget)) return; // moving between fields is still typing
            document.removeEventListener('focusout', onFocusOut);
            held = false;
            settle = setTimeout(update, KEYBOARD_SETTLE_MS);
        };
        function update() {
            clearTimeout(settle);
            settle = undefined;
            const next = read();
            if (applied.current.input === 'touch' && next.input === 'touch' && isEditable(document.activeElement)) {
                if (!held) {
                    held = true;
                    document.addEventListener('focusout', onFocusOut);
                }
                return;
            }
            if (same(applied.current, next)) return;
            applied.current = next;
            setMode(next);
        }
        queries.forEach(query => query.addEventListener('change', update));
        update();
        return () => {
            clearTimeout(settle);
            queries.forEach(query => query.removeEventListener('change', update));
            document.removeEventListener('focusout', onFocusOut);
        };
    }, []);

    return mode;
}
```

- [ ] **Step 4: Implement the context**

Replace `components/editor-layout/FormFactorContext.tsx` with:
```tsx
import React, { createContext, useContext, useEffect } from 'react';
import type { FormFactor, InputMode } from '../../hooks/useEditorFormFactor';

const FormFactorContext = createContext<FormFactor>('desktop');
const InputModeContext = createContext<InputMode>('mouse');

/** The editor's layout: 'tablet' and 'phone' for touch devices and for narrow mouse windows alike. */
export const useFormFactor = (): FormFactor => useContext(FormFactorContext);
/** How the user points. Touch-only behaviour (44px targets, row ⋯ sheets, gestures) reads this, not the layout. */
export const useInputMode = (): InputMode => useContext(InputModeContext);

/**
 * `input` defaults to touch for a narrow layout and mouse for desktop, which is what every caller
 * meant before narrow mouse windows existed; EditorPage passes the detected input explicitly.
 */
export function FormFactorProvider({ value, input = value === 'desktop' ? 'mouse' : 'touch', children }: {
    value: FormFactor; input?: InputMode; children: React.ReactNode;
}) {
    useEffect(() => {
        const root = document.documentElement;
        if (value === 'desktop') {
            root.removeAttribute('data-form-factor');
            return;
        }
        root.setAttribute('data-form-factor', value);
        return () => root.removeAttribute('data-form-factor');
    }, [value]);

    useEffect(() => {
        const root = document.documentElement;
        if (input !== 'touch') {
            root.removeAttribute('data-input');
            return;
        }
        root.setAttribute('data-input', 'touch');
        return () => root.removeAttribute('data-input');
    }, [input]);

    return (
        <FormFactorContext.Provider value={value}>
            <InputModeContext.Provider value={input}>{children}</InputModeContext.Provider>
        </FormFactorContext.Provider>
    );
}
```

- [ ] **Step 5: Wire EditorPage**

In `pages/EditorPage.tsx` replace line 160 `const formFactor = useEditorFormFactor();` with:
```tsx
  const editorMode = useEditorFormFactor();
  const formFactor = editorMode.layout;
```
and line 432 `<FormFactorProvider value={formFactor}>` with:
```tsx
    <FormFactorProvider value={formFactor} input={editorMode.input}>
```
In `tests/unit/EditorPage.phoneChrome.test.tsx` replace line 16 with:
```ts
vi.mock('../../hooks/useEditorFormFactor', () => ({
    useEditorFormFactor: () => ({ layout: formFactor.current, input: formFactor.current === 'desktop' ? 'mouse' : 'touch' }),
}));
```

- [ ] **Step 6: Run tests and the type check**

Run: `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/editorFormFactor.test.tsx tests/unit/EditorPage.phoneChrome.test.tsx tests/unit/EditorPage.backDismiss.test.tsx`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: exit 0. (If it reports a `detectFormFactor` import anywhere, that caller is a test missed above: switch it to `detectEditorMode(...).layout`.)

- [ ] **Step 7: Commit**

```bash
git add hooks/useEditorFormFactor.ts components/editor-layout/FormFactorContext.tsx pages/EditorPage.tsx tests/unit/editorFormFactor.test.tsx tests/unit/EditorPage.phoneChrome.test.tsx
git commit -m "feat(editor): split form factor into layout and input; narrow mouse windows get narrow layouts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CZ6oYo4VzPnW7azRr7jQJ"
```

---

### Task 2: Touch CSS scoped by what each rule is for

**Files:**
- Modify: `index.html` (the `/* touch-editor:start */` … `/* touch-editor:end */` block, currently lines 77–186)
- Test: `tests/unit/touchCss.test.ts`

**Interfaces:**
- Consumes: `data-input="touch"` on `<html>` (Task 1).
- Produces: input rules under `[data-input="touch"]`; layout rules under `[data-form-factor…]`.

- [ ] **Step 1: Update the CSS test (failing)**

In `tests/unit/touchCss.test.ts`:

1. Replace the header comment's first sentence ("every rule lives inside the marked block and is scoped under [data-form-factor] (set on <html> only for phone/tablet)") with: "every rule lives inside the marked block and is scoped under [data-input="touch"] (touch devices) or [data-form-factor] (narrow layouts, touch or mouse)".
2. Replace the test `'keeps every touch rule inside the marked block, scoped under data-form-factor'` with:
```ts
    it('keeps every touch rule inside the marked block, scoped under data-input or data-form-factor', () => {
        expect(block.length).toBeGreaterThan(0);
        const selectors = rules.match(/[^{}]+(?=\{)/g) ?? [];
        expect(selectors.length).toBeGreaterThan(0);
        for (const selector of selectors) {
            for (const part of selector.split(',')) expect(part.trim()).toMatch(/^\[data-input="touch"\]|^\[data-form-factor(=|\])/);
        }
        expect(html.replace(block, '')).not.toMatch(/data-form-factor|data-input/);
    });

    // A narrow mouse window gets the narrow layouts but keeps desktop input: target sizes, form
    // control text, hover reveals, the layer swatch strip and colour inputs follow the pointer.
    it('scopes input rules to touch input, and layout rules to the narrow layouts', () => {
        const scopeOf = (pattern: RegExp) => {
            const found = Array.from(rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)).filter(([, selector, body]) => pattern.test(selector + '{' + body));
            expect(found.length, String(pattern)).toBeGreaterThan(0);
            return found.flatMap(([, selector]) => selector.split(',').map(part => part.trim().split(' ')[0]));
        };
        for (const pattern of [/min-height:\s*44px/, /font-size:\s*16px/, /group-hover:opacity-100/, /group-hover:flex/,
            /\[data-color-popover\]/, /input\[type="color"\]/]) {
            for (const scope of scopeOf(pattern)) expect(scope, String(pattern)).toBe('[data-input="touch"]');
        }
        for (const pattern of [/\.editor-dialog-panel/, /\[data-touch-chrome="top-bar"\]/, /\[data-canvas-content\]/,
            /\[data-touch-pill-scroller\]/, /\[data-editor-shell\]/]) {
            for (const scope of scopeOf(pattern)) expect(scope, String(pattern)).toMatch(/^\[data-form-factor(=|\])/);
        }
    });
```
3. In `'takes pointer events away from colour inputs on touch'`, change the regex to:
```ts
        expect(rules).toMatch(/\[data-input="touch"\] input\[type="color"\]\s*\{\s*pointer-events:\s*none;\s*\}/);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/touchCss.test.ts`
Expected: FAIL in the two scope tests and the colour-input test.

- [ ] **Step 3: Rescope the CSS**

In `index.html`, inside the block:

1. Replace the block's opening comment with:
```css
      /* Narrow-layout and touch rules. FormFactorProvider sets data-form-factor="phone" | "tablet"
         on <html> for the narrow layouts (touch devices and narrow mouse windows alike) and
         data-input="touch" for a coarse pointer; both are absent on desktop / unmount. Rules about
         fingers (target sizes, hover reveals, colour inputs) use data-input; rules about the
         narrow layouts (full-screen dialogs, top bar, pill, shell height) use data-form-factor. */
```
2. Change these selectors from `[data-form-factor]` to `[data-input="touch"]` (bodies unchanged):
   - `[data-form-factor] button,` / `[data-form-factor] [role="button"],` / `[data-form-factor] select {` (44px)
   - `[data-form-factor] input,` / `[data-form-factor] select,` / `[data-form-factor] textarea {` (16px)
   - `[data-form-factor] .opacity-0[class~="group-hover:opacity-100"]:not(.pointer-events-none) {`
   - `[data-form-factor] .hidden[class~="group-hover:flex"] {`
   - `[data-form-factor] [data-color-popover] {`, `[data-form-factor] [data-color-popover] > button {`, `[data-form-factor] [data-color-popover] > span {`
   - `[data-form-factor] input[type="color"] {`
3. In the "Layer colour swatches" comment, replace "On touch it becomes" with "On touch input it becomes".
4. Leave every other selector (`.editor-dialog-panel`, top bar, `[data-canvas-content]`, `[data-touch-pill-scroller]`, `[data-editor-shell]`) on `[data-form-factor…]` as it is.

- [ ] **Step 4: Run tests**

Run: `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/touchCss.test.ts`
Expected: PASS. (`'marks the desktop-only micro-steppers…'` still expects `useFormFactor() !== 'desktop'`, which is still true here; Task 3 changes both the files and that test.)

- [ ] **Step 5: Commit**

```bash
git add index.html tests/unit/touchCss.test.ts
git commit -m "feat(editor): scope finger-sized CSS to touch input, layout CSS to narrow layouts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CZ6oYo4VzPnW7azRr7jQJ"
```

---

### Task 3: Touch-only components read the input, not the layout

**Files:**
- Modify: `components/LayersPanel.tsx:11,55`
- Modify: `components/sidebar/NodeItem.tsx:6,27`
- Modify: `components/sidebar/TemplateItem.tsx:6,22`
- Modify: `components/properties/SingleElementEditor.tsx:17,245,322`
- Modify: `components/properties/TextPaddingControls.tsx:5,43`
- Modify: `components/color/TouchColorPickerHost.tsx:3,85`
- Modify: `components/editor-layout/useBackDismiss.tsx:4,85,148,152` (and the two doc comments that say "phone and tablet" / "on touch")
- Modify: `components/editor-layout/touchActions.ts:15`
- Modify: `components/editor-layout/TouchToolButtons.tsx:36-41`
- Tests: `tests/unit/sidebarTouchRowActions.test.tsx`, `tests/unit/LayersPanel.touchReorder.test.tsx`, `tests/unit/touchStepper.test.tsx`, `tests/unit/touchColorPicker.test.tsx`, `tests/unit/useBackDismiss.test.tsx`, `tests/unit/touchChrome.test.tsx`, `tests/unit/touchCss.test.ts`

**Interfaces:**
- Consumes: `useInputMode()` and `FormFactorProvider`'s `input` prop (Task 1).
- Produces: `TouchEditorActions.toggleMultiSelect` becomes optional: `toggleMultiSelect?: () => void` (Task 4 sets it only for touch input).

Not changed — these mean the layout and keep `useFormFactor()`: `EditorLayout`, `EditorPage` (header on phone), `HierarchyGeneratorModal` (split panes), `DeviceExportDialog` and `JsonModal` (full screen on phone), `PropertiesPanel` (element settings first).

- [ ] **Step 1: Write the failing mouse-in-narrow-layout tests**

Add to `tests/unit/sidebarTouchRowActions.test.tsx` — change `renderTree` to accept an input:
```ts
function renderTree(formFactor: FormFactor, input?: 'mouse' | 'touch') {
    const handlers = {
        onSelect: vi.fn(), onAdd: vi.fn(), onAddRef: vi.fn(), onDelete: vi.fn(), onDuplicate: vi.fn(), onUpdate: vi.fn(),
    };
    render(<FormFactorProvider value={formFactor} input={input}><NodeItem nodeId="root" state={state} depth={0} {...handlers} /></FormFactorProvider>);
    return handlers;
}
```
and after the desktop describe add:
```ts
describe.each(['phone', 'tablet'] as const)('sidebar rows in a narrow mouse window (%s layout)', formFactor => {
    it('keeps the hover actions and has no ⋯ button', () => {
        renderTree(formFactor, 'mouse');
        expect(screen.getAllByTitle('Add New Page').length).toBeGreaterThan(0);
        expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
    });
});
```
Do the same for `TemplateItem` if the file has a `renderTemplates`-style helper: add an `input` parameter passed to `FormFactorProvider` and one test asserting the desktop hover actions are present and no `Actions for` button exists for `formFactor` `'tablet'` with `input` `'mouse'` (mirror that file's existing desktop TemplateItem assertions exactly).

Add to `tests/unit/LayersPanel.touchReorder.test.tsx`, in the first describe:
```ts
    it('renders no reorder buttons in a narrow mouse window', () => {
        render(<FormFactorProvider value="tablet" input="mouse"><LayersPanel {...props()} /></FormFactorProvider>);
        expect(screen.queryByRole('button', { name: /Move .* forward/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /Move .* backward/ })).toBeNull();
    });
```

In `tests/unit/touchStepper.test.tsx`, give `renderPanel` an optional fourth parameter `input?: 'mouse' | 'touch'` passed as `<FormFactorProvider value={formFactor} input={input}>`, then add next to `'desktop keeps the hover micro-steppers…'`:
```ts
    it('a narrow mouse window keeps the hover micro-steppers and renders no touch buttons', () => {
        const { container } = renderPanel('tablet', stateFor([rect('a')], ['a']), {}, 'mouse');

        expect(container.querySelectorAll('[data-micro-stepper]')).toHaveLength(GEOMETRY_FIELDS.length);
        expect(container.querySelector('[data-touch-stepper]')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Increase X' })).toBeNull();
    });
```

In `tests/unit/touchColorPicker.test.tsx`, give the `TouchColorPickerHost` `mount` helper an optional `input` parameter passed to the provider, and add:
```ts
    it('a narrow mouse window leaves the native picker alone', () => {
        const { input } = mount('tablet', 'mouse');
        const click = new MouseEvent('click', { bubbles: true, cancelable: true });
        act(() => { input.dispatchEvent(click); });
        expect(click.defaultPrevented).toBe(false);
        expect(screen.queryByRole('dialog')).toBeNull();
    });
```

In `tests/unit/useBackDismiss.test.tsx`, give `Host` (and `routesFor` / `mount`) an optional `input` passed to `<FormFactorProvider value={formFactor} input={input}>`, and add:
```ts
describe('useBackDismiss in a narrow mouse window', () => {
    it('adds no history entries and leaves the back button to the router', () => {
        const dismiss = vi.fn(closes('a'));
        const { router, log } = mount('tablet', { a: dismiss }, 'mouse');
        open('a');
        expect(log).toHaveLength(0);
        expect(depth(router)).toBe(0);
        back(router);
        expect(router.state.location.pathname).toBe('/');
        expect(dismiss).not.toHaveBeenCalled();
    });
});
```
(Thread the third `input` argument through `mount` → `routesFor` → `Host` the same way `formFactor` is threaded today.)

In `tests/unit/touchChrome.test.tsx`, in `describe('TouchToolButtons', …)` add:
```ts
    it('leaves out Select multiple when the actions offer no toggle (mouse input)', () => {
        render(<TouchToolButtons actions={makeActions({ toggleMultiSelect: undefined })} />);
        expect(screen.getByRole('button', { name: 'Select' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Select multiple' })).toBeNull();
    });
```

In `tests/unit/touchCss.test.ts`, in `'marks the desktop-only micro-steppers and renders the touch stepper in their place'`, change the middle expectation to:
```ts
            expect(source, file).toMatch(/useInputMode\(\) === 'touch'/);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/sidebarTouchRowActions.test.tsx tests/unit/LayersPanel.touchReorder.test.tsx tests/unit/touchStepper.test.tsx tests/unit/touchColorPicker.test.tsx tests/unit/useBackDismiss.test.tsx tests/unit/touchChrome.test.tsx tests/unit/touchCss.test.ts`
Expected: the new narrow-mouse tests and the touchCss stepper test FAIL; everything else passes.

- [ ] **Step 3: Re-point the components**

In each file below, replace the import `useFormFactor` from `FormFactorContext` with `useInputMode` (keep `useFormFactor` only if the file still uses it elsewhere), and replace the flag line exactly as shown:

| File | Old | New |
|---|---|---|
| `components/LayersPanel.tsx:55` | `const isTouch = useFormFactor() !== 'desktop';` | `const isTouch = useInputMode() === 'touch';` |
| `components/sidebar/NodeItem.tsx:27` | `const touch = useFormFactor() !== 'desktop';` | `const touch = useInputMode() === 'touch';` |
| `components/sidebar/TemplateItem.tsx:22` | `const touch = useFormFactor() !== 'desktop';` | `const touch = useInputMode() === 'touch';` |
| `components/properties/SingleElementEditor.tsx:245` and `:322` | `const touch = useFormFactor() !== 'desktop';` | `const touch = useInputMode() === 'touch';` |
| `components/properties/TextPaddingControls.tsx:43` | `const touch = useFormFactor() !== 'desktop';` | `const touch = useInputMode() === 'touch';` |
| `components/color/TouchColorPickerHost.tsx:85` | `const touch = useFormFactor() !== 'desktop';` | `const touch = useInputMode() === 'touch';` |
| `components/editor-layout/useBackDismiss.tsx:85` | `const enabled = useFormFactor() !== 'desktop';` | `const enabled = useInputMode() === 'touch';` |

In `components/editor-layout/useBackDismiss.tsx` `useBackDismiss`, replace
```ts
    const formFactor = useFormFactor();
```
with
```ts
    const touch = useInputMode() === 'touch';
```
and
```ts
    const active = open && registry !== null && formFactor !== 'desktop';
```
with
```ts
    const active = open && registry !== null && touch;
```
Update its two doc comments: "Active on phone and tablet only; on desktop it provides nothing" → "Active for touch input only; for a mouse (desktop or a narrow window) it provides nothing, because to a mouse user Back means leave"; "Gives an open overlay a history entry on touch … A no-op on desktop" → "… A no-op for mouse input".

In `components/editor-layout/touchActions.ts` replace line 15:
```ts
    /** Session-only "Select multiple" mode: taps and Layers rows toggle elements in and out of the selection. */
    multiSelect: boolean; toggleMultiSelect: () => void;
```
with
```ts
    /**
     * Session-only "Select multiple" mode: taps and Layers rows toggle elements in and out of the
     * selection. Touch input only: `toggleMultiSelect` is absent for a mouse in a narrow window,
     * which selects several with Ctrl/Cmd/Shift-click (the canvas reads the mode in its tap handlers only).
     */
    multiSelect: boolean; toggleMultiSelect?: () => void;
```
In `components/editor-layout/TouchToolButtons.tsx` change `{tool === 'select' && (` to `{tool === 'select' && actions.toggleMultiSelect && (`.

- [ ] **Step 4: Run tests and the type check**

Run the Step 2 command again. Expected: PASS.
Run: `npx tsc --noEmit`. Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add components/LayersPanel.tsx components/sidebar/NodeItem.tsx components/sidebar/TemplateItem.tsx components/properties/SingleElementEditor.tsx components/properties/TextPaddingControls.tsx components/color/TouchColorPickerHost.tsx components/editor-layout/useBackDismiss.tsx components/editor-layout/touchActions.ts components/editor-layout/TouchToolButtons.tsx tests/unit/sidebarTouchRowActions.test.tsx tests/unit/LayersPanel.touchReorder.test.tsx tests/unit/touchStepper.test.tsx tests/unit/touchColorPicker.test.tsx tests/unit/useBackDismiss.test.tsx tests/unit/touchChrome.test.tsx tests/unit/touchCss.test.ts
git commit -m "feat(editor): touch-only controls follow the pointer, so narrow mouse windows keep desktop input

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CZ6oYo4VzPnW7azRr7jQJ"
```

---

### Task 4: ProjectEditor and Canvas — narrow chrome and fit for a mouse

**Files:**
- Modify: `components/ProjectEditor.tsx:1651-1659, 1732, 1739, 1767, 1782-1785, 1825-1852`
- Modify: `components/Canvas.tsx:466` (and its `useTouchFit` import)
- Modify: `hooks/useTouchFit.ts` (add `gutter` option and `MOUSE_CANVAS_GUTTER`)
- Test: `tests/unit/ProjectEditor.touchZoom.test.tsx`, `tests/unit/useTouchFit.test.tsx`

**Interfaces:**
- Consumes: `useFormFactor()`, `useInputMode()`, `FormFactorProvider input` (Task 1); optional `toggleMultiSelect` (Task 3).
- Produces: `export const MOUSE_CANVAS_GUTTER = 48;` and `useTouchFit(outerRef, { enabled, fitSignal, pageWidth, scale, onZoom, gutter? })` with `gutter` defaulting to `TOUCH_CANVAS_GUTTER`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/useTouchFit.test.tsx`, add to `describe('useTouchFit', …)`:
```ts
    it('subtracts the gutter it is given (the mouse canvas keeps its wider padding)', () => {
        const onZoom = vi.fn();
        function Mouse() {
            const outer = useRef<HTMLDivElement>(null);
            useTouchFit(outer, { enabled: true, fitSignal: 1, pageWidth: 595, scale: 1, onZoom, gutter: MOUSE_CANVAS_GUTTER });
            return <div ref={el => { outer.current = el; if (el) widthOf(el, 700); }} />;
        }
        render(<Mouse />);
        expect(MOUSE_CANVAS_GUTTER).toBe(48);
        expect(onZoom).toHaveBeenLastCalledWith((700 - 96) / 595);
    });
```
and change its import to `import { MOUSE_CANVAS_GUTTER, TOUCH_CANVAS_GUTTER, useTouchFit } from '../../hooks/useTouchFit';`.

In `tests/unit/ProjectEditor.touchZoom.test.tsx`:
1. Change `renderEditor` to:
```ts
const renderEditor = (formFactor: 'desktop' | 'tablet' | 'phone', onStateChange = vi.fn(), input?: 'mouse' | 'touch') => {
    render(
        <FormFactorProvider value={formFactor} input={input}>
            <ProjectEditor projectId="p" projectName="Root" initialState={state} isActive
                onNameChange={() => {}} onStateChange={onStateChange}
                onCreateGeneratedProject={async () => false} onSaveCustomPreset={async () => false} />
        </FormFactorProvider>,
    );
    return onStateChange;
};
```
2. Add:
```ts
describe('narrow mouse windows', () => {
    it.each(['phone', 'tablet'] as const)('%s layout: mouse input, fitted session zoom kept out of the project', (formFactor) => {
        const onStateChange = renderEditor(formFactor, vi.fn(), 'mouse');
        expect(canvasProps.inputMode).toBe('mouse');
        expect(canvasProps.fitSignal).toBeTruthy();
        act(() => canvasProps.onZoom(3));
        expect(canvasProps.scale).toBe(3);
        const persisted = onStateChange.mock.calls.map(([s]) => s as AppState);
        expect(persisted.every(s => s.scale === 1.5)).toBe(true);
    });

    it('shows the narrow chrome without the Select multiple toggle, and keeps multi-select off', () => {
        renderEditor('tablet', vi.fn(), 'mouse');
        expect(screen.getByRole('button', { name: 'Open pages and templates' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Select' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Select multiple' })).toBeNull();
        expect(canvasProps.multiSelect).toBe(false);
    });

    it('touch keeps the Select multiple toggle', () => {
        renderEditor('tablet');
        expect(screen.getByRole('button', { name: 'Select multiple' })).toBeTruthy();
    });

    it('closes the drawer after a pick, as on touch', () => {
        renderEditor('tablet', vi.fn(), 'mouse');
        fireEvent.click(screen.getByRole('button', { name: 'Open pages and templates' }));
        expect(screen.getByRole('dialog')).toBeTruthy();
        act(() => sidebarProps.onSelectNode('root', false, false));
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
```
(If `SidebarDrawer` does not render with `role="dialog"`, use the selector its own tests use for the open drawer — check `tests/unit/` for `SidebarDrawer` — and keep the assertion meaning: drawer open, then closed after the pick.)

- [ ] **Step 2: Run them to verify they fail**

Run: `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/useTouchFit.test.tsx tests/unit/ProjectEditor.touchZoom.test.tsx`
Expected: FAIL — `MOUSE_CANVAS_GUTTER` missing; with `input="mouse"` the editor still reports `inputMode: 'touch'` and shows Select multiple.

- [ ] **Step 3: Implement the gutter option**

In `hooks/useTouchFit.ts`, after `TOUCH_CANVAS_GUTTER`:
```ts
/** The mouse canvas keeps its desktop padding (p-12), so a fit in a narrow mouse window leaves this much each side. */
export const MOUSE_CANVAS_GUTTER = 48;
```
Change the signature and the width computation:
```ts
export function useTouchFit(outerRef: RefObject<HTMLElement | null>, {
    enabled, fitSignal, pageWidth, scale, onZoom, gutter = TOUCH_CANVAS_GUTTER,
}: {
    enabled: boolean;
    fitSignal: number | undefined;
    pageWidth: number;
    scale: number;
    onZoom: (scale: number) => void;
    /** Space left each side of the page; defaults to the touch canvas's. */
    gutter?: number;
}): void {
```
```ts
            const available = outer.clientWidth - 2 * gutter;
```
and add `gutter` to the effect's dependency array: `}, [enabled, fitSignal, pageWidth, outerRef, gutter]);`

In `components/Canvas.tsx` change the import to include `MOUSE_CANVAS_GUTTER` and `TOUCH_CANVAS_GUTTER` from `../hooks/useTouchFit` (keep whatever it imports today), and replace line 466:
```ts
    // Fit: zoom so the page width fills the viewport minus a gutter on each side. Requested by the
    // narrow layouts (touch or a narrow mouse window) through fitSignal; desktop passes none.
    useTouchFit(outerContainerRef, {
        enabled: fitSignal !== undefined, fitSignal, pageWidth: template.width, scale, onZoom,
        gutter: isTouch ? TOUCH_CANVAS_GUTTER : MOUSE_CANVAS_GUTTER,
    });
```

- [ ] **Step 4: Split narrow and touch in ProjectEditor**

In `components/ProjectEditor.tsx`:

1. Add `useInputMode` to the `FormFactorContext` import.
2. Replace lines 1651–1652:
```ts
    const formFactor = useFormFactor();
    const isTouch = formFactor !== 'desktop';
```
with
```ts
    const formFactor = useFormFactor();
    // The narrow layouts (tablet/phone) follow the window; touch behaviour follows the pointer. A
    // narrow mouse window gets the narrow chrome and fit-to-width zoom but mouse input.
    const narrow = formFactor !== 'desktop';
    const touchInput = useInputMode() === 'touch';
```
3. Update the comments above `pickCount` ("Touch: every page/template pick…" → "Narrow layouts: every page/template pick…") and `touchViewport` ("Touch zoom is session-local" → "Narrow-layout zoom is session-local").
4. `useTouchMultiSelect({ … enabled: isTouch, … })` → `enabled: touchInput`.
5. Add right after the `useTouchMultiSelect` line:
```ts
    // A panel resize belongs to the desktop layout; leaving it mid-drag must not keep resizing.
    useEffect(() => { if (narrow) setResizingPanel(null); }, [narrow]);
```
(`setResizingPanel` is already destructured from the view model at line 1644; `useEffect` is already imported — check the React import at the top and add it if not.)
6. Lines 1732 and 1739: `if (isTouch) countPick();` → `if (narrow) countPick();`
7. Line 1767: `scale={isTouch ? touchViewport.scale : state.scale}` → `scale={narrow ? touchViewport.scale : state.scale}`
8. Line 1782: `onZoom={isTouch ? …` → `onZoom={narrow ? touchViewport.setScale : (scale) => setPreferences({ scale })}`
9. Line 1784: `inputMode={isTouch ? 'touch' : 'mouse'}` → `inputMode={touchInput ? 'touch' : 'mouse'}`
10. Line 1785: `fitSignal={isTouch ? touchViewport.fitSignal : undefined}` → `fitSignal={narrow ? touchViewport.fitSignal : undefined}`
11. Line 1822 comment "Touch chrome (phone top bar / tablet toolbar / overflow sheet)… Built only on touch: desktop never reads them" → "Narrow-layout chrome (phone top bar / tablet toolbar / overflow sheet)… Built only for the narrow layouts: desktop never reads them".
12. Line 1825: `const previewChoice = isTouch ? …` → `const previewChoice = narrow ? …`
13. Line 1826: `!isTouch ? undefined : {` → `!narrow ? undefined : {`
14. In the `touchActions` object replace `multiSelect, toggleMultiSelect,` with:
```ts
        multiSelect,
        // Mouse input selects several with Ctrl/Cmd/Shift-click; the canvas reads the mode in its tap handlers only.
        toggleMultiSelect: touchInput ? toggleMultiSelect : undefined,
```
15. `grep -n "isTouch" components/ProjectEditor.tsx` must print nothing.

- [ ] **Step 5: Run tests and the type check**

Run: `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit/useTouchFit.test.tsx tests/unit/ProjectEditor.touchZoom.test.tsx tests/unit/ProjectEditor.touchLayout.test.tsx tests/unit/useTouchMultiSelect.test.tsx`
Expected: PASS.
Run: `npx tsc --noEmit`. Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add hooks/useTouchFit.ts components/Canvas.tsx components/ProjectEditor.tsx tests/unit/useTouchFit.test.tsx tests/unit/ProjectEditor.touchZoom.test.tsx
git commit -m "feat(editor): narrow mouse windows get the narrow chrome and fit-to-width zoom with mouse input

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CZ6oYo4VzPnW7azRr7jQJ"
```

---

### Task 5: Full unit suite and desktop guard

**Files:** none modified unless a failure points at code changed in Tasks 1–4.

- [ ] **Step 1: Run the whole unit suite**

Run: `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run`
Expected: all files pass. Any failure that renders `FormFactorProvider value="tablet"|"phone"` and expects touch behaviour must already pass (default `input` is touch); a failure elsewhere means a call site was re-pointed wrongly — fix the call site, not the test, unless the test asserts the old "not desktop means touch" rule for a component this plan moved to input, in which case give that test `input="touch"` explicitly.

- [ ] **Step 2: Run the desktop layout guard and the touch e2e smoke**

Run: `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp E2E_WEB_PORT=4410 E2E_API_PORT=4411 npx playwright test tests/e2e/desktop_layout_guard.spec.js --project=chromium`
Expected: 3 passed, with no snapshot changes. Never pass `--update-snapshots`; if a screenshot differs, stop and report.
Run: `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp E2E_WEB_PORT=4410 E2E_API_PORT=4411 npx playwright test tests/e2e/mobile_editor.spec.js --project=mobile-phone-chromium --project=mobile-tablet-chromium`
Expected: all pass (WebKit projects are skipped on this host).
Then: `git checkout -- server/analytics.db`

- [ ] **Step 3: Commit only if Step 1 required fixes**

```bash
git add <fixed files>
git commit -m "fix(editor): <what the suite caught>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CZ6oYo4VzPnW7azRr7jQJ"
```

---

### Task 6: E2E — a mouse window across the breakpoints

**Files:**
- Create: `tests/e2e/narrow_window_layout.spec.js`
- Modify only if Step 3 fails: `components/Canvas.tsx` (inline editing commit on unmount)

**Interfaces:**
- Consumes: everything above. Runs in the desktop `chromium` project (no touch emulation, real `(pointer: fine)`).

- [ ] **Step 1: Write the spec**

Create `tests/e2e/narrow_window_layout.spec.js`:
```js
import { test, expect } from '@playwright/test';
import { seedNativeProject } from './localWorkspaceHelpers.js';
import { layoutFixture as fixture } from './fixtures/layoutFixture.js';

// A mouse/trackpad window narrower than 1024px uses the tablet layout, narrower than 640px the phone
// layout, and keeps desktop input throughout (spec 2026-10-19-narrow-window-layouts-design.md).

const activePane = page => page.locator('[data-testid="project-pane"][data-active="true"]');
const topBar = page => page.locator('[data-touch-chrome="top-bar"]');
const html = page => page.locator('html');

test.describe('narrow mouse window', () => {
    test.skip(({ browserName }) => browserName !== 'chromium', 'layout switching is engine-independent; recorded on Chromium');

    test.beforeEach(async ({ page }) => {
        await seedNativeProject(page, { id: 'narrow', name: 'Narrow', initialState: fixture });
        await page.setViewportSize({ width: 900, height: 800 });
        await page.goto('/app');
        await expect(activePane(page).getByTestId('editor-canvas')).toBeVisible();
    });

    test('900px: tablet layout with mouse input', async ({ page }) => {
        await expect(html(page)).toHaveAttribute('data-form-factor', 'tablet');
        await expect(html(page)).not.toHaveAttribute('data-input', 'touch');
        await expect(topBar(page)).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Select multiple' })).toHaveCount(0);

        // Normal-size controls: no 44px floor on an ordinary panel button.
        const bringForward = activePane(page).getByTitle('Bring Forward');
        await activePane(page).locator('[data-element-id="box"]').click();
        await expect(bringForward).toBeVisible();
        expect((await bringForward.boundingBox()).height).toBeLessThan(44);

        // The page is fitted with no sideways scroll.
        const overflow = await activePane(page).locator('.canvas-scroll-container').evaluate(el => el.scrollWidth - el.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);

        // Mouse drag moves the selected element.
        const rect = activePane(page).locator('[data-element-id="box"]');
        const before = await rect.boundingBox();
        await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
        await page.mouse.down();
        await page.mouse.move(before.x + before.width / 2 + 40, before.y + before.height / 2 + 30, { steps: 5 });
        await page.mouse.up();
        await expect.poll(async () => (await rect.boundingBox()).x).toBeGreaterThan(before.x + 20);

        // Sidebar rows in the drawer keep their hover actions, no ⋯ button.
        await page.getByRole('button', { name: 'Open pages and templates' }).click();
        const row = page.getByText('Guard Page').first();
        await row.hover();
        await expect(page.getByTitle('Add New Page').first()).toBeVisible();
        await expect(page.getByRole('button', { name: /^Actions for/ })).toHaveCount(0);
    });

    test('600px: phone layout; back to 1440px restores the desktop with its saved zoom', async ({ page }) => {
        await page.setViewportSize({ width: 600, height: 800 });
        await expect(html(page)).toHaveAttribute('data-form-factor', 'phone');
        await expect(topBar(page).getByRole('button', { name: 'Narrow' })).toHaveCount(1);

        await page.setViewportSize({ width: 1440, height: 900 });
        await expect(html(page)).not.toHaveAttribute('data-form-factor', /.+/);
        await expect(topBar(page)).toHaveCount(0);
        // The fixture's saved zoom is 0.8; narrow-window fitting never wrote it.
        await expect(activePane(page).getByText('80%')).toBeVisible();
    });

    test('an inline text edit survives crossing a breakpoint', async ({ page }) => {
        const title = activePane(page).locator('[data-element-id="title"]');
        await title.dblclick();
        const editor = activePane(page).locator('[data-canvas-event-owner="inline-text"] [contenteditable]');
        await expect(editor).toBeVisible();
        await page.keyboard.press('End');
        await page.keyboard.type(' edited');
        await page.setViewportSize({ width: 1440, height: 900 });
        await expect(activePane(page).locator('[data-element-id="title"]')).toContainText('Guard edited');
        // One undo step takes the whole edit back.
        await activePane(page).getByTestId('editor-canvas').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('Control+z');
        await expect(activePane(page).locator('[data-element-id="title"]')).toContainText('Guard');
        await expect(activePane(page).locator('[data-element-id="title"]')).not.toContainText('edited');
    });
});
```
(If a selector does not exist exactly as written — `.canvas-scroll-container`, the inline editor's `[contenteditable]` path, or the `80%` readout's scope — read the component (`components/Canvas.tsx`, `components/canvas/OverlayTextEditor.tsx`, `components/EditorToolbar.tsx:160`) and use the real one; keep the assertion's meaning.)

- [ ] **Step 2: Run it**

Run: `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp E2E_WEB_PORT=4410 E2E_API_PORT=4411 npx playwright test tests/e2e/narrow_window_layout.spec.js --project=chromium`
Expected: 3 passed. Then `git checkout -- server/analytics.db`.

- [ ] **Step 3: If the inline-edit test loses the text, commit the session on unmount**

Only if `'an inline text edit survives crossing a breakpoint'` fails because the text is lost or the undo does not take it back in one step. In `components/Canvas.tsx`, next to the `inlineEditing` state (around line 291), add:
```ts
    // A layout swap (a window crossing a breakpoint) remounts the canvas under a new parent while
    // an inline edit may be open; end its session so the typed text is one committed history step.
    const inlineEditingRef = useRef(inlineEditing);
    inlineEditingRef.current = inlineEditing;
    const finishInlineEditingRef = useRef(finishInlineEditing);
    finishInlineEditingRef.current = finishInlineEditing;
    useEffect(() => () => {
        const session = inlineEditingRef.current;
        if (session) finishInlineEditingRef.current(session);
    }, []);
```
(place it after `finishInlineEditing` is declared so the ref initialiser can read it.) Re-run Step 2; expected: 3 passed.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/narrow_window_layout.spec.js
# and components/Canvas.tsx only if Step 3 was needed
git commit -m "test(e2e): narrow mouse window switches layouts and keeps mouse input

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CZ6oYo4VzPnW7azRr7jQJ"
```

---

### Task 7: Docs, spec amendments, onboarding bundle

**Files:**
- Modify: `docs-content/reference/editor/editor-on-phones-and-tablets.md` (front-matter `summary`, `keywords`, and the first paragraph)
- Modify: `docs/superpowers/specs/2026-09-23-mobile-editor-design.md:21` and `:32`
- Modify: `docs/superpowers/specs/2026-10-19-narrow-window-layouts-design.md` (rulings R1–R3)
- Regenerate: `onboarding/index.html`

- [ ] **Step 1: User docs**

In `docs-content/reference/editor/editor-on-phones-and-tablets.md`:
- `summary:` replace "while desktop stays exactly as it is." with "and a narrow desktop window uses the same layouts with mouse behaviour."
- `keywords:` append `, narrow window, small window, resize, breakpoint`.
- Replace the first paragraph's second sentence "Nothing changes on a computer with a mouse or trackpad, at any window size — the layout follows the device's pointer, not its width." with:
  "On a computer with a mouse or trackpad the full desktop editor shows at 1024px wide and above; narrow the window below 1024px and it switches to the tablet layout, below 640px to the phone layout (the window's height does not matter). In a narrow window everything else stays as on desktop: controls keep their normal size, sidebar rows show their actions on hover, the canvas works with the mouse, the browser's Back button leaves the editor, and the zoom you set on the desktop comes back when the window is wide again. The gestures, the bigger buttons and **Select multiple** below are for touch screens."

- [ ] **Step 2: Mobile spec amendment**

In `docs/superpowers/specs/2026-09-23-mobile-editor-design.md`:
- Line 21: append to the bullet: " *(Amended 2026-10-19: narrow mouse windows now use the tablet/phone layouts with mouse input — see `2026-10-19-narrow-window-layouts-design.md`.)*"
- Line 32: append: " *(Superseded 2026-10-19 by `2026-10-19-narrow-window-layouts-design.md`.)*"

- [ ] **Step 3: Write the plan rulings back into the narrow-window spec**

In `docs/superpowers/specs/2026-10-19-narrow-window-layouts-design.md`:
- In "Context", replace "`FormFactorProvider` takes `value: EditorMode`." with "`FormFactorProvider` takes `value: FormFactor` (the layout) and an optional `input?: InputMode`, defaulting to touch for a narrow layout and mouse for desktop (what every existing caller meant); `EditorPage` passes the detected input."
- In "Call sites → Follow layout → ProjectEditor", replace the `useTouchMultiSelect` bullet with: "`useTouchMultiSelect` is enabled for touch input only, and `touchActions.toggleMultiSelect` is set only then, so the **Select multiple** button is hidden for a mouse: the canvas reads the mode in its touch tap handlers only, and Ctrl/Cmd/Shift-click already selects several."
- In "Canvas fit decoupled from input", append: "The fit's side gutter follows input: 16px (`TOUCH_CANVAS_GUTTER`, the touch canvas's `p-4`) for touch, 48px (`MOUSE_CANVAS_GUTTER`, the mouse canvas's `p-12`) for a mouse."

- [ ] **Step 4: Commit docs**

```bash
git add docs-content/reference/editor/editor-on-phones-and-tablets.md docs/superpowers/specs/2026-09-23-mobile-editor-design.md docs/superpowers/specs/2026-10-19-narrow-window-layouts-design.md
git commit -m "docs(editor): narrow desktop windows use the tablet and phone layouts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CZ6oYo4VzPnW7azRr7jQJ"
```

- [ ] **Step 5: Check the docs anti-rot guards**

Run: `TMPDIR=/media/anoop/ssd_1/Work/doctect/doctect/.worktrees/rescue-tmp npx vitest run tests/unit --reporter=dot -t "docs"`
Expected: PASS. If a docs guard fails on the new paragraph (e.g. a keyword or link check), fix the doc text and commit the fix as a new commit (do not rewrite history).

- [ ] **Step 6: Regenerate the onboarding bundle (last commit)**

```bash
node onboarding/build.mjs
git add onboarding/index.html
git commit -m "chore(onboarding): regenerate bundle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CZ6oYo4VzPnW7azRr7jQJ"
```

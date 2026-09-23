# Mobile & Tablet Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the project editor usable on phones and tablets (canvas + bottom sheet + drawer, touch select/move/resize/create, quick text formatting) without changing the desktop UI.

**Architecture:** A form-factor context (`desktop | tablet | phone`, touch-first detection) wraps the editor route. `ProjectEditor`'s layout block moves into a new `EditorLayout` component whose desktop branch renders today's markup exactly; tablet/phone branches place the *same* `Sidebar`, `Canvas` and `PropertiesPanel` into a drawer, a bottom sheet and touch toolbars. A pointer-event gesture hook feeds one-finger drags into `Canvas`'s existing mouse handlers so move/resize/create reuse desktop logic.

**Tech Stack:** React 18 + TypeScript, Tailwind via CDN (`index.html`, no CSS build), vitest + @testing-library/react (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-23-mobile-editor-design.md` — read it before starting.

## Global Constraints

- **Desktop must not change.** Any device where `matchMedia('(pointer: coarse)')` is false renders today's editor at every width. The desktop DOM snapshot (Task 1) and desktop screenshots (Task 2) must pass after every task.
- Form factor: coarse pointer and width `< 640px` → `phone`; coarse pointer otherwise → `tablet`; else `desktop`.
- Touch layouts never write `state.scale`, `state.sidebarWidth` or `state.propertiesPanelWidth`.
- All touch CSS is scoped under `[data-form-factor]` on `<html>`; the attribute is absent on desktop and removed when the editor unmounts.
- Touch hit targets ≥ 44px; touch form controls use a 16px font.
- No schema or persisted-state changes.
- Keep hunks in `ProjectEditor.tsx`, `Canvas.tsx`, `EditorToolbar.tsx`, `PropertiesPanel.tsx`, `LayersPanel.tsx` and `playwright.config.cjs` thin; new behaviour goes in new files.
- Commit after every task. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Notes on line references

This plan was written against `main` at `3a32465`. Implementation starts **after** `feat/incremental-local-persistence` merges, which rewrites large parts of `ProjectEditor.tsx` and `Canvas.tsx`. Locate code by the quoted anchors (e.g. "the `<div className="flex flex-1 overflow-hidden">` block"), not by line numbers.

## File Structure

| File | Responsibility |
|---|---|
| `hooks/useEditorFormFactor.ts` (new) | `detectFormFactor()` pure fn + `useEditorFormFactor()` media-query hook |
| `components/editor-layout/FormFactorContext.tsx` (new) | Context, `useFormFactor()`, provider that sets/removes `<html data-form-factor>` |
| `components/editor-layout/EditorChromeContext.tsx` (new) | Page-level chrome (project tabs, save status, cloud/account menus) for the phone top bar |
| `components/editor-layout/EditorLayout.tsx` (new) | Desktop / tablet / phone layout branches |
| `components/editor-layout/touchActions.ts` (new) | `TouchEditorActions` type shared by touch chrome |
| `components/editor-layout/SidebarDrawer.tsx` (new) | Left overlay drawer |
| `components/editor-layout/PropertiesSheet.tsx` (new) | Bottom sheet with peek/half/full detents |
| `components/editor-layout/TouchToolButtons.tsx` (new) | Tool buttons (Select, Hand, Text, shapes) + fit |
| `components/editor-layout/OverflowMenu.tsx` (new) | ⋯ sheet: Selection / Export / Canvas / Project / Cloud / Account |
| `components/editor-layout/ProjectSwitcher.tsx` (new) | Phone project-tab switcher |
| `components/editor-layout/PhoneTopBar.tsx`, `TabletToolbar.tsx` (new) | Touch toolbars |
| `components/editor-layout/useTouchViewport.ts` (new) | Local (non-persisted) touch zoom + fit signal |
| `services/previewNodes.ts` (new) | Template preview-node options (pure) |
| `hooks/useCanvasTouchGestures.ts` (new) | Pointer-event gesture recogniser |
| `components/canvas/QuickFormatBar.tsx` (new) | Floating text formatting bar |
| `services/generatorErrorPane.ts` (new) | Maps a Generator error message to its script pane |
| `components/Canvas.tsx` | `inputMode`, `fitSignal` props; touch routing; extracted helpers |
| `components/canvas/SelectionHandles.tsx` | `touchScale` prop: 44px hit zones, no rotate/pivot on touch |
| `components/canvas/SelectUnderMenu.tsx` | Outside-close on `pointerdown`; gesture-ignore marker |
| `components/ProjectEditor.tsx` | Uses `EditorLayout`; builds `touchActions`; touch zoom |
| `pages/EditorPage.tsx` | Provides form-factor + chrome contexts; hides header on phone |
| `components/HierarchyGeneratorModal.tsx` | Template/Hierarchy toggle on touch |
| `components/LayersPanel.tsx` | ▲/▼ layer reorder on touch |
| `index.html` | Scoped touch CSS |
| `components/JsonModal.tsx`, `GeneratorVisualPreviewModal.tsx`, `NewProjectModal.tsx` | `editor-dialog-panel` class |
| `playwright.config.cjs` | Mobile projects; desktop projects ignore the mobile spec |

---

### Task 0: Start gate

**Files:** none.

- [ ] **Step 1: Confirm prerequisites**

`feat/incremental-local-persistence` must be merged into `main`. Then:

```bash
cd /media/anoop/ssd_1/Work/doctect/doctect/.worktrees/mobile-editor
git fetch . main:main 2>/dev/null || true
git rebase main
npx vitest run tests/unit 2>&1 | tail -5
```

Expected: rebase clean (the branch only holds the spec and this plan). Record the failing-test baseline so later tasks don't mistake pre-existing failures for regressions.

- [ ] **Step 2: Re-locate anchors**

Open `components/ProjectEditor.tsx` and confirm these still exist: the editor bar `<div className="min-h-[40px] py-1 bg-white border-b ...">`, the three-column block `<div className="flex flex-1 overflow-hidden">`, `saveToHistory`, `undo`, `redo`, `handleExportPDF`, `handleDuplicate`, `handleDeleteElements`, `effectivePreviewNodeId`. Open `components/Canvas.tsx` and confirm `handleMouseDown/Move/Up`, `handleContextMenu`, `getMouseCoords`, `outerContainerRef`, the wheel-zoom effect and the `if (w < MIN_DRAG_THRESHOLD && h < MIN_DRAG_THRESHOLD)` branch in `handleMouseUp`. If the persistence branch renamed any, use the new names throughout.

---

### Task 1: Desktop DOM snapshot guard

**Files:**
- Create: `tests/helpers/editorFixtures.ts`
- Create: `tests/unit/ProjectEditor.desktopLayout.test.tsx`

**Interfaces:** Produces the snapshot every later task must keep passing.

- [ ] **Step 1: Shared fixture**

`tests/helpers/editorFixtures.ts` (reused by Tasks 8 and 12):

```ts
import type { AppState } from '../../types';
import { CURRENT_SCHEMA_VERSION } from '../../services/migration';

export const editorState = (overrides: Partial<AppState> = {}): AppState => ({
    nodes: { root: { id: 'root', parentId: null, type: 'page', title: 'Root', data: {}, children: [] } },
    rootId: 'root',
    variants: { default: { id: 'default', name: 'Default', templates: {
        page: { id: 'page', name: 'Page', width: 509, height: 679,
            layers: [{ id: 'l1', name: 'Layer 1', order: 0, visible: true, locked: false }], elements: [] },
    } } },
    activeVariantId: 'default', viewMode: 'hierarchy', selectedNodeId: 'root', selectedNodeIds: ['root'],
    selectedTemplateId: '', selectedTemplateIds: [], selectedElementIds: [], activeLayerId: 'l1',
    scale: 1, tool: 'select', showJsonModal: false, sidebarWidth: 280, propertiesPanelWidth: 320,
    snapToGrid: true, showGrid: false, showNodeSelector: false, nodeSelectorMode: 'grid_source',
    editingElementId: null, clipboard: [], schemaVersion: CURRENT_SCHEMA_VERSION,
    ...overrides,
} as AppState);
```

- [ ] **Step 2: Write the snapshot test**

```tsx
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { editorState } from '../helpers/editorFixtures';

vi.mock('../../components/Sidebar', () => ({ Sidebar: () => <div data-mock="sidebar" /> }));
vi.mock('../../components/Canvas', () => ({ Canvas: () => <div data-mock="canvas" /> }));
vi.mock('../../components/PropertiesPanel', () => ({ PropertiesPanel: () => <div data-mock="properties" /> }));
vi.mock('../../components/LayersPanel', () => ({ LayersPanel: () => <div /> }));
vi.mock('../../components/CollapsibleSection', () => ({ CollapsibleSection: () => <div /> }));
vi.mock('../../components/JsonModal', () => ({ JsonModal: () => null }));
vi.mock('../../components/NodeSelectorModal', () => ({ NodeSelectorModal: () => null }));
vi.mock('../../components/DeleteConfirmModal', () => ({ DeleteConfirmModal: () => null }));
vi.mock('../../components/SavePresetModal', () => ({ SavePresetModal: () => null }));
vi.mock('../../components/NewVariantModal', () => ({ NewVariantModal: () => null }));
vi.mock('../../components/EditorToolbar', () => ({ EditorToolbar: () => <div data-mock="toolbar" /> }));
vi.mock('../../components/HierarchyGeneratorModal', () => ({ HierarchyGeneratorModal: () => null }));

import { ProjectEditor } from '../../components/ProjectEditor';

const state = editorState();

describe('ProjectEditor desktop layout', () => {
    it('renders the desktop editor markup unchanged', () => {
        const { container } = render(
            <ProjectEditor
                projectId="11111111-2222-3333-4444-555555555555"
                projectName="Root"
                initialState={state}
                isActive
                onNameChange={() => {}}
                onCreateGeneratedProject={async () => false}
                onSaveCustomPreset={async () => false}
            />,
        );
        expect(container.innerHTML).toMatchSnapshot();
    });
});
```

If the merged `ProjectEditorProps` has new required props, pass inert values for them.

- [ ] **Step 3: Record the snapshot on unchanged code**

Run: `npx vitest run tests/unit/ProjectEditor.desktopLayout.test.tsx`
Expected: PASS, writes `tests/unit/__snapshots__/ProjectEditor.desktopLayout.test.tsx.snap`. Open it and check it contains `min-h-[40px]`, `flex flex-1 overflow-hidden`, `cursor-col-resize` twice, and the three `data-mock` markers.

- [ ] **Step 4: Commit**

```bash
git add tests/helpers/editorFixtures.ts tests/unit/ProjectEditor.desktopLayout.test.tsx tests/unit/__snapshots__/ProjectEditor.desktopLayout.test.tsx.snap
git commit -m "test(editor): snapshot desktop editor layout before mobile work"
```

---

### Task 2: Desktop screenshot guard

**Files:**
- Create: `tests/e2e/fixtures/layoutFixture.js`
- Create: `tests/e2e/desktop_layout_guard.spec.js`
- Create (generated): `tests/e2e/desktop_layout_guard.spec.js-snapshots/*.png`

- [ ] **Step 1: Write the shared fixture and the spec**

`tests/e2e/fixtures/layoutFixture.js` (reused by Task 16):

```js
export const layoutFixture = {
    nodes: { root: { id: 'root', parentId: null, type: 'page', title: 'Guard Page', data: {}, children: [] } },
    rootId: 'root',
    variants: { default: { id: 'default', name: 'Default', templates: { page: {
        id: 'page', name: 'Page', width: 595, height: 842,
        layers: [{ id: 'base', name: 'Base', order: 0, visible: true, locked: false }],
        elements: [
            { id: 'box', type: 'rect', layerId: 'base', x: 60, y: 80, w: 200, h: 120, rotation: 0,
              fill: '#e2e8f0', stroke: '#000000', strokeWidth: 1, opacity: 1 },
            { id: 'title', type: 'text', layerId: 'base', x: 60, y: 240, w: 300, h: 40, rotation: 0,
              fill: '', stroke: '', strokeWidth: 0, opacity: 1, text: 'Guard', autoWidth: false,
              fontSize: 24, fontFamily: 'helvetica', fontWeight: 'bold', fontStyle: 'normal',
              textColor: '#000000', textOverflow: 'clip', textWrap: true,
              textPadding: { top: 0, right: 0, bottom: 0, left: 0 } },
        ],
    } } } },
    activeVariantId: 'default', viewMode: 'hierarchy', selectedNodeId: 'root', selectedNodeIds: ['root'],
    selectedTemplateId: '', selectedTemplateIds: [], selectedElementIds: [], activeLayerId: 'base',
    scale: 0.8, tool: 'select', showJsonModal: false, showNodeSelector: false,
    nodeSelectorMode: 'grid_source', editingElementId: null, sidebarWidth: 288,
    propertiesPanelWidth: 320, snapToGrid: false, showGrid: false, clipboard: [],
};
```

`tests/e2e/desktop_layout_guard.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { seedNativeProject } from './localWorkspaceHelpers.js';
import { layoutFixture as fixture } from './fixtures/layoutFixture.js';

const activePane = page => page.locator('[data-testid="project-pane"][data-active="true"]');
const shot = { maxDiffPixelRatio: 0.01, animations: 'disabled' };

test.describe('desktop editor layout guard', () => {
    test.skip(({ browserName }) => browserName !== 'chromium', 'baselines are recorded on Chromium');

    test.beforeEach(async ({ page }) => {
        await seedNativeProject(page, { id: 'layout-guard', name: 'Layout Guard', initialState: fixture });
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/app');
        await expect(activePane(page).getByTestId('editor-canvas')).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
    });

    test('idle editor', async ({ page }) => {
        await expect(page).toHaveScreenshot('idle.png', { ...shot, mask: [page.getByRole('status')] });
    });

    test('element selected', async ({ page }) => {
        await activePane(page).locator('[data-element-id="box"]').click();
        await expect(page).toHaveScreenshot('selected.png', { ...shot, mask: [page.getByRole('status')] });
    });

    test('generator open', async ({ page }) => {
        await activePane(page).getByTitle('Generate Hierarchy via Script').click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page).toHaveScreenshot('generator.png', { ...shot, mask: [page.getByRole('status')] });
    });
});
```

`layoutFixture` needs a `schemaVersion` matching the merged `CURRENT_SCHEMA_VERSION` if the helper validates it — copy the value used by `tests/e2e/element_properties.spec.js`.

- [ ] **Step 2: Record baselines on unchanged code**

Run: `npx playwright test tests/e2e/desktop_layout_guard.spec.js --project=chromium --update-snapshots`
Then: `npx playwright test tests/e2e/desktop_layout_guard.spec.js --project=chromium`
Expected: 3 passed on the second run. (If port 3000 is busy, set `E2E_WEB_PORT=3100 E2E_API_PORT=3101`.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/fixtures/layoutFixture.js tests/e2e/desktop_layout_guard.spec.js tests/e2e/desktop_layout_guard.spec.js-snapshots
git commit -m "test(e2e): desktop editor screenshot baselines"
```

---

### Task 3: Form-factor detection and context

**Files:**
- Create: `hooks/useEditorFormFactor.ts`
- Create: `components/editor-layout/FormFactorContext.tsx`
- Modify: `pages/EditorPage.tsx` (wrap the returned tree in the provider)
- Test: `tests/unit/editorFormFactor.test.tsx`

**Interfaces:**
- Produces: `type FormFactor = 'desktop' | 'tablet' | 'phone'`; `detectFormFactor(coarsePointer: boolean, viewportWidth: number): FormFactor`; `useEditorFormFactor(): FormFactor`; `FormFactorProvider({ value, children })`; `useFormFactor(): FormFactor` (defaults to `'desktop'` outside a provider).

- [ ] **Step 1: Write the failing tests**

```tsx
import React from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { detectFormFactor, useEditorFormFactor } from '../../hooks/useEditorFormFactor';
import { FormFactorProvider, useFormFactor } from '../../components/editor-layout/FormFactorContext';

type Listener = () => void;
const installMatchMedia = (initial: { coarse: boolean; width: number }) => {
    const env = { ...initial };
    const listeners = new Set<Listener>();
    (window as any).matchMedia = (query: string) => ({
        get matches() {
            if (query === '(pointer: coarse)') return env.coarse;
            if (query === '(max-width: 639px)') return env.width < 640;
            return false;
        },
        media: query,
        addEventListener: (_: string, fn: Listener) => listeners.add(fn),
        removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
    });
    return {
        set(next: Partial<typeof env>) { Object.assign(env, next); listeners.forEach(fn => fn()); },
    };
};

afterEach(() => {
    delete (window as any).matchMedia;
    document.documentElement.removeAttribute('data-form-factor');
});

describe('detectFormFactor', () => {
    it.each([
        [false, 390, 'desktop'], [false, 1440, 'desktop'], [false, 500, 'desktop'],
        [true, 390, 'phone'], [true, 639, 'phone'], [true, 640, 'tablet'], [true, 1366, 'tablet'],
    ] as const)('coarse=%s width=%s -> %s', (coarse, width, expected) => {
        expect(detectFormFactor(coarse, width)).toBe(expected);
    });
});

describe('useEditorFormFactor', () => {
    it('is desktop when matchMedia is unavailable', () => {
        const { result } = renderHook(() => useEditorFormFactor());
        expect(result.current).toBe('desktop');
    });

    it('follows rotation between phone and tablet', () => {
        const media = installMatchMedia({ coarse: true, width: 390 });
        const { result } = renderHook(() => useEditorFormFactor());
        expect(result.current).toBe('phone');
        act(() => media.set({ width: 844 }));
        expect(result.current).toBe('tablet');
    });

    it('never leaves desktop for a fine pointer at narrow widths', () => {
        const media = installMatchMedia({ coarse: false, width: 1200 });
        const { result } = renderHook(() => useEditorFormFactor());
        act(() => media.set({ width: 400 }));
        expect(result.current).toBe('desktop');
    });
});

describe('FormFactorProvider', () => {
    const Probe = () => <span>{useFormFactor()}</span>;

    it('defaults to desktop without a provider', () => {
        const { container } = render(<Probe />);
        expect(container.textContent).toBe('desktop');
    });

    it('sets the html attribute for touch form factors and removes it on unmount', () => {
        const { rerender, unmount } = render(<FormFactorProvider value="phone"><Probe /></FormFactorProvider>);
        expect(document.documentElement.getAttribute('data-form-factor')).toBe('phone');
        rerender(<FormFactorProvider value="desktop"><Probe /></FormFactorProvider>);
        expect(document.documentElement.hasAttribute('data-form-factor')).toBe(false);
        rerender(<FormFactorProvider value="tablet"><Probe /></FormFactorProvider>);
        expect(document.documentElement.getAttribute('data-form-factor')).toBe('tablet');
        unmount();
        expect(document.documentElement.hasAttribute('data-form-factor')).toBe(false);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/editorFormFactor.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`hooks/useEditorFormFactor.ts`:

```ts
import { useEffect, useState } from 'react';

export type FormFactor = 'desktop' | 'tablet' | 'phone';

export const PHONE_MAX_WIDTH = 639;
const COARSE_QUERY = '(pointer: coarse)';
const PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;

export function detectFormFactor(coarsePointer: boolean, viewportWidth: number): FormFactor {
    if (!coarsePointer) return 'desktop';
    return viewportWidth <= PHONE_MAX_WIDTH ? 'phone' : 'tablet';
}

const read = (): FormFactor => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop';
    const coarse = window.matchMedia(COARSE_QUERY).matches;
    const phone = window.matchMedia(PHONE_QUERY).matches;
    return detectFormFactor(coarse, phone ? 0 : PHONE_MAX_WIDTH + 1);
};

export function useEditorFormFactor(): FormFactor {
    const [formFactor, setFormFactor] = useState<FormFactor>(read);

    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return;
        const queries = [window.matchMedia(COARSE_QUERY), window.matchMedia(PHONE_QUERY)];
        const update = () => setFormFactor(read());
        queries.forEach(query => query.addEventListener('change', update));
        update();
        return () => queries.forEach(query => query.removeEventListener('change', update));
    }, []);

    return formFactor;
}
```

`components/editor-layout/FormFactorContext.tsx`:

```tsx
import React, { createContext, useContext, useEffect } from 'react';
import type { FormFactor } from '../../hooks/useEditorFormFactor';

const FormFactorContext = createContext<FormFactor>('desktop');

export const useFormFactor = (): FormFactor => useContext(FormFactorContext);

export function FormFactorProvider({ value, children }: { value: FormFactor; children: React.ReactNode }) {
    useEffect(() => {
        const root = document.documentElement;
        if (value === 'desktop') {
            root.removeAttribute('data-form-factor');
            return;
        }
        root.setAttribute('data-form-factor', value);
        return () => root.removeAttribute('data-form-factor');
    }, [value]);

    return <FormFactorContext.Provider value={value}>{children}</FormFactorContext.Provider>;
}
```

- [ ] **Step 4: Wire into `EditorPage`**

In `pages/EditorPage.tsx`, add imports:

```tsx
import { useEditorFormFactor } from '../hooks/useEditorFormFactor';
import { FormFactorProvider } from '../components/editor-layout/FormFactorContext';
```

Inside the component body (with the other hooks): `const formFactor = useEditorFormFactor();`

Wrap the component's returned fragment `<>…</>` in `<FormFactorProvider value={formFactor}>…</FormFactorProvider>` (replace the outer `<>` / `</>`).

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/editorFormFactor.test.tsx tests/unit/ProjectEditor.desktopLayout.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add hooks/useEditorFormFactor.ts components/editor-layout/FormFactorContext.tsx pages/EditorPage.tsx tests/unit/editorFormFactor.test.tsx
git commit -m "feat(editor): detect touch form factor and expose it via context"
```

---

### Task 4: Extract `EditorLayout` (desktop branch only)

**Files:**
- Create: `components/editor-layout/EditorLayout.tsx`
- Create: `components/editor-layout/touchActions.ts`
- Modify: `components/ProjectEditor.tsx`
- Test: `tests/unit/ProjectEditor.desktopLayout.test.tsx` (unchanged — must still pass)

**Interfaces:**
- Produces:

```ts
// touchActions.ts
export interface PreviewNodeChoice { options: { id: string; title: string }[]; selectedId: string; onSelect: (id: string) => void; }
export interface TouchEditorActions {
    undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean;
    exportPdf: () => void; exportAllVariants: () => void; canExportAllVariants: boolean; isExporting: boolean;
    greyscale: boolean; toggleGreyscale: () => void;
    openJson: () => void; openGenerator: () => void; savePreset: () => void;
    importSvg: (file: File) => void; insertSvgPlaceholder: () => void;
    snapToGrid: boolean; toggleSnap: () => void; showGrid: boolean; toggleGrid: () => void;
    tool: string; setTool: (tool: string) => void;
    fitToWidth: () => void;
    hasSelection: boolean; duplicateSelection: () => void; deleteSelection: () => void;
    preview: PreviewNodeChoice | null;
}
```

```ts
// EditorLayout.tsx
export interface EditorLayoutProps {
    formFactor: FormFactor;
    editorBar: React.ReactNode;
    toolbar: React.ReactNode;
    sidebar: React.ReactNode;
    canvas: React.ReactNode;
    properties: React.ReactNode;
    sidebarWidth: number;
    propertiesPanelWidth: number;
    onStartResize: (panel: 'sidebar' | 'properties') => void;
    touchActions?: TouchEditorActions;          // required for tablet/phone (Task 12)
    selectionLabel?: string;                     // phone sheet peek text (Task 12)
    navigationKey?: string;                      // closes the drawer when it changes (Task 12)
}
```

- [ ] **Step 1: Create `touchActions.ts`** with exactly the types above.

- [ ] **Step 2: Create `EditorLayout.tsx` with the desktop branch**

```tsx
import React from 'react';
import type { FormFactor } from '../../hooks/useEditorFormFactor';
import type { TouchEditorActions } from './touchActions';

export interface EditorLayoutProps {
    formFactor: FormFactor;
    editorBar: React.ReactNode;
    toolbar: React.ReactNode;
    sidebar: React.ReactNode;
    canvas: React.ReactNode;
    properties: React.ReactNode;
    sidebarWidth: number;
    propertiesPanelWidth: number;
    onStartResize: (panel: 'sidebar' | 'properties') => void;
    touchActions?: TouchEditorActions;
    selectionLabel?: string;
    navigationKey?: string;
}

export function DesktopEditorLayout(props: EditorLayoutProps) {
    const { editorBar, toolbar, sidebar, canvas, properties, sidebarWidth, propertiesPanelWidth, onStartResize } = props;
    return (
        <>
            {editorBar}
            <div className="flex flex-1 overflow-hidden">
                <div style={{ width: sidebarWidth }} className="flex-shrink-0 relative flex flex-col">
                    {sidebar}
                    <div
                        className="absolute right-0 top-0 bottom-0 w-1 hover:bg-blue-400 cursor-col-resize z-30 transition-colors"
                        onMouseDown={() => onStartResize('sidebar')}
                    />
                </div>
                <div className="flex-1 flex flex-col relative min-w-0">
                    {toolbar}
                    <div className="flex-1 bg-slate-200 overflow-hidden relative flex flex-col">
                        {canvas}
                    </div>
                </div>
                <div style={{ width: propertiesPanelWidth }} className="flex-shrink-0 relative flex flex-col">
                    <div
                        className="absolute left-0 top-0 bottom-0 w-1 hover:bg-blue-400 cursor-col-resize z-30 transition-colors"
                        onMouseDown={() => onStartResize('properties')}
                    />
                    {properties}
                </div>
            </div>
        </>
    );
}

export function EditorLayout(props: EditorLayoutProps) {
    // Tablet and phone branches are added in Task 12.
    return <DesktopEditorLayout {...props} />;
}
```

Compare every class string above against the current `ProjectEditor` markup and copy the merged version verbatim if it differs.

- [ ] **Step 3: Use it in `ProjectEditor`**

In `ProjectEditor.tsx`:

1. Import: `import { EditorLayout } from './editor-layout/EditorLayout';` and `import { useFormFactor } from './editor-layout/FormFactorContext';`
2. In the body: `const formFactor = useFormFactor();`
3. Cut the editor bar `<div className="min-h-[40px] py-1 bg-white border-b ...">…</div>` into `const editorBar = (…);` placed just before `return (`.
4. Cut each panel's inner element into constants, unchanged: `const sidebarElement = (<Sidebar … />);`, `const toolbarElement = (<EditorToolbar … />);`, `const canvasElement = (<Canvas … />);`, `const propertiesElement = (<PropertiesPanel … layersSlot={…} />);`
5. Replace the editor bar and the whole `<div className="flex flex-1 overflow-hidden">…</div>` block with:

```tsx
<EditorLayout
    formFactor={formFactor}
    editorBar={editorBar}
    toolbar={toolbarElement}
    sidebar={sidebarElement}
    canvas={canvasElement}
    properties={propertiesElement}
    sidebarWidth={state.sidebarWidth}
    propertiesPanelWidth={state.propertiesPanelWidth}
    onStartResize={setResizingPanel}
/>
```

The modals after the block stay where they are.

- [ ] **Step 4: Verify the snapshot is unchanged**

Run: `npx vitest run tests/unit/ProjectEditor.desktopLayout.test.tsx tests/unit/ProjectEditor.exportAllVariants.test.tsx tests/unit/ProjectEditor.generatorHistory.test.tsx`
Expected: PASS with **no** snapshot update. If the snapshot differs, fix the markup — never run with `-u`.

- [ ] **Step 5: Commit**

```bash
git add components/editor-layout/EditorLayout.tsx components/editor-layout/touchActions.ts components/ProjectEditor.tsx
git commit -m "refactor(editor): move desktop layout into EditorLayout"
```

---

### Task 5: Touch gesture hook

**Files:**
- Create: `hooks/useCanvasTouchGestures.ts`
- Test: `tests/unit/useCanvasTouchGestures.test.tsx`

**Interfaces:**
- Produces:

```ts
export interface TouchPoint { clientX: number; clientY: number; target: EventTarget | null; }
export interface TouchGestureHandlers {
    claimDirectDrag: (event: PointerEvent) => boolean;
    onDirectDown: (event: PointerEvent) => void;
    onDirectMove: (event: PointerEvent) => void;
    onDirectUp: (event: PointerEvent) => void;
    onTap: (point: TouchPoint) => void;
    onDoubleTap: (point: TouchPoint) => void;
    onLongPress: (point: TouchPoint) => void;
    onPan: (dx: number, dy: number) => void;
    onPinch: (factor: number, centerX: number, centerY: number) => void;
    onGestureStart?: () => void;
    onGestureEnd?: () => void;
}
export const TAP_SLOP_PX = 8, DOUBLE_TAP_MS = 300, DOUBLE_TAP_SLOP_PX = 24, LONG_PRESS_MS = 500;
export const GESTURE_IGNORE_ATTR = 'data-touch-gesture-ignore';
export function useCanvasTouchGestures(ref: React.RefObject<HTMLElement>, handlers: TouchGestureHandlers, enabled: boolean): void;
```

Behaviour: only `pointerType === 'touch'` is handled, and pointer-downs inside `[data-touch-gesture-ignore]` are ignored. Every handled `pointerdown` calls `preventDefault()` so browsers don't emit compatibility mouse events. When a second finger lands during a direct drag, the drag ends where it is (`onDirectUp` with the last event) and pinch/pan begins. A direct drag released without moving still counts toward double-tap detection, so double-tapping the selected text works.

- [ ] **Step 1: Write the failing tests**

```tsx
import React, { useRef } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DOUBLE_TAP_MS, LONG_PRESS_MS, TouchGestureHandlers, useCanvasTouchGestures,
} from '../../hooks/useCanvasTouchGestures';

const pointer = (target: Element, type: string, id: number, x: number, y: number, pointerType = 'touch') => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: pointerType } });
    target.dispatchEvent(event);
    return event;
};

const makeHandlers = (claim = false): TouchGestureHandlers & Record<string, any> => ({
    claimDirectDrag: vi.fn(() => claim),
    onDirectDown: vi.fn(), onDirectMove: vi.fn(), onDirectUp: vi.fn(),
    onTap: vi.fn(), onDoubleTap: vi.fn(), onLongPress: vi.fn(),
    onPan: vi.fn(), onPinch: vi.fn(), onGestureStart: vi.fn(), onGestureEnd: vi.fn(),
});

const Harness = ({ handlers, enabled = true }: { handlers: TouchGestureHandlers; enabled?: boolean }) => {
    const ref = useRef<HTMLDivElement>(null);
    useCanvasTouchGestures(ref, handlers, enabled);
    return (
        <div ref={ref} data-testid="surface">
            <span data-testid="inner" />
            <div data-touch-gesture-ignore><button data-testid="ignored" /></div>
        </div>
    );
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useCanvasTouchGestures', () => {
    it('reports a tap and prevents compatibility mouse events', () => {
        const h = makeHandlers();
        const { getByTestId } = render(<Harness handlers={h} />);
        const down = pointer(getByTestId('inner'), 'pointerdown', 1, 10, 10);
        pointer(getByTestId('inner'), 'pointerup', 1, 12, 11);
        expect(down.defaultPrevented).toBe(true);
        expect(h.onTap).toHaveBeenCalledWith(expect.objectContaining({ clientX: 10, clientY: 10 }));
        expect(h.onPan).not.toHaveBeenCalled();
    });

    it('recognises a double tap within the time and distance window', () => {
        const h = makeHandlers();
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 50, 50); pointer(s, 'pointerup', 1, 50, 50);
        act(() => { vi.advanceTimersByTime(DOUBLE_TAP_MS - 50); });
        pointer(s, 'pointerdown', 2, 55, 52); pointer(s, 'pointerup', 2, 55, 52);
        expect(h.onTap).toHaveBeenCalledTimes(1);
        expect(h.onDoubleTap).toHaveBeenCalledTimes(1);
    });

    it('turns a moving single finger into pan deltas', () => {
        const h = makeHandlers();
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 100, 100);
        pointer(s, 'pointermove', 1, 120, 100);
        pointer(s, 'pointermove', 1, 130, 90);
        pointer(s, 'pointerup', 1, 130, 90);
        expect(h.onPan).toHaveBeenNthCalledWith(1, 20, 0);
        expect(h.onPan).toHaveBeenNthCalledWith(2, 10, -10);
        expect(h.onTap).not.toHaveBeenCalled();
    });

    it('fires a long press when the finger stays put', () => {
        const h = makeHandlers();
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 30, 40);
        act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
        pointer(s, 'pointerup', 1, 30, 40);
        expect(h.onLongPress).toHaveBeenCalledWith(expect.objectContaining({ clientX: 30, clientY: 40 }));
        expect(h.onTap).not.toHaveBeenCalled();
    });

    it('routes a claimed drag to the direct handlers', () => {
        const h = makeHandlers(true);
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 10, 10);
        pointer(s, 'pointermove', 1, 40, 10);
        pointer(s, 'pointerup', 1, 40, 10);
        expect(h.onDirectDown).toHaveBeenCalledTimes(1);
        expect(h.onDirectMove).toHaveBeenCalledTimes(1);
        expect(h.onDirectUp).toHaveBeenCalledTimes(1);
        expect(h.onPan).not.toHaveBeenCalled();
    });

    it('ends a direct drag and switches to pinch when a second finger lands', () => {
        const h = makeHandlers(true);
        const { getByTestId } = render(<Harness handlers={h} />);
        const s = getByTestId('surface');
        pointer(s, 'pointerdown', 1, 100, 100);
        pointer(s, 'pointerdown', 2, 200, 100);
        expect(h.onDirectUp).toHaveBeenCalledTimes(1);
        pointer(s, 'pointermove', 2, 300, 100);
        expect(h.onPinch).toHaveBeenCalledWith(2, 200, 100);
        pointer(s, 'pointerup', 1, 100, 100);
        pointer(s, 'pointerup', 2, 300, 100);
        expect(h.onDirectUp).toHaveBeenCalledTimes(1);
        expect(h.onGestureEnd).toHaveBeenCalledTimes(1);
    });

    it('ignores mouse pointers, ignored subtrees and disabled state', () => {
        const h = makeHandlers();
        const { getByTestId, rerender } = render(<Harness handlers={h} />);
        pointer(getByTestId('surface'), 'pointerdown', 1, 0, 0, 'mouse');
        pointer(getByTestId('surface'), 'pointerup', 1, 0, 0, 'mouse');
        pointer(getByTestId('ignored'), 'pointerdown', 2, 0, 0);
        pointer(getByTestId('ignored'), 'pointerup', 2, 0, 0);
        rerender(<Harness handlers={h} enabled={false} />);
        pointer(getByTestId('surface'), 'pointerdown', 3, 0, 0);
        pointer(getByTestId('surface'), 'pointerup', 3, 0, 0);
        expect(h.onTap).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/useCanvasTouchGestures.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { RefObject, useEffect, useRef } from 'react';

export interface TouchPoint { clientX: number; clientY: number; target: EventTarget | null; }

export interface TouchGestureHandlers {
    claimDirectDrag: (event: PointerEvent) => boolean;
    onDirectDown: (event: PointerEvent) => void;
    onDirectMove: (event: PointerEvent) => void;
    onDirectUp: (event: PointerEvent) => void;
    onTap: (point: TouchPoint) => void;
    onDoubleTap: (point: TouchPoint) => void;
    onLongPress: (point: TouchPoint) => void;
    onPan: (dx: number, dy: number) => void;
    onPinch: (factor: number, centerX: number, centerY: number) => void;
    onGestureStart?: () => void;
    onGestureEnd?: () => void;
}

export const TAP_SLOP_PX = 8;
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_SLOP_PX = 24;
export const LONG_PRESS_MS = 500;
export const GESTURE_IGNORE_ATTR = 'data-touch-gesture-ignore';

type Mode = 'idle' | 'pending' | 'pan' | 'direct' | 'pinch' | 'done';
type Point = { x: number; y: number };

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function useCanvasTouchGestures(
    ref: RefObject<HTMLElement>,
    handlers: TouchGestureHandlers,
    enabled: boolean,
): void {
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;

    useEffect(() => {
        const el = ref.current;
        if (!el || !enabled) return;

        const pointers = new Map<number, Point>();
        let mode: Mode = 'idle';
        let start: (TouchPoint & { time: number }) | null = null;
        let last: Point = { x: 0, y: 0 };
        let lastDirectEvent: PointerEvent | null = null;
        let longPressTimer: ReturnType<typeof setTimeout> | null = null;
        let lastTap: { x: number; y: number; time: number } | null = null;
        let pinchDistance = 0;
        let pinchCenter: Point = { x: 0, y: 0 };

        const clearLongPress = () => {
            if (longPressTimer) clearTimeout(longPressTimer);
            longPressTimer = null;
        };

        const registerTap = (point: TouchPoint, notify: boolean) => {
            const now = Date.now();
            if (lastTap && now - lastTap.time <= DOUBLE_TAP_MS
                && Math.hypot(point.clientX - lastTap.x, point.clientY - lastTap.y) <= DOUBLE_TAP_SLOP_PX) {
                lastTap = null;
                handlersRef.current.onDoubleTap(point);
                return;
            }
            lastTap = { x: point.clientX, y: point.clientY, time: now };
            if (notify) handlersRef.current.onTap(point);
        };

        const finishIfIdle = () => {
            if (pointers.size > 0) return;
            clearLongPress();
            mode = 'idle';
            start = null;
            lastDirectEvent = null;
            handlersRef.current.onGestureEnd?.();
        };

        const onDown = (event: PointerEvent) => {
            if (event.pointerType !== 'touch') return;
            if ((event.target as Element | null)?.closest?.(`[${GESTURE_IGNORE_ATTR}]`)) return;
            event.preventDefault();
            el.setPointerCapture?.(event.pointerId);
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

            if (pointers.size === 1) {
                start = { clientX: event.clientX, clientY: event.clientY, target: event.target, time: Date.now() };
                last = { x: event.clientX, y: event.clientY };
                handlersRef.current.onGestureStart?.();
                if (handlersRef.current.claimDirectDrag(event)) {
                    mode = 'direct';
                    lastDirectEvent = event;
                    handlersRef.current.onDirectDown(event);
                    return;
                }
                mode = 'pending';
                longPressTimer = setTimeout(() => {
                    longPressTimer = null;
                    if (mode === 'pending' && start) {
                        mode = 'done';
                        handlersRef.current.onLongPress(start);
                    }
                }, LONG_PRESS_MS);
                return;
            }

            if (pointers.size === 2) {
                clearLongPress();
                if (mode === 'direct' && lastDirectEvent) handlersRef.current.onDirectUp(lastDirectEvent);
                const [a, b] = [...pointers.values()];
                pinchDistance = distance(a, b);
                pinchCenter = midpoint(a, b);
                mode = 'pinch';
            }
        };

        const onMove = (event: PointerEvent) => {
            if (event.pointerType !== 'touch' || !pointers.has(event.pointerId)) return;
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

            if (mode === 'direct') {
                lastDirectEvent = event;
                handlersRef.current.onDirectMove(event);
                return;
            }
            if (mode === 'pending' && start
                && Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) > TAP_SLOP_PX) {
                clearLongPress();
                mode = 'pan';
            }
            if (mode === 'pan') {
                handlersRef.current.onPan(event.clientX - last.x, event.clientY - last.y);
                last = { x: event.clientX, y: event.clientY };
                return;
            }
            if (mode === 'pinch' && pointers.size >= 2) {
                const [a, b] = [...pointers.values()];
                const nextDistance = distance(a, b);
                const nextCenter = midpoint(a, b);
                if (pinchDistance > 0 && nextDistance > 0) {
                    handlersRef.current.onPinch(nextDistance / pinchDistance, nextCenter.x, nextCenter.y);
                }
                const dx = nextCenter.x - pinchCenter.x;
                const dy = nextCenter.y - pinchCenter.y;
                if (dx !== 0 || dy !== 0) handlersRef.current.onPan(dx, dy);
                pinchDistance = nextDistance;
                pinchCenter = nextCenter;
            }
        };

        const onUp = (event: PointerEvent) => {
            if (event.pointerType !== 'touch' || !pointers.has(event.pointerId)) return;
            pointers.delete(event.pointerId);

            if (mode === 'direct') {
                handlersRef.current.onDirectUp(event);
                if (start && Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) <= TAP_SLOP_PX) {
                    registerTap(start, false);
                }
                mode = 'done';
            } else if (mode === 'pending' && start) {
                clearLongPress();
                registerTap(start, true);
                mode = 'done';
            } else if (mode === 'pinch' && pointers.size < 2) {
                mode = 'done';
            }
            finishIfIdle();
        };

        const onCancel = (event: PointerEvent) => {
            if (event.pointerType !== 'touch' || !pointers.has(event.pointerId)) return;
            pointers.delete(event.pointerId);
            if (mode === 'direct') handlersRef.current.onDirectUp(event);
            mode = 'done';
            finishIfIdle();
        };

        el.addEventListener('pointerdown', onDown, { passive: false });
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp);
        el.addEventListener('pointercancel', onCancel);
        return () => {
            clearLongPress();
            el.removeEventListener('pointerdown', onDown);
            el.removeEventListener('pointermove', onMove);
            el.removeEventListener('pointerup', onUp);
            el.removeEventListener('pointercancel', onCancel);
        };
    }, [ref, enabled]);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/useCanvasTouchGestures.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add hooks/useCanvasTouchGestures.ts tests/unit/useCanvasTouchGestures.test.tsx
git commit -m "feat(canvas): pointer-event touch gesture recogniser"
```

---

### Task 6: Canvas touch mode — select, move, resize, pan

**Files:**
- Modify: `components/Canvas.tsx`
- Modify: `components/canvas/SelectionHandles.tsx`
- Test: `tests/unit/canvasTouch.test.tsx`

**Interfaces:**
- Consumes: `useCanvasTouchGestures`, `GESTURE_IGNORE_ATTR` (Task 5).
- Produces: `CanvasProps.inputMode?: 'mouse' | 'touch'` (default `'mouse'`); `SelectionHandles` prop `touchScale?: number`; Canvas helper `clientToCanvas(clientX, clientY)` used by Tasks 7 and 13; `TOUCH_HANDLE_PX = 44` exported from `SelectionHandles.tsx`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/canvasTouch.test.tsx`. The canvas measures its position with `getBoundingClientRect`, which returns zeros in jsdom. That is fine: with `scale={1}`, client coordinates equal page coordinates.

Each dispatch is wrapped in `act()`. React 18 flushes state updates from native listeners in a microtask, and back-to-back synchronous dispatches would otherwise see stale `isDragging`/`isResizing` state. jsdom doesn't keep `scrollLeft`/`scrollTop`, so `trackScroll` gives the surface real backing values.

```tsx
import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../components/Canvas';
import type { PageTemplate, TemplateElement } from '../../types';

const pointer = (target: Element, type: string, id: number, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: 'touch' } });
    act(() => { target.dispatchEvent(event); });
    return event;
};

const trackScroll = (el: HTMLElement, left = 0, top = 0) => {
    const pos = { left, top };
    Object.defineProperty(el, 'scrollLeft', { configurable: true, get: () => pos.left, set: v => { pos.left = v; } });
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => pos.top, set: v => { pos.top = v; } });
    return pos;
};

const rect = (id: string, x: number, y: number): TemplateElement => ({
    id, type: 'rect', x, y, w: 100, h: 60, rotation: 0, layerId: 'l1',
    fill: '#eeeeee', stroke: '#000000', strokeWidth: 1, opacity: 1, zIndex: 1,
});

const template: PageTemplate = {
    id: 'page', name: 'Page', width: 500, height: 700,
    layers: [{ id: 'l1', name: 'Layer 1', order: 0, visible: true, locked: false }],
    elements: [],
};

const renderCanvas = (overrides: Partial<React.ComponentProps<typeof Canvas>> = {}) => {
    const props = {
        template, elements: [rect('a', 20, 20), rect('b', 200, 200)], selectedElementIds: [] as string[],
        scale: 1, tool: 'select', nodes: {}, currentNodeId: 'root', snapToGrid: false, showGrid: false,
        onUpdateElements: vi.fn(), onSelectElements: vi.fn(), onZoom: vi.fn(), onInteractionStart: vi.fn(),
        onSwitchToSelect: vi.fn(), activeLayerId: 'l1', inputMode: 'touch' as const,
        ...overrides,
    };
    const utils = render(<Canvas {...props} />);
    const surface = utils.container.querySelector('.canvas-scroll-container') as HTMLElement;
    const elementNode = (id: string) => utils.container.querySelector(`[data-element-id="${id}"]`) as HTMLElement;
    return { ...utils, props, surface, elementNode };
};

afterEach(() => vi.restoreAllMocks());

describe('Canvas touch mode', () => {
    it('selects the tapped element without starting a drag', () => {
        const { props, elementNode } = renderCanvas();
        pointer(elementNode('b'), 'pointerdown', 1, 210, 210);
        pointer(elementNode('b'), 'pointerup', 1, 210, 210);
        expect(props.onSelectElements).toHaveBeenLastCalledWith(['b']);
        expect(props.onUpdateElements).not.toHaveBeenCalled();
    });

    it('clears the selection when empty canvas is tapped', () => {
        const { props, surface } = renderCanvas({ selectedElementIds: ['a'] });
        pointer(surface, 'pointerdown', 1, 450, 650);
        pointer(surface, 'pointerup', 1, 450, 650);
        expect(props.onSelectElements).toHaveBeenLastCalledWith([]);
    });

    it('moves the selected element with a one-finger drag, saving history once', () => {
        const { props, elementNode } = renderCanvas({ selectedElementIds: ['a'] });
        pointer(elementNode('a'), 'pointerdown', 1, 30, 30);
        pointer(elementNode('a'), 'pointermove', 1, 60, 50);
        pointer(elementNode('a'), 'pointerup', 1, 60, 50);
        const moved = props.onUpdateElements.mock.calls.at(-1)![0].find((el: TemplateElement) => el.id === 'a');
        expect(moved).toMatchObject({ x: 50, y: 40 });
        expect(props.onInteractionStart).toHaveBeenCalledTimes(1);
    });

    it('pans instead of moving when dragging an unselected element', () => {
        const { props, surface, elementNode } = renderCanvas({ selectedElementIds: ['a'] });
        trackScroll(surface, 100, 0);
        pointer(elementNode('b'), 'pointerdown', 1, 210, 210);
        pointer(elementNode('b'), 'pointermove', 1, 180, 210);
        pointer(elementNode('b'), 'pointerup', 1, 180, 210);
        expect(props.onUpdateElements).not.toHaveBeenCalled();
        expect(surface.scrollLeft).toBe(130);
    });

    it('resizes through an enlarged touch handle', () => {
        const { props, container } = renderCanvas({ selectedElementIds: ['a'] });
        const handle = container.querySelector('[data-resize-handle="se"]') as HTMLElement;
        expect(handle.style.width).toBe('44px');
        expect(container.querySelector('[data-rotate-handle]')).toBeNull();
        expect(container.querySelector('[data-pivot-handle]')).toBeNull();
        pointer(handle, 'pointerdown', 1, 120, 80);
        pointer(handle, 'pointermove', 1, 150, 100);
        pointer(handle, 'pointerup', 1, 150, 100);
        const resized = props.onUpdateElements.mock.calls.at(-1)![0].find((el: TemplateElement) => el.id === 'a');
        expect(resized.w).toBeGreaterThan(100);
        expect(resized.h).toBeGreaterThan(60);
    });

    it('keeps desktop handles and mouse behaviour in mouse mode', () => {
        const { container } = renderCanvas({ inputMode: 'mouse', selectedElementIds: ['a'] });
        expect(container.querySelector('[data-rotate-handle]')).not.toBeNull();
        expect((container.querySelector('.canvas-scroll-container') as HTMLElement).style.touchAction).toBe('');
    });
});
```

Existing desktop canvas tests (`tests/unit/*Canvas*.test.tsx`) are the regression guard for mouse mode. Run them in Step 5.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/canvasTouch.test.tsx`
Expected: FAIL (`inputMode` is ignored, taps do nothing).

- [ ] **Step 3: Touch-aware `SelectionHandles`**

In `components/canvas/SelectionHandles.tsx`:

```tsx
export const TOUCH_HANDLE_PX = 44;

export const SelectionHandles: React.FC<{ element: TemplateElement; touchScale?: number }> = ({ element, touchScale }) => {
    if (touchScale !== undefined) return <TouchSelectionHandles element={element} scale={touchScale} />;
    return ( /* existing JSX, unchanged */ );
};

// Touch variant: each handle is a transparent 44-screen-px square carrying data-resize-handle,
// centred on the visual handle; the visual is pointer-events-none so the square is the event target.
// No rotate or pivot handles on touch (out of scope).
const TouchSelectionHandles: React.FC<{ element: TemplateElement; scale: number }> = ({ element, scale }) => {
    const size = TOUCH_HANDLE_PX / (scale > 0 ? scale : 1);
    const zone = (handle: string, left: string, top: string) => (
        <div
            key={handle}
            data-resize-handle={handle}
            className="absolute z-20"
            style={{ left, top, width: size, height: size, transform: 'translate(-50%, -50%)' }}
        >
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-blue-500 bg-white" />
        </div>
    );
    if (element.type === 'line') {
        return (
            <div className="pointer-events-auto">
                {zone('start', '0%', element.flip ? '100%' : '0%')}
                {zone('end', '100%', element.flip ? '0%' : '100%')}
            </div>
        );
    }
    return (
        <div className="pointer-events-auto">
            {zone('nw', '0%', '0%')}{zone('n', '50%', '0%')}{zone('ne', '100%', '0%')}
            {zone('w', '0%', '50%')}{zone('e', '100%', '50%')}
            {zone('sw', '0%', '100%')}{zone('s', '50%', '100%')}{zone('se', '100%', '100%')}
        </div>
    );
};
```

In `Canvas.tsx`, change the selection-overlay handle render from `<SelectionHandles element={el} />` to `<SelectionHandles element={el} touchScale={isTouch ? scale : undefined} />`.

- [ ] **Step 4: Canvas touch routing**

In `components/Canvas.tsx`:

1. Imports:

```tsx
import { useCanvasTouchGestures, TouchGestureHandlers } from '../hooks/useCanvasTouchGestures';
```

2. `CanvasProps`: add `inputMode?: 'mouse' | 'touch';`. Destructure it with default `inputMode = 'mouse'` and add `const isTouch = inputMode === 'touch';`.

3. Replace `getMouseCoords` with a client-point helper plus a wrapper (identical maths):

```tsx
const clientToCanvas = (clientX: number, clientY: number) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
};
const getMouseCoords = (e: MouseEvent) => clientToCanvas(e.clientX, e.clientY);
```

4. After `handleMouseUp` is defined, add the touch handlers:

```tsx
const CREATION_TOOLS = ['rect', 'ellipse', 'triangle', 'text', 'grid', 'line'];
const asMouse = (event: PointerEvent) => event as unknown as MouseEvent;
const topElementAt = (clientX: number, clientY: number) =>
    hitTestPoint(clientToCanvas(clientX, clientY), elements, template.layers, nodes, currentNodeId)[0];

const touchHandlers: TouchGestureHandlers = {
    claimDirectDrag: event => {
        if (CREATION_TOOLS.includes(tool)) return true;
        if (tool !== 'select') return false;
        const target = event.target as HTMLElement;
        if (target.closest('[data-resize-handle]')) return singleSelectedTransformable;
        if (selectedElementIds.length === 0) return false;
        const stack = hitTestPoint(clientToCanvas(event.clientX, event.clientY), elements, template.layers, nodes, currentNodeId);
        return stack.some(el => selectedElementIds.includes(el.id));
    },
    onDirectDown: event => handleMouseDown(asMouse(event)),
    onDirectMove: event => handleMouseMove(asMouse(event)),
    onDirectUp: event => handleMouseUp(asMouse(event)),
    onTap: ({ clientX, clientY }) => {
        if (tool !== 'select' && tool !== 'hand') return;
        const top = topElementAt(clientX, clientY);
        onSelectElements(top ? [top.id] : []);
    },
    onDoubleTap: () => {},            // Task 7
    onLongPress: () => {},            // Task 7
    onPan: (dx, dy) => {
        const outer = outerContainerRef.current;
        if (!outer) return;
        outer.scrollLeft -= dx;
        outer.scrollTop -= dy;
    },
    onPinch: () => {},                // Task 7
};
useCanvasTouchGestures(outerContainerRef, touchHandlers, isTouch);
```

Every hook this plan adds to `Canvas` (here and in Tasks 7 and 13) must run on every render. If `Canvas` has an early `return` before `handleMouseUp`, put the hook calls above it and define the handlers they use as plain functions above it too.

`hitTestPoint` already skips hidden and locked layers, which matches desktop click rules.

5. On the outer container `div` (`ref={outerContainerRef}`), merge touch styles into `style` and keep the mouse handlers bound. Real mice and trackpads on tablets still use them; touch never reaches them because the hook calls `preventDefault` on `pointerdown`.

```tsx
style={{ cursor: containerCursor, ...(isTouch ? { touchAction: 'none', WebkitTouchCallout: 'none' } : {}) }}
```

6. On the inner wrapper `<div className="m-auto p-12 min-w-fit min-h-fit">`, use `className={isTouch ? 'm-auto p-4 min-w-fit min-h-fit' : 'm-auto p-12 min-w-fit min-h-fit'}`.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/canvasTouch.test.tsx && npx vitest run tests/unit --reporter=dot 2>&1 | tail -5`
Expected: new tests PASS; the full suite shows no failures beyond the Task 0 baseline. The desktop snapshot is unchanged.

- [ ] **Step 6: Commit**

```bash
git add components/Canvas.tsx components/canvas/SelectionHandles.tsx tests/unit/canvasTouch.test.tsx
git commit -m "feat(canvas): touch select, move, resize and pan"
```

---

### Task 7: Canvas touch mode — create, double-tap, long-press, pinch, fit

**Files:**
- Modify: `components/Canvas.tsx`, `components/canvas/SelectUnderMenu.tsx`
- Test: `tests/unit/canvasTouch.test.tsx` (extend)

**Interfaces:**
- Produces: `CanvasProps.fitSignal?: number`. Whenever it changes and is truthy in touch mode, Canvas calls `onZoom(fitScale)`. Also exports `TOUCH_CANVAS_GUTTER = 16` and `TOUCH_DEFAULT_SIZE` from `Canvas.tsx`.

- [ ] **Step 1: Add failing tests** to `tests/unit/canvasTouch.test.tsx`:

```tsx
describe('Canvas touch creation and gestures', () => {
    it('creates a default-size rect when tapping with the rect tool', () => {
        const { props, surface } = renderCanvas({ tool: 'rect', elements: [] });
        pointer(surface, 'pointerdown', 1, 300, 400);
        pointer(surface, 'pointerup', 1, 300, 400);
        const created = props.onUpdateElements.mock.calls.at(-1)![0][0];
        expect(created).toMatchObject({ type: 'rect', x: 300, y: 400, w: 120, h: 80 });
    });

    it('draws a text box by dragging with the text tool', () => {
        const { props, surface } = renderCanvas({ tool: 'text', elements: [] });
        pointer(surface, 'pointerdown', 1, 100, 100);
        pointer(surface, 'pointermove', 1, 260, 140);
        pointer(surface, 'pointerup', 1, 260, 140);
        expect(props.onUpdateElements.mock.calls.at(-1)![0][0]).toMatchObject({ type: 'text', w: 160, h: 40 });
    });

    it('starts inline editing on double tap of a text element', () => {
        const text: TemplateElement = {
            id: 't', type: 'text', x: 20, y: 20, w: 200, h: 40, rotation: 0, layerId: 'l1',
            fill: '', stroke: '', strokeWidth: 0, opacity: 1, text: 'Hello', fontSize: 16,
            fontFamily: 'helvetica', textOverflow: 'clip', textWrap: true,
        };
        const { container, elementNode } = renderCanvas({ elements: [text] });
        for (let i = 0; i < 2; i++) {
            pointer(elementNode('t'), 'pointerdown', i + 1, 40, 30);
            pointer(elementNode('t'), 'pointerup', i + 1, 40, 30);
        }
        expect(container.querySelector('[contenteditable="true"]')).not.toBeNull();
    });

    it('opens the select-under menu on long press over stacked elements', () => {
        vi.useFakeTimers();
        const { elementNode, getByTestId } = renderCanvas({ elements: [rect('a', 20, 20), rect('c', 40, 30)] });
        pointer(elementNode('c'), 'pointerdown', 1, 60, 50);
        act(() => { vi.advanceTimersByTime(600); });
        expect(getByTestId('select-under-menu')).toBeTruthy();
        vi.useRealTimers();
    });

    it('zooms around the pinch centre via onZoom', () => {
        const { props, surface } = renderCanvas({ scale: 1 });
        pointer(surface, 'pointerdown', 1, 100, 100);
        pointer(surface, 'pointerdown', 2, 200, 100);
        pointer(surface, 'pointermove', 2, 300, 100);
        expect(props.onZoom).toHaveBeenLastCalledWith(2);
    });

    it('fits the page width when fitSignal changes', () => {
        const { props, surface, rerender } = renderCanvas({ fitSignal: 1 });
        Object.defineProperty(surface, 'clientWidth', { configurable: true, value: 532 });
        rerender(<Canvas {...props} fitSignal={2} />);
        expect(props.onZoom).toHaveBeenLastCalledWith((532 - 2 * 16) / 500);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/canvasTouch.test.tsx`
Expected: the six new tests FAIL.

- [ ] **Step 3: Implement in `Canvas.tsx`**

1. Add `fitSignal?: number;` to `CanvasProps` and destructure it.

2. Module-level constants:

```tsx
export const TOUCH_CANVAS_GUTTER = 16;
export const TOUCH_DEFAULT_SIZE: Record<string, { w: number; h: number }> = {
    rect: { w: 120, h: 80 }, ellipse: { w: 120, h: 80 }, triangle: { w: 120, h: 100 },
    grid: { w: 240, h: 120 }, line: { w: 120, h: 0 },
};
```

3. Tap-to-create default size. In `handleMouseUp`, immediately after `let { x, y, w, h, start, current } = bounds;`:

```tsx
if (isTouch && tool !== 'text' && w < MIN_DRAG_THRESHOLD && h < MIN_DRAG_THRESHOLD && TOUCH_DEFAULT_SIZE[tool]) {
    ({ w, h } = TOUCH_DEFAULT_SIZE[tool]);
    current = { x: start.x + w, y: start.y + h };
}
```

(`x`/`y` already equal the tap point. Desktop is unaffected because `isTouch` is false.)

4. Extract the zoom maths from the wheel handler into a helper, and make the wheel handler call it:

```tsx
const zoomAroundClientPoint = (clientX: number, clientY: number, requested: number) => {
    const el = outerContainerRef.current;
    if (!el) return;
    const newScale = Math.max(0.2, Math.min(10, requested));
    if (Math.abs(newScale - scale) <= 0.001) return;
    const rect = el.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    zoomTarget.current = { mx, my, cx: (mx + el.scrollLeft) / scale, cy: (my + el.scrollTop) / scale };
    onZoom(newScale);
};
```

In the wheel handler, replace the body after `e.preventDefault();` with `zoomAroundClientPoint(e.clientX, e.clientY, scale * (1 - e.deltaY * 0.002));`. This is the same formula as before: `1 + (-deltaY * 0.002)`.

5. Extract the select-under opening:

```tsx
const openSelectUnderMenuAt = (clientX: number, clientY: number) => {
    const stack = hitTestPoint(clientToCanvas(clientX, clientY), elements, template.layers, nodes, currentNodeId);
    if (stack.length === 0) return false;
    setSelectUnderMenu({ x: clientX, y: clientY, stack });
    return true;
};
const handleContextMenu = (e: MouseEvent) => {
    if (tool !== 'select') return;
    if (openSelectUnderMenuAt(e.clientX, e.clientY)) e.preventDefault();
};
```

6. Extract editing entry, and use it from the existing `CanvasElement onDoubleClick`:

```tsx
const beginEditing = (element: TemplateElement) => {
    const layer = element.layerId ? template.layers?.find(item => item.id === element.layerId) : undefined;
    if (!layer?.locked) setEditingElementId(element.id);
};
```

Change `onDoubleClick={() => { … }}` to `onDoubleClick={() => beginEditing(element)}`.

7. Fill in the Task 6 stubs, and make `onTap` also commit an active edit:

```tsx
const pinchScaleRef = useRef<number | null>(null);
useEffect(() => { pinchScaleRef.current = null; }, [scale]);

// inside touchHandlers:
onTap: ({ clientX, clientY }) => {
    if (editingElementId) {
        (document.activeElement as HTMLElement | null)?.blur?.();
        setEditingElementId(null);
    }
    if (tool !== 'select' && tool !== 'hand') return;
    const top = topElementAt(clientX, clientY);
    onSelectElements(top ? [top.id] : []);
},
onDoubleTap: ({ clientX, clientY }) => {
    const top = topElementAt(clientX, clientY);
    if (!top || top.type !== 'text') return;
    onSelectElements([top.id]);
    beginEditing(top);
},
onLongPress: ({ clientX, clientY }) => {
    if (tool === 'select') openSelectUnderMenuAt(clientX, clientY);
},
onPinch: (factor, centerX, centerY) => {
    const base = pinchScaleRef.current ?? scale;
    const next = Math.max(0.2, Math.min(10, base * factor));
    pinchScaleRef.current = next;
    zoomAroundClientPoint(centerX, centerY, next);
},
```

8. Fit effect:

```tsx
useEffect(() => {
    if (!isTouch || !fitSignal) return;
    const outer = outerContainerRef.current;
    if (!outer || template.width <= 0) return;
    const available = outer.clientWidth - 2 * TOUCH_CANVAS_GUTTER;
    if (available <= 0) return;
    onZoom(Math.max(0.2, Math.min(10, available / template.width)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
}, [fitSignal, isTouch, template.width]);
```

- [ ] **Step 4: `SelectUnderMenu` works with touch**

In `components/canvas/SelectUnderMenu.tsx`:
- Outside-close: change `window.addEventListener('mousedown', onDown)` and its removal to `'pointerdown'`, and type `onDown` as `(e: PointerEvent)`. Mouse behaviour is unchanged, because `pointerdown` fires just before `mousedown`.
- Add `data-touch-gesture-ignore` to the menu root `div` (next to `data-testid="select-under-menu"`), so taps on the menu don't reach the canvas gesture hook.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/canvasTouch.test.tsx && npx vitest run tests/unit --reporter=dot 2>&1 | tail -5`
Expected: PASS; no failures beyond the Task 0 baseline. The existing `SelectUnderMenu` tests still pass (they use mouse events: if one fires only `mousedown` for outside-close, change it to `pointerdown` in the test and note it in the commit message).

- [ ] **Step 6: Commit**

```bash
git add components/Canvas.tsx components/canvas/SelectUnderMenu.tsx tests/unit
git commit -m "feat(canvas): touch create, double-tap edit, long-press menu, pinch and fit"
```

---

### Task 8: Local touch zoom (never persisted)

**Files:**
- Create: `components/editor-layout/useTouchViewport.ts`
- Modify: `components/ProjectEditor.tsx`
- Test: `tests/unit/ProjectEditor.touchZoom.test.tsx`

**Interfaces:**
- Produces: `useTouchViewport(): { scale: number; setScale: (s: number) => void; fitSignal: number; requestFit: () => void }`.

- [ ] **Step 1: Write the failing test**

```tsx
import React from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AppState } from '../../types';

let canvasProps: any = null;
vi.mock('../../components/Canvas', () => ({ Canvas: (props: any) => { canvasProps = props; return <div />; } }));
vi.mock('../../components/Sidebar', () => ({ Sidebar: () => <div /> }));
vi.mock('../../components/PropertiesPanel', () => ({ PropertiesPanel: () => <div /> }));
vi.mock('../../components/LayersPanel', () => ({ LayersPanel: () => <div /> }));
vi.mock('../../components/CollapsibleSection', () => ({ CollapsibleSection: () => <div /> }));
vi.mock('../../components/JsonModal', () => ({ JsonModal: () => null }));
vi.mock('../../components/NodeSelectorModal', () => ({ NodeSelectorModal: () => null }));
vi.mock('../../components/DeleteConfirmModal', () => ({ DeleteConfirmModal: () => null }));
vi.mock('../../components/SavePresetModal', () => ({ SavePresetModal: () => null }));
vi.mock('../../components/NewVariantModal', () => ({ NewVariantModal: () => null }));
vi.mock('../../components/EditorToolbar', () => ({ EditorToolbar: () => <div /> }));
vi.mock('../../components/HierarchyGeneratorModal', () => ({ HierarchyGeneratorModal: () => null }));

import { ProjectEditor } from '../../components/ProjectEditor';
import { FormFactorProvider } from '../../components/editor-layout/FormFactorContext';
import { editorState } from '../helpers/editorFixtures';

const state = editorState({ scale: 1.5 });

const renderEditor = (formFactor: 'desktop' | 'phone', onStateChange = vi.fn()) => {
    render(
        <FormFactorProvider value={formFactor}>
            <ProjectEditor projectId="p" projectName="Root" initialState={state} isActive
                onNameChange={() => {}} onStateChange={onStateChange}
                onCreateGeneratedProject={async () => false} onSaveCustomPreset={async () => false} />
        </FormFactorProvider>,
    );
    return onStateChange;
};

describe('touch zoom isolation', () => {
    it('keeps phone zoom out of the persisted project state', () => {
        const onStateChange = renderEditor('phone');
        expect(canvasProps.inputMode).toBe('touch');
        act(() => canvasProps.onZoom(3));
        expect(canvasProps.scale).toBe(3);
        const persisted = onStateChange.mock.calls.map(([s]) => s as AppState);
        expect(persisted.every(s => s.scale === 1.5 && s.sidebarWidth === 280 && s.propertiesPanelWidth === 320)).toBe(true);
    });

    it('keeps desktop zoom writing to state.scale', () => {
        const onStateChange = renderEditor('desktop');
        expect(canvasProps.inputMode).toBe('mouse');
        act(() => canvasProps.onZoom(2));
        expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ scale: 2 }));
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/ProjectEditor.touchZoom.test.tsx`
Expected: FAIL — `inputMode` is undefined.

- [ ] **Step 3: Implement**

`components/editor-layout/useTouchViewport.ts`:

```ts
import { useCallback, useState } from 'react';

export function useTouchViewport() {
    const [scale, setScale] = useState(1);
    const [fitSignal, setFitSignal] = useState(1);
    const requestFit = useCallback(() => setFitSignal(n => n + 1), []);
    return { scale, setScale, fitSignal, requestFit };
}
```

In `ProjectEditor.tsx`:

```tsx
import { useTouchViewport } from './editor-layout/useTouchViewport';
// body:
const isTouch = formFactor !== 'desktop';
const touchViewport = useTouchViewport();
```

In `canvasElement`, change the zoom props and add the touch props:

```tsx
scale={isTouch ? touchViewport.scale : state.scale}
onZoom={isTouch ? touchViewport.setScale : (newScale) => setState(s => ({ ...s, scale: newScale }))}
inputMode={isTouch ? 'touch' : 'mouse'}
fitSignal={isTouch ? touchViewport.fitSignal : undefined}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/ProjectEditor.touchZoom.test.tsx tests/unit/ProjectEditor.desktopLayout.test.tsx`
Expected: PASS; snapshot unchanged.

- [ ] **Step 5: Commit**

```bash
git add components/editor-layout/useTouchViewport.ts components/ProjectEditor.tsx tests/unit/ProjectEditor.touchZoom.test.tsx
git commit -m "feat(editor): keep touch zoom local so it never persists"
```

---

### Task 9: Scoped touch CSS + hover-reveal guard

**Files:**
- Modify: `index.html` (inside the existing `<style>` block, at the end)
- Test: `tests/unit/touchCss.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync('index.html', 'utf8');
const HOVER_FILES = [
    'components/sidebar/NodeItem.tsx', 'components/sidebar/TemplateItem.tsx', 'components/TabBar.tsx',
    'components/json/JsonTreeItem.tsx', 'components/json/MainCollectionItem.tsx',
    'components/properties/SingleElementEditor.tsx', 'components/properties/TextPaddingControls.tsx',
];

describe('touch CSS', () => {
    it('scopes every touch rule under data-form-factor', () => {
        const block = html.slice(html.indexOf('/* touch-editor:start */'), html.indexOf('/* touch-editor:end */'));
        expect(block.length).toBeGreaterThan(0);
        const selectors = block.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g) ?? [];
        for (const selector of selectors) {
            for (const part of selector.split(',')) expect(part.trim()).toMatch(/^\[data-form-factor/);
        }
    });

    it('declares 44px targets, 16px form controls, hover reveal and dialog rules', () => {
        expect(html).toMatch(/min-height:\s*44px/);
        expect(html).toMatch(/font-size:\s*16px/);
        expect(html).toContain('group-hover:opacity-100');
        expect(html).toContain('group-hover:flex');
        expect(html).toContain('.editor-dialog-panel');
    });

    it('only uses hover-reveal patterns the touch CSS knows about', () => {
        const known = /(opacity-0 group-hover:opacity-100|hidden group-hover:flex|pointer-events-none[^"'`]*opacity-0)/;
        for (const file of HOVER_FILES) {
            const source = readFileSync(file, 'utf8');
            const uses = source.match(/className=["'`{][^"'`]*group-hover:[^"'`]*/g) ?? [];
            for (const use of uses) {
                if (/opacity-0|\bhidden\b/.test(use)) expect(use, `${file}: ${use}`).toMatch(known);
            }
        }
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/touchCss.test.ts`
Expected: FAIL — markers missing.

- [ ] **Step 3: Add the CSS** at the end of the `<style>` block in `index.html`:

```css
      /* touch-editor:start — rules apply only when the editor runs on a touch-first device */
      [data-form-factor] button,
      [data-form-factor] [role="button"],
      [data-form-factor] select {
        min-height: 44px;
        min-width: 44px;
      }
      [data-form-factor] input,
      [data-form-factor] select,
      [data-form-factor] textarea {
        font-size: 16px;
      }
      [data-form-factor] .opacity-0[class~="group-hover:opacity-100"]:not(.pointer-events-none) {
        opacity: 1;
      }
      [data-form-factor] .hidden[class~="group-hover:flex"] {
        display: flex;
      }
      [data-form-factor="phone"] :has(> .editor-dialog-panel),
      [data-form-factor] :has(> .editor-dialog-panel.generator-dialog-panel) {
        padding: 0;
      }
      [data-form-factor="phone"] .editor-dialog-panel,
      [data-form-factor] .editor-dialog-panel.generator-dialog-panel {
        width: 100vw;
        max-width: none;
        height: 100dvh;
        max-height: none;
        border-radius: 0;
      }
      /* touch-editor:end */
```

The 44px rule is intentionally broad inside the editor on touch. Canvas handles are already sized in Task 6 and aren't buttons.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/touchCss.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/unit/touchCss.test.ts
git commit -m "feat(editor): scoped touch CSS for targets, inputs, hover controls and dialogs"
```

---

### Task 10: Drawer and bottom sheet

**Files:**
- Create: `components/editor-layout/SidebarDrawer.tsx`, `components/editor-layout/PropertiesSheet.tsx`
- Test: `tests/unit/editorLayoutPanels.test.tsx`

**Interfaces:**
- Produces:

```ts
SidebarDrawer: React.FC<{ open: boolean; onClose: () => void; children: React.ReactNode }>
export type SheetDetent = 'peek' | 'half' | 'full';
export const SHEET_PEEK_PX = 72;
PropertiesSheet: React.FC<{ detent: SheetDetent; onDetentChange: (d: SheetDetent) => void; title: string; actions?: React.ReactNode; children: React.ReactNode }>
```

- [ ] **Step 1: Write the failing tests**

```tsx
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarDrawer } from '../../components/editor-layout/SidebarDrawer';
import { PropertiesSheet, SHEET_PEEK_PX } from '../../components/editor-layout/PropertiesSheet';

describe('SidebarDrawer', () => {
    it('renders children only while open and closes on backdrop and Escape', () => {
        const onClose = vi.fn();
        const { rerender } = render(<SidebarDrawer open={false} onClose={onClose}><p>tree</p></SidebarDrawer>);
        expect(screen.queryByText('tree')).toBeNull();
        rerender(<SidebarDrawer open onClose={onClose}><p>tree</p></SidebarDrawer>);
        expect(screen.getByRole('dialog', { name: 'Pages and templates' })).toBeTruthy();
        fireEvent.click(screen.getByTestId('sidebar-drawer-backdrop'));
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(2);
    });
});

describe('PropertiesSheet', () => {
    it('shows peek height and cycles detents from the grabber', () => {
        const onDetentChange = vi.fn();
        render(<PropertiesSheet detent="peek" onDetentChange={onDetentChange} title="Rectangle"><p>props</p></PropertiesSheet>);
        const sheet = screen.getByTestId('properties-sheet');
        expect(sheet.style.height).toBe(`${SHEET_PEEK_PX}px`);
        expect(screen.getByText('Rectangle')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Resize properties sheet' }));
        expect(onDetentChange).toHaveBeenCalledWith('half');
    });

    it('uses dynamic viewport heights for half and full', () => {
        const { rerender } = render(<PropertiesSheet detent="half" onDetentChange={() => {}} title="x"><p /></PropertiesSheet>);
        expect(screen.getByTestId('properties-sheet').style.height).toBe('50dvh');
        rerender(<PropertiesSheet detent="full" onDetentChange={() => {}} title="x"><p /></PropertiesSheet>);
        expect(screen.getByTestId('properties-sheet').style.height).toBe('calc(100dvh - 56px)');
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/editorLayoutPanels.test.tsx` → FAIL (modules missing).

- [ ] **Step 3: Implement**

`SidebarDrawer.tsx`:

```tsx
import React, { useEffect } from 'react';

export function SidebarDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;
    return (
        <div className="absolute inset-0 z-40 flex">
            <div role="dialog" aria-modal="true" aria-label="Pages and templates"
                className="relative flex h-full w-[min(85vw,320px)] flex-col bg-white shadow-2xl">
                {children}
            </div>
            <div data-testid="sidebar-drawer-backdrop" className="flex-1 bg-black/30" onClick={onClose} />
        </div>
    );
}
```

`PropertiesSheet.tsx`:

```tsx
import React, { useRef } from 'react';

export type SheetDetent = 'peek' | 'half' | 'full';
export const SHEET_PEEK_PX = 72;
const HEIGHT: Record<SheetDetent, string> = {
    peek: `${SHEET_PEEK_PX}px`, half: '50dvh', full: 'calc(100dvh - 56px)',
};
const NEXT: Record<SheetDetent, SheetDetent> = { peek: 'half', half: 'full', full: 'peek' };

export function PropertiesSheet({ detent, onDetentChange, title, actions, children }: {
    detent: SheetDetent; onDetentChange: (d: SheetDetent) => void; title: string;
    actions?: React.ReactNode; children: React.ReactNode;
}) {
    const dragStartY = useRef<number | null>(null);
    const suppressClick = useRef(false);

    const onPointerDown = (event: React.PointerEvent) => { dragStartY.current = event.clientY; };
    const onPointerUp = (event: React.PointerEvent) => {
        const startY = dragStartY.current;
        dragStartY.current = null;
        if (startY === null || Math.abs(event.clientY - startY) < 24) return; // a tap: let onClick cycle
        suppressClick.current = true; // browsers still fire click after a drag that ends on the button
        const fromTop = event.clientY / window.innerHeight;
        onDetentChange(fromTop > 0.75 ? 'peek' : fromTop > 0.3 ? 'half' : 'full');
    };
    const onClick = () => {
        if (suppressClick.current) { suppressClick.current = false; return; }
        onDetentChange(NEXT[detent]);
    };

    return (
        <section data-testid="properties-sheet" aria-label="Properties"
            className="absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl border-t bg-white shadow-[0_-8px_24px_rgba(15,23,42,0.12)] transition-[height] duration-200"
            style={{ height: HEIGHT[detent] }}>
            <div className="flex items-center gap-2 px-3" style={{ minHeight: SHEET_PEEK_PX }}>
                <button type="button" aria-label="Resize properties sheet"
                    className="flex flex-1 items-center gap-3 text-left touch-none"
                    onPointerDown={onPointerDown} onPointerUp={onPointerUp} onClick={onClick}>
                    <span className="h-1.5 w-10 shrink-0 rounded-full bg-slate-300" />
                    <span className="truncate text-sm font-semibold text-slate-700">{title}</span>
                </button>
                {actions}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto" hidden={detent === 'peek'}>{children}</div>
        </section>
    );
}
```

A drag that moves more than 24px lands on a detent, and the click that follows it is swallowed. A short tap is handled by `onClick`, which cycles to the next detent.

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add components/editor-layout/SidebarDrawer.tsx components/editor-layout/PropertiesSheet.tsx tests/unit/editorLayoutPanels.test.tsx
git commit -m "feat(editor): sidebar drawer and properties bottom sheet"
```

---

### Task 11: Touch chrome components

**Files:**
- Create: `components/editor-layout/EditorChromeContext.tsx`, `TouchToolButtons.tsx`, `OverflowMenu.tsx`, `ProjectSwitcher.tsx`, `PhoneTopBar.tsx`, `TabletToolbar.tsx`
- Create: `services/previewNodes.ts`
- Create: `tests/helpers/touchActions.ts`
- Test: `tests/unit/touchChrome.test.tsx`, `tests/unit/previewNodes.test.ts`

**Interfaces:**
- Consumes: `TouchEditorActions` (Task 4).
- Produces:

```ts
// EditorChromeContext.tsx
export interface EditorChrome {
    projects: { id: string; name: string }[];
    activeProjectId: string | null;
    onSelectProject: (id: string) => void;
    onCloseProject: (id: string) => void;
    onNewProject: () => void;
    saveStatus: React.ReactNode;
    cloudMenu: React.ReactNode;
    accountMenu: React.ReactNode;
}
export const EditorChromeContext: React.Context<EditorChrome | null>;
export const useEditorChrome: () => EditorChrome | null;

// previewNodes.ts
export function listPreviewNodes(state: AppState, effectivePreviewNodeId: string): { options: { id: string; title: string }[]; selectedId: string } | null;

// components
TouchToolButtons: React.FC<{ actions: TouchEditorActions; showFit?: boolean }>
OverflowMenu: React.FC<{ open: boolean; onClose: () => void; actions: TouchEditorActions; chrome: EditorChrome | null }>
ProjectSwitcher: React.FC<{ chrome: EditorChrome }>
PhoneTopBar: React.FC<{ actions: TouchEditorActions; onOpenSidebar: () => void }>
TabletToolbar: React.FC<{ actions: TouchEditorActions; onOpenSidebar: () => void }>
```

- [ ] **Step 1: Write the failing tests**

`tests/unit/previewNodes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { listPreviewNodes } from '../../services/previewNodes';

const base: any = {
    viewMode: 'templates', selectedTemplateId: 'day',
    nodes: {
        root: { id: 'root', type: 'cover', title: 'Cover' },
        d1: { id: 'd1', type: 'day', title: 'Mon' },
        d2: { id: 'd2', type: 'day', title: 'Tue' },
    },
};

describe('listPreviewNodes', () => {
    it('lists nodes using the selected template in templates view', () => {
        expect(listPreviewNodes(base, 'd2')).toEqual({
            options: [{ id: 'd1', title: 'Mon' }, { id: 'd2', title: 'Tue' }], selectedId: 'd2',
        });
    });
    it('returns null outside templates view or with no matching nodes', () => {
        expect(listPreviewNodes({ ...base, viewMode: 'hierarchy' }, 'root')).toBeNull();
        expect(listPreviewNodes({ ...base, selectedTemplateId: 'none' }, 'root')).toBeNull();
    });
});
```

`tests/helpers/touchActions.ts` (reused by Task 12):

```ts
import { vi } from 'vitest';
import type { TouchEditorActions } from '../../components/editor-layout/touchActions';

export const makeActions = (overrides: Partial<TouchEditorActions> = {}): TouchEditorActions => ({
    undo: vi.fn(), redo: vi.fn(), canUndo: true, canRedo: false,
    exportPdf: vi.fn(), exportAllVariants: vi.fn(), canExportAllVariants: true, isExporting: false,
    greyscale: false, toggleGreyscale: vi.fn(), openJson: vi.fn(), openGenerator: vi.fn(), savePreset: vi.fn(),
    importSvg: vi.fn(), insertSvgPlaceholder: vi.fn(), snapToGrid: false, toggleSnap: vi.fn(),
    showGrid: false, toggleGrid: vi.fn(), tool: 'select', setTool: vi.fn(), fitToWidth: vi.fn(),
    hasSelection: false, duplicateSelection: vi.fn(), deleteSelection: vi.fn(), preview: null,
    ...overrides,
});
```

`tests/unit/touchChrome.test.tsx`:

```tsx
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeActions } from '../helpers/touchActions';
import { TouchToolButtons } from '../../components/editor-layout/TouchToolButtons';
import { OverflowMenu } from '../../components/editor-layout/OverflowMenu';
import { PhoneTopBar } from '../../components/editor-layout/PhoneTopBar';
import { EditorChromeContext, EditorChrome } from '../../components/editor-layout/EditorChromeContext';

const chrome: EditorChrome = {
    projects: [{ id: 'a', name: 'Planner' }, { id: 'b', name: 'Notebook' }], activeProjectId: 'a',
    onSelectProject: vi.fn(), onCloseProject: vi.fn(), onNewProject: vi.fn(),
    saveStatus: <span>saved</span>, cloudMenu: <span>cloud-menu</span>, accountMenu: <span>account-menu</span>,
};

describe('TouchToolButtons', () => {
    it('offers select, hand, text, shapes and fit, and marks the active tool', () => {
        const actions = makeActions({ tool: 'text' });
        render(<TouchToolButtons actions={actions} showFit />);
        for (const name of ['Select', 'Pan', 'Text', 'Rectangle', 'Ellipse', 'Triangle', 'Line', 'Grid', 'Fit page to width']) {
            expect(screen.getByRole('button', { name })).toBeTruthy();
        }
        expect(screen.getByRole('button', { name: 'Text' }).getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
        expect(actions.setTool).toHaveBeenCalledWith('rect');
        fireEvent.click(screen.getByRole('button', { name: 'Fit page to width' }));
        expect(actions.fitToWidth).toHaveBeenCalled();
    });
});

describe('OverflowMenu', () => {
    it('groups project actions and reaches cloud and account menus', () => {
        const actions = makeActions({ hasSelection: true });
        render(<OverflowMenu open onClose={vi.fn()} actions={actions} chrome={chrome} />);
        fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
        fireEvent.click(screen.getByRole('button', { name: 'Duplicate selection' }));
        fireEvent.click(screen.getByRole('button', { name: 'Generator' }));
        expect(actions.exportPdf).toHaveBeenCalled();
        expect(actions.duplicateSelection).toHaveBeenCalled();
        expect(actions.openGenerator).toHaveBeenCalled();
        expect(screen.getByText('cloud-menu')).toBeTruthy();
        expect(screen.getByText('account-menu')).toBeTruthy();
    });

    it('hides the selection group with nothing selected', () => {
        render(<OverflowMenu open onClose={vi.fn()} actions={makeActions()} chrome={null} />);
        expect(screen.queryByRole('button', { name: 'Duplicate selection' })).toBeNull();
    });
});

describe('PhoneTopBar', () => {
    it('shows drawer, project switcher, save status, undo/redo and overflow', () => {
        const actions = makeActions();
        const onOpenSidebar = vi.fn();
        render(
            <EditorChromeContext.Provider value={chrome}>
                <PhoneTopBar actions={actions} onOpenSidebar={onOpenSidebar} />
            </EditorChromeContext.Provider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Open pages and templates' }));
        expect(onOpenSidebar).toHaveBeenCalled();
        expect(screen.getByText('saved')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Redo' })).toHaveProperty('disabled', true);
        fireEvent.click(screen.getByRole('button', { name: /Planner/ }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Notebook' }));
        expect(chrome.onSelectProject).toHaveBeenCalledWith('b');
        fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
        expect(screen.getByRole('button', { name: 'Export PDF' })).toBeTruthy();
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/touchChrome.test.tsx tests/unit/previewNodes.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`services/previewNodes.ts`:

```ts
import type { AppNode, AppState } from '../types';

export function listPreviewNodes(state: AppState, effectivePreviewNodeId: string) {
    if (state.viewMode !== 'templates') return null;
    const options = (Object.values(state.nodes) as AppNode[])
        .filter(node => node.type === state.selectedTemplateId)
        .map(node => ({ id: node.id, title: node.title }));
    if (options.length === 0) return null;
    return { options, selectedId: effectivePreviewNodeId };
}
```

`EditorChromeContext.tsx`:

```tsx
import React, { createContext, useContext } from 'react';

export interface EditorChrome {
    projects: { id: string; name: string }[];
    activeProjectId: string | null;
    onSelectProject: (id: string) => void;
    onCloseProject: (id: string) => void;
    onNewProject: () => void;
    saveStatus: React.ReactNode;
    cloudMenu: React.ReactNode;
    accountMenu: React.ReactNode;
}

export const EditorChromeContext = createContext<EditorChrome | null>(null);
export const useEditorChrome = () => useContext(EditorChromeContext);
```

`TouchToolButtons.tsx`:

```tsx
import React from 'react';
import clsx from 'clsx';
import { Circle, Grid3X3, Hand, Maximize2, Minus, MousePointer2, Square, Triangle, Type } from 'lucide-react';
import type { TouchEditorActions } from './touchActions';

const TOOLS = [
    { tool: 'select', label: 'Select', icon: MousePointer2 },
    { tool: 'hand', label: 'Pan', icon: Hand },
    { tool: 'text', label: 'Text', icon: Type },
    { tool: 'rect', label: 'Rectangle', icon: Square },
    { tool: 'ellipse', label: 'Ellipse', icon: Circle },
    { tool: 'triangle', label: 'Triangle', icon: Triangle },
    { tool: 'line', label: 'Line', icon: Minus },
    { tool: 'grid', label: 'Grid', icon: Grid3X3 },
];

export function TouchToolButtons({ actions, showFit = false }: { actions: TouchEditorActions; showFit?: boolean }) {
    return (
        <div className="flex items-center gap-0.5">
            {TOOLS.map(({ tool, label, icon: Icon }) => (
                <button key={tool} type="button" aria-label={label} aria-pressed={actions.tool === tool}
                    onClick={() => actions.setTool(tool)}
                    className={clsx('flex items-center justify-center rounded-lg',
                        actions.tool === tool ? 'bg-blue-600 text-white' : 'text-slate-600')}>
                    <Icon size={18} />
                </button>
            ))}
            {showFit && (
                <button type="button" aria-label="Fit page to width" onClick={actions.fitToWidth}
                    className="flex items-center justify-center rounded-lg text-slate-600">
                    <Maximize2 size={18} />
                </button>
            )}
        </div>
    );
}
```

`OverflowMenu.tsx`:

```tsx
import React, { useRef } from 'react';
import type { TouchEditorActions } from './touchActions';
import type { EditorChrome } from './EditorChromeContext';

const Item = ({ label, onClick, checked, disabled }: { label: string; onClick: () => void; checked?: boolean; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={checked}
        className="flex w-full items-center justify-between px-4 text-left text-sm text-slate-700 disabled:opacity-40">
        <span>{label}</span>
        {checked !== undefined && <span className="text-xs text-slate-400">{checked ? 'On' : 'Off'}</span>}
    </button>
);

const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="border-b border-slate-100 py-1">
        <h3 className="px-4 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
        {children}
    </section>
);

export function OverflowMenu({ open, onClose, actions, chrome }: {
    open: boolean; onClose: () => void; actions: TouchEditorActions; chrome: EditorChrome | null;
}) {
    const svgInput = useRef<HTMLInputElement>(null);
    if (!open) return null;
    const run = (fn: () => void) => () => { fn(); onClose(); };

    return (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/30" onClick={onClose}>
            <div role="dialog" aria-label="More actions" onClick={event => event.stopPropagation()}
                className="max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)]">
                {actions.hasSelection && (
                    <Group title="Selection">
                        <Item label="Duplicate selection" onClick={run(actions.duplicateSelection)} />
                        <Item label="Delete selection" onClick={run(actions.deleteSelection)} />
                    </Group>
                )}
                <Group title="Export">
                    <Item label="Export PDF" onClick={run(actions.exportPdf)} disabled={actions.isExporting} />
                    <Item label="Export all variants" onClick={run(actions.exportAllVariants)}
                        disabled={actions.isExporting || !actions.canExportAllVariants} />
                    <Item label="Greyscale export" onClick={actions.toggleGreyscale} checked={actions.greyscale} />
                </Group>
                <Group title="Canvas">
                    <Item label="Snap to grid" onClick={actions.toggleSnap} checked={actions.snapToGrid} />
                    <Item label="Show grid" onClick={actions.toggleGrid} checked={actions.showGrid} />
                    {actions.preview && (
                        <label className="flex items-center justify-between gap-3 px-4 text-sm text-slate-700">
                            <span>Preview node</span>
                            <select value={actions.preview.selectedId}
                                onChange={event => actions.preview!.onSelect(event.target.value)}
                                className="max-w-[55%] rounded border border-slate-200">
                                {actions.preview.options.map(option => (
                                    <option key={option.id} value={option.id}>{option.title}</option>
                                ))}
                            </select>
                        </label>
                    )}
                </Group>
                <Group title="Project">
                    <Item label="JSON" onClick={run(actions.openJson)} />
                    <Item label="Generator" onClick={run(actions.openGenerator)} />
                    <Item label="Save preset" onClick={run(actions.savePreset)} />
                    <Item label="Import SVG" onClick={() => svgInput.current?.click()} />
                    <Item label="Insert SVG placeholder" onClick={run(actions.insertSvgPlaceholder)} />
                    <input ref={svgInput} type="file" accept=".svg,image/svg+xml" hidden
                        onChange={event => {
                            const file = event.target.files?.[0];
                            if (file) { actions.importSvg(file); onClose(); }
                            event.target.value = '';
                        }} />
                </Group>
                {chrome && (
                    <>
                        <Group title="Cloud"><div className="px-4 py-2">{chrome.cloudMenu}</div></Group>
                        <Group title="Account"><div className="px-4 py-2">{chrome.accountMenu}</div></Group>
                    </>
                )}
            </div>
        </div>
    );
}
```

`ProjectSwitcher.tsx`:

```tsx
import React, { useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import type { EditorChrome } from './EditorChromeContext';

export function ProjectSwitcher({ chrome }: { chrome: EditorChrome }) {
    const [open, setOpen] = useState(false);
    const active = chrome.projects.find(project => project.id === chrome.activeProjectId);
    return (
        <div className="relative min-w-0 flex-1">
            <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)}
                className="flex max-w-full items-center gap-1 truncate text-sm font-semibold text-slate-800">
                <span className="truncate">{active?.name || 'Untitled'}</span>
                <ChevronDown size={16} className="shrink-0" />
            </button>
            {open && (
                <div role="menu" className="absolute left-0 top-full z-50 mt-1 w-64 rounded-xl border bg-white py-1 shadow-xl">
                    {chrome.projects.map(project => (
                        <div key={project.id} className="flex items-center">
                            <button type="button" role="menuitem" className="flex-1 truncate px-3 text-left text-sm"
                                onClick={() => { chrome.onSelectProject(project.id); setOpen(false); }}>
                                {project.name || 'Untitled'}
                            </button>
                            <button type="button" aria-label={`Close ${project.name || 'Untitled'}`}
                                onClick={() => { chrome.onCloseProject(project.id); setOpen(false); }}
                                className="flex items-center justify-center text-slate-400">
                                <X size={16} />
                            </button>
                        </div>
                    ))}
                    <button type="button" role="menuitem" className="flex w-full items-center gap-2 px-3 text-sm text-blue-600"
                        onClick={() => { chrome.onNewProject(); setOpen(false); }}>
                        <Plus size={16} /> New project
                    </button>
                </div>
            )}
        </div>
    );
}
```

`PhoneTopBar.tsx`:

```tsx
import React, { useState } from 'react';
import { Menu, MoreHorizontal, Redo2, Undo2 } from 'lucide-react';
import type { TouchEditorActions } from './touchActions';
import { useEditorChrome } from './EditorChromeContext';
import { ProjectSwitcher } from './ProjectSwitcher';
import { OverflowMenu } from './OverflowMenu';

export function PhoneTopBar({ actions, onOpenSidebar }: { actions: TouchEditorActions; onOpenSidebar: () => void }) {
    const chrome = useEditorChrome();
    const [menuOpen, setMenuOpen] = useState(false);
    return (
        <header className="z-20 flex h-12 shrink-0 items-center gap-1 border-b bg-white px-1">
            <button type="button" aria-label="Open pages and templates" onClick={onOpenSidebar}
                className="flex items-center justify-center text-slate-600"><Menu size={20} /></button>
            {chrome ? <ProjectSwitcher chrome={chrome} /> : <div className="flex-1" />}
            {chrome?.saveStatus}
            <button type="button" aria-label="Undo" onClick={actions.undo} disabled={!actions.canUndo}
                className="flex items-center justify-center text-slate-600 disabled:opacity-30"><Undo2 size={18} /></button>
            <button type="button" aria-label="Redo" onClick={actions.redo} disabled={!actions.canRedo}
                className="flex items-center justify-center text-slate-600 disabled:opacity-30"><Redo2 size={18} /></button>
            <button type="button" aria-label="More actions" onClick={() => setMenuOpen(true)}
                className="flex items-center justify-center text-slate-600"><MoreHorizontal size={20} /></button>
            <OverflowMenu open={menuOpen} onClose={() => setMenuOpen(false)} actions={actions} chrome={chrome} />
        </header>
    );
}
```

The spec shows save status as a compact dot. Reusing `LocalSaveStatus` keeps retry/download working; if it's too wide at 390px, the Task 16 layout assertion will catch it. In that case add a `compact` prop to `LocalSaveStatus` that hides its text label.

`TabletToolbar.tsx`:

```tsx
import React, { useState } from 'react';
import { Download, Menu, MoreHorizontal, Redo2, Undo2 } from 'lucide-react';
import type { TouchEditorActions } from './touchActions';
import { TouchToolButtons } from './TouchToolButtons';
import { OverflowMenu } from './OverflowMenu';

export function TabletToolbar({ actions, onOpenSidebar }: { actions: TouchEditorActions; onOpenSidebar: () => void }) {
    const [menuOpen, setMenuOpen] = useState(false);
    return (
        <div className="z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-white px-2">
            <button type="button" aria-label="Open pages and templates" onClick={onOpenSidebar}
                className="flex items-center justify-center text-slate-600"><Menu size={20} /></button>
            <TouchToolButtons actions={actions} showFit />
            <div className="flex-1" />
            <button type="button" aria-label="Undo" onClick={actions.undo} disabled={!actions.canUndo}
                className="flex items-center justify-center text-slate-600 disabled:opacity-30"><Undo2 size={18} /></button>
            <button type="button" aria-label="Redo" onClick={actions.redo} disabled={!actions.canRedo}
                className="flex items-center justify-center text-slate-600 disabled:opacity-30"><Redo2 size={18} /></button>
            <button type="button" onClick={actions.exportPdf} disabled={actions.isExporting}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white disabled:opacity-50">
                <Download size={16} /> Export PDF
            </button>
            <button type="button" aria-label="More actions" onClick={() => setMenuOpen(true)}
                className="flex items-center justify-center text-slate-600"><MoreHorizontal size={20} /></button>
            <OverflowMenu open={menuOpen} onClose={() => setMenuOpen(false)} actions={actions} chrome={null} />
        </div>
    );
}
```

Tablet keeps the desktop page header, so cloud and account are already reachable there and `chrome={null}` is correct.

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add components/editor-layout services/previewNodes.ts tests/helpers/touchActions.ts tests/unit/touchChrome.test.tsx tests/unit/previewNodes.test.ts
git commit -m "feat(editor): touch toolbars, overflow menu and project switcher"
```

---

### Task 12: Tablet and phone layouts wired end to end

**Files:**
- Modify: `components/editor-layout/EditorLayout.tsx`
- Modify: `components/ProjectEditor.tsx`
- Modify: `pages/EditorPage.tsx`
- Test: `tests/unit/editorLayoutTouch.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 3–11.

- [ ] **Step 1: Write the failing tests**

```tsx
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditorLayout } from '../../components/editor-layout/EditorLayout';
import { makeActions } from '../helpers/touchActions';

const slots = {
    editorBar: <div data-testid="desktop-editor-bar" />,
    toolbar: <div data-testid="desktop-toolbar" />,
    sidebar: <div data-testid="sidebar" />,
    canvas: <div data-testid="canvas" />,
    properties: <div data-testid="properties" />,
    sidebarWidth: 288, propertiesPanelWidth: 320, onStartResize: vi.fn(),
};

describe('EditorLayout touch branches', () => {
    it('tablet docks properties, hides desktop chrome and drawers the sidebar', () => {
        render(<EditorLayout formFactor="tablet" {...slots} touchActions={makeActions()} navigationKey="n1" />);
        expect(screen.queryByTestId('desktop-editor-bar')).toBeNull();
        expect(screen.queryByTestId('desktop-toolbar')).toBeNull();
        expect(screen.getByTestId('properties')).toBeTruthy();
        expect(screen.queryByTestId('sidebar')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Open pages and templates' }));
        expect(screen.getByTestId('sidebar')).toBeTruthy();
    });

    it('phone closes the drawer when navigation changes', () => {
        const { rerender } = render(<EditorLayout formFactor="phone" {...slots} touchActions={makeActions()} navigationKey="n1" selectionLabel="Page · Root" />);
        fireEvent.click(screen.getByRole('button', { name: 'Open pages and templates' }));
        expect(screen.getByTestId('sidebar')).toBeTruthy();
        rerender(<EditorLayout formFactor="phone" {...slots} touchActions={makeActions()} navigationKey="n2" selectionLabel="Page · Root" />);
        expect(screen.queryByTestId('sidebar')).toBeNull();
    });

    it('phone sheet peeks on selection, hides the tool pill at half, and drops to peek while editing text', () => {
        const { rerender } = render(<EditorLayout formFactor="phone" {...slots} touchActions={makeActions()} navigationKey="n1" selectionLabel="Page · Root" />);
        expect(screen.getByTestId('properties-sheet').style.height).toBe('72px');
        expect(screen.getByTestId('touch-tool-pill')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Resize properties sheet' }));
        expect(screen.getByTestId('properties-sheet').style.height).toBe('50dvh');
        expect(screen.queryByTestId('touch-tool-pill')).toBeNull();

        const editable = document.createElement('div');
        editable.contentEditable = 'true';
        screen.getByTestId('canvas').appendChild(editable);
        act(() => { editable.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });
        expect(screen.getByTestId('properties-sheet').style.height).toBe('72px');

        rerender(<EditorLayout formFactor="phone" {...slots} touchActions={makeActions({ hasSelection: true })} navigationKey="n1" selectionLabel="Rectangle" />);
        expect(screen.getByText('Rectangle')).toBeTruthy();
    });

    it('desktop still renders the desktop markup', () => {
        render(<EditorLayout formFactor="desktop" {...slots} />);
        expect(screen.getByTestId('desktop-editor-bar')).toBeTruthy();
        expect(screen.getByTestId('sidebar')).toBeTruthy();
    });
});
```

`contentEditable` focus detection: jsdom sets `isContentEditable` only in newer versions. The implementation checks `target.isContentEditable || target.getAttribute('contenteditable') === 'true'`.

- [ ] **Step 2: Run to verify failure** → FAIL (touch branches missing).

- [ ] **Step 3: Implement the touch branches in `EditorLayout.tsx`**

Add imports and replace `EditorLayout`:

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { SidebarDrawer } from './SidebarDrawer';
import { PropertiesSheet, SHEET_PEEK_PX, SheetDetent } from './PropertiesSheet';
import { TabletToolbar } from './TabletToolbar';
import { PhoneTopBar } from './PhoneTopBar';
import { TouchToolButtons } from './TouchToolButtons';

const isEditableTarget = (target: EventTarget | null) =>
    target instanceof HTMLElement && (target.isContentEditable || target.getAttribute('contenteditable') === 'true');

function useTouchLayoutState(navigationKey: string | undefined, onRotate: (() => void) | undefined) {
    const [drawerOpen, setDrawerOpen] = useState(false);
    useEffect(() => { setDrawerOpen(false); }, [navigationKey]);
    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return;
        const query = window.matchMedia('(orientation: portrait)');
        const onChange = () => { setDrawerOpen(false); onRotate?.(); };
        query.addEventListener('change', onChange);
        return () => query.removeEventListener('change', onChange);
    }, [onRotate]);
    return { drawerOpen, setDrawerOpen };
}

function TabletEditorLayout({ sidebar, canvas, properties, touchActions, navigationKey }: EditorLayoutProps) {
    const { drawerOpen, setDrawerOpen } = useTouchLayoutState(navigationKey, touchActions?.fitToWidth);
    return (
        <div className="relative flex min-h-0 flex-1 flex-col">
            <TabletToolbar actions={touchActions!} onOpenSidebar={() => setDrawerOpen(true)} />
            <div className="flex min-h-0 flex-1 overflow-hidden">
                <div className="relative flex min-w-0 flex-1 flex-col bg-slate-200">{canvas}</div>
                <div className="flex w-[320px] shrink-0 flex-col border-l bg-white">{properties}</div>
            </div>
            <SidebarDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>{sidebar}</SidebarDrawer>
        </div>
    );
}

function PhoneEditorLayout({ sidebar, canvas, properties, touchActions, navigationKey, selectionLabel }: EditorLayoutProps) {
    const { drawerOpen, setDrawerOpen } = useTouchLayoutState(navigationKey, touchActions?.fitToWidth);
    const [detent, setDetent] = useState<SheetDetent>('peek');
    const canvasRef = useRef<HTMLDivElement>(null);

    // Selecting something from half/full keeps the user's detent; editing text always drops to peek.
    useEffect(() => {
        const el = canvasRef.current;
        if (!el) return;
        const onFocusIn = (event: FocusEvent) => { if (isEditableTarget(event.target)) setDetent('peek'); };
        el.addEventListener('focusin', onFocusIn);
        return () => el.removeEventListener('focusin', onFocusIn);
    }, []);

    return (
        <div className="relative flex min-h-0 flex-1 flex-col">
            <PhoneTopBar actions={touchActions!} onOpenSidebar={() => setDrawerOpen(true)} />
            <div ref={canvasRef} className="relative flex min-h-0 flex-1 flex-col bg-slate-200"
                style={{ paddingBottom: SHEET_PEEK_PX }}>
                {canvas}
                {detent === 'peek' && (
                    <div data-testid="touch-tool-pill"
                        className="absolute left-1/2 z-20 max-w-[calc(100vw-16px)] -translate-x-1/2 overflow-x-auto rounded-2xl border bg-white/95 px-1 shadow-lg"
                        style={{ bottom: SHEET_PEEK_PX + 12 }}>
                        <TouchToolButtons actions={touchActions!} showFit />
                    </div>
                )}
            </div>
            <PropertiesSheet detent={detent} onDetentChange={setDetent} title={selectionLabel ?? 'Properties'}>
                {properties}
            </PropertiesSheet>
            <SidebarDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>{sidebar}</SidebarDrawer>
        </div>
    );
}

export function EditorLayout(props: EditorLayoutProps) {
    if (props.formFactor === 'tablet' && props.touchActions) return <TabletEditorLayout {...props} />;
    if (props.formFactor === 'phone' && props.touchActions) return <PhoneEditorLayout {...props} />;
    return <DesktopEditorLayout {...props} />;
}
```

Spec refinement: with nothing selected, the phone sheet stays at *peek* and shows the page's name (it isn't closed), so page data fields stay reachable. Tapping empty canvas clears the selection and the peek goes back to the page label.

- [ ] **Step 4: Build `touchActions` in `ProjectEditor`**

```tsx
import { listPreviewNodes } from '../services/previewNodes';
import { getElementLabel } from '../services/layers';
import type { TouchEditorActions } from './editor-layout/touchActions';

// after effectivePreviewNodeId is computed:
const previewChoice = listPreviewNodes(state, effectivePreviewNodeId);
const touchActions: TouchEditorActions = {
    undo, redo,
    canUndo: historyRef.current.past.length > 0,
    canRedo: historyRef.current.future.length > 0,
    exportPdf: () => { void handleExportPDF(); },
    exportAllVariants: () => { void handleExportPDF({ exportAllVariants: true }); },
    canExportAllVariants: Object.keys(state.variants).length > 1,
    isExporting,
    greyscale: exportGreyscale,
    toggleGreyscale: () => setExportGreyscale(!exportGreyscale),
    openJson: () => setState(s => ({ ...s, showJsonModal: true })),
    openGenerator: () => setShowScriptGenModal(true),
    savePreset: () => setShowSavePresetModal(true),
    importSvg: handleImportSvg,
    insertSvgPlaceholder: handleInsertSvgPlaceholder,
    snapToGrid: state.snapToGrid,
    toggleSnap: () => setState(s => ({ ...s, snapToGrid: !s.snapToGrid })),
    showGrid: state.showGrid,
    toggleGrid: () => setState(s => ({ ...s, showGrid: !s.showGrid })),
    tool: state.tool,
    setTool: tool => setState(s => ({ ...s, tool: tool as AppState['tool'] })),
    fitToWidth: touchViewport.requestFit,
    hasSelection: state.selectedElementIds.length > 0,
    duplicateSelection: handleDuplicate,
    deleteSelection: () => { saveToHistory(); handleDeleteElements(state.selectedElementIds); },
    preview: previewChoice && {
        ...previewChoice,
        onSelect: id => setState(s => ({ ...s, templatePreviewNodeId: id })),
    },
};

const selectedElements = (currentTemplate?.elements ?? []).filter(el => state.selectedElementIds.includes(el.id));
const selectionLabel = selectedElements.length === 1
    ? getElementLabel(selectedElements[0])
    : selectedElements.length > 1
        ? `${selectedElements.length} elements`
        : `Page · ${state.nodes[effectivePreviewNodeId]?.title ?? ''}`;
const navigationKey = `${state.viewMode}:${state.selectedNodeId}:${state.selectedTemplateId}:${state.activeVariantId}`;
```

Check the desktop toolbar's snap button: if toggling snap also sets `showGrid` there, mirror that in `toggleSnap`. Pass the new props to `<EditorLayout … touchActions={touchActions} selectionLabel={selectionLabel} navigationKey={navigationKey} />`. Use the merged names for anything the persistence branch renamed (`exportGreyscale`, `isExporting`, `historyRef`).

- [ ] **Step 5: Page-level chrome in `EditorPage`**

In `pages/EditorPage.tsx`:

```tsx
import { EditorChromeContext, EditorChrome } from '../components/editor-layout/EditorChromeContext';
```

Build the chrome from the values the header already uses (copy the `onSelect`/`onClose`/`onNew` bodies and the `LocalSaveStatus`/`CloudMenu`/`AccountMenu` elements exactly as the header renders them):

```tsx
const chrome: EditorChrome = {
    projects,
    activeProjectId,
    onSelectProject: projectId => { void handleActivateProject(projectId); },
    onCloseProject: projectId => {
        const authorityEpoch = authorityEpochs.get(projectId);
        if (authorityEpoch === undefined) return;
        setClosingProjectIntent({ projectId, authorityEpoch });
    },
    onNewProject: () => { setCommandError(null); setShowNewProjectModal(true); },
    saveStatus: activeProject ? (
        <LocalSaveStatus
            state={saveStates.get(activeProject.id) ?? { status: 'saved' }}
            onRetry={() => retryProject(activeProject.id)}
            onDownload={() => downloadProjectJson(activeProject)}
        />
    ) : null,
    cloudMenu: activeProject ? (
        <CloudMenu
            project={activeProject}
            onLinkCloud={cloud => handleLinkCloud(activeProject.id, authorityEpochs.get(activeProject.id) ?? 0, cloud)}
            onRestoreState={(state, cloud) => handleRestoreState(
                activeProject.id, authorityEpochs.get(activeProject.id) ?? 0, state, cloud,
            )}
        />
    ) : null,
    accountMenu: <AccountMenu />,
};
```

Then:
- Wrap the tree inside `FormFactorProvider` with `<EditorChromeContext.Provider value={chrome}>`.
- Render the existing `<header …>` only when `formFactor !== 'phone'`: `{formFactor !== 'phone' && (<header …>…</header>)}`.

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/unit/editorLayoutTouch.test.tsx tests/unit/ProjectEditor.desktopLayout.test.tsx tests/unit/ProjectEditor.touchZoom.test.tsx && npx vitest run tests/unit --reporter=dot 2>&1 | tail -5`
Expected: PASS, desktop snapshot unchanged, no new failures.

- [ ] **Step 7: Commit**

```bash
git add components/editor-layout/EditorLayout.tsx components/ProjectEditor.tsx pages/EditorPage.tsx tests/unit/editorLayoutTouch.test.tsx
git commit -m "feat(editor): tablet and phone editor layouts"
```

---

### Task 13: Quick formatting bar + keyboard-aware editing

**Files:**
- Create: `components/canvas/QuickFormatBar.tsx`
- Modify: `components/Canvas.tsx`
- Test: `tests/unit/quickFormatBar.test.tsx`

**Interfaces:**
- Produces: `QuickFormatBar: React.FC<{ element: TemplateElement; anchor: { left: number; top: number; bottom: number; width: number }; onChange: (updates: Partial<TemplateElement>) => void }>`, `QUICK_FORMAT_BAR_HEIGHT = 48`.

- [ ] **Step 1: Write the failing tests**

```tsx
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuickFormatBar } from '../../components/canvas/QuickFormatBar';
import type { TemplateElement } from '../../types';

const text: TemplateElement = {
    id: 't', type: 'text', x: 0, y: 0, w: 100, h: 20, rotation: 0, fill: '', stroke: '', strokeWidth: 0,
    opacity: 1, text: 'Hi', fontSize: 14, fontWeight: 'normal', fontStyle: 'normal', textDecoration: 'none',
    align: 'left', textColor: '#000000',
};
const anchor = { left: 100, top: 300, bottom: 320, width: 100 };

describe('QuickFormatBar', () => {
    it.each([
        ['Increase font size', { fontSize: 15 }],
        ['Decrease font size', { fontSize: 13 }],
        ['Bold', { fontWeight: 'bold' }],
        ['Italic', { fontStyle: 'italic' }],
        ['Underline', { textDecoration: 'underline' }],
        ['Align center', { align: 'center' }],
        ['Align right', { align: 'right' }],
    ])('%s issues %o', (label, patch) => {
        const onChange = vi.fn();
        render(<QuickFormatBar element={text} anchor={anchor} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: label }));
        expect(onChange).toHaveBeenCalledWith(patch);
    });

    it('toggles bold off and changes colour', () => {
        const onChange = vi.fn();
        render(<QuickFormatBar element={{ ...text, fontWeight: 'bold' }} anchor={anchor} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
        expect(onChange).toHaveBeenCalledWith({ fontWeight: 'normal' });
        fireEvent.change(screen.getByLabelText('Text colour'), { target: { value: '#ff0000' } });
        expect(onChange).toHaveBeenCalledWith({ textColor: '#ff0000' });
    });

    it('sits above the element, or below when there is no room, and keeps edits alive', () => {
        const { rerender } = render(<QuickFormatBar element={text} anchor={anchor} onChange={() => {}} />);
        const bar = screen.getByRole('toolbar', { name: 'Text formatting' });
        expect(bar.style.top).toBe(`${300 - 48 - 8}px`);
        expect(bar.hasAttribute('data-prevent-finish-edit')).toBe(true);
        expect(bar.hasAttribute('data-touch-gesture-ignore')).toBe(true);
        rerender(<QuickFormatBar element={text} anchor={{ ...anchor, top: 20, bottom: 40 }} onChange={() => {}} />);
        expect(bar.style.top).toBe(`${40 + 8}px`);
    });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement `QuickFormatBar.tsx`**

```tsx
import React from 'react';
import clsx from 'clsx';
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Minus, Plus, Underline } from 'lucide-react';
import type { TemplateElement } from '../../types';

export const QUICK_FORMAT_BAR_HEIGHT = 48;
const GAP = 8;
const MAX_WIDTH = 468; // 9 controls at the 44px touch minimum + size readout + colour swatch

interface Props {
    element: TemplateElement;
    anchor: { left: number; top: number; bottom: number; width: number };
    onChange: (updates: Partial<TemplateElement>) => void;
}

export function QuickFormatBar({ element, anchor, onChange }: Props) {
    const above = anchor.top - QUICK_FORMAT_BAR_HEIGHT - GAP;
    const top = above >= GAP ? above : anchor.bottom + GAP;
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : MAX_WIDTH + 2 * GAP;
    const width = Math.min(MAX_WIDTH, viewportWidth - 2 * GAP);
    const left = Math.max(GAP, Math.min(viewportWidth - width - GAP, anchor.left + anchor.width / 2 - width / 2));
    const size = element.fontSize ?? 16;
    const toggle = (active: boolean, label: string, icon: React.ReactNode, patch: Partial<TemplateElement>) => (
        <button type="button" aria-label={label} aria-pressed={active} onClick={() => onChange(patch)}
            className={clsx('flex items-center justify-center rounded-md', active ? 'bg-blue-100 text-blue-700' : 'text-slate-600')}>
            {icon}
        </button>
    );

    return (
        <div role="toolbar" aria-label="Text formatting" data-prevent-finish-edit data-touch-gesture-ignore
            onPointerDown={event => event.preventDefault()}
            className="fixed z-[200] flex items-center gap-0.5 overflow-x-auto rounded-xl border bg-white px-1 shadow-xl"
            style={{ top: `${top}px`, left: `${left}px`, width, height: QUICK_FORMAT_BAR_HEIGHT }}>
            <button type="button" aria-label="Decrease font size" onClick={() => onChange({ fontSize: Math.max(4, size - 1) })}
                className="flex items-center justify-center text-slate-600"><Minus size={16} /></button>
            <span className="w-7 text-center text-xs tabular-nums text-slate-700">{size}</span>
            <button type="button" aria-label="Increase font size" onClick={() => onChange({ fontSize: size + 1 })}
                className="flex items-center justify-center text-slate-600"><Plus size={16} /></button>
            {toggle(element.fontWeight === 'bold', 'Bold', <Bold size={16} />, { fontWeight: element.fontWeight === 'bold' ? 'normal' : 'bold' })}
            {toggle(element.fontStyle === 'italic', 'Italic', <Italic size={16} />, { fontStyle: element.fontStyle === 'italic' ? 'normal' : 'italic' })}
            {toggle(element.textDecoration === 'underline', 'Underline', <Underline size={16} />, { textDecoration: element.textDecoration === 'underline' ? 'none' : 'underline' })}
            {toggle((element.align ?? 'left') === 'left', 'Align left', <AlignLeft size={16} />, { align: 'left' })}
            {toggle(element.align === 'center', 'Align center', <AlignCenter size={16} />, { align: 'center' })}
            {toggle(element.align === 'right', 'Align right', <AlignRight size={16} />, { align: 'right' })}
            <input type="color" aria-label="Text colour" value={element.textColor || '#000000'}
                onChange={event => onChange({ textColor: event.target.value })}
                className="h-8 w-8 shrink-0 rounded border-0 bg-transparent p-0" />
        </div>
    );
}
```

(The `Align left` test: the fixture's align is `'left'`, so clicking it issues `{ align: 'left' }`. The parameterised test only covers center/right. That's intentional.)

- [ ] **Step 4: Integrate into `Canvas.tsx` (touch mode only)**

```tsx
import { QuickFormatBar } from './canvas/QuickFormatBar';

const [touchGestureActive, setTouchGestureActive] = useState(false);
const [formatAnchor, setFormatAnchor] = useState<{ left: number; top: number; bottom: number; width: number } | null>(null);
const formatTarget = isTouch && selectedElementIds.length === 1
    ? elements.find(el => el.id === selectedElementIds[0] && (el.type === 'text' || el.type === 'grid'))
    : undefined;

useLayoutEffect(() => {
    const outer = outerContainerRef.current;
    if (!formatTarget || !outer) { setFormatAnchor(null); return; }
    const measure = () => {
        const node = outer.querySelector(`[data-element-id="${formatTarget.id}"]`);
        if (!node) { setFormatAnchor(null); return; }
        const r = node.getBoundingClientRect();
        setFormatAnchor({ left: r.left, top: r.top, bottom: r.bottom, width: r.width });
    };
    measure();
    outer.addEventListener('scroll', measure);
    return () => outer.removeEventListener('scroll', measure);
}, [formatTarget, scale, elements]);
```

Add to `touchHandlers`: `onGestureStart: () => setTouchGestureActive(true), onGestureEnd: () => setTouchGestureActive(false),`

Render, just before the `selectUnderMenu` block:

```tsx
{formatTarget && formatAnchor && !touchGestureActive && !isDragging && !isResizing && (
    <QuickFormatBar
        element={formatTarget}
        anchor={formatAnchor}
        onChange={updates => onUpdateElements(elements.map(el => el.id === formatTarget.id ? { ...el, ...updates } : el), true)}
    />
)}
```

- [ ] **Step 5: Keep the edited element above the keyboard**

In `Canvas.tsx`:

```tsx
useEffect(() => {
    if (!isTouch || !editingElementId) return;
    const viewport = window.visualViewport;
    const outer = outerContainerRef.current;
    if (!viewport || !outer) return;
    const ensureVisible = () => {
        const node = outer.querySelector(`[data-element-id="${editingElementId}"]`);
        if (!node) return;
        const r = node.getBoundingClientRect();
        const visibleTop = viewport.offsetTop + 16;
        const visibleBottom = viewport.offsetTop + viewport.height - 16;
        if (r.bottom > visibleBottom) outer.scrollTop += r.bottom - visibleBottom;
        else if (r.top < visibleTop) outer.scrollTop -= visibleTop - r.top;
    };
    ensureVisible();
    viewport.addEventListener('resize', ensureVisible);
    return () => viewport.removeEventListener('resize', ensureVisible);
}, [isTouch, editingElementId]);
```

Add to `tests/unit/canvasTouch.test.tsx`:

```tsx
it('scrolls the edited element above the on-screen keyboard', () => {
    const listeners: Record<string, () => void> = {};
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: {
        offsetTop: 0, height: 300,
        addEventListener: (type: string, fn: () => void) => { listeners[type] = fn; },
        removeEventListener: () => {},
    } });
    const text: TemplateElement = {
        id: 't', type: 'text', x: 20, y: 20, w: 200, h: 40, rotation: 0, layerId: 'l1', fill: '', stroke: '',
        strokeWidth: 0, opacity: 1, text: 'Hi', fontSize: 16, fontFamily: 'helvetica', textOverflow: 'clip', textWrap: true,
    };
    const { surface, elementNode } = renderCanvas({ elements: [text] });
    trackScroll(surface);
    vi.spyOn(elementNode('t'), 'getBoundingClientRect').mockReturnValue({ top: 500, bottom: 540, left: 0, right: 200, width: 200, height: 40 } as DOMRect);
    for (let i = 0; i < 2; i++) {
        pointer(elementNode('t'), 'pointerdown', i + 1, 40, 30);
        pointer(elementNode('t'), 'pointerup', i + 1, 40, 30);
    }
    expect(surface.scrollTop).toBe(540 - (300 - 16));
    delete (window as any).visualViewport;
});
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/unit/quickFormatBar.test.tsx tests/unit/canvasTouch.test.tsx` → PASS.

- [ ] **Step 7: Commit**

```bash
git add components/canvas/QuickFormatBar.tsx components/Canvas.tsx tests/unit/quickFormatBar.test.tsx tests/unit/canvasTouch.test.tsx
git commit -m "feat(canvas): quick text formatting bar and keyboard-aware editing on touch"
```

---

### Task 14: Generator Template/Hierarchy toggle + dialog panels

**Files:**
- Create: `services/generatorErrorPane.ts`
- Modify: `components/HierarchyGeneratorModal.tsx`, `components/JsonModal.tsx`, `components/GeneratorVisualPreviewModal.tsx`, `components/NewProjectModal.tsx`
- Test: `tests/unit/generatorPaneToggle.test.tsx`

**Interfaces:**
- Produces: `type GeneratorPane = 'template' | 'hierarchy'`; `generatorErrorPane(message: string): GeneratorPane | null`.

- [ ] **Step 1: Write the failing tests**

```tsx
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { generatorErrorPane } from '../../services/generatorErrorPane';
import { HierarchyGeneratorModal } from '../../components/HierarchyGeneratorModal';
import { FormFactorProvider } from '../../components/editor-layout/FormFactorContext';

describe('generatorErrorPane', () => {
    it.each([
        ['Template: page elements must be an array.', 'template'],
        ['Template script exceeds 512 KiB.', 'template'],
        ['Hierarchy: Node x parentId does not match.', 'hierarchy'],
        ['Hierarchy script exceeds 512 KiB.', 'hierarchy'],
        ['Runtime: boom', null],
        ['Combined generator source exceeds 1 MiB.', null],
    ] as const)('%s -> %s', (message, pane) => {
        expect(generatorErrorPane(message)).toBe(pane);
    });
});

const renderModal = (formFactor: 'desktop' | 'phone') => render(
    <FormFactorProvider value={formFactor}>
        <HierarchyGeneratorModal isOpen projectName="P" onClose={vi.fn()}
            onApplyGenerated={vi.fn(() => true)} onCreateGeneratedProject={vi.fn(async () => false)} />
    </FormFactorProvider>,
);

describe('Generator pane toggle', () => {
    it('shows one pane at a time on touch and keeps both drafts', () => {
        renderModal('phone');
        const template = screen.getByLabelText('Template script') as HTMLTextAreaElement;
        const hierarchy = screen.getByLabelText('Hierarchy script') as HTMLTextAreaElement;
        expect(template.closest('[data-generator-pane]')!.className).not.toContain('hidden');
        expect(hierarchy.closest('[data-generator-pane]')!.className).toContain('hidden');
        fireEvent.change(template, { target: { value: 'return { templates: {} };' } });
        fireEvent.click(screen.getByRole('tab', { name: 'Hierarchy' }));
        expect(template.closest('[data-generator-pane]')!.className).toContain('hidden');
        expect(template.value).toBe('return { templates: {} };');
    });

    it('keeps side-by-side panes and no toggle on desktop', () => {
        renderModal('desktop');
        expect(screen.queryByRole('tab', { name: 'Hierarchy' })).toBeNull();
        const panes = document.querySelectorAll('[data-generator-pane]');
        expect(panes[0].className).toBe('flex-1 flex flex-col border-r-4 border-slate-500');
        expect(panes[1].className).toBe('flex-1 flex flex-col');
    });
});
```

`SimpleEditor` renders a textarea with `aria-label={label}` (see `components/HierarchyGeneratorModal.tsx`, `<textarea` near the top). If it doesn't, adjust the queries to how the label is exposed.

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement**

`services/generatorErrorPane.ts`:

```ts
export type GeneratorPane = 'template' | 'hierarchy';

// Preview errors are "<Category>: message" (validation) or "<Script> script exceeds …" (size checks).
// Runtime/clone/protocol errors don't say which script failed, so they map to null and are shown
// only in the header alert.
export function generatorErrorPane(message: string): GeneratorPane | null {
    if (/^Template(:| script\b)/.test(message)) return 'template';
    if (/^Hierarchy(:| script\b)/.test(message)) return 'hierarchy';
    return null;
}
```

In `HierarchyGeneratorModal.tsx` (the main modal component, where `previewState` lives):

```tsx
import { useFormFactor } from './editor-layout/FormFactorContext';
import { generatorErrorPane, GeneratorPane } from '../services/generatorErrorPane';

const formFactor = useFormFactor();
const splitPanes = formFactor === 'desktop';
const [activePane, setActivePane] = useState<GeneratorPane>('template');
const errorPane = previewState.status === 'error' ? generatorErrorPane(previewState.message) : null;
```

- Dialog panel (the `role="dialog"` element): append ` editor-dialog-panel generator-dialog-panel` to its existing `className`.
- Directly above `{/* Side-by-Side Editor Area */}`, insert the toggle for touch only:

```tsx
{!splitPanes && (
    <div role="tablist" aria-label="Generator scripts" className="flex border-b bg-[#252526]">
        {(['template', 'hierarchy'] as const).map(pane => (
            <button key={pane} type="button" role="tab" aria-selected={activePane === pane}
                onClick={() => setActivePane(pane)}
                className={clsx('relative flex-1 text-sm font-medium',
                    activePane === pane ? 'text-white border-b-2 border-indigo-400' : 'text-slate-400')}>
                {pane === 'template' ? 'Template' : 'Hierarchy'}
                {errorPane === pane && activePane !== pane && (
                    <span aria-label="Has error" className="absolute right-3 top-3 h-2 w-2 rounded-full bg-red-500" />
                )}
            </button>
        ))}
    </div>
)}
```

- Templates pane wrapper: replace `className="flex-1 flex flex-col border-r-4 border-slate-500"` with

```tsx
data-generator-pane="template"
className={clsx('flex-1 flex flex-col', splitPanes ? 'border-r-4 border-slate-500' : activePane !== 'template' && 'hidden')}
```

- Hierarchy pane wrapper: replace `className="flex-1 flex flex-col"` with

```tsx
data-generator-pane="hierarchy"
className={clsx('flex-1 flex flex-col', !splitPanes && activePane !== 'hierarchy' && 'hidden')}
```

(Import `clsx` if the file doesn't already.)

- [ ] **Step 4: Tag the other large dialogs**

Append ` editor-dialog-panel` to the `className` of:
- `JsonModal.tsx`: the `bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] …` panel.
- `GeneratorVisualPreviewModal.tsx`: the `role="dialog"` panel (`flex h-[92vh] w-full max-w-7xl …`).
- `NewProjectModal.tsx`: the `role="dialog"` panel (`relative flex max-h-[90vh] w-full max-w-4xl …`).

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/generatorPaneToggle.test.tsx && npx vitest run tests/unit --reporter=dot 2>&1 | tail -5` → PASS, no new failures.

- [ ] **Step 6: Commit**

```bash
git add services/generatorErrorPane.ts components/HierarchyGeneratorModal.tsx components/JsonModal.tsx components/GeneratorVisualPreviewModal.tsx components/NewProjectModal.tsx tests/unit/generatorPaneToggle.test.tsx
git commit -m "feat(generator): template/hierarchy toggle and full-screen dialogs on touch"
```

---

### Task 15: Touch layer reordering

**Files:**
- Modify: `components/LayersPanel.tsx`
- Test: `tests/unit/LayersPanel.touchReorder.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LayersPanel } from '../../components/LayersPanel';
import { FormFactorProvider } from '../../components/editor-layout/FormFactorContext';
import type { PageTemplate } from '../../types';

const template: PageTemplate = {
    id: 'p', name: 'P', width: 100, height: 100, elements: [],
    layers: [
        { id: 'back', name: 'Back', order: 0, visible: true, locked: false },
        { id: 'front', name: 'Front', order: 1, visible: true, locked: false },
    ],
};
const props = () => ({
    template, selectedElementIds: [], activeLayerId: 'back', onUpdateTemplate: vi.fn(),
    onUpdateElements: vi.fn(), onSelectElements: vi.fn(), onSetActiveLayer: vi.fn(),
});

describe('LayersPanel touch reorder', () => {
    it('moves a layer forward with the up button on touch', () => {
        const p = props();
        render(<FormFactorProvider value="tablet"><LayersPanel {...p} /></FormFactorProvider>);
        fireEvent.click(screen.getByRole('button', { name: 'Move Back forward' }));
        const layers = p.onUpdateTemplate.mock.calls[0][0].layers;
        const order = Object.fromEntries(layers.map((l: any) => [l.id, l.order]));
        expect(order.back).toBeGreaterThan(order.front);
    });

    it('disables moves past the ends', () => {
        render(<FormFactorProvider value="phone"><LayersPanel {...props()} /></FormFactorProvider>);
        expect(screen.getByRole('button', { name: 'Move Front forward' })).toHaveProperty('disabled', true);
        expect(screen.getByRole('button', { name: 'Move Back backward' })).toHaveProperty('disabled', true);
    });

    it('renders no reorder buttons on desktop', () => {
        render(<LayersPanel {...props()} />);
        expect(screen.queryByRole('button', { name: /Move .* forward/ })).toBeNull();
    });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement**

In `LayersPanel.tsx`:

```tsx
// add ChevronUp to the existing lucide-react import (ChevronDown is already imported)
import { useFormFactor } from './editor-layout/FormFactorContext';

const isTouch = useFormFactor() !== 'desktop';
const ascending = [...(template.layers ?? [])].sort((a, b) => a.order - b.order);
const moveLayerBy = (id: string, delta: 1 | -1) => {
    const index = ascending.findIndex(l => l.id === id);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= ascending.length) return;
    onUpdateTemplate({ layers: moveLayerToIndex(template.layers ?? [], id, target) });
};
```

In the layer row, immediately before the delete button, render for touch only:

```tsx
{isTouch && (() => {
    const index = ascending.findIndex(l => l.id === layer.id);
    return (
        <>
            <button type="button" aria-label={`Move ${layer.name} forward`} disabled={index === ascending.length - 1}
                onClick={() => moveLayerBy(layer.id, 1)} className="text-slate-500 disabled:opacity-30">
                <ChevronUp size={14} />
            </button>
            <button type="button" aria-label={`Move ${layer.name} backward`} disabled={index === 0}
                onClick={() => moveLayerBy(layer.id, -1)} className="text-slate-500 disabled:opacity-30">
                <ChevronDown size={14} />
            </button>
        </>
    );
})()}
```

`moveLayerToIndex` takes the target index in ascending `order`, the same convention `handleDropOnLayer` uses.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/LayersPanel.touchReorder.test.tsx tests/unit/LayersPanel.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add components/LayersPanel.tsx tests/unit/LayersPanel.touchReorder.test.tsx
git commit -m "feat(layers): up/down layer reordering on touch"
```

---

### Task 16: Mobile end-to-end tests

**Files:**
- Modify: `playwright.config.cjs`
- Create: `tests/e2e/mobile_editor.spec.js`

- [ ] **Step 1: Add mobile projects**

In `playwright.config.cjs`:
- Add `testIgnore: /mobile_editor\.spec\.js/,` to the `chromium`, `firefox` and `webkit` projects.
- Append:

```js
        {
            name: 'mobile-phone-chromium',
            testMatch: /mobile_editor\.spec\.js/,
            use: { ...devices['iPhone 13'], browserName: 'chromium' },
        },
        {
            name: 'mobile-phone-webkit',
            testMatch: /mobile_editor\.spec\.js/,
            use: { ...devices['iPhone 13'] },
        },
        {
            name: 'mobile-tablet-chromium',
            testMatch: /mobile_editor\.spec\.js/,
            use: { ...devices['iPad (gen 7)'], browserName: 'chromium' },
        },
        {
            name: 'mobile-tablet-webkit',
            testMatch: /mobile_editor\.spec\.js/,
            use: { ...devices['iPad (gen 7)'] },
        },
```

If `tests/unit/playwrightConfig.test.js` asserts the project list, update it to match.

- [ ] **Step 2: Write the spec**

Emulated browsers don't reliably report `pointer: coarse`, so an init script forces it. Detection itself is unit-tested (Task 3). Drags and pinches are dispatched as real `PointerEvent`s with `pointerType: 'touch'`, which is what the gesture hook consumes. Taps go through `page.touchscreen.tap`.

```js
import { test, expect } from '@playwright/test';
import { seedNativeProject } from './localWorkspaceHelpers.js';
import { layoutFixture as fixture } from './fixtures/layoutFixture.js';
const activePane = page => page.locator('[data-testid="project-pane"][data-active="true"]');
const isPhone = testInfo => testInfo.project.name.startsWith('mobile-phone');

const box = async locator => {
    const b = await locator.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
};

const touch = (page, type, id, x, y) => page.evaluate(([type, id, x, y]) => {
    const target = window.__touchTarget && type !== 'pointerdown' ? window.__touchTarget : document.elementFromPoint(x, y);
    if (type === 'pointerdown' && id === 1) window.__touchTarget = target;
    target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
        pointerId: id, pointerType: 'touch', isPrimary: id === 1, button: 0,
    }));
}, [type, id, x, y]);

const drag = async (page, from, to, steps = 6) => {
    await touch(page, 'pointerdown', 1, from.x, from.y);
    for (let i = 1; i <= steps; i++) {
        await touch(page, 'pointermove', 1, from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    }
    await touch(page, 'pointerup', 1, to.x, to.y);
};

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        const original = window.matchMedia.bind(window);
        window.matchMedia = query => (query === '(pointer: coarse)'
            ? { matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }
            : original(query));
    });
    await seedNativeProject(page, { id: 'mobile', name: 'Mobile', initialState: fixture });
    await page.goto('/app');
    await expect(activePane(page).getByTestId('editor-canvas')).toBeVisible();
});

test('uses the touch layout for the device', async ({ page }, testInfo) => {
    const expected = isPhone(testInfo) ? 'phone' : 'tablet';
    await expect(page.locator('html')).toHaveAttribute('data-form-factor', expected);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
});

test('tap selects, drag moves, handle resizes', async ({ page }) => {
    const pane = activePane(page);
    const rect = pane.locator('[data-element-id="box"]');
    const start = await box(rect);
    await page.touchscreen.tap(start.x, start.y);
    await expect(pane.locator('[data-resize-handle="se"]')).toBeVisible();

    await drag(page, start, { x: start.x + 40, y: start.y + 30 });
    const moved = await box(rect);
    expect(moved.b.x).toBeGreaterThan(start.b.x + 20);

    const handle = await box(pane.locator('[data-resize-handle="se"]'));
    await drag(page, handle, { x: handle.x + 40, y: handle.y + 40 });
    const resized = await box(rect);
    expect(resized.b.width).toBeGreaterThan(moved.b.width + 20);
});

test('double tap edits text; quick format bar applies bold', async ({ page }) => {
    const pane = activePane(page);
    const title = await box(pane.locator('[data-element-id="title"]'));
    await page.touchscreen.tap(title.x, title.y);
    await page.touchscreen.tap(title.x, title.y);
    await expect(pane.locator('[contenteditable="true"]')).toBeVisible();
    await page.getByRole('toolbar', { name: 'Text formatting' }).getByRole('button', { name: 'Bold' }).click();
    await expect(page.getByRole('toolbar', { name: 'Text formatting' }).getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'false');
});

test('pinch zooms the canvas without scrolling the page', async ({ page }) => {
    const canvas = activePane(page).getByTestId('editor-canvas');
    const before = (await canvas.boundingBox()).width;
    const c = await box(activePane(page).locator('.canvas-scroll-container'));
    await touch(page, 'pointerdown', 1, c.x - 40, c.y);
    await touch(page, 'pointerdown', 2, c.x + 40, c.y);
    for (let i = 1; i <= 5; i++) await touch(page, 'pointermove', 2, c.x + 40 + i * 20, c.y);
    await touch(page, 'pointerup', 2, c.x + 140, c.y);
    await touch(page, 'pointerup', 1, c.x - 40, c.y);
    expect((await canvas.boundingBox()).width).toBeGreaterThan(before * 1.2);
    expect(await page.evaluate(() => window.scrollX + window.scrollY)).toBe(0);
});

test('drawer, sheet and overflow menu', async ({ page }, testInfo) => {
    await page.getByRole('button', { name: 'Open pages and templates' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Pages and templates' })).toBeVisible();
    await page.getByTestId('sidebar-drawer-backdrop').click();
    if (isPhone(testInfo)) {
        await page.getByRole('button', { name: 'Resize properties sheet' }).click();
        await expect(page.getByTestId('properties-sheet')).toHaveCSS('height', /\d+px/);
    }
    await page.getByRole('button', { name: 'More actions' }).first().click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export PDF' }).click();
    expect((await downloadPromise).suggestedFilename()).toMatch(/\.pdf$/);
});

test('phone top bar controls do not overlap', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'phone only');
    const buttons = page.locator('header').first().getByRole('button');
    const boxes = [];
    for (let i = 0; i < await buttons.count(); i++) boxes.push(await buttons.nth(i).boundingBox());
    for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
            expect(overlap, `buttons ${i} and ${j} overlap`).toBe(false);
        }
    }
});
```

If export uses a blob download that Playwright can't observe in WebKit, assert instead that the Export button shows its busy state and then returns to idle.

- [ ] **Step 3: Run**

Run: `npx playwright test tests/e2e/mobile_editor.spec.js --project=mobile-phone-chromium --project=mobile-phone-webkit --project=mobile-tablet-chromium --project=mobile-tablet-webkit`
Expected: all pass. Then run `npx playwright test tests/e2e/desktop_layout_guard.spec.js --project=chromium` → still passes.

- [ ] **Step 4: Commit**

```bash
git add playwright.config.cjs tests/e2e/mobile_editor.spec.js tests/unit/playwrightConfig.test.js
git commit -m "test(e2e): phone and tablet editor flows"
```

---

### Task 17: Docs, manual checklist, final verification

**Files:**
- Create: `docs-content/reference/editor/editor-on-phones-and-tablets.md`
- Create: `docs/superpowers/plans/2026-09-23-mobile-editor-device-checklist.md`

- [ ] **Step 1: Reference entry**

Check the frontmatter of a sibling file in `docs-content/reference/editor/` and match it. Content:

```markdown
---
title: Using the Editor on Phones and Tablets
summary: On touch devices the editor switches to a canvas-first layout with a pages drawer, a properties sheet and touch gestures; desktop is unchanged.
aliases: mobile, phone, tablet, iPad, touch
keywords: touch, pinch, zoom, drawer, bottom sheet, quick format, generator toggle
---

On a phone or tablet the editor rearranges itself around the canvas. Nothing changes on a computer with a mouse or trackpad.

**Phones** show the canvas full screen. Tap **☰** for pages and templates, tap the project name to switch projects, and use **⋯** for export, JSON, the Generator, cloud and account. Properties live in a sheet at the bottom: tap its handle, or drag it, to go from a one-line summary to half or full height. Tools sit in a floating strip above the sheet.

**Tablets** keep the page header and dock properties on the right; pages and templates open from **☰**.

| Gesture | What it does |
| --- | --- |
| Tap an element | Select it |
| Tap empty canvas | Clear the selection |
| Drag the selected element | Move it |
| Drag a corner or edge handle | Resize it |
| Drag anywhere else | Scroll the page |
| Double-tap text | Edit it in place |
| Long-press | Pick from elements stacked under your finger |
| Pinch / two-finger drag | Zoom and scroll |
| Tap or drag with Text or a shape tool | Create one (a tap gives a default size) |

While a text element is selected, a small bar above it sets size, bold, italic, underline, alignment and colour.

In the **Generator**, Template and Hierarchy become two views with a toggle at the top; a red dot marks the view whose script has an error.

**Not available on touch yet:** selecting several elements at once, rotating, alignment and distribute, and keyboard shortcuts. Zooming on a phone doesn't change the zoom saved with the project.
```

- [ ] **Step 2: Manual device checklist**

```markdown
# Mobile editor — manual device checklist

Run on a real iPhone (Safari) and Android phone (Chrome), plus an iPad (Safari):

- [ ] Editor opens in phone/tablet layout; desktop browser on a laptop is unchanged at any window width
- [ ] Double-tap text: keyboard opens and the text stays visible above it
- [ ] Tapping a property input doesn't zoom the page
- [ ] Address bar showing/hiding doesn't cut off the bottom sheet or full-screen dialogs
- [ ] Rotate while the drawer is open: drawer closes, page re-fits
- [ ] Long-press on the canvas opens the stack menu, not the system text-selection callout
- [ ] Pinch-zoom feels anchored under the fingers
- [ ] Quick format bar buttons don't end text editing
- [ ] Generator: toggle between Template and Hierarchy keeps both scripts; Preview and Apply work
- [ ] Layers: ▲/▼ reorder layers
- [ ] iPad with trackpad/mouse: mouse drags still move and marquee-select as on desktop
```

- [ ] **Step 3: Full verification**

```bash
npx vitest run tests/unit 2>&1 | tail -8
npx vitest run tests/unit/docsAntiRot.test.ts
npx tsc --noEmit -p . 2>&1 | grep -c "error TS"
npx playwright test tests/e2e/desktop_layout_guard.spec.js --project=chromium
npx playwright test tests/e2e/mobile_editor.spec.js --project=mobile-phone-chromium --project=mobile-phone-webkit --project=mobile-tablet-chromium --project=mobile-tablet-webkit
npx playwright test --project=chromium
```

Expected: unit failures no worse than the Task 0 baseline; TS error count no higher than baseline; desktop guard, mobile spec and the existing desktop e2e suite pass.

- [ ] **Step 4: Commit**

```bash
git add docs-content/reference/editor/editor-on-phones-and-tablets.md docs/superpowers/plans/2026-09-23-mobile-editor-device-checklist.md
git commit -m "docs(editor): phones and tablets reference and device checklist"
```

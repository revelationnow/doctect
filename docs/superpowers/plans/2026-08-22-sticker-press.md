# The Sticker Press Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship gallery flagship 21, a 500-sticker source book with four device variants, plus the two platform prerequisites it needs.

**Architecture:** Two generator scripts under `gallery-samples/21-sticker-press/`. `templates.js` holds a device-profile table, ~90 parametric shape builders returning SVG path data in a 24×24 viewBox, a 500-entry sticker registry, and a layout engine that runs the registry once per device profile and returns `{ variants, activeVariantId }`. `hierarchy.js` builds one node tree shared by all four variants. Two prerequisites land first: `MAX_STATE_BYTES` rises to 16 MiB, and the gallery test harness learns to validate every variant instead of only the active one.

**Tech Stack:** Plain ES2020 JavaScript in the generator scripts (executed via `new Function`, no imports, no TypeScript). Vitest + TypeScript for the test suites. Playwright for the final real-browser verification.

**Spec:** `docs/superpowers/specs/2026-08-12-sticker-press-design.md`

## Global Constraints

- Page sizes, in points, exact: `paper_pro` 509×679, `move` 260×463, `note_air` 446×595, `pure` 447×596.
- `activeVariantId` is `paper_pro`.
- All four variants MUST expose an identical template id set. Every node renders in every variant.
- 500 stickers total: 180 structural, 320 pictorial. Per variant: structural × 6 colourways × 3 sizes, pictorial × 3 treatments × 2 sizes = 5,160 placements.
- Sticker markup budget: **230 bytes average, 400 bytes maximum** per sticker's `svgContent`.
- Outline colour is always `#23292f`. Structural colourway fills: Outline (none), Amber `#f0c674`, Green `#86c08e`, Blue `#5b93c4`, Red `#b04a46`, Ink `#3d4650`.
- `pure` variant ink treatments, in switcher order: Outline only, Light halftone, Medium halftone, Dense halftone, Solid mid-grey `#7a8290`, Solid ink `#3d4650`.
- SVG authoring: ship `viewBox`, omit root `width`/`height`; 6-digit hex or `rgb()` only — never `hsl()`, `hsla()`, `#rgba`, `#rrggbbaa`; never `<use>`, `<script>`, `<style>`, `<foreignObject>`, or `on*` handlers. `<pattern>`/`<defs>` permitted only for `pure` halftones.
- Sheet ground is pure white. No borders around sticker cells. Labels sit in a gutter strip below the artwork.
- Element ids must be deterministic across repeated execution — use a monotonic counter, never `Math.random()`.
- Generator scripts are capped at 512 KiB each (`shared/generatorMetadata.js:2`).
- **Every sheet needs its own template.** Unlike the other twenty products, which reuse one template across many nodes via `{{field}}` binding, `svgContent` is not data-bindable — it is read raw at both render sites. Each sheet's artwork is therefore baked into its own template, so a variant holds ~77 templates rather than the ~11 a planner needs.
- **Tests never evaluate `templates.js` with an appended `return`.** The script ends with its own top-level `return`, which would make an appended one unreachable. All unit tests load internals through `tests/unit/gallerySamples/stickerPressScope.ts` (`loadStickerPressScope`, `runStickerPressGenerator`), which cuts the source at the `GENERATE_SENTINEL` line. Task 11 must emit that sentinel verbatim.
- Skip-to-blank link text is exactly `Skip to blank workspace →` (trailing arrow required by the harness).
- Run the full unit suite with `npx vitest run`. Run one file with `npx vitest run <path>`.

---

## File Structure

**Prerequisite A — state cap**
- Modify: `shared/projectLimits.js` — raise `MAX_STATE_BYTES`, add `MAX_GENERATOR_OUTPUT_BYTES`
- Modify: `services/validateGeneratedProject.ts`, `services/generatorSandbox.ts` — consume the generator constant
- Modify: `tests/e2e/fixtures/localWorkspaceMigration.js` — rename its stale duplicate constant

**Prerequisite B — harness**
- Modify: `tests/helpers/gallerySampleHarness.ts` — variant-aware loading, per-variant page size, per-variant element-id scoping
- Create: `tests/unit/gallerySamples/harnessVariants.test.ts` — proves the harness catches per-variant defects

**Product**
- Create: `gallery-samples/21-sticker-press/templates.js` — device profiles, builders, registry, layout engine
- Create: `gallery-samples/21-sticker-press/hierarchy.js` — node tree
- Create: `gallery-samples/21-sticker-press/README.md`
- Create: `tests/unit/gallerySamples/stickerPress.test.ts`
- Modify: `tests/unit/gallerySamples/collection.test.ts` — append the slug
- Create: `scratch/render_sticker_press.mjs` — real-browser render (not committed)

`templates.js` is one file by necessity: the generator modal takes a single script, and it must be self-contained with no imports. Internally it is ordered in four labelled sections — profiles, builders, registry, layout — and Tasks 4–11 each own one region of it.

---

## Task 1: Raise the state cap

**Files:**
- Modify: `shared/projectLimits.js:1`
- Modify: `services/validateGeneratedProject.ts:7,168,310`
- Modify: `services/generatorSandbox.ts:5,416`
- Modify: `tests/e2e/fixtures/localWorkspaceMigration.js:12`
- Test: `tests/unit/projectLimits.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `MAX_STATE_BYTES = 16777216` and `MAX_GENERATOR_OUTPUT_BYTES = 16777216`, both exported from `shared/projectLimits.js`.

**Why two constants:** the sandbox bound is a denial-of-service control on hostile generator source; the state bound governs what may be stored and published. They protect unrelated things and have drifted apart before — one constant serving both is why the localStorage/UTF-16 mismatch went unnoticed for months. They hold the same value today; the split makes the next change safe.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/projectLimits.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MAX_STATE_BYTES, MAX_GENERATOR_OUTPUT_BYTES } from '../../shared/projectLimits.js';

describe('project limits', () => {
    it('allows a four-variant sticker book to be stored', () => {
        expect(MAX_STATE_BYTES).toBe(16 * 1024 * 1024);
    });

    it('bounds generator output separately from stored state', () => {
        expect(MAX_GENERATOR_OUTPUT_BYTES).toBe(16 * 1024 * 1024);
    });

    it('leaves headroom above the projected sticker book size', () => {
        const projectedStickerBookBytes = 9.65 * 1024 * 1024;
        expect(MAX_GENERATOR_OUTPUT_BYTES).toBeGreaterThan(projectedStickerBookBytes * 1.5);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/projectLimits.test.ts`
Expected: FAIL — `MAX_STATE_BYTES` is 5242880, and `MAX_GENERATOR_OUTPUT_BYTES` is undefined.

- [ ] **Step 3: Raise and split the constants**

In `shared/projectLimits.js`, replace line 1 with:

```js
// Ceiling on a stored or published AppState, measured in UTF-8 bytes.
export const MAX_STATE_BYTES = 16 * 1024 * 1024;

// Ceiling on generator output, enforced inside the sandboxed evaluator as a
// denial-of-service bound on hostile script source. Same value as
// MAX_STATE_BYTES today, but a separate concern: this one guards the browser
// during evaluation, that one guards storage.
export const MAX_GENERATOR_OUTPUT_BYTES = 16 * 1024 * 1024;
```

- [ ] **Step 4: Point the generator paths at the generator constant**

In `services/validateGeneratedProject.ts`, change the import on line 7 from `MAX_STATE_BYTES` to `MAX_GENERATOR_OUTPUT_BYTES`, and update both checks (lines 168 and 310) plus their message strings to use it.

In `services/generatorSandbox.ts`, change the import on line 5 and the `EVALUATOR_SOURCE` template on line 416 to use `MAX_GENERATOR_OUTPUT_BYTES`.

Leave `shared/validateAppState.js:38` on `MAX_STATE_BYTES` — that is the storage path.

- [ ] **Step 5: Rename the stale duplicate in the e2e fixture**

`tests/e2e/fixtures/localWorkspaceMigration.js:12` declares its own `MAX_STATE_BYTES = 5 * 1024 * 1024`, unrelated to the shared constant. It exists to build a legacy project near the *old* limit, which is still exactly what that migration test should exercise. Rename it so it cannot be mistaken for the live constant:

```js
// The pre-2026-08 state ceiling. Migration fixtures deliberately pin the old
// value: the point is to prove a project authored under it still migrates.
export const LEGACY_STATE_BYTES = 5 * 1024 * 1024;
```

Update the three references in `tests/e2e/local_workspace_migration.spec.js` (lines 9, 549–550, 600) and the one at `tests/e2e/fixtures/localWorkspaceMigration.js:626` to the new name. Do not change the value.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/unit/projectLimits.test.ts`
Expected: PASS

Run: `npx vitest run`
Expected: PASS, no regressions. Any failure here means a test asserted the old ceiling — read it before changing it.

Run: `grep -rn "MAX_STATE_BYTES" --include=*.ts --include=*.js . | grep -v node_modules`
Expected: only `shared/projectLimits.js`, `shared/validateAppState.js`, `server/validateAppState.js`, and `tests/unit/projectLimits.test.ts`. No generator path, no e2e fixture.

- [ ] **Step 7: Commit**

```bash
git add shared/projectLimits.js services/validateGeneratedProject.ts services/generatorSandbox.ts tests/e2e/fixtures/localWorkspaceMigration.js tests/e2e/local_workspace_migration.spec.js tests/unit/projectLimits.test.ts
git commit -m "feat(limits): raise state cap to 16 MiB and split the generator bound"
```

---

## Task 2: Teach the harness about variants

**Files:**
- Modify: `tests/helpers/gallerySampleHarness.ts`
- Test: `tests/unit/gallerySamples/harnessVariants.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `LoadedGalleryVariant { id: string; name: string; templates: Record<string, any>; pageWidth: number; pageHeight: number }`
  - `LoadedGallerySample` gains `variants: LoadedGalleryVariant[]` and `activeVariantId: string`; its existing `templates` field keeps pointing at the active variant's templates so all twenty existing suites are untouched.
  - `GallerySampleContract` gains optional `expectedVariants?: Record<string, { width: number; height: number }>`. Absent means one variant at 509×679.

**The defect being fixed:** `executeGallerySample` line 138 reads `normalized.templates ?? normalized.variants![normalized.activeVariantId!].templates`, discarding every non-active variant. Without this task, three of the sticker book's four device layouts ship with no bounds, link, or chrome validation at all.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/gallerySamples/harnessVariants.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { executeGallerySample, validateSharedGalleryInvariants } from '../../helpers/gallerySampleHarness';

const HIERARCHY = `
    const nodes = {
        root: { id: 'root', parentId: null, type: 'sheet', title: 'Root', data: {}, children: [] },
    };
    return { nodes, rootId: 'root' };
`;

const twoVariants = (secondSheetElements: string) => `
    const sheet = (w, h, elements) => ({ id: 'sheet', name: 'Sheet', width: w, height: h, elements });
    const templates = {
        big: { templates: { sheet: sheet(509, 679, [
            { id: 'e1', type: 'rect', x: 10, y: 10, w: 100, h: 20, rotation: 0, fill: '#fff', stroke: '', strokeWidth: 0, opacity: 1 },
        ]) } },
        small: { templates: { sheet: sheet(260, 463, ${secondSheetElements}) } },
    };
    return { variants: templates, activeVariantId: 'big' };
`;

describe('harness variant support', () => {
    it('loads every variant, not only the active one', () => {
        const inBounds = `[{ id: 'e1', type: 'rect', x: 10, y: 10, w: 100, h: 20, rotation: 0, fill: '#fff', stroke: '', strokeWidth: 0, opacity: 1 }]`;
        const sample = executeGallerySample(twoVariants(inBounds), HIERARCHY);

        expect(sample.variants.map(variant => variant.id)).toEqual(['big', 'small']);
        expect(sample.activeVariantId).toBe('big');
        expect(sample.variants[1].pageWidth).toBe(260);
        expect(sample.variants[1].pageHeight).toBe(463);
    });

    it('keeps sample.templates pointing at the active variant', () => {
        const inBounds = `[{ id: 'e1', type: 'rect', x: 10, y: 10, w: 100, h: 20, rotation: 0, fill: '#fff', stroke: '', strokeWidth: 0, opacity: 1 }]`;
        const sample = executeGallerySample(twoVariants(inBounds), HIERARCHY);

        expect(sample.templates.sheet.width).toBe(509);
    });

    it('catches an element that overflows a non-active variant page', () => {
        const overflowing = `[{ id: 'e1', type: 'rect', x: 200, y: 10, w: 100, h: 20, rotation: 0, fill: '#fff', stroke: '', strokeWidth: 0, opacity: 1 }]`;
        const sample = executeGallerySample(twoVariants(overflowing), HIERARCHY);
        const errors = validateSharedGalleryInvariants(sample);

        expect(errors.join('\n')).toMatch(/variant 'small'.*'e1'.*overflows width/);
    });

    it('allows sibling variants to reuse element ids', () => {
        const inBounds = `[{ id: 'e1', type: 'rect', x: 10, y: 10, w: 100, h: 20, rotation: 0, fill: '#fff', stroke: '', strokeWidth: 0, opacity: 1 }]`;
        const sample = executeGallerySample(twoVariants(inBounds), HIERARCHY);
        const errors = validateSharedGalleryInvariants(sample);

        expect(errors.join('\n')).not.toMatch(/duplicated/);
    });

    it('still rejects a duplicate element id inside one variant', () => {
        const source = `
            const elements = [
                { id: 'dupe', type: 'rect', x: 0, y: 0, w: 10, h: 10, rotation: 0, fill: '#fff', stroke: '', strokeWidth: 0, opacity: 1 },
            ];
            return { templates: {
                sheet: { id: 'sheet', name: 'A', width: 509, height: 679, elements },
                other: { id: 'other', name: 'B', width: 509, height: 679, elements },
            } };
        `;
        const sample = executeGallerySample(source, HIERARCHY);
        const errors = validateSharedGalleryInvariants(sample);

        expect(errors.join('\n')).toMatch(/element id 'dupe' is duplicated/);
    });

    it('rejects a variant whose templates disagree on page size', () => {
        const source = `
            const el = [{ id: 'e1', type: 'rect', x: 0, y: 0, w: 10, h: 10, rotation: 0, fill: '#fff', stroke: '', strokeWidth: 0, opacity: 1 }];
            return { templates: {
                sheet: { id: 'sheet', name: 'A', width: 509, height: 679, elements: el },
                other: { id: 'other', name: 'B', width: 260, height: 463, elements: el },
            } };
        `;
        const sample = executeGallerySample(source, HIERARCHY);
        const errors = validateSharedGalleryInvariants(sample);

        expect(errors.join('\n')).toMatch(/must be 509x679/);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/gallerySamples/harnessVariants.test.ts`
Expected: FAIL — `sample.variants` is undefined.

- [ ] **Step 3: Add the variant types**

In `tests/helpers/gallerySampleHarness.ts`, replace the `LoadedGallerySample` and `GallerySampleContract` interfaces (lines 10–25) with:

```ts
export interface LoadedGalleryVariant {
    id: string;
    name: string;
    templates: Record<string, any>;
    pageWidth: number;
    pageHeight: number;
}

export interface LoadedGallerySample {
    slug: string;
    /** The active variant's templates. Single-variant samples are unaffected. */
    templates: Record<string, any>;
    variants: LoadedGalleryVariant[];
    activeVariantId: string;
    nodes: Record<string, any>;
    rootId: string;
    templateSource: string;
    hierarchySource: string;
}

export interface GallerySampleContract {
    slug: string;
    expectedTemplateIds: string[];
    pageCount: [number, number];
    palette: string[];
    requiredStableNodeIds: ['root', 'start_here', 'example_workspace', 'blank_workspace'];
    /** Expected page size per variant id. Omit for a single 509x679 variant. */
    expectedVariants?: Record<string, { width: number; height: number }>;
}
```

Keep `PAGE_WIDTH`/`PAGE_HEIGHT` at lines 28–29 — they become the default for samples that declare no variants.

- [ ] **Step 4: Build variants during execution**

In `executeGallerySample`, replace the single `const templates = ...` line with variant construction. A variant's page size is taken from its first template; Step 6 then asserts every other template in that variant agrees.

```ts
    const normalized = normalizeGeneratedTemplates(raw);
    const rawVariants: Record<string, { name?: string; templates: Record<string, any> }> =
        normalized.variants ?? { default: { name: 'Default', templates: normalized.templates! } };
    const activeVariantId = normalized.variants
        ? normalized.activeVariantId!
        : 'default';

    const variants: LoadedGalleryVariant[] = Object.entries(rawVariants).map(([id, variant]) => {
        const first: any = Object.values(variant.templates ?? {})[0];
        return {
            id,
            name: typeof variant.name === 'string' ? variant.name : id,
            templates: variant.templates ?? {},
            pageWidth: typeof first?.width === 'number' ? first.width : PAGE_WIDTH,
            pageHeight: typeof first?.height === 'number' ? first.height : PAGE_HEIGHT,
        };
    });
    const templates = variants.find(variant => variant.id === activeVariantId)?.templates ?? {};
```

Then add `variants` and `activeVariantId` to the `sample` object literal that follows.

- [ ] **Step 5: Run to confirm the first two tests pass**

Run: `npx vitest run tests/unit/gallerySamples/harnessVariants.test.ts -t 'loads every variant'`
Expected: PASS

Run: `npx vitest run tests/unit/gallerySamples/harnessVariants.test.ts -t 'keeps sample.templates'`
Expected: PASS

- [ ] **Step 6: Make validateTemplates variant-aware**

Change `validateTemplates` to take one variant, and scope `seenElementIds` inside it so sibling variants may reuse ids. Replace its signature and opening lines:

```ts
const validateVariantTemplates = (
    sample: LoadedGallerySample,
    variant: LoadedGalleryVariant,
    errors: string[],
) => {
    const label = sample.variants.length > 1 ? `variant '${variant.id}' ` : '';
    const seenElementIds = new Map<string, string>();
    Object.entries(variant.templates).forEach(([templateId, template]) => {
```

Inside the body, make three substitutions throughout:

- Every `sample.templates` becomes `variant.templates`.
- Every `PAGE_WIDTH` becomes `variant.pageWidth`, every `PAGE_HEIGHT` becomes `variant.pageHeight`. The page-size error message becomes:
  ```ts
  errors.push(`${label}template '${templateId}' must be ${variant.pageWidth}x${variant.pageHeight}`);
  ```
- Every `errors.push(\`template '${templateId}' ...\`)` gains the `${label}` prefix, so a failure names its variant.

The `renderedNodes(sample, templateId)` call is unchanged — nodes are project-level, not per-variant.

- [ ] **Step 7: Make deterministic-id checking variant-aware**

In `validateDeterministicIds`, replace the `templateIds`/`repeatedTemplateIds` comparison and the per-element loop so they walk every variant:

```ts
        const variantIds = sample.variants.map(variant => variant.id).sort();
        const repeatedVariantIds = repeated.variants.map(variant => variant.id).sort();
        if (JSON.stringify(variantIds) !== JSON.stringify(repeatedVariantIds)) {
            errors.push('variant IDs are not deterministic across repeated execution');
            return;
        }

        for (const variant of sample.variants) {
            const repeatedVariant = repeated.variants.find(candidate => candidate.id === variant.id)!;
            const templateIds = Object.keys(variant.templates).sort();
            const repeatedTemplateIds = Object.keys(repeatedVariant.templates).sort();
            if (JSON.stringify(templateIds) !== JSON.stringify(repeatedTemplateIds)) {
                errors.push(`variant '${variant.id}' template IDs are not deterministic across repeated execution`);
                continue;
            }
            templateIds.forEach(templateId => {
                const elements = Array.isArray(variant.templates[templateId]?.elements)
                    ? variant.templates[templateId].elements
                    : [];
                const repeatedElements = Array.isArray(repeatedVariant.templates[templateId]?.elements)
                    ? repeatedVariant.templates[templateId].elements
                    : [];
                const count = Math.max(elements.length, repeatedElements.length);
                for (let index = 0; index < count; index += 1) {
                    if (elements[index]?.id !== repeatedElements[index]?.id) {
                        errors.push(`variant '${variant.id}' template '${templateId}' element at index ${index} id is not deterministic across repeated execution`);
                    }
                }
            });
        }
```

Leave the node-key and node-id comparisons exactly as they are — the hierarchy is shared across variants.

- [ ] **Step 8: Drive every variant from the entry point**

In `validateSharedGalleryInvariants`, replace the single `validateTemplates(sample, errors)` call:

```ts
        validateStructure(sample, errors);
        sample.variants.forEach(variant => validateVariantTemplates(sample, variant, errors));
        validateExampleChrome(sample, errors);
        validateJsonClonable(sample, errors);
```

`validateJsonClonable` walks `sample.templates` (active variant only). Widen it to every variant:

```ts
const validateJsonClonable = (sample: LoadedGallerySample, errors: string[]) => {
    sample.variants.forEach(variant => {
        const templateIssue = findNonJsonValue(variant.templates);
        if (templateIssue) errors.push(`variant '${variant.id}' templates: ${templateIssue} — sandbox rejects non-JSON output`);
    });
    const nodeIssue = findNonJsonValue(sample.nodes);
    if (nodeIssue) errors.push(`nodes: ${nodeIssue} — sandbox rejects non-JSON output`);
};
```

- [ ] **Step 9: Enforce the contract's variant expectations**

In `validateGallerySample`, after the existing `expectedTemplateIds` block, add:

```ts
    const expectedVariants = contract.expectedVariants
        ?? { default: { width: 509, height: 679 } };
    const actualVariantIds = new Set(sample.variants.map(variant => variant.id));
    Object.entries(expectedVariants).forEach(([variantId, size]) => {
        const variant = sample.variants.find(candidate => candidate.id === variantId);
        if (!variant) {
            errors.push(`expected variant '${variantId}' is missing`);
            return;
        }
        if (variant.pageWidth !== size.width || variant.pageHeight !== size.height) {
            errors.push(`variant '${variantId}' is ${variant.pageWidth}x${variant.pageHeight}, expected ${size.width}x${size.height}`);
        }
    });
    actualVariantIds.forEach(variantId => {
        if (!expectedVariants[variantId]) errors.push(`unexpected variant '${variantId}' is present`);
    });
```

Then widen the `expectedTemplateIds` checks so they run per variant — this is what enforces the identical-template-id-set rule:

```ts
    sample.variants.forEach(variant => {
        contract.expectedTemplateIds.forEach(templateId => {
            if (!variant.templates[templateId]) {
                errors.push(`variant '${variant.id}' is missing expected template '${templateId}'`);
            }
        });
        Object.keys(variant.templates).forEach(templateId => {
            if (!expectedTemplates.has(templateId)) {
                errors.push(`variant '${variant.id}' has unexpected template '${templateId}'`);
            }
        });
    });
```

Delete the two original loops that checked only `templates`.

- [ ] **Step 10: Run the new tests, then the whole suite**

Run: `npx vitest run tests/unit/gallerySamples/harnessVariants.test.ts`
Expected: PASS, all six.

Run: `npx vitest run tests/unit/gallerySamples/`
Expected: PASS. All twenty existing product suites must stay green — they declare no variants, so they take the `default` path at 509×679.

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add tests/helpers/gallerySampleHarness.ts tests/unit/gallerySamples/harnessVariants.test.ts
git commit -m "test(harness): validate every gallery sample variant

The harness read only the active variant's templates, so a multi-variant
sample could ship three unvalidated device layouts. Page size now comes
from the variant and element-id uniqueness is scoped to it, since sibling
variants reusing ids is what makes them one product."
```

---

## Task 3: Measurement spike

**Files:**
- Create: `gallery-samples/21-sticker-press/templates.js` (profiles + a handful of builders only)
- Create: `gallery-samples/21-sticker-press/hierarchy.js` (minimal)
- Create: `scratch/spike_sticker_bytes.mjs` (not committed)
- Already present: `tests/unit/gallerySamples/stickerPressScope.ts` — the shared loader every
  later test uses. Do not modify it.

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: `DEVICES`, an ordered array of four device profiles, each
  `{ id, name, width, height, structural: number[], wideStructural: [number, number][], pictorial: number[], rail: 'full' | 'reduced', palette: 'colour' | 'ink' }`.
  Also `svgMarkup(pathData, fill, stroke)` returning a complete `<svg>` string.

**This task is evidence, not a feature.** Every byte figure in the spec is arithmetic. Three assumptions get tested here and any of them can resize the product: ~405 bytes per placement, ~5:1 gzip on stored commits, and `<pattern>` surviving both renderers.

- [ ] **Step 1: Write the profiles and markup helper**

Create `gallery-samples/21-sticker-press/templates.js`:

```js
// The Sticker Press — templates script.
// Section 1: device profiles.

const OUTLINE = '#23292f';

const DEVICES = [
    { id: 'paper_pro', name: 'Paper Pro', width: 509, height: 679,
      structural: [48, 32, 20], wideStructural: [[192, 24], [128, 16], [80, 10]],
      pictorial: [48, 24], rail: 'full', palette: 'colour' },
    { id: 'move', name: 'Paper Pro Move', width: 260, height: 463,
      structural: [36, 24, 16], wideStructural: [[144, 18], [96, 12], [60, 8]],
      pictorial: [36, 18], rail: 'reduced', palette: 'colour' },
    { id: 'note_air', name: 'Boox Note Air 5C', width: 446, height: 595,
      structural: [42, 28, 18], wideStructural: [[168, 21], [112, 14], [70, 9]],
      pictorial: [42, 21], rail: 'full', palette: 'colour' },
    { id: 'pure', name: 'Paper Pure', width: 447, height: 596,
      structural: [42, 28, 18], wideStructural: [[168, 21], [112, 14], [70, 9]],
      pictorial: [42, 21], rail: 'full', palette: 'ink' },
];

// Section 2: shape builders. Each returns SVG path data for a 24x24 viewBox.

const round1 = n => Math.round(n * 10) / 10;

const builders = {
    // A regular star. points >= 3, innerRatio in (0, 1).
    star(points, innerRatio) {
        const segments = [];
        for (let i = 0; i < points * 2; i += 1) {
            const radius = (i % 2 === 0 ? 11 : 11 * innerRatio);
            const angle = (Math.PI * i) / points - Math.PI / 2;
            segments.push(`${round1(12 + radius * Math.cos(angle))} ${round1(12 + radius * Math.sin(angle))}`);
        }
        return `M${segments.join('L')}Z`;
    },
    // A leaf with an optional centre vein.
    leaf(vein) {
        const body = 'M12 2C6 7 4 14 12 22C20 14 18 7 12 2Z';
        return vein ? `${body}M12 5V20` : body;
    },
};

const svgMarkup = (pathData, fill, stroke) =>
    `<svg viewBox="0 0 24 24"><path d="${pathData}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/></svg>`;
```

- [ ] **Step 2: Measure one sticker's markup**

Create `scratch/spike_sticker_bytes.mjs`:

```js
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const source = readFileSync('gallery-samples/21-sticker-press/templates.js', 'utf8');
const SENTINEL = '// ---- GENERATE (tests strip below this line) ----';
const cut = source.indexOf(SENTINEL);
const body = cut === -1 ? source : source.slice(0, cut);
const scope = new Function(`${body}\nreturn { DEVICES, builders, svgMarkup };`)();

const samples = [
    scope.svgMarkup(scope.builders.star(5, 0.5), '#f0c674', '#23292f'),
    scope.svgMarkup(scope.builders.star(8, 0.4), '#5b93c4', '#23292f'),
    scope.svgMarkup(scope.builders.leaf(true), '#86c08e', '#23292f'),
];

const bytes = samples.map(markup => Buffer.byteLength(markup, 'utf8'));
console.log('markup bytes:', bytes, 'mean', Math.round(bytes.reduce((a, b) => a + b) / bytes.length));

// One placement = element JSON + escaped markup.
const element = {
    id: 'sp_0001', type: 'svg', x: 24, y: 36, w: 48, h: 48, rotation: 0,
    fill: '', stroke: '', strokeWidth: 0, opacity: 1, zIndex: 1,
    svgContent: samples[0],
};
const placementBytes = Buffer.byteLength(JSON.stringify(element), 'utf8');
console.log('placement bytes:', placementBytes);
console.log('projected 4 variants:', ((placementBytes * 5160 * 4) / 1024 / 1024).toFixed(2), 'MB');

const projected = JSON.stringify(Array.from({ length: 5160 * 4 }, (_, i) => ({ ...element, id: `sp_${i}` })));
console.log('gzip ratio:', (projected.length / gzipSync(projected).length).toFixed(1), ': 1');
```

- [ ] **Step 3: Run the measurement and record it**

Run: `node scratch/spike_sticker_bytes.mjs`

Record all four numbers in the task's commit message. Decision gates:

- Mean markup > 400 bytes → the builders are too detailed. Simplify before proceeding.
- Projected total > 14 MB → cut colourway depth or sticker count. Escalate rather than proceeding.
- Gzip ratio < 3:1 → the ~1.5 MB stored-commit estimate is wrong; note it, but it does not block (50 MB quota absorbs it).

- [ ] **Step 4: Verify `<pattern>` survives DOMPurify**

Add to `scratch/spike_sticker_bytes.mjs`:

```js
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const purify = createDOMPurify(new JSDOM('').window);
const halftone = '<svg viewBox="0 0 24 24"><defs><pattern id="h3" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#3d4650"/></pattern></defs><path d="M2 2H22V22H2Z" fill="url(#h3)" stroke="#23292f" stroke-width="1.5"/></svg>';
const clean = purify.sanitize(halftone, { USE_PROFILES: { svg: true, svgFilters: true } });
console.log('pattern survives DOMPurify:', clean.includes('<pattern') && clean.includes('url(#h3)'));
```

Run: `node scratch/spike_sticker_bytes.mjs`
Expected: `pattern survives DOMPurify: true`.

If false, the `pure` variant cannot use `<pattern>` and must fall back to stippled paths. Record the finding and flag it before Task 11 — it changes that variant's byte cost materially.

- [ ] **Step 5: Verify `<pattern>` survives PDF export**

Write a throwaway spec that renders the halftone markup through the real export path and asserts the produced PDF is non-trivial:

```js
// scratch/spike_pattern_pdf.mjs — run with: npx vite-node scratch/spike_pattern_pdf.mjs
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;

const { generatePdf } = await import('../services/pdfService.ts');
// Build a one-page state whose single element is the halftone SVG above,
// export it, and assert the resulting byte array is larger than an empty page.
```

Run it and confirm the export completes without a `console.error` from `pdfService.ts:1192-1194` — that is the swallowed-failure path, and it is how a pattern would silently vanish.

- [ ] **Step 6: Commit the profiles and the findings**

```bash
git add gallery-samples/21-sticker-press/templates.js gallery-samples/21-sticker-press/hierarchy.js
git commit -m "feat(sticker-press): device profiles and byte measurement

Measured: <mean markup> bytes/sticker, <placement> bytes/placement,
<total> MB projected for four variants, <ratio>:1 gzip.
<pattern> survives DOMPurify: <yes/no>; survives svg2pdf: <yes/no>."
```

---

## Task 4: Structural builders — tabs, banners, labels

**Files:**
- Modify: `gallery-samples/21-sticker-press/templates.js` (Section 2)
- Test: `tests/unit/gallerySamples/stickerPressBuilders.test.ts` (create)

**Interfaces:**
- Consumes: `builders`, `svgMarkup`, `round1` from Task 3.
- Produces, all on the `builders` object, all returning path-data strings for a 24×24 viewBox:
  - `tab(style, notch)` — `style` in `'rounded' | 'square' | 'angled'`, `notch` boolean
  - `flag(tail)` — `tail` in `'swallow' | 'point' | 'straight'`
  - `bookmark(ribbon)` — boolean
  - `cornerTriangle(fold)` — boolean
  - `dogEar(size)` — number 1–3
  - `banner(tails, fold)` — `tails` boolean, `fold` boolean
  - `pennant(notch)` — boolean
  - `scroll(curls)` — number 1–2
  - `rosette(petals)` — number 8–16
  - `tape(torn)` — boolean
  - `tag(hole)` — boolean
  - `stickyNote(style)` — `'plain' | 'lined' | 'torn'`
  - `speechBubble(tail)` — `'left' | 'right' | 'none'`

74 stickers across categories 1–3 are produced by these thirteen builders under different arguments; the registry in Task 9 supplies the arguments.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/gallerySamples/stickerPressBuilders.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadStickerPressScope, runStickerPressGenerator } from './stickerPressScope';

const scope = loadStickerPressScope(['builders', 'svgMarkup', 'DEVICES']);

const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]+$/;

const TAB_BUILDERS: Array<[string, unknown[]]> = [
    ['tab', ['rounded', false]], ['tab', ['square', true]], ['tab', ['angled', false]],
    ['flag', ['swallow']], ['flag', ['point']], ['flag', ['straight']],
    ['bookmark', [true]], ['cornerTriangle', [false]], ['dogEar', [2]],
    ['banner', [true, false]], ['pennant', [true]], ['scroll', [2]], ['rosette', [12]],
    ['tape', [true]], ['tag', [true]], ['stickyNote', ['lined']], ['speechBubble', ['left']],
];

describe('sticker press structural builders', () => {
    it.each(TAB_BUILDERS)('%s produces valid path data', (name, args) => {
        const result = scope.builders[name](...(args as unknown[]));
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
        expect(result).toMatch(PATH_DATA);
    });

    it.each(TAB_BUILDERS)('%s stays inside the 24x24 viewBox', (name, args) => {
        const result = scope.builders[name](...(args as unknown[]));
        const numbers = result.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
        expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...numbers)).toBeLessThanOrEqual(24);
    });

    it.each(TAB_BUILDERS)('%s fits the markup byte budget', (name, args) => {
        const markup = scope.svgMarkup(scope.builders[name](...(args as unknown[])), '#f0c674', '#23292f');
        expect(Buffer.byteLength(markup, 'utf8')).toBeLessThanOrEqual(400);
    });

    it.each(TAB_BUILDERS)('%s is deterministic', (name, args) => {
        expect(scope.builders[name](...(args as unknown[])))
            .toBe(scope.builders[name](...(args as unknown[])));
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/gallerySamples/stickerPressBuilders.test.ts`
Expected: FAIL — `scope.builders.tab is not a function`.

- [ ] **Step 3: Implement the thirteen builders**

Add to the `builders` object in Section 2. Two worked examples showing the house style — integer or one-decimal coordinates, a single closed path, no whitespace beyond what path data needs:

```js
    // Index tab. Notch cuts a V into the right edge for a filing-tab look.
    tab(style, notch) {
        const right = notch ? 'H20L17 12L20 18' : 'H20V18';
        const lead = style === 'rounded' ? 'M4 6Q4 3 7 3'
            : style === 'angled' ? 'M4 6L7 3'
            : 'M4 3';
        return `${lead}H20V6${right}H4Z`;
    },
    // Ribbon banner. Tails add the notched ends, fold adds the underlap.
    banner(tails, fold) {
        const body = 'M2 7H22V17H2Z';
        const tailShapes = tails ? 'M2 7L6 12L2 17ZM22 7L18 12L22 17Z' : '';
        const foldShape = fold ? 'M4 17V20L7 17Z' : '';
        return `${body}${tailShapes}${foldShape}`;
    },
```

Implement the remaining eleven in the same style. Every coordinate must fall within 0–24 inclusive, and every builder must be a pure function of its arguments.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/gallerySamples/stickerPressBuilders.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gallery-samples/21-sticker-press/templates.js tests/unit/gallerySamples/stickerPressBuilders.test.ts
git commit -m "feat(sticker-press): tab, banner and label shape builders"
```

---

## Task 5: Structural builders — arrows, boxes, stars, dividers

**Files:**
- Modify: `gallery-samples/21-sticker-press/templates.js` (Section 2)
- Modify: `tests/unit/gallerySamples/stickerPressBuilders.test.ts`

**Interfaces:**
- Consumes: Task 4's `builders` object.
- Produces:
  - `arrow(curve, head, tail)` — `curve` in `'straight' | 'curved' | 'looped' | 'elbow' | 'uturn'`, `head` in `'line' | 'block' | 'doodle'`, `tail` in `'plain' | 'dashed' | 'branch'`
  - `hand(direction)` — `'left' | 'right' | 'up' | 'down'`
  - `checkbox(state)` — `'empty' | 'checked' | 'crossed'`
  - `bullet(shape)` — `'dot' | 'star' | 'arrow' | 'diamond' | 'square'`
  - `pip(filled)` — boolean
  - `priorityFlag(level)` — number 1–3
  - `star(points, innerRatio)` — already exists from Task 3; keep it
  - `sparkle(arms)` — number 4–8
  - `burst(spikes, jagged)` — number 8–16, boolean
  - `seal(scallops)` — number 10–20
  - `medal(ribbon)` — boolean
  - `rule(style)` — `'dotted' | 'dashed' | 'wave' | 'zigzag' | 'double'`
  - `flourish(side)` — `'left' | 'right' | 'both'`
  - `bracket(side)` — `'left' | 'right'`
  - `boxFrame(corners)` — `'square' | 'round' | 'ornate'`

106 stickers across categories 4–7 come from these builders.

- [ ] **Step 1: Extend the failing test**

Append a second table to `tests/unit/gallerySamples/stickerPressBuilders.test.ts` and reuse the same four assertions by extracting them. Replace the `TAB_BUILDERS` constant and the four `it.each` blocks with:

```ts
const STRUCTURAL_BUILDERS: Array<[string, unknown[]]> = [
    ['tab', ['rounded', false]], ['tab', ['square', true]], ['tab', ['angled', false]],
    ['flag', ['swallow']], ['flag', ['point']], ['flag', ['straight']],
    ['bookmark', [true]], ['cornerTriangle', [false]], ['dogEar', [2]],
    ['banner', [true, false]], ['pennant', [true]], ['scroll', [2]], ['rosette', [12]],
    ['tape', [true]], ['tag', [true]], ['stickyNote', ['lined']], ['speechBubble', ['left']],
    ['arrow', ['straight', 'block', 'plain']], ['arrow', ['curved', 'line', 'dashed']],
    ['arrow', ['looped', 'doodle', 'plain']], ['arrow', ['elbow', 'block', 'branch']],
    ['arrow', ['uturn', 'line', 'plain']], ['hand', ['right']],
    ['checkbox', ['empty']], ['checkbox', ['checked']], ['checkbox', ['crossed']],
    ['bullet', ['dot']], ['bullet', ['star']], ['bullet', ['diamond']],
    ['pip', [true]], ['priorityFlag', [3]],
    ['star', [5, 0.5]], ['star', [8, 0.4]], ['sparkle', [4]], ['sparkle', [8]],
    ['burst', [12, true]], ['seal', [16]], ['medal', [true]],
    ['rule', ['dotted']], ['rule', ['wave']], ['rule', ['zigzag']], ['rule', ['double']],
    ['flourish', ['both']], ['bracket', ['left']], ['boxFrame', ['ornate']],
];
```

and rename every `it.each(TAB_BUILDERS)` to `it.each(STRUCTURAL_BUILDERS)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/gallerySamples/stickerPressBuilders.test.ts`
Expected: FAIL — `scope.builders.arrow is not a function`.

- [ ] **Step 3: Implement the builders**

Add them to Section 2. One worked example for the composition pattern, since `arrow` is the most parameterised:

```js
    // Arrow. Shaft geometry, head shape and tail decoration compose freely.
    arrow(curve, head, tail) {
        const shaft = curve === 'curved' ? 'M3 18Q12 18 17 8'
            : curve === 'looped' ? 'M3 18Q12 22 14 14Q15 8 17 8'
            : curve === 'elbow' ? 'M3 18V12H17'
            : curve === 'uturn' ? 'M5 20V10Q5 5 11 5Q17 5 17 10V12'
            : 'M3 18L17 8';
        const headShape = head === 'block' ? 'M17 8L21 6L18 12Z'
            : head === 'doodle' ? 'M17 8L21 7M17 8L18 12'
            : 'M17 8L21 7M17 8L18 12';
        const tailShape = tail === 'branch' ? 'M3 18L7 14M3 18L7 22' : '';
        return `${shaft}${headShape}${tailShape}`;
    },
```

Note that `tail: 'dashed'` is expressed with a `stroke-dasharray` attribute at markup-assembly time, not in the path data — Task 10's `svgMarkup` gains an optional attribute argument for it. Keep the path data itself solid.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/gallerySamples/stickerPressBuilders.test.ts`
Expected: PASS, all 45 rows × 4 assertions.

- [ ] **Step 5: Commit**

```bash
git add gallery-samples/21-sticker-press/templates.js tests/unit/gallerySamples/stickerPressBuilders.test.ts
git commit -m "feat(sticker-press): arrow, marker, star and divider builders"
```

---

## Task 6: Pictorial builders — nature

**Files:**
- Modify: `gallery-samples/21-sticker-press/templates.js` (Section 2)
- Modify: `tests/unit/gallerySamples/stickerPressBuilders.test.ts`

**Interfaces:**
- Consumes: Task 5's `builders`.
- Produces, covering categories 8–10 (92 stickers):
  - Weather: `sun(rays)`, `cloud(puffs)`, `rain(drops)`, `storm(bolt)`, `snowflake(arms)`, `moon(phase)` where phase is 0–7, `rainbow(bands)`, `umbrella(open)`, `wind(gusts)`
  - Botanical: `leaf(vein)` (exists), `fern(fronds)`, `branch(leaves)`, `flower(petals, centre)`, `sprig(berries)`, `mushroom(spots)`, `acorn(cap)`, `cactus(arms)`, `succulent(rings)`, `tree(shape)` where shape is `'round' | 'pine' | 'palm'`
  - Animals: `cat(pose)`, `dog(ears)`, `bird(wings)`, `butterfly(pattern)`, `bee(stripes)`, `ladybug(spots)`, `snail(swirls)`, `fox(tail)`, `bear(ears)`, `rabbit(ears)`, `whale(spout)`, `fish(fins)`, `owl(tufts)`

- [ ] **Step 1: Extend the failing test**

Add a `PICTORIAL_BUILDERS` table alongside `STRUCTURAL_BUILDERS`, with at least one row per builder above, and duplicate the four `it.each` blocks against it. Pictorial stickers carry more detail, so relax only the byte assertion:

```ts
    it.each(PICTORIAL_BUILDERS)('%s fits the markup byte budget', (name, args) => {
        const markup = scope.svgMarkup(scope.builders[name](...(args as unknown[])), '#86c08e', '#23292f');
        expect(Buffer.byteLength(markup, 'utf8')).toBeLessThanOrEqual(400);
    });
```

Add one aggregate assertion that guards the *average*, which is the figure the byte budget actually depends on:

```ts
    it('keeps the mean markup within the 230-byte budget', () => {
        const all = [...STRUCTURAL_BUILDERS, ...PICTORIAL_BUILDERS];
        const total = all.reduce((sum, [name, args]) => sum
            + Buffer.byteLength(scope.svgMarkup(scope.builders[name](...(args as unknown[])), '#86c08e', '#23292f'), 'utf8'), 0);
        expect(Math.round(total / all.length)).toBeLessThanOrEqual(230);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/gallerySamples/stickerPressBuilders.test.ts`
Expected: FAIL — `scope.builders.sun is not a function`.

- [ ] **Step 3: Implement the builders**

Two worked examples showing how detail is kept cheap — radial repetition computed rather than enumerated, and a single path rather than several:

```js
    // Sun with evenly spaced rays.
    sun(rays) {
        const spokes = [];
        for (let i = 0; i < rays; i += 1) {
            const angle = (Math.PI * 2 * i) / rays;
            spokes.push(`M${round1(12 + 8 * Math.cos(angle))} ${round1(12 + 8 * Math.sin(angle))}`
                + `L${round1(12 + 11 * Math.cos(angle))} ${round1(12 + 11 * Math.sin(angle))}`);
        }
        return `M12 5A7 7 0 1 1 11.9 5Z${spokes.join('')}`;
    },
    // Flower. petals >= 4; centre adds the seed circle.
    flower(petals, centre) {
        const shapes = [];
        for (let i = 0; i < petals; i += 1) {
            const angle = (Math.PI * 2 * i) / petals - Math.PI / 2;
            const cx = round1(12 + 6 * Math.cos(angle));
            const cy = round1(12 + 6 * Math.sin(angle));
            shapes.push(`M${cx} ${cy}A3 3 0 1 1 ${round1(cx - 0.1)} ${cy}Z`);
        }
        return `${shapes.join('')}${centre ? 'M12 9A3 3 0 1 1 11.9 9Z' : ''}`;
    },
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/gallerySamples/stickerPressBuilders.test.ts`
Expected: PASS, including the mean-byte assertion.

- [ ] **Step 5: Commit**

```bash
git add gallery-samples/21-sticker-press/templates.js tests/unit/gallerySamples/stickerPressBuilders.test.ts
git commit -m "feat(sticker-press): weather, botanical and animal builders"
```

---

## Task 7: Pictorial builders — daily life

**Files:**
- Modify: `gallery-samples/21-sticker-press/templates.js` (Section 2)
- Modify: `tests/unit/gallerySamples/stickerPressBuilders.test.ts`

**Interfaces:**
- Consumes: Task 6's `builders`.
- Produces, covering categories 11–14 (110 stickers):
  - Food: `mug(steam)`, `teapot(spout)`, `bottle(cap)`, `cake(tiers)`, `cupcake(swirl)`, `donut(sprinkles)`, `croissant(layers)`, `pizza(slices)`, `fruit(kind)` where kind is `'apple' | 'pear' | 'cherry' | 'banana' | 'grape' | 'lemon'`, `veg(kind)` where kind is `'carrot' | 'broccoli' | 'pepper' | 'leek'`, `iceCream(scoops)`
  - Faces: `face(mood)` where mood is `'smile' | 'laugh' | 'wink' | 'sad' | 'angry' | 'sleepy' | 'love' | 'thinking'`, `moodBlob(mood)` taking the same set
  - Study/work: `pencil(sharpened)`, `brush(bristles)`, `ruler(marks)`, `scissors(open)`, `paperclip(turns)`, `pushpin(angled)`, `notebook(rings)`, `folder(tab)`, `calendar(rows)`, `clock(hands)`, `laptop(open)`, `envelope(sealed)`, `gear(teeth)`, `bulb(rays)`, `chart(kind)` where kind is `'bar' | 'line' | 'pie'`
  - Health: `heart(style)` where style is `'solid' | 'outline' | 'beat'`, `drop(ripple)`, `pill(split)`, `bandage(dots)`, `dumbbell(plates)`, `shoe(laces)`, `bicycle(spokes)`, `sleepMoon(zzz)`, `candle(flame)`, `timer(dial)`

- [ ] **Step 1: Extend the failing test**

Add every builder above to `PICTORIAL_BUILDERS` with at least one argument row each.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/gallerySamples/stickerPressBuilders.test.ts`
Expected: FAIL — `scope.builders.mug is not a function`.

- [ ] **Step 3: Implement the builders**

Follow the established style. One worked example for the enumerated-variant pattern, which `face`, `fruit`, `veg` and `chart` all share:

```js
    // Face. One circle plus per-mood features, kept to a single path.
    face(mood) {
        const head = 'M12 2A10 10 0 1 1 11.9 2Z';
        const eyes = mood === 'wink' ? 'M8 10H10M15 10A1 1 0 1 1 14.9 10Z'
            : mood === 'sleepy' ? 'M7 10H10M14 10H17'
            : mood === 'love' ? 'M8 9L9 11L10 9M14 9L15 11L16 9'
            : 'M9 10A1 1 0 1 1 8.9 10ZM15 10A1 1 0 1 1 14.9 10Z';
        const mouth = mood === 'laugh' ? 'M7 14Q12 20 17 14Z'
            : mood === 'sad' ? 'M8 17Q12 13 16 17'
            : mood === 'angry' ? 'M8 17H16M7 7L10 9M17 7L14 9'
            : mood === 'thinking' ? 'M9 16H14'
            : 'M8 15Q12 18 16 15';
        return `${head}${eyes}${mouth}`;
    },
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/gallerySamples/stickerPressBuilders.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gallery-samples/21-sticker-press/templates.js tests/unit/gallerySamples/stickerPressBuilders.test.ts
git commit -m "feat(sticker-press): food, face, work and health builders"
```

---

## Task 8: Pictorial builders — places, occasions, symbols

**Files:**
- Modify: `gallery-samples/21-sticker-press/templates.js` (Section 2)
- Modify: `tests/unit/gallerySamples/stickerPressBuilders.test.ts`

**Interfaces:**
- Consumes: Task 7's `builders`.
- Produces, covering categories 15–18 (100 stickers):
  - Travel: `plane(trail)`, `suitcase(straps)`, `backpack(pockets)`, `mapPin(hole)`, `compass(needle)`, `globe(meridians)`, `camera(flash)`, `ticket(perforated)`, `passport(crest)`, `train(carriages)`, `tent(guys)`, `mountains(peaks)`
  - Celebration: `gift(bow)`, `balloon(string)`, `partyHat(stripes)`, `confetti(pieces)`, `firework(bursts)`, `pumpkin(face)`, `holly(berries)`, `snowman(sections)`, `ornament(pattern)`, `shamrock(leaves)`
  - Money/home: `coin(currency)` where currency is `'generic' | 'stack'`, `note(fold)`, `wallet(clasp)`, `piggyBank(slot)`, `receipt(zigzag)`, `shoppingBag(handles)`, `house(storeys)`, `door(panels)`, `lamp(shade)`, `bed(pillows)`, `tool(kind)` where kind is `'hammer' | 'wrench' | 'screwdriver'`
  - Symbols: `mark(kind)` where kind is `'exclamation' | 'question' | 'warning'`, `hourglass(sand)`, `battery(level)` 0–3, `wifi(bars)`, `sync(arrows)`, `infinity()`, `hash()`, `note(kind)` — **rename to `musicNote(kind)`** to avoid colliding with the banknote builder — `'quaver' | 'crotchet' | 'beamed'`, `dice(pips)` 1–6, `puzzle(nubs)`, `flame(tongues)`

Note the deliberate rename: `note` is already taken by the banknote in the money category. The music builder is `musicNote`.

- [ ] **Step 1: Extend the failing test**

Add every builder above to `PICTORIAL_BUILDERS`. Include an explicit collision guard:

```ts
    it('has no duplicate builder names', () => {
        const names = Object.keys(scope.builders);
        expect(new Set(names).size).toBe(names.length);
    });

    it('exposes exactly the builders the registry will reference', () => {
        expect(Object.keys(scope.builders).length).toBeGreaterThanOrEqual(88);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/gallerySamples/stickerPressBuilders.test.ts`
Expected: FAIL — `scope.builders.plane is not a function`.

- [ ] **Step 3: Implement the builders**

Follow the established style throughout.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/gallerySamples/stickerPressBuilders.test.ts`
Expected: PASS, including the mean-byte and no-duplicate assertions.

- [ ] **Step 5: Commit**

```bash
git add gallery-samples/21-sticker-press/templates.js tests/unit/gallerySamples/stickerPressBuilders.test.ts
git commit -m "feat(sticker-press): travel, celebration, home and symbol builders"
```

---

## Task 9: The 500-sticker registry

**Files:**
- Modify: `gallery-samples/21-sticker-press/templates.js` (Section 3)
- Test: `tests/unit/gallerySamples/stickerPressRegistry.test.ts` (create)

**Interfaces:**
- Consumes: every builder from Tasks 4–8.
- Produces:
  - `CATEGORIES` — 18 entries, `{ id, name, family: 'structural' | 'pictorial', count }`
  - `REGISTRY` — 500 entries, `{ id, name, cat, builder, args, natural, aspect }` where `aspect` is `'square' | 'wide'`
  - `STRUCTURAL_COLOURWAYS` and `INK_TREATMENTS` — 6 entries each, `{ id, name, fill }`
  - `PICTORIAL_TREATMENTS` — 3 entries, `{ id, name }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/gallerySamples/stickerPressRegistry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadStickerPressScope, runStickerPressGenerator } from './stickerPressScope';

const scope = loadStickerPressScope([
    'builders', 'REGISTRY', 'CATEGORIES',
    'STRUCTURAL_COLOURWAYS', 'INK_TREATMENTS', 'PICTORIAL_TREATMENTS', 'svgMarkup',
]);

const luminance = (hex: string) => {
    const digits = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map(offset => parseInt(digits.slice(offset, offset + 2), 16));
    return 0.299 * r + 0.587 * g + 0.114 * b;
};

describe('sticker press registry', () => {
    it('holds exactly 500 stickers', () => {
        expect(scope.REGISTRY).toHaveLength(500);
    });

    it('splits 180 structural and 320 pictorial', () => {
        const family = (cat: string) => scope.CATEGORIES.find((c: any) => c.id === cat).family;
        const structural = scope.REGISTRY.filter((s: any) => family(s.cat) === 'structural');
        expect(structural).toHaveLength(180);
        expect(scope.REGISTRY.length - structural.length).toBe(320);
    });

    it('declares 18 categories whose counts sum to 500', () => {
        expect(scope.CATEGORIES).toHaveLength(18);
        expect(scope.CATEGORIES.reduce((sum: number, c: any) => sum + c.count, 0)).toBe(500);
    });

    it('matches each category count to its actual membership', () => {
        scope.CATEGORIES.forEach((category: any) => {
            const actual = scope.REGISTRY.filter((s: any) => s.cat === category.id).length;
            expect(`${category.id}:${actual}`).toBe(`${category.id}:${category.count}`);
        });
    });

    it('gives every sticker a unique id and a unique name', () => {
        const ids = scope.REGISTRY.map((s: any) => s.id);
        const names = scope.REGISTRY.map((s: any) => s.name);
        expect(new Set(ids).size).toBe(500);
        expect(new Set(names).size).toBe(500);
    });

    it('references only builders that exist', () => {
        scope.REGISTRY.forEach((sticker: any) => {
            expect(typeof scope.builders[sticker.builder]).toBe('function');
        });
    });

    it('renders every sticker within the byte budget', () => {
        const sizes = scope.REGISTRY.map((sticker: any) => Buffer.byteLength(
            scope.svgMarkup(scope.builders[sticker.builder](...sticker.args), sticker.natural, '#23292f'),
            'utf8',
        ));
        expect(Math.max(...sizes)).toBeLessThanOrEqual(400);
        expect(Math.round(sizes.reduce((a: number, b: number) => a + b) / sizes.length)).toBeLessThanOrEqual(230);
    });

    it('keeps every natural colour a 6-digit hex', () => {
        scope.REGISTRY.forEach((sticker: any) => {
            expect(sticker.natural).toMatch(/^#[0-9a-f]{6}$/i);
        });
    });

    it('separates the six colourways by luminance', () => {
        const values = scope.STRUCTURAL_COLOURWAYS
            .filter((c: any) => c.fill !== 'none')
            .map((c: any) => luminance(c.fill))
            .sort((a: number, b: number) => a - b);
        for (let i = 1; i < values.length; i += 1) {
            expect(values[i] - values[i - 1]).toBeGreaterThanOrEqual(25);
        }
        expect(Math.min(...values) - luminance('#23292f')).toBeGreaterThanOrEqual(25);
    });

    it('offers six ink treatments and three pictorial treatments', () => {
        expect(scope.INK_TREATMENTS).toHaveLength(6);
        expect(scope.PICTORIAL_TREATMENTS).toHaveLength(3);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/gallerySamples/stickerPressRegistry.test.ts`
Expected: FAIL — `REGISTRY is not defined`.

- [ ] **Step 3: Write Section 3**

```js
// Section 3: categories, colourways and the 500-sticker registry.

const CATEGORIES = [
    { id: 'tabs',      name: 'Index tabs & flags',     family: 'structural', count: 28 },
    { id: 'banners',   name: 'Banners & ribbons',      family: 'structural', count: 24 },
    { id: 'labels',    name: 'Labels & plates',        family: 'structural', count: 22 },
    { id: 'arrows',    name: 'Arrows & pointers',      family: 'structural', count: 28 },
    { id: 'markers',   name: 'Boxes, bullets, markers',family: 'structural', count: 24 },
    { id: 'stars',     name: 'Stars, sparkles, bursts',family: 'structural', count: 22 },
    { id: 'dividers',  name: 'Dividers, corners, frames', family: 'structural', count: 32 },
    { id: 'weather',   name: 'Weather & sky',          family: 'pictorial',  count: 24 },
    { id: 'botanical', name: 'Botanical',              family: 'pictorial',  count: 34 },
    { id: 'animals',   name: 'Animals',                family: 'pictorial',  count: 34 },
    { id: 'food',      name: 'Food & drink',           family: 'pictorial',  count: 32 },
    { id: 'faces',     name: 'Faces & moods',          family: 'pictorial',  count: 22 },
    { id: 'work',      name: 'Study & work',           family: 'pictorial',  count: 30 },
    { id: 'health',    name: 'Health & self-care',     family: 'pictorial',  count: 26 },
    { id: 'travel',    name: 'Travel & places',        family: 'pictorial',  count: 24 },
    { id: 'occasions', name: 'Celebration & seasons',  family: 'pictorial',  count: 24 },
    { id: 'home',      name: 'Money & home',           family: 'pictorial',  count: 22 },
    { id: 'symbols',   name: 'Symbols & misc',         family: 'pictorial',  count: 30 },
];

const STRUCTURAL_COLOURWAYS = [
    { id: 'outline', name: 'Outline', fill: 'none' },
    { id: 'amber',   name: 'Amber',   fill: '#f0c674' },
    { id: 'green',   name: 'Green',   fill: '#86c08e' },
    { id: 'blue',    name: 'Blue',    fill: '#5b93c4' },
    { id: 'red',     name: 'Red',     fill: '#b04a46' },
    { id: 'ink',     name: 'Ink',     fill: '#3d4650' },
];

const INK_TREATMENTS = [
    { id: 'outline',  name: 'Outline',        fill: 'none' },
    { id: 'light',    name: 'Light halftone', fill: 'url(#ht_light)' },
    { id: 'medium',   name: 'Medium halftone',fill: 'url(#ht_medium)' },
    { id: 'dense',    name: 'Dense halftone', fill: 'url(#ht_dense)' },
    { id: 'grey',     name: 'Mid grey',       fill: '#7a8290' },
    { id: 'solid',    name: 'Solid ink',      fill: '#3d4650' },
];

const PICTORIAL_TREATMENTS = [
    { id: 'natural', name: 'Natural' },
    { id: 'mono',    name: 'Mono' },
    { id: 'pastel',  name: 'Pastel' },
];

const REGISTRY = [
    { id: 'tab_round',  name: 'Rounded tab', cat: 'tabs', builder: 'tab', args: ['rounded', false], natural: '#5b93c4', aspect: 'wide' },
    { id: 'tab_notch',  name: 'Notched tab', cat: 'tabs', builder: 'tab', args: ['square', true],   natural: '#5b93c4', aspect: 'wide' },
    // ... 498 more, grouped by category in CATEGORIES order.
];
```

Write all 500 entries, grouped by category in `CATEGORIES` order, with per-category counts matching the table exactly. Ids are lowercase snake_case and unique; names are human-readable, unique, and are what the A–Z index sorts on. `aspect: 'wide'` applies to tabs, banners, tape, rules and dividers; everything else is `'square'`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/gallerySamples/stickerPressRegistry.test.ts`
Expected: PASS, all ten.

- [ ] **Step 5: Commit**

```bash
git add gallery-samples/21-sticker-press/templates.js tests/unit/gallerySamples/stickerPressRegistry.test.ts
git commit -m "feat(sticker-press): 500-sticker registry with categories and colourways"
```

---

## Task 10: Sheet layout engine

**Files:**
- Modify: `gallery-samples/21-sticker-press/templates.js` (Section 4)
- Test: `tests/unit/gallerySamples/stickerPressLayout.test.ts` (create)

**Interfaces:**
- Consumes: `DEVICES`, `REGISTRY`, `CATEGORIES`, colourway tables, `builders`, `svgMarkup`.
- Produces:
  - `svgMarkup(pathData, fill, stroke, extraAttrs)` — extended with an optional fourth argument for `stroke-dasharray` and similar
  - `planSheets(device)` → `Array<{ id, category, colourway, family, clusters: Array<{ sticker, x, y, cells: Array<{ size, x, y }> }> }>`
  - `buildStickerElements(device, sheet, nextId)` → `TemplateElement[]`
  - `nextElementId()` — monotonic counter producing `sp_0001`, `sp_0002`, … reset per variant

- [ ] **Step 1: Write the failing test**

Create `tests/unit/gallerySamples/stickerPressLayout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadStickerPressScope, runStickerPressGenerator } from './stickerPressScope';

const scope = loadStickerPressScope([
    'DEVICES', 'REGISTRY', 'planSheets', 'buildStickerElements', 'resetElementIds',
    'buildRail', 'buildSwitcher',
]);

const device = (id: string) => scope.DEVICES.find((d: any) => d.id === id);

describe('sticker press layout', () => {
    it.each(['paper_pro', 'move', 'note_air', 'pure'])('%s places every sticker in every colourway', id => {
        const sheets = scope.planSheets(device(id));
        const placed = new Set<string>();
        sheets.forEach((sheet: any) => sheet.clusters.forEach((cluster: any) => {
            placed.add(`${cluster.sticker.id}:${sheet.colourway}`);
        }));
        const structural = scope.REGISTRY.filter((s: any) => sheets.some((sh: any) => sh.family === 'structural' && sh.category === s.cat));
        expect(placed.size).toBe(structural.length * 6 + (500 - structural.length) * 3);
    });

    it.each(['paper_pro', 'move', 'note_air', 'pure'])('%s keeps every cluster inside the page', id => {
        const profile = device(id);
        const sheets = scope.planSheets(profile);
        sheets.forEach((sheet: any) => sheet.clusters.forEach((cluster: any) => {
            cluster.cells.forEach((cell: any) => {
                expect(cell.x).toBeGreaterThanOrEqual(0);
                expect(cell.y).toBeGreaterThanOrEqual(0);
                expect(cell.x + cell.size).toBeLessThanOrEqual(profile.width);
                expect(cell.y + cell.size).toBeLessThanOrEqual(profile.height);
            });
        }));
    });

    it('gives structural clusters three sizes and pictorial clusters two', () => {
        const sheets = scope.planSheets(device('paper_pro'));
        sheets.forEach((sheet: any) => sheet.clusters.forEach((cluster: any) => {
            expect(cluster.cells).toHaveLength(sheet.family === 'structural' ? 3 : 2);
        }));
    });

    it('produces deterministic element ids', () => {
        scope.resetElementIds();
        const first = scope.buildStickerElements(device('paper_pro'), scope.planSheets(device('paper_pro'))[0]);
        scope.resetElementIds();
        const second = scope.buildStickerElements(device('paper_pro'), scope.planSheets(device('paper_pro'))[0]);
        expect(first.map((e: any) => e.id)).toEqual(second.map((e: any) => e.id));
    });

    it('emits svg elements with a viewBox and no root width or height', () => {
        scope.resetElementIds();
        const elements = scope.buildStickerElements(device('paper_pro'), scope.planSheets(device('paper_pro'))[0]);
        const svgs = elements.filter((e: any) => e.type === 'svg');
        expect(svgs.length).toBeGreaterThan(0);
        svgs.forEach((element: any) => {
            expect(element.svgContent).toContain('viewBox="0 0 24 24"');
            expect(element.svgContent).not.toMatch(/<svg[^>]*\swidth=/);
            expect(element.svgContent).not.toMatch(/<svg[^>]*\sheight=/);
        });
    });

    it('declares each halftone pattern once per pure sheet, not once per sticker', () => {
        scope.resetElementIds();
        const pureSheets = scope.planSheets(device('pure'));
        const halftoneSheet = pureSheets.find((s: any) => s.colourway === 'medium');
        const elements = scope.buildStickerElements(device('pure'), halftoneSheet);
        const definitions = elements.filter((e: any) => typeof e.svgContent === 'string' && e.svgContent.includes('<pattern'));
        expect(definitions).toHaveLength(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/gallerySamples/stickerPressLayout.test.ts`
Expected: FAIL — `planSheets is not defined`.

- [ ] **Step 3: Implement Section 4**

```js
// Section 4: layout engine.

const GUTTER = 6;
const LABEL_HEIGHT = 9;
const RAIL_HEIGHT = 22;
const SWITCHER_HEIGHT = 18;

let elementCounter = 0;
const resetElementIds = () => { elementCounter = 0; };
const nextElementId = () => `sp_${String(++elementCounter).padStart(4, '0')}`;

// Packs one category's stickers, in one colourway, into as many sheets as needed.
const planSheets = device => {
    const sheets = [];
    CATEGORIES.forEach(category => {
        const stickers = REGISTRY.filter(sticker => sticker.cat === category.id);
        const colourways = category.family === 'structural'
            ? (device.palette === 'ink' ? INK_TREATMENTS : STRUCTURAL_COLOURWAYS)
            : PICTORIAL_TREATMENTS;
        const sizes = category.family === 'structural' ? device.structural : device.pictorial;
        const clusterWidth = sizes.reduce((sum, size) => sum + size, 0) + GUTTER * (sizes.length - 1);
        const clusterHeight = Math.max(...sizes) + LABEL_HEIGHT;

        const top = RAIL_HEIGHT + GUTTER;
        const usableWidth = device.width - GUTTER * 2;
        const usableHeight = device.height - top - SWITCHER_HEIGHT - GUTTER;
        const columns = Math.max(1, Math.floor((usableWidth + GUTTER) / (clusterWidth + GUTTER)));
        const rows = Math.max(1, Math.floor((usableHeight + GUTTER) / (clusterHeight + GUTTER)));
        const perSheet = columns * rows;

        colourways.forEach(colourway => {
            for (let offset = 0; offset < stickers.length; offset += perSheet) {
                const page = stickers.slice(offset, offset + perSheet);
                const index = Math.floor(offset / perSheet);
                sheets.push({
                    id: `${category.id}_${colourway.id}${index > 0 ? `_${index + 1}` : ''}`,
                    category: category.id,
                    family: category.family,
                    colourway: colourway.id,
                    labelled: colourway.id === colourways[0].id,
                    clusters: page.map((sticker, position) => {
                        const column = position % columns;
                        const row = Math.floor(position / columns);
                        const x = GUTTER + column * (clusterWidth + GUTTER);
                        const y = top + row * (clusterHeight + GUTTER);
                        let cellX = x;
                        return {
                            sticker,
                            x,
                            y,
                            cells: sizes.map(size => {
                                const cell = { size, x: cellX, y: y + (Math.max(...sizes) - size) };
                                cellX += size + GUTTER;
                                return cell;
                            }),
                        };
                    }),
                });
            }
        });
    });
    return sheets;
};
```

Then `buildStickerElements(device, sheet)`, which resolves each cluster's fill from the sheet's colourway, calls the builder, and emits one `svg` element per cell plus one `text` label per cluster when `sheet.labelled`. For `pure` halftone sheets it emits one leading `svg` element carrying only the `<defs><pattern>` block, so the definition is declared once per sheet.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/gallerySamples/stickerPressLayout.test.ts`
Expected: PASS, all six.

- [ ] **Step 5: Commit**

```bash
git add gallery-samples/21-sticker-press/templates.js tests/unit/gallerySamples/stickerPressLayout.test.ts
git commit -m "feat(sticker-press): sheet layout engine with per-device packing"
```

---

## Task 11: Rail, switcher and template assembly

**Files:**
- Modify: `gallery-samples/21-sticker-press/templates.js` (Section 4)
- Modify: `tests/unit/gallerySamples/stickerPressLayout.test.ts`

**Interfaces:**
- Consumes: `planSheets`, `buildStickerElements`.
- **Emits the `GENERATE_SENTINEL` line verbatim** immediately before the variant-building
  block. `tests/unit/gallerySamples/stickerPressScope.ts` cuts the source there; omitting it
  breaks every test written in Tasks 4-10.
- Produces:
  - `buildRail(device, sheet)` → `TemplateElement[]` — full rail on `paper_pro`/`note_air`/`pure`, reduced 8-chip rail on `move`
  - `buildSwitcher(device, sheet)` → `TemplateElement[]` — six `specific_node` chips
  - `buildSheetTemplate(device, sheet)` → a complete `PageTemplate`
  - The script's `return { variants, activeVariantId: 'paper_pro' }`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/gallerySamples/stickerPressLayout.test.ts`:

```ts
describe('sticker press chrome', () => {
    it('gives move a reduced rail and the others a full one', () => {
        const railCount = (id: string) => {
            const profile = scope.DEVICES.find((d: any) => d.id === id);
            scope.resetElementIds();
            const sheet = scope.planSheets(profile).find((s: any) => s.family === 'structural');
            return scope.buildRail(profile, sheet).filter((e: any) => e.linkTarget === 'specific_node').length;
        };
        expect(railCount('move')).toBeLessThanOrEqual(8);
        expect(railCount('paper_pro')).toBeGreaterThan(8);
    });

    it('links every switcher chip at the same sheet in another colourway', () => {
        const profile = scope.DEVICES.find((d: any) => d.id === 'paper_pro');
        scope.resetElementIds();
        const sheets = scope.planSheets(profile);
        const sheet = sheets[0];
        const chips = scope.buildSwitcher(profile, sheet);
        const targets = chips.map((chip: any) => chip.linkValue).filter(Boolean);
        expect(targets).toHaveLength(6);
        targets.forEach((target: string) => {
            const destination = sheets.find((candidate: any) => candidate.id === target);
            expect(destination?.category).toBe(sheet.category);
        });
    });

    it('returns four variants with paper_pro active', () => {
        const result = runStickerPressGenerator();
        expect(Object.keys(result.variants).sort()).toEqual(['move', 'note_air', 'paper_pro', 'pure']);
        expect(result.activeVariantId).toBe('paper_pro');
    });

    it('gives all four variants an identical template id set', () => {
        const result = runStickerPressGenerator();
        const sets = Object.values(result.variants)
            .map((variant: any) => Object.keys(variant.templates).sort().join(','));
        expect(new Set(sets).size).toBe(1);
    });

    it('sizes every template to its own device page', () => {
        const result = runStickerPressGenerator();
        const expected: Record<string, [number, number]> = {
            paper_pro: [509, 679], move: [260, 463], note_air: [446, 595], pure: [447, 596],
        };
        Object.entries(result.variants).forEach(([id, variant]: [string, any]) => {
            Object.values(variant.templates).forEach((template: any) => {
                expect([template.width, template.height]).toEqual(expected[id]);
            });
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/gallerySamples/stickerPressLayout.test.ts`
Expected: FAIL — `buildRail is not defined`.

- [ ] **Step 3: Implement the chrome and the variant return**

Add `buildRail`, `buildSwitcher` and `buildSheetTemplate`, then close the script:

```js
// ---- GENERATE (tests strip below this line) ----
// This sentinel is load-bearing: tests/unit/gallerySamples/stickerPressScope.ts cuts the
// source here to reach the internals. Without it the script's own return below wins and
// every builder, registry and layout test loses its handle on the module. Keep verbatim.

const buildVariant = device => {
    resetElementIds();
    const templates = {};
    planSheets(device).forEach(sheet => {
        templates[sheet.id] = buildSheetTemplate(device, sheet);
    });
    buildChromeTemplates(device, templates);   // cover, start_here, contents, guide, index, example, blank
    return { name: device.name, templates };
};

const variants = {};
DEVICES.forEach(device => { variants[device.id] = buildVariant(device); });

return { variants, activeVariantId: 'paper_pro' };
```

Chip rules, from the spec's dead-end guidance: rail and switcher chips are **unfilled text chips** with visible `textColor` and no `fill`, so a chip whose label is empty leaves no coloured box behind. Only always-labelled controls may be filled.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/gallerySamples/stickerPressLayout.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gallery-samples/21-sticker-press/templates.js tests/unit/gallerySamples/stickerPressLayout.test.ts
git commit -m "feat(sticker-press): rail, colourway switcher and four-variant assembly"
```

---

## Task 12: The hierarchy script

**Files:**
- Modify: `gallery-samples/21-sticker-press/hierarchy.js`
- Test: `tests/unit/gallerySamples/stickerPress.test.ts` (create)

**Interfaces:**
- Consumes: the `templates` map the modal passes into the hierarchy scope (the active variant's), plus `createId` and `SAMPLE_CONFIG`.
- Produces: `{ nodes, rootId: 'root' }` with stable ids `root`, `start_here`, `example_workspace`, `blank_workspace`, plus one node per sheet, six A–Z index pages, contents, and the colour guide.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/gallerySamples/stickerPress.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { expectValidGallerySample, type GallerySampleContract } from '../../helpers/gallerySampleHarness';

const CONTRACT: GallerySampleContract = {
    slug: '21-sticker-press',
    expectedTemplateIds: [],   // filled in Step 3 from the generator's own output
    pageCount: [70, 260],
    palette: ['#23292f', '#f0c674', '#86c08e', '#5b93c4', '#b04a46', '#3d4650', '#7a8290'],
    requiredStableNodeIds: ['root', 'start_here', 'example_workspace', 'blank_workspace'],
    expectedVariants: {
        paper_pro: { width: 509, height: 679 },
        move: { width: 260, height: 463 },
        note_air: { width: 446, height: 595 },
        pure: { width: 447, height: 596 },
    },
};

describe('21-sticker-press', () => {
    it('passes the shared gallery sample contract', () => {
        expectValidGallerySample('21-sticker-press', CONTRACT);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/gallerySamples/stickerPress.test.ts`
Expected: FAIL — the hierarchy script returns nothing usable.

- [ ] **Step 3: Write the hierarchy**

Build the node tree. Every node's `type` is a template id present in all four variants. Structure:

```
root (cover)
└── start_here
    ├── contents
    ├── colour_guide
    ├── example_workspace          EXAMPLE chrome + skip link
    │   └── example_annotated      EXAMPLE chrome + skip link
    ├── blank_workspace
    │   ├── blank_dots
    │   └── blank_ruled
    ├── index_a … index_f          (6 A-Z pages)
    └── one node per sheet, in CATEGORIES order
```

Every node in the `example_workspace` subtree must set `data.example_label = 'EXAMPLE'` and `data.skip_label = 'Skip to blank workspace →'`, and its template must bind both as visible text with the skip element carrying `linkTarget: 'specific_node'`, `linkValue: 'blank_workspace'`. This is enforced at `gallerySampleHarness.ts:524-563`.

Then fill `expectedTemplateIds` with the generator's actual template ids. Because every sheet owns a template, this is a literal array of roughly 77 sorted strings, not the ~11 the planner products declare. Generate it once and paste it:

```bash
node -e "
const { runStickerPressGenerator } = { runStickerPressGenerator: new Function(require('fs').readFileSync('gallery-samples/21-sticker-press/templates.js','utf8')) };
const ids = Object.keys(runStickerPressGenerator().variants.paper_pro.templates).sort();
console.log(JSON.stringify(ids, null, 4));
"
```

Paste the output verbatim. It is a checked-in fact, not boilerplate: the harness compares it in both directions, so an accidentally added or dropped sheet fails the suite.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/gallerySamples/stickerPress.test.ts`
Expected: PASS. Read every harness error carefully — an overflow or unresolved link now names its variant.

- [ ] **Step 5: Commit**

```bash
git add gallery-samples/21-sticker-press/hierarchy.js tests/unit/gallerySamples/stickerPress.test.ts
git commit -m "feat(sticker-press): hierarchy with sheets, index and example workspace"
```

---

## Task 13: Product-specific test suite

**Files:**
- Modify: `tests/unit/gallerySamples/stickerPress.test.ts`
- Modify: `tests/unit/gallerySamples/collection.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: the guards that keep the product honest.

- [ ] **Step 1: Write the failing assertions**

Append to `tests/unit/gallerySamples/stickerPress.test.ts`:

```ts
describe('21-sticker-press guards', () => {
    // expectValidGallerySample re-executes the generator to check determinism, so this
    // is a ~10 MB, four-variant build. Load it once for the whole block, never per test.
    let loaded: ReturnType<typeof expectValidGallerySample>;
    beforeAll(() => { loaded = expectValidGallerySample('21-sticker-press', CONTRACT); });
    const sample = () => loaded;

    const everySvg = () => sample().variants.flatMap(variant =>
        Object.values(variant.templates).flatMap((template: any) =>
            template.elements.filter((element: any) => element.type === 'svg')));

    it('keeps every svg parseable with a viewBox and no root dimensions', () => {
        everySvg().forEach((element: any) => {
            expect(element.svgContent).toContain('viewBox=');
            expect(element.svgContent).not.toMatch(/<svg[^>]*\swidth=/);
            expect(element.svgContent).not.toMatch(/<svg[^>]*\sheight=/);
        });
    });

    it('uses no colour format svg2pdf silently drops', () => {
        everySvg().forEach((element: any) => {
            expect(element.svgContent).not.toMatch(/hsla?\(/i);
            expect(element.svgContent).not.toMatch(/#[0-9a-f]{4}(?![0-9a-f])/i);
            expect(element.svgContent).not.toMatch(/#[0-9a-f]{8}\b/i);
        });
    });

    it('uses no markup DOMPurify strips or svg2pdf mishandles', () => {
        everySvg().forEach((element: any) => {
            expect(element.svgContent).not.toMatch(/<(use|script|style|foreignObject)\b/i);
            expect(element.svgContent).not.toMatch(/\son[a-z]+=/i);
        });
    });

    it('keeps every sticker within the markup byte budget', () => {
        const sizes = everySvg().map((element: any) => Buffer.byteLength(element.svgContent, 'utf8'));
        expect(Math.max(...sizes)).toBeLessThanOrEqual(400);
    });

    it('serialises the whole project under 12 MiB', () => {
        const loaded = sample();
        const variants: Record<string, unknown> = {};
        loaded.variants.forEach(variant => {
            variants[variant.id] = { id: variant.id, name: variant.name, templates: variant.templates };
        });
        const bytes = Buffer.byteLength(JSON.stringify({
            variants, activeVariantId: loaded.activeVariantId, nodes: loaded.nodes, rootId: loaded.rootId,
        }), 'utf8');
        expect(bytes).toBeLessThan(12 * 1024 * 1024);
    });

    it('exposes an identical template id set in all four variants', () => {
        const sets = sample().variants.map(variant => Object.keys(variant.templates).sort().join(','));
        expect(new Set(sets).size).toBe(1);
    });

    it('declares each halftone pattern once per sheet', () => {
        const pure = sample().variants.find(variant => variant.id === 'pure')!;
        Object.values(pure.templates).forEach((template: any) => {
            const definitions = template.elements.filter((element: any) =>
                typeof element.svgContent === 'string' && element.svgContent.includes('<pattern'));
            expect(definitions.length).toBeLessThanOrEqual(1);
        });
    });
});
```

- [ ] **Step 2: Run and fix what they catch**

Run: `npx vitest run tests/unit/gallerySamples/stickerPress.test.ts`

Fix any failure in `templates.js`, not by relaxing the assertion. The state-size guard is the one most likely to bite; if it does, the levers in priority order are markup tightening, then dropping labels from more sheets, then reducing the `move` rail further.

- [ ] **Step 3: Register the slug**

Add `'21-sticker-press'` to `EXPECTED_SLUGS` in `tests/unit/gallerySamples/collection.test.ts`, keeping the array sorted.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS, with no regression in the other twenty products.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/gallerySamples/stickerPress.test.ts tests/unit/gallerySamples/collection.test.ts
git commit -m "test(sticker-press): svg hygiene, byte budget and state size guards"
```

---

## Task 14: README

**Files:**
- Create: `gallery-samples/21-sticker-press/README.md`
- Modify: `gallery-samples/README.md`

**Interfaces:**
- Consumes: the finished product.
- Produces: gallery listing copy.

- [ ] **Step 1: Write the README**

Follow the house structure used by `gallery-samples/18-music-practice-studio/README.md`: title, one-paragraph pitch, "Why you'll like it", Workflow, Configuration, Inventory, Navigation, Visual And Border Construction, Publishing.

Every countable claim must be true of the generated output — page counts, sticker counts, category counts. Read them off a real run, do not restate the plan.

The Publishing section must carry six tags, at least one from the gallery's `play` strip list in `components/gallery/sections.ts` (`games, adventure, travel, hobby, chess, astronomy`) or `create` (`journal, writing, creative, recipes, family`), or the listing lands in the leftover grid. Suggested: `stickers, journal, creative, planner, icons, decorative`.

- [ ] **Step 2: Add the roster entry**

Append `21. The Sticker Press` to the Products list in `gallery-samples/README.md`.

- [ ] **Step 3: Verify the counts**

Run a node one-liner that loads the generator and prints the real page count, sticker count per category, and per-variant template count. Reconcile every number in the README against it.

- [ ] **Step 4: Commit**

```bash
git add gallery-samples/21-sticker-press/README.md gallery-samples/README.md
git commit -m "docs(sticker-press): product README and roster entry"
```

---

## Task 15: Real-browser verification

**Files:**
- Create: `scratch/render_sticker_press.mjs` (not committed)

**Interfaces:**
- Consumes: the finished product.
- Produces: evidence it works in the real app, not just in tests.

This is the mandatory final task. Unit tests cannot catch a swallowed svg2pdf failure (`pdfService.ts:1192-1194` logs and drops the element), and that is exactly the failure mode this product is most exposed to.

- [ ] **Step 1: Start the dev server**

Run: `npx vite --port 3002`

- [ ] **Step 2: Drive the generator**

Adapt `scratch/render_expansion.mjs`. Paste both scripts into the two textareas using the React-aware value setter, press Preview, then Apply. Confirm the preview completes without a size rejection — if `MAX_GENERATOR_OUTPUT_BYTES` were still 5 MiB this is where it would fail.

- [ ] **Step 3: Screenshot six template tabs per variant**

Capture, for each of the four variants: the cover, one structural sheet, one pictorial sheet, the colour guide, an A–Z index page, and the example workspace. On `pure`, one of the structural sheets must be a halftone colourway.

Remember the harness gotcha: a template `name` that matches a node title collides with the preview `<select>` options and makes `getByText` ambiguous.

- [ ] **Step 4: Export and inspect the PDFs**

Export all variants. For each PDF, confirm: the page count matches the README, stickers actually render (not blank boxes — that is the swallowed-failure signature), and on `pure` the halftones are visibly distinct from one another.

Run `node scratch/pdf_spot.cjs <pdf> page N` on a sheet page and confirm the switcher chips resolve to the expected destination pages.

- [ ] **Step 5: Check the browser console**

Any `console.error` from the svg2pdf path means stickers are silently missing from the export. Investigate before declaring done — a clean-looking PDF with dropped elements is the exact failure this task exists to catch.

- [ ] **Step 6: Record the evidence**

```bash
git add gallery-samples/21-sticker-press/samples/
git commit -m "docs(sticker-press): rendered page samples and exported PDFs"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: device variants → 3, 11; inventory → 9; art style → 4–8; colourways and ink treatments → 9, 10; sheet layout and crop hygiene → 10; navigation → 11, 12; required chrome → 12; generator architecture → 3–11; byte budget → 3, 13; Prerequisite A → 1; Prerequisite B → 2; SVG authoring rules → 13; testing → 13; Task-1 spike → 3.

**Two spec items deliberately not given their own task.** The product name stays "The Sticker Press" — the spec listed alternatives but no decision was made, and the working title is used throughout. The per-category counts are pinned in Task 9's `CATEGORIES` table at the spec's numbers; the spec allows them to shift during authoring, and the test asserts internal consistency plus a 500 total rather than the individual figures.

**Naming consistency.** `svgMarkup` gains a fourth parameter in Task 10 and every earlier call site remains valid. `resetElementIds`/`nextElementId` are introduced in Task 10 and used in 10–11. The `note` collision between the banknote and the music note is resolved in Task 8 by renaming the latter to `musicNote`. `LEGACY_STATE_BYTES` replaces the e2e fixture's shadowing `MAX_STATE_BYTES` in Task 1.

**Known soft spot.** Tasks 4–8 enumerate ~90 builder names and signatures but show two or three worked implementations each rather than all ninety. The interface, the argument types, the byte budget and the test that enforces them are fully specified; the path data itself is drawing work. That is a deliberate limit of a written plan, not an omission — the tests fail until every named builder exists and fits the budget.

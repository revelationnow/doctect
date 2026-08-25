import { describe, expect, it } from 'vitest';
import { generatePDF } from '../../../services/pdfService';
import {
    collectGallerySampleSlugs,
    loadGallerySample,
    validateSharedGalleryInvariants,
} from '../../helpers/gallerySampleHarness';

const EXPECTED_SLUGS = [
    '01-academic-success-system',
    '02-work-project-hub',
    '03-personal-finance-planner',
    '04-wellness-fitness-journal',
    '05-seasonal-kitchen',
    '06-travel-field-journal',
    '07-novel-story-studio',
    '08-ttrpg-campaign-codex',
    '09-adventure-gamebook',
    '10-trivia-quiz-night',
    '11-chess-opening-repertoire',
    '12-family-history-workbook',
    '13-language-learning-lab',
    '14-job-search-hq',
    '15-garden-almanac',
    '16-reading-journal',
    '17-home-owners-manual',
    '18-music-practice-studio',
    '19-astronomy-observation-log',
    '20-habit-quest-rpg',
    '21-sticker-press',
];

const descendants = (sample: ReturnType<typeof loadGallerySample>, rootId: string) => {
    const nodeIds: string[] = [];
    const pending = [rootId];
    while (pending.length > 0) {
        const nodeId = pending.shift()!;
        nodeIds.push(nodeId);
        pending.push(...sample.nodes[nodeId].children);
    }
    return nodeIds;
};

const resolveAncestorField = (
    sample: ReturnType<typeof loadGallerySample>,
    nodeId: string,
    field: string,
) => {
    let node = sample.nodes[nodeId];
    while (node) {
        if (node.data?.[field] !== undefined) return node.data[field];
        node = node.parentId ? sample.nodes[node.parentId] : undefined;
    }
    return undefined;
};

// Structural replacement for "assume undefined is always safe": is `field` an
// actual live binding (dataBinding or a `{{field}}` text interpolation) on any
// template reachable from a descendant of `rootId`, in ANY device variant?
// Sweeps `sample.variants`, not `sample.templates` (the active variant only),
// because a binding present only in a non-active variant's template would
// otherwise go undetected.
//
// This is the question that actually matters for leak safety. resolveText's
// real search (services/pdfService.ts getContextNodes) checks self+ancestors
// FIRST, so an explicit '' set anywhere on the direct ancestor chain shadows
// correctly — that's what resolveAncestorField mirrors. But if that walk
// finds nothing (returns undefined) and the field is bound nowhere at all,
// resolveText is never even invoked for it — nothing to leak, so undefined
// is genuinely safe. If the field IS bound somewhere, resolveText WILL run
// its full search when that binding renders, and an unshadowed (undefined)
// ancestor result lets that search fall through to wider sources — the
// reference target's ancestors, or a referrer's ancestors — which can supply
// a real, leaked value. So: bound anywhere -> require the explicit '' shadow;
// bound nowhere -> undefined is the only correct value, and anything else is
// a stray that should fail too.
const boundAnywhereUnderRoot = (
    sample: ReturnType<typeof loadGallerySample>,
    rootId: string,
    field: string,
) => descendants(sample, rootId).some(id =>
    sample.variants.some(variant => (variant.templates[sample.nodes[id].type]?.elements ?? [])
        .some((el: any) => el?.dataBinding === field
            || (typeof el?.text === 'string' && el.text.includes(`{{${field}}}`)))));

const chromeGeometrySignature = (slug: string) => {
    const sample = loadGallerySample(slug);
    const template = sample.templates[sample.nodes.example_workspace.type];
    const chrome = template.elements.filter((element: any) =>
        element.dataBinding === 'example_label'
        || element.dataBinding === 'skip_label'
        || (element.type === 'text' && ['root', 'parent'].includes(element.linkTarget))
        || (element.y < 82 && element.type !== 'text')
        || (element.y > 615 && element.type !== 'text'),
    );
    const bucket = (value: number) => Math.round(value / 20) * 20;
    return chrome
        .map((element: any) => [element.type, bucket(element.x), bucket(element.y), bucket(element.w), bucket(element.h)].join(':'))
        .sort()
        .join('|');
};

describe('gallery sample collection', () => {
    it('contains exactly the approved products', () => {
        expect(collectGallerySampleSlugs()).toEqual(EXPECTED_SLUGS);
    });

    it.each(EXPECTED_SLUGS)('%s has no structural contract errors', slug => {
        const sample = loadGallerySample(slug);
        expect(validateSharedGalleryInvariants(sample)).toEqual([]);
    });

    it('gives all products distinct core chrome geometry', () => {
        const signatures = EXPECTED_SLUGS.map(chromeGeometrySignature);
        expect(new Set(signatures).size).toBe(EXPECTED_SLUGS.length);
    });

    it('the "never bound" exemption is structurally real: zero bindings for Sticker Press, several for every other product', () => {
        // Sanity check on boundAnywhereUnderRoot itself: it must actually
        // distinguish products, not just always return the same answer. The
        // Sticker Press's exemption from the '' shadow requirement (above)
        // rests entirely on this being 0 for it and non-trivially positive for
        // everything else — verified directly rather than assumed.
        const countBound = (slug: string, field: string) => {
            const sample = loadGallerySample(slug);
            return descendants(sample, 'blank_workspace').filter(id =>
                sample.variants.some(variant => (variant.templates[sample.nodes[id].type]?.elements ?? [])
                    .some((el: any) => el?.dataBinding === field
                        || (typeof el?.text === 'string' && el.text.includes(`{{${field}}}`))))).length;
        };
        ['example_label', 'skip_label'].forEach(field => {
            expect(countBound('21-sticker-press', field), `21-sticker-press ${field}`).toBe(0);
            EXPECTED_SLUGS.filter(slug => slug !== '21-sticker-press').forEach(slug => {
                expect(countBound(slug, field), `${slug} ${field}`).toBeGreaterThanOrEqual(3);
            });
        });
    });

    it.each(EXPECTED_SLUGS)('%s shadows example chrome throughout the blank workspace', slug => {
        const sample = loadGallerySample(slug);

        // Most products reuse one "workspace" template for both the guided EXAMPLE
        // branch and the blank workspace, so a stray EXAMPLE banner would leak onto
        // blank pages unless the hierarchy explicitly shadows both labels to '' at
        // blank_workspace. The Sticker Press (21) instead gives blank_workspace its
        // own template that never binds these fields at all in ANY device variant,
        // so the banner cannot leak there by construction and there is nothing to
        // shadow.
        //
        // "Never bound, therefore undefined is safe" only holds when NOTHING
        // under blank_workspace binds the field anywhere — checked structurally
        // per field below, not assumed. When the field IS bound somewhere, only
        // the explicit '' shadow is accepted; `undefined` there is a real gap
        // (see the regression test below for why) and now fails like any other
        // stray value.
        ['example_label', 'skip_label'].forEach(field => {
            const boundSomewhere = boundAnywhereUnderRoot(sample, 'blank_workspace', field);
            descendants(sample, 'blank_workspace').forEach(nodeId => {
                const value = resolveAncestorField(sample, nodeId, field);
                if (boundSomewhere) {
                    expect(value, `${nodeId} ${field}: ${JSON.stringify(value)} (bound under blank_workspace in some variant — must be explicitly shadowed to '')`).toBe('');
                } else {
                    expect(value, `${nodeId} ${field}: ${JSON.stringify(value)} (never bound anywhere under blank_workspace — must be left undefined, not a stray value)`).toBe(undefined);
                }
            });
        });
    });

    it('a synthetic product that binds skip_label under blank_workspace via an EXAMPLE-branch referrer, without shadowing it, is caught', async () => {
        // Regression for the S1 finding: reproduces the reviewer's failing case
        // directly, rather than trusting the fix by inspection. Shape: a
        // "mirror" node lives in the EXAMPLE branch and points (`referenceId`)
        // at a node under blank_workspace; blank_workspace's own subtree never
        // sets an explicit '' shadow for skip_label. Real resolveText
        // (services/pdfService.ts getContextNodes) checks self+ancestors first
        // (finds nothing here — that's the missing shadow), then falls through
        // to referrers-and-their-ancestors, which reaches the mirror node's
        // parent in the EXAMPLE branch and finds the real, non-blank text.
        const nodes: any = {
            example_workspace: {
                id: 'example_workspace', parentId: null, type: 'page', title: 'Example',
                data: { skip_label: 'Skip to blank workspace →' }, children: ['mirror_page'],
            },
            mirror_page: {
                id: 'mirror_page', parentId: 'example_workspace', type: 'page', title: 'Mirror',
                data: {}, children: [], referenceId: 'blank_target',
            },
            blank_workspace: {
                id: 'blank_workspace', parentId: null, type: 'page', title: 'Blank',
                data: {}, children: ['blank_target'], // <- the missing shadow: no example_label/skip_label here
            },
            blank_target: {
                id: 'blank_target', parentId: 'blank_workspace', type: 'skip_tpl', title: 'Blank target',
                data: {}, children: [],
            },
        };
        const templates: any = {
            page: { id: 'page', name: 'Page', width: 200, height: 200, elements: [] },
            skip_tpl: {
                id: 'skip_tpl', name: 'Skip', width: 200, height: 200, elements: [{
                    id: 'skip_el', type: 'text', x: 10, y: 10, w: 150, h: 20,
                    dataBinding: 'skip_label', linkTarget: 'specific_node', linkValue: 'blank_workspace', fontSize: 10,
                }],
            },
        };
        const sample = { nodes, templates, variants: [{ id: 'default', name: 'Default', templates }] } as any;

        // 1. The naive "bound nowhere under blank_workspace" reasoning this
        // fixture would need to be exempt under is false: skip_label IS bound,
        // on blank_target's own template.
        expect(boundAnywhereUnderRoot(sample, 'blank_workspace', 'skip_label')).toBe(true);

        // 2. Because it's bound, the fixed assertion requires the explicit ''
        // shadow. This fixture doesn't have one anywhere in blank_target's
        // simple ancestor chain, so the fixed check correctly flags it —
        // this is the exact assertion the `it.each` test above runs for
        // every real product, applied here to a fixture the OLD blanket
        // `'' || undefined` acceptance would have wrongly let through
        // (resolveAncestorField returns undefined, which that old check
        // treated as fine regardless of whether the field was ever bound).
        const resolved = resolveAncestorField(sample, 'blank_target', 'skip_label');
        expect(resolved).toBe(undefined);
        const oldBuggyCheckWronglyPasses = resolved === '' || resolved === undefined;
        expect(oldBuggyCheckWronglyPasses, 'sanity: confirms the widened acceptance really did miss this').toBe(true);
        expect(resolved === '', 'the fixed check: bound somewhere means only \'\' is acceptable').toBe(false);

        // 3. Prove the defect is real, not just a model mismatch: a real
        // generatePDF on this exact fixture emits a live /Dest annotation for
        // the "empty" skip link on the blank page — the ghost-annotation
        // defect these tests exist to catch.
        const state = {
            rootId: 'blank_workspace',
            nodes,
            activeVariantId: 'default',
            variants: { default: { id: 'default', name: 'Default', templates } },
        } as any;
        const buffer = await generatePDF(state, { output: 'arraybuffer' }) as ArrayBuffer;
        const pdf = new TextDecoder('latin1').decode(new Uint8Array(buffer));
        expect(pdf, 'expected the unshadowed referrer leak to actually produce a /Dest annotation').toContain('/Dest');
    });

    it.each(EXPECTED_SLUGS)('%s emits no PDF annotation for its empty blank Skip binding', async slug => {
        const sample = loadGallerySample(slug);
        const blankWorkspace = sample.nodes.blank_workspace;
        const template = sample.templates[blankWorkspace.type];
        const skip = template.elements.find((element: any) =>
            element.type === 'text'
            && element.dataBinding === 'skip_label'
            && element.linkTarget === 'specific_node'
            && element.linkValue === 'blank_workspace',
        );
        // A missing `skip` element is only legitimate when skip_label is bound
        // NOWHERE under blank_workspace for this product (Sticker Press: its
        // blank pages use a dedicated template that never reuses the guided-
        // example one, in any variant) — then there's genuinely nothing to
        // build a probe PDF from. If it's bound somewhere but this exact
        // element-matching pattern didn't find it, the probe's own matching
        // assumptions are broken (e.g. a renamed `linkValue`), which would
        // otherwise silently turn this whole guard into a permanent no-op —
        // fail loudly instead of returning quietly.
        if (!skip) {
            expect(boundAnywhereUnderRoot(sample, 'blank_workspace', 'skip_label'),
                `${slug}: skip_label is bound somewhere under blank_workspace but no matching element was found on blank_workspace's own template — probe assumptions broken`).toBe(false);
            return;
        }

        const state = {
            rootId: 'blank_workspace',
            nodes: {
                ...sample.nodes,
                blank_workspace: { ...blankWorkspace, children: [] },
            },
            activeVariantId: 'default',
            variants: {
                default: {
                    id: 'default',
                    name: 'Default',
                    templates: {
                        [blankWorkspace.type]: { ...template, elements: [skip] },
                    },
                },
            },
        } as any;
        const buffer = await generatePDF(state, { output: 'arraybuffer' }) as ArrayBuffer;
        const pdf = new TextDecoder('latin1').decode(new Uint8Array(buffer));

        expect(pdf).not.toContain('/Dest');
    });

    it.each(EXPECTED_SLUGS)('%s emits no Skip annotation from a non-root blank descendant', async slug => {
        const sample = loadGallerySample(slug);
        const blankWorkspace = sample.nodes.blank_workspace;
        const descendantId = blankWorkspace.children.find((nodeId: string) => {
            const node = sample.nodes[nodeId];
            const template = node && sample.templates[node.type];
            return !node?.referenceId && template?.elements.some((element: any) =>
                element.type === 'text'
                && element.dataBinding === 'skip_label'
                && element.linkTarget === 'specific_node'
                && element.linkValue === 'blank_workspace',
            );
        });
        // Same gate as the previous test: a missing descendant is only
        // legitimate when skip_label is bound nowhere under blank_workspace
        // for this product. If it's bound somewhere but no direct child
        // matched this exact pattern, fail loudly rather than silently
        // no-op — same "renamed linkValue" risk as above.
        if (!descendantId) {
            expect(boundAnywhereUnderRoot(sample, 'blank_workspace', 'skip_label'),
                `${slug}: skip_label is bound somewhere under blank_workspace but no direct child of blank_workspace matched — probe assumptions broken`).toBe(false);
            return;
        }

        const descendant = sample.nodes[descendantId!];
        const descendantTemplate = sample.templates[descendant.type];
        const skip = descendantTemplate.elements.find((element: any) =>
            element.type === 'text'
            && element.dataBinding === 'skip_label'
            && element.linkTarget === 'specific_node'
            && element.linkValue === 'blank_workspace',
        );
        const blankRootType = '__blank_annotation_root__';
        const state = {
            rootId: 'blank_workspace',
            nodes: {
                blank_workspace: {
                    ...blankWorkspace,
                    type: blankRootType,
                    children: [descendantId],
                },
                [descendantId!]: { ...descendant, parentId: 'blank_workspace', children: [] },
            },
            activeVariantId: 'default',
            variants: {
                default: {
                    id: 'default',
                    name: 'Default',
                    templates: {
                        [blankRootType]: { ...descendantTemplate, id: blankRootType, elements: [] },
                        [descendant.type]: { ...descendantTemplate, elements: [skip] },
                    },
                },
            },
        } as any;
        const buffer = await generatePDF(state, { output: 'arraybuffer' }) as ArrayBuffer;
        const pdf = new TextDecoder('latin1').decode(new Uint8Array(buffer));

        expect(pdf).not.toContain('/Dest');
    });
});

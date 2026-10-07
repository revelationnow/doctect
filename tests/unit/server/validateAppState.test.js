// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
    MAX_STATE_BYTES,
    validateAppState,
} from '../../../server/validateAppState.js';
import { validateAppState as validateSharedAppState, validateAppStateWork,
    validateAppNode, validateAppNodeWork, validatePageTemplate, validatePageTemplateWork } from '../../../shared/validateAppState.js';
import { MAX_STATE_BYTES as SHARED_MAX_STATE_BYTES } from '../../../shared/projectLimits.js';
import { runSync } from '../../../shared/cooperativeWork.js';
import { makeWorkHarness } from '../../helpers/normalizationWorkHarness';
import { plainJsonBytesWork } from '../../../shared/jsonWork.js';

const goodState = () => ({
    nodes: { root: { id: 'root', parentId: null, type: 'page', title: 'Root', data: {}, children: [] } },
    rootId: 'root',
    variants: { default: { id: 'default', name: 'Default', templates: { page: { id: 'page', name: 'Page', width: 500, height: 700, elements: [] } } } },
    activeVariantId: 'default',
    schemaVersion: 7
});

const validGenerator = () => ({
    formatVersion: 1,
    templateScript: '  const café = "☕";\r\nreturn { café };\n',
    hierarchyScript: '\n\treturn { nodes: { "根": true } };\r\n',
    generatedAt: '2026-07-14T12:34:56.000Z',
});

describe('validateAppState', () => {
    it('steps through template elements under the shared validator', async () => {
        const state = goodState(); state.schemaVersion = 11;
        state.variants.default.templates.page.elements = Array.from({ length: 5000 }, () => ({ type: 'text' }));
        const before = structuredClone(state), h = makeWorkHarness();
        expect(await h.runtime.run(validateAppStateWork(state, 'plain'))).toEqual({ ok: true });
        expect(h.runtime.snapshot().yields).toBeGreaterThan(0); expect(state).toEqual(before);
        state.variants.default.templates.page.elements[4999].textWrap = 'invalid';
        expect(await h.runtime.run(validateAppStateWork(state, 'plain'))).toEqual(validateSharedAppState(state));
    });

    it('steps through standalone node children without adding membership or sparse-array rules', async () => {
        const node = goodState().nodes.root;
        node.children = Array(5000).fill('missing-node'); delete node.children[5];
        const h = makeWorkHarness();
        expect(await h.runtime.run(validateAppNodeWork('root', node))).toEqual({ ok: true });
        expect(h.runtime.snapshot().yields).toBeGreaterThan(0);
        node.children[4999] = 3;
        expect(await h.runtime.run(validateAppNodeWork('root', node))).toEqual(validateAppNode('root', node));
    });

    it('steps through long node-id comparisons', async () => {
        const id = 'x'.repeat(4096), node = { ...goodState().nodes.root, id };
        const h = makeWorkHarness();
        expect(await h.runtime.run(validateAppNodeWork(id, node))).toEqual({ ok: true });
        expect(h.runtime.snapshot().comparedCodeUnits).toBe(8192);
        expect(h.runtime.snapshot().yields).toBeGreaterThan(0);
    });

    it('yields inside standalone template validation, without canonicalizing legacy elements', async () => {
        const template = goodState().variants.default.templates.page;
        template.elements = Array.from({ length: 5000 }, () => null);
        const h = makeWorkHarness();
        expect(await h.runtime.run(validatePageTemplateWork('v', 'p', template, 11))).toEqual({ ok: true });
        expect(h.runtime.snapshot().yields).toBeGreaterThan(0);
        template.elements[4999] = { layerId: 4 };
        expect(await h.runtime.run(validatePageTemplateWork('v', 'p', template, 11)))
            .toEqual(validatePageTemplate('v', 'p', template, 11));
    });

    it.each([
        state => { state.nodes.root.children = [3]; state.variants = {}; },
        state => { state.generator = { formatVersion: 2 }; state.nodes.root.children = [3]; },
        state => { state.rootId = 'missing'; state.generator = {}; },
        state => { state.variants.default.name = 3; },
        state => { state.variants.default.templates.page.width = -1; },
        state => { state.schemaVersion = 11; state.variants.default.templates.page.elements = [{ type: 'text', textPadding: { top: -1 } }]; },
    ])('preserves validation error order %#', async change => {
        const state = goodState(); change(state);
        expect(await makeWorkHarness().runtime.run(validateAppStateWork(state, 'plain'))).toEqual(validateSharedAppState(state));
    });

    it('does not invoke accessor roots even through the Work entrypoint', () => {
        const get = vi.fn(() => goodState().nodes);
        const state = Object.defineProperty(goodState(), 'nodes', { get, enumerable: true });
        expect(runSync(validateAppStateWork(state, 'plain'))).toEqual({ ok: false, error: 'nodes must be an object' });
        expect(get).not.toHaveBeenCalled();
    });

    it.each(['undefined', 'nonfinite', 'getter', 'toJSON'])('retains native compatibility serialization for %s', kind => {
        const state = goodState();
        if (kind === 'undefined') state.extension = undefined;
        if (kind === 'nonfinite') state.extension = Infinity;
        if (kind === 'getter') Object.defineProperty(state, 'extension', { enumerable: true, get: () => 1 });
        if (kind === 'toJSON') state.toJSON = () => ({ serialized: 'custom' });
        expect(validateSharedAppState(state)).toEqual({ ok: true });
        expect(runSync(validateAppStateWork(state))).toEqual({ ok: true });
    });

    it('counts plain JSON bytes without assembling a full string', async () => {
        const value = { z: '😀\ud800', rows: [undefined, , -0, NaN], omitted: undefined };
        const expected = new TextEncoder().encode(JSON.stringify(value)).length;
        expect(await makeWorkHarness().runtime.run(plainJsonBytesWork(value))).toBe(expected);
    });

    it.each(['state', 'node', 'template'])('propagates cancellation through %s validation', async kind => {
        const state = goodState(); state.nodes.root.children = Array(5000).fill('root');
        state.variants.default.templates.page.elements = Array(5000).fill(null);
        const h = makeWorkHarness(); h.observe(() => h.cancel());
        const program = kind === 'state' ? validateAppStateWork(state, 'plain')
            : kind === 'node' ? validateAppNodeWork('root', state.nodes.root)
            : validatePageTemplateWork('default', 'page', state.variants.default.templates.page, 11);
        await expect(h.runtime.run(program)).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('keeps the server path as a compatibility re-export of the shared implementation', () => {
        expect(validateAppState).toBe(validateSharedAppState);
        expect(MAX_STATE_BYTES).toBe(SHARED_MAX_STATE_BYTES);
    });

    it('runs without the Node Buffer global', () => {
        const buffer = globalThis.Buffer;
        try {
            globalThis.Buffer = undefined;
            expect(validateSharedAppState(goodState())).toEqual({ ok: true });
        } finally {
            globalThis.Buffer = buffer;
        }
    });

    it('accepts a minimal valid state', () => {
        expect(validateAppState(goodState()).ok).toBe(true);
    });
    it('rejects non-objects', () => {
        expect(validateAppState(null).ok).toBe(false);
        expect(validateAppState('hi').ok).toBe(false);
    });
    it('rejects missing rootId in nodes', () => {
        const s = goodState(); s.rootId = 'nope';
        expect(validateAppState(s).ok).toBe(false);
    });
    it.each(['__proto__', 'constructor', 'toString'])(
        'rejects inherited %s as a root node', rootId => {
            expect(validateAppState({ ...goodState(), nodes: {}, rootId })).toEqual({
                ok: false,
                error: 'rootId must reference an existing node',
            });
        },
    );
    it('rejects an accessor root without invoking it', () => {
        const getter = vi.fn(() => goodState().nodes.root);
        const nodes = {};
        Object.defineProperty(nodes, 'root', { enumerable: true, get: getter });

        expect(validateAppState({ ...goodState(), nodes })).toEqual({
            ok: false,
            error: 'rootId must reference an existing node',
        });
        expect(getter).not.toHaveBeenCalled();
    });
    it('accepts an own reserved root in a null-prototype node map', () => {
        const state = goodState();
        const nodes = Object.create(null);
        nodes.__proto__ = { ...state.nodes.root, id: '__proto__' };
        state.nodes = nodes;
        state.rootId = '__proto__';

        expect(validateAppState(state)).toEqual({ ok: true });
    });
    it('rejects malformed nodes', () => {
        const s = goodState(); s.nodes.bad = { id: 'bad' };
        expect(validateAppState(s).ok).toBe(false);
    });
    it('rejects empty variants', () => {
        const s = goodState(); s.variants = {};
        expect(validateAppState(s).ok).toBe(false);
    });
    it('rejects templates with non-numeric dimensions', () => {
        const s = goodState(); s.variants.default.templates.page.width = 'wide';
        expect(validateAppState(s).ok).toBe(false);
    });
    it('rejects oversize payloads', () => {
        const s = goodState();
        s.nodes.root.data.big = 'x'.repeat(34 * 1024 * 1024);
        expect(validateAppState(s).ok).toBe(false);
    });
    it('reports cyclic state as non-serializable', () => {
        const s = goodState();
        s.cycle = s;
        expect(validateAppState(s)).toEqual({ ok: false, error: 'state is not serializable' });
    });
    it('accepts pre-migration states with no layers/layerId (legacy)', () => {
        expect(validateAppState(goodState()).ok).toBe(true);
    });
    it('accepts templates with a valid layers array and string layerIds', () => {
        const s = goodState();
        const tpl = s.variants.default.templates.page;
        tpl.layers = [{ id: 'l1', name: 'Layer 1', order: 0, visible: true, locked: false }];
        tpl.elements = [{ id: 'e1', layerId: 'l1' }];
        expect(validateAppState(s).ok).toBe(true);
    });
    it('rejects non-array layers', () => {
        const s = goodState();
        s.variants.default.templates.page.layers = { nope: true };
        expect(validateAppState(s).ok).toBe(false);
    });
    it('rejects more than 200 layers per template', () => {
        const s = goodState();
        s.variants.default.templates.page.layers = Array.from({ length: 201 }, (_, i) => ({ id: `l${i}` }));
        expect(validateAppState(s).ok).toBe(false);
    });
    it('rejects a non-string layerId on an element', () => {
        const s = goodState();
        s.variants.default.templates.page.elements = [{ id: 'e1', layerId: 42 }];
        expect(validateAppState(s).ok).toBe(false);
    });

    it.each([
        ['text', 'textOverflow', 'truncate'],
        ['grid', 'textOverflow', 'truncate'],
        ['text', 'textWrap', 'true'],
        ['grid', 'textWrap', 'true'],
    ])('rejects malformed present v10 %s %s', (type, field, value) => {
        const state = goodState();
        state.schemaVersion = 10;
        state.variants.default.templates.page.elements = [
            { id: type, type, [field]: value },
        ];
        expect(validateAppState(state)).toMatchObject({ ok: false, error: expect.stringContaining(field) });
    });

    it('accepts missing fields and old-schema malformed fields', () => {
        const current = goodState();
        current.schemaVersion = 10;
        current.variants.default.templates.page.elements = [
            { id: 'text', type: 'text' },
            { id: 'grid', type: 'grid' },
        ];
        expect(validateAppState(current)).toEqual({ ok: true });

        const state = goodState();
        state.schemaVersion = 9;
        state.variants.default.templates.page.elements = [
            { id: 'old', type: 'text', textOverflow: 'old-value', textWrap: 'yes' },
        ];
        expect(validateAppState(state)).toEqual({ ok: true });
    });

    it('accepts canonical or missing v11 text padding', () => {
        const state = goodState();
        state.schemaVersion = 11;
        state.variants.default.templates.page.elements = [
            { id: 'canonical', type: 'text', textPadding: { top: 0, right: 1.25, bottom: 2, left: 3 } },
            { id: 'missing', type: 'text' },
        ];
        expect(validateAppState(state)).toEqual({ ok: true });
    });

    it.each([
        ['non-object', null],
        ['array', [0, 0, 0, 0]],
        ['missing side', { top: 0, right: 0, bottom: 0 }],
        ['negative side', { top: -1, right: 0, bottom: 0, left: 0 }],
        ['string side', { top: '1', right: 0, bottom: 0, left: 0 }],
    ])('rejects v11 text padding with %s', (_label, textPadding) => {
        const state = goodState();
        state.schemaVersion = 11;
        state.variants.default.templates.page.elements = [{ id: 'text', type: 'text', textPadding }];
        expect(validateAppState(state)).toMatchObject({
            ok: false,
            error: expect.stringContaining('textPadding'),
        });
    });

    it('ignores padding on v10 text and v11 non-text elements', () => {
        const old = goodState();
        old.schemaVersion = 10;
        old.variants.default.templates.page.elements = [{ id: 'old', type: 'text', textPadding: -1 }];
        expect(validateAppState(old)).toEqual({ ok: true });

        const unrelated = goodState();
        unrelated.schemaVersion = 11;
        unrelated.variants.default.templates.page.elements = [{ id: 'rect', type: 'rect', textPadding: -1 }];
        expect(validateAppState(unrelated)).toEqual({ ok: true });
    });

    it.each([
        [10, 'rect'],
        [10, 'line'],
        [11, 'rect'],
        [11, 'line'],
    ])('accepts unrelated text fields on schema-v%s %s elements', (schemaVersion, type) => {
        const state = goodState();
        state.schemaVersion = schemaVersion;
        state.variants.default.templates.page.elements = [
            { id: type, type, textOverflow: 'future', textWrap: 1 },
        ];
        expect(validateAppState(state)).toEqual({ ok: true });
    });

    it('accepts valid generator metadata', () => {
        expect(validateAppState({ ...goodState(), generator: validGenerator() })).toEqual({ ok: true });
    });

    it.each([
        ['a non-object', null],
        ['an unknown field', { ...validGenerator(), secret: true }],
        ['an unsupported format', { ...validGenerator(), formatVersion: 2 }],
        ['a non-text template script', { ...validGenerator(), templateScript: 42 }],
        ['a non-text hierarchy script', { ...validGenerator(), hierarchyScript: null }],
        ['an invalid timestamp', { ...validGenerator(), generatedAt: 'not-a-date' }],
        ['an oversized template script', { ...validGenerator(), templateScript: 'x'.repeat(512 * 1024 + 1) }],
        ['an oversized hierarchy script', { ...validGenerator(), hierarchyScript: 'x'.repeat(512 * 1024 + 1) }],
    ])('rejects generator metadata with %s', (_label, generator) => {
        expect(validateAppState({ ...goodState(), generator })).toMatchObject({ ok: false });
    });

    it('enforces total state size before generator detail validation', () => {
        const state = { ...goodState(), generator: { secret: true } };
        state.nodes.root.data.padding = 'x'.repeat(34 * 1024 * 1024);
        expect(validateAppState(state)).toMatchObject({ ok: false, error: expect.stringContaining('state exceeds') });
    });
});

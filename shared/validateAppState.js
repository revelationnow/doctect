import {
    MAX_ELEMENTS,
    MAX_LAYERS_PER_TEMPLATE,
    MAX_NODES,
    MAX_STATE_BYTES,
    MAX_TEMPLATE_DIMENSION,
    MAX_VARIANTS,
} from './projectLimits.js';
import { validateGeneratorProvenance, validateGeneratorProvenanceWork } from './generatorMetadata.js';
import { effect, primitive, runSync } from './cooperativeWork.js';
import { canonicalInspectionWork, compareStringsWork, enumerableEntriesWork, plainJsonBytesWork } from './jsonWork.js';

const fail = (error) => ({ ok: false, error });
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const ownEnumerableDataValue = (object, key) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
        ? descriptor.value
        : undefined;
};
const utf8ByteLength = value => new TextEncoder().encode(value).byteLength;
const TEXT_OVERFLOW_VALUES = ['clip', 'ellipsis', 'shrink', 'visible'];
const TEXT_PADDING_SIDES = ['top', 'right', 'bottom', 'left'];

// Shared record rules. Callers own JSON safety, aggregate limits and membership.
function* validateAppNodeTraversal(id, node, synchronous) {
    if (!synchronous) yield* effect(1, () => {});
    if (!isObj(node)) return fail(`node ${id} must be an object`);
    if (!isStr(node.id) || (synchronous || !isStr(id) ? node.id !== id
        : (yield* compareStringsWork(node.id, id)) !== 0)) return fail(`node ${id} has mismatched id`);
    if (node.parentId !== null && !isStr(node.parentId)) return fail(`node ${id} parentId invalid`);
    if (!isStr(node.type)) return fail(`node ${id} missing type`);
    if (!isStr(node.title)) return fail(`node ${id} missing title`);
    if (!isObj(node.data)) return fail(`node ${id} data must be an object`);
    if (!Array.isArray(node.children)) return fail(`node ${id} children invalid`);
    const children = node.children, invalidChild = child => !isStr(child);
    if (synchronous) {
        if (children.some(invalidChild)) return fail(`node ${id} children invalid`);
    } else {
        // Preserve Array.some's captured length and skipping of sparse slots.
        for (let index = 0, length = children.length; index < length; index++) {
            const invalid = yield* effect(1, () => index in children && invalidChild(children[index]));
            if (invalid) return fail(`node ${id} children invalid`);
        }
    }
    return { ok: true };
}

export const validateAppNode = (id, node) => runSync(validateAppNodeTraversal(id, node, true));
export const validateAppNodeWork = (id, node) => validateAppNodeTraversal(id, node, false);

export const validateVariantMetadata = (vid, variant) => {
    if (!isObj(variant)) return fail(`variant ${vid} must be an object`);
    if (!isStr(variant.id) || !isStr(variant.name)) return fail(`variant ${vid} missing id/name`);
    return { ok: true };
};

function* validatePageTemplateTraversal(vid, tid, tpl, schemaVersion, synchronous) {
    if (!synchronous) yield* effect(1, () => {});
    if (!isObj(tpl)) return fail(`template ${vid}/${tid} must be an object`);
    if (!isStr(tpl.id) || !isStr(tpl.name)) return fail(`template ${vid}/${tid} missing id/name`);
    if (!isNum(tpl.width) || !isNum(tpl.height) || tpl.width <= 0 || tpl.height <= 0 || tpl.width > MAX_TEMPLATE_DIMENSION || tpl.height > MAX_TEMPLATE_DIMENSION) {
        return fail(`template ${vid}/${tid} has invalid dimensions`);
    }
    if (!Array.isArray(tpl.elements)) return fail(`template ${vid}/${tid} elements must be an array`);
    // Layers (v8+): light, optional checks — legacy/un-migrated states must still validate.
    if (tpl.layers !== undefined) {
        if (!Array.isArray(tpl.layers)) return fail(`template ${vid}/${tid} layers must be an array`);
        if (tpl.layers.length > MAX_LAYERS_PER_TEMPLATE) return fail(`template ${vid}/${tid} has too many layers (max 200)`);
    }
    for (const el of tpl.elements) {
        if (!synchronous) yield* effect(1, () => {});
        if (el && typeof el === 'object' && el.layerId !== undefined && !isStr(el.layerId)) {
            return fail(`template ${vid}/${tid} has an element with a non-string layerId`);
        }
        if (Number.isInteger(schemaVersion) && schemaVersion >= 10
            && el && typeof el === 'object' && (el.type === 'text' || el.type === 'grid')) {
            if (el.textOverflow !== undefined && !TEXT_OVERFLOW_VALUES.includes(el.textOverflow)) {
                return fail(`template ${vid}/${tid} has an element with invalid textOverflow`);
            }
            if (el.textWrap !== undefined && typeof el.textWrap !== 'boolean') {
                return fail(`template ${vid}/${tid} has an element with invalid textWrap`);
            }
        }
        if (Number.isInteger(schemaVersion) && schemaVersion >= 11
            && el && typeof el === 'object' && el.type === 'text' && el.textPadding !== undefined) {
            if (!isObj(el.textPadding)
                || TEXT_PADDING_SIDES.some(side => !isNum(el.textPadding[side]) || el.textPadding[side] < 0)) {
                return fail(`template ${vid}/${tid} has an element with invalid textPadding`);
            }
        }
    }
    return { ok: true };
}

export const validatePageTemplate = (vid, tid, tpl, schemaVersion) =>
    runSync(validatePageTemplateTraversal(vid, tid, tpl, schemaVersion, true));
export const validatePageTemplateWork = (vid, tid, tpl, schemaVersion) =>
    validatePageTemplateTraversal(vid, tid, tpl, schemaVersion, false);

// Compatibility serialization retains native toJSON/Get behavior. This branch
// is never selected for normalization's canonically checked plain input.
const compatibilitySize = state => {
    let serialized;
    try { serialized = JSON.stringify(state); }
    catch { return undefined; }
    return serialized === undefined ? undefined : utf8ByteLength(serialized);
};

function* validateAppStateTraversal(state, mode, synchronous, measuredBytes) {
    if (!synchronous) yield* effect(1, () => {});
    if (!isObj(state)) return fail('state must be an object');
    const nodes = ownEnumerableDataValue(state, 'nodes');
    if (!isObj(nodes)) return fail('nodes must be an object');
    const rootId = ownEnumerableDataValue(state, 'rootId');
    if (!isStr(rootId) || !isObj(ownEnumerableDataValue(nodes, rootId))) {
        return fail('rootId must reference an existing node');
    }

    let bytes;
    if (measuredBytes !== undefined) bytes = measuredBytes;
    else if (mode === 'plain') {
        try { bytes = yield* plainJsonBytesWork(state); }
        catch { return fail('state is not serializable'); }
    } else {
        bytes = synchronous ? compatibilitySize(state)
            : yield* primitive('compat-json', () => compatibilitySize(state));
    }
    if (bytes === undefined) return fail('state is not serializable');
    if (bytes > MAX_STATE_BYTES) {
        return fail(`state exceeds ${MAX_STATE_BYTES} bytes`);
    }

    if (state.generator !== undefined) {
        const generatorResult = synchronous ? validateGeneratorProvenance(state.generator, { strictUnknownFields: true })
            : yield* validateGeneratorProvenanceWork(state.generator, { strictUnknownFields: true });
        if (!generatorResult.ok) return fail(generatorResult.message);
    }

    const nodeKeys = synchronous ? Object.keys(nodes) : yield* primitive('keys', () => Object.keys(nodes));
    if (nodeKeys.length > MAX_NODES) return fail('too many nodes (max 20000)');

    const nodeEntries = synchronous ? Object.entries(nodes) : yield* enumerableEntriesWork(nodes);
    for (const [id, node] of nodeEntries) {
        const result = yield* validateAppNodeTraversal(id, node, synchronous);
        if (!result.ok) return result;
    }

    if (!isObj(state.variants)) return fail('variants must be a non-empty object');
    const variantKeys = synchronous ? Object.keys(state.variants) : yield* primitive('keys', () => Object.keys(state.variants));
    if (variantKeys.length === 0) return fail('variants must be a non-empty object');
    // Keep the second enumeration: standalone accessors may change the object.
    const variantCount = synchronous ? Object.keys(state.variants).length
        : (yield* primitive('keys', () => Object.keys(state.variants))).length;
    if (variantCount > MAX_VARIANTS) return fail('too many variants (max 50)');

    let totalElements = 0;
    const variantEntries = synchronous ? Object.entries(state.variants) : yield* enumerableEntriesWork(state.variants);
    for (const [vid, variant] of variantEntries) {
        if (!synchronous) yield* effect(1, () => {});
        const variantResult = validateVariantMetadata(vid, variant);
        if (!variantResult.ok) return variantResult;
        if (!isObj(variant.templates)) return fail(`variant ${vid} templates must be an object`);
        const templateEntries = synchronous ? Object.entries(variant.templates) : yield* enumerableEntriesWork(variant.templates);
        for (const [tid, tpl] of templateEntries) {
            const templateResult = yield* validatePageTemplateTraversal(vid, tid, tpl, state.schemaVersion, synchronous);
            if (!templateResult.ok) return templateResult;
            totalElements += tpl.elements.length;
        }
    }
    if (totalElements > MAX_ELEMENTS) return fail('too many elements (max 50000)');

    return { ok: true };
}

/** Synchronous APIs share predicates without per-element work dispatch. */
export const validateAppState = state => runSync(validateAppStateTraversal(state, 'compat', true));
export const validateAppStateWork = (state, mode = 'compat') => validateAppStateTraversal(state, mode, false);

/** One immutable image: strict JSON inspection supplies the exact serialized
 * byte count used immediately by schema validation. No caller-supplied size. */
export function* inspectAppStateWork(state, expectedSchemaVersion) {
    if (!Number.isInteger(expectedSchemaVersion) || expectedSchemaVersion < 0) throw new TypeError('Invalid expected schema version');
    let inspection;
    try { inspection = yield* canonicalInspectionWork(state); }
    catch (jsonError) { return { jsonError }; }
    const schemaMatches = state?.schemaVersion === expectedSchemaVersion;
    const result = schemaMatches ? yield* validateAppStateTraversal(state, 'plain', false, inspection.bytes) : undefined;
    return { ...inspection, schemaMatches, result };
}

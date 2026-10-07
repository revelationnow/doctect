import { effect, primitive, runSync } from './cooperativeWork.js';
import { utf8LengthWork } from './jsonWork.js';

export const GENERATOR_FORMAT_VERSION = 1;
export const GENERATOR_SCRIPT_MAX_BYTES = 512 * 1024;
export const GENERATOR_COMBINED_MAX_BYTES = 1024 * 1024;
export const GENERATOR_KEYS = ['formatVersion', 'templateScript', 'hierarchyScript', 'generatedAt'];

const byteLength = value => new TextEncoder().encode(value).byteLength;
const isPlainObject = value => value !== null && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

function* validateGeneratorTraversal(value, { strictUnknownFields = false } = {}, synchronous = false) {
  if (!isPlainObject(value)) return { ok: false, issue: 'not_plain_object', message: 'Saved generator must be an object.' };
  if (strictUnknownFields) {
    const keys = synchronous ? Object.keys(value) : yield* primitive('keys', () => Object.keys(value));
    for (const key of keys) {
      if (!synchronous) yield* effect(1, () => {});
      if (!GENERATOR_KEYS.includes(key)) return { ok: false, issue: 'unknown_field', message: 'Saved generator contains unknown fields.' };
    }
  }
  if (value.formatVersion !== GENERATOR_FORMAT_VERSION) return { ok: false, issue: 'format_version', message: 'Unsupported generator format version.' };
  if (typeof value.templateScript !== 'string') return { ok: false, issue: 'template_script', message: 'Template script must be text.' };
  if (typeof value.hierarchyScript !== 'string') return { ok: false, issue: 'hierarchy_script', message: 'Hierarchy script must be text.' };
  const templateBytes = synchronous ? byteLength(value.templateScript) : yield* utf8LengthWork(value.templateScript);
  const hierarchyBytes = synchronous ? byteLength(value.hierarchyScript) : yield* utf8LengthWork(value.hierarchyScript);
  if (templateBytes > GENERATOR_SCRIPT_MAX_BYTES) return { ok: false, issue: 'template_script_too_large', message: 'Template script exceeds 512 KiB.' };
  if (hierarchyBytes > GENERATOR_SCRIPT_MAX_BYTES) return { ok: false, issue: 'hierarchy_script_too_large', message: 'Hierarchy script exceeds 512 KiB.' };
  if (templateBytes + hierarchyBytes > GENERATOR_COMBINED_MAX_BYTES) return { ok: false, issue: 'combined_scripts_too_large', message: 'Combined generator source exceeds 1 MiB.' };
  const parseDate = () => typeof value.generatedAt === 'string' ? new Date(value.generatedAt) : null;
  const generatedDate = synchronous ? parseDate() : yield* primitive('scalar', parseDate);
  if (!generatedDate || Number.isNaN(generatedDate.getTime()) || generatedDate.toISOString() !== value.generatedAt) {
    return { ok: false, issue: 'generated_at', message: 'Generator timestamp must be ISO 8601 text.' };
  }
  return { ok: true, value: {
    formatVersion: GENERATOR_FORMAT_VERSION,
    templateScript: value.templateScript,
    hierarchyScript: value.hierarchyScript,
    generatedAt: value.generatedAt,
  } };
}

/** One rule implementation; synchronous callers keep native byte counting. */
export const validateGeneratorProvenance = (value, options = undefined) =>
  runSync(validateGeneratorTraversal(value, options, true));

export const validateGeneratorProvenanceWork = (value, options = undefined) =>
  validateGeneratorTraversal(value, options);

function* normalizeGeneratorTraversal(value, synchronous) {
  if (value === undefined) return {};
  const result = yield* validateGeneratorTraversal(value, undefined, synchronous);
  return result.ok ? { generator: result.value } : { warning: `Saved generator was detached: ${result.message}` };
}

export const normalizeGeneratorProvenance = value => runSync(normalizeGeneratorTraversal(value, true));
export const normalizeGeneratorProvenanceWork = value => normalizeGeneratorTraversal(value, false);

export const generatorProvenanceEqual = (left, right) =>
  left === undefined && right === undefined
  || Boolean(left && right
    && left.formatVersion === right.formatVersion
    && left.templateScript === right.templateScript
    && left.hierarchyScript === right.hierarchyScript
    && left.generatedAt === right.generatedAt);

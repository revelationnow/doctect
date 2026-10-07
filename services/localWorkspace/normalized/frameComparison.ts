import { effect, primitive, type Work } from '../../../shared/cooperativeWork.js';
import { compareCanonicalWork, emitComparedCanonicalWork, compareStringsWork, plainJsonBytesWork, quoteWork, stableSortWork, textWork,
  type CanonicalComparison, type JsonEmit } from '../../../shared/jsonWork.js';
import { dataObjectWork, denseDataArrayWork, requireContract } from './commitProof';
import type { ProjectStoreName } from './schema';

type CompareValue = (key: string, expected: unknown, actual: unknown, emit?: JsonEmit) => Work<CanonicalComparison>;
const compareValue: CompareValue = (_key, expected, actual, emit) => compareCanonicalWork(expected, actual, emit);

function* literal(text: string, emit?: JsonEmit): Work<number> {
  if (emit) yield* textWork(text, emit);
  return text.length; // All callers supply fixed ASCII grammar, never payloads.
}
function* quoted(text: string, emit?: JsonEmit): Work<number> {
  const bytes = yield* plainJsonBytesWork(text);
  if (emit) yield* quoteWork(text, emit);
  return bytes;
}
/** Preserve envelopeFrame's own-enumerable snapshot/Get semantics. Strict
 * record/archive callers validate their container before reaching this helper. */
function* entries(value: object): Work<[string, unknown][]> {
  const keys = yield* primitive('keys', () => Object.keys(value)), rows: [string, unknown][] = [];
  for (const key of keys) yield* effect(1, () => { rows.push([key, (value as Record<string, unknown>)[key]]); });
  return yield* stableSortWork(rows, (a, b) => compareStringsWork(a[0], b[0]));
}
function* fields(expected: object, actual: object, emit: JsonEmit | undefined, compare: CompareValue): Work<CanonicalComparison> {
  const left = yield* entries(expected), right = yield* entries(actual);
  let bytes = yield* literal('{', emit);
  if (left.length !== right.length) return { equal: false, bytes };
  for (let index = 0; index < left.length; index++) {
    const [key, value] = left[index], [otherKey, otherValue] = right[index];
    if ((yield* compareStringsWork(key, otherKey)) !== 0) return { equal: false, bytes };
    if (index) bytes += yield* literal(',', emit);
    bytes += yield* quoted(key, emit); bytes += yield* literal(':', emit);
    const result = yield* compare(key, value, otherValue, emit); bytes += result.bytes;
    if (!result.equal) return { equal: false, bytes };
  }
  bytes += yield* literal('}', emit); return { equal: true, bytes };
}

/** Full recordFrame(..., false), including commit proof/window fields and the
 * original per-field depth resets. Expected output remains the persisted frame. */
export function* compareRecordWork(store: ProjectStoreName, expected: object, actual: object, emit?: JsonEmit): Work<CanonicalComparison> {
  return yield* recordComparison(store, expected, actual, emit, compareValue);
}
/** Same validation/output, but byte accounting belongs to the required hasher. */
export function* emitComparedRecordWork(store: ProjectStoreName, expected: object, actual: object, emit: JsonEmit): Work<boolean> {
  const result = yield* recordComparison(store, expected, actual, emit, function* (_key, left, right, output) {
    return { equal: yield* emitComparedCanonicalWork(left, right, output!), bytes: 0 };
  });
  return result.equal;
}
function* recordComparison(store: ProjectStoreName, expected: object, actual: object, emit: JsonEmit | undefined, compare: CompareValue): Work<CanonicalComparison> {
  yield* dataObjectWork(expected); yield* dataObjectWork(actual);
  let bytes = yield* literal('["doctect-normalized-record-v1",', emit);
  bytes += yield* quoted(store, emit); bytes += yield* literal(',', emit);
  const result = yield* fields(expected, actual, emit, compare); bytes += result.bytes;
  if (!result.equal) return { equal: false, bytes };
  bytes += yield* literal(']', emit); return { equal: true, bytes };
}

export function* compareEnvelopeWork(label: string, expected: object, actual: object, emit?: JsonEmit): Work<CanonicalComparison> {
  let bytes = yield* literal('[', emit); bytes += yield* quoted(label, emit); bytes += yield* literal(',', emit);
  const result = yield* fields(expected, actual, emit, compareValue); bytes += result.bytes;
  if (!result.equal) return { equal: false, bytes };
  bytes += yield* literal(']', emit); return { equal: true, bytes };
}

function* archiveList(label: string, expected: unknown, actual: unknown, emit?: JsonEmit): Work<CanonicalComparison> {
  requireContract(Array.isArray(expected) && Array.isArray(actual), 'Invalid normalization archive list');
  yield* denseDataArrayWork(expected); yield* denseDataArrayWork(actual);
  for (const value of expected) yield* dataObjectWork(value);
  for (const value of actual) yield* dataObjectWork(value);
  let bytes = yield* literal('[', emit); bytes += yield* quoted(label, emit); bytes += yield* literal(',', emit);
  if (expected.length !== actual.length) return { equal: false, bytes };
  for (let index = 0; index < expected.length; index++) {
    if (index) bytes += yield* literal(',', emit);
    const result = yield* compareEnvelopeWork('envelope', expected[index], actual[index], emit); bytes += result.bytes;
    if (!result.equal) return { equal: false, bytes };
  }
  // Preserve historical empty list syntax [label,], not [label].
  bytes += yield* literal(']', emit); return { equal: true, bytes };
}

/** Exact archiveSealFrame grammar, not a whole-root canonicalization that would
 * consume additional external payload ancestry or erase container constraints. */
export function* compareArchiveWork(expected: object, actual: object, emit?: JsonEmit): Work<CanonicalComparison> {
  yield* dataObjectWork(expected); yield* dataObjectWork(actual);
  let bytes = yield* literal('["archive-seal",', emit);
  const result = yield* fields(expected, actual, emit, function* (key, left, right, output) {
    if (['seed', 'presets', 'pendingImports', 'projectMetadata'].includes(key)) return yield* archiveList(key, left, right, output);
    if (key === 'workspace' || key === 'ledger' && (left !== null || right !== null)) {
      if (key === 'ledger' && (left === null || right === null)) return { equal: false, bytes: 0 };
      const a = yield* dataObjectWork(left), b = yield* dataObjectWork(right);
      return yield* compareEnvelopeWork(key, a, b, output);
    }
    return yield* compareCanonicalWork(left, right, output);
  });
  bytes += result.bytes;
  if (!result.equal) return { equal: false, bytes };
  bytes += yield* literal(']', emit); return { equal: true, bytes };
}

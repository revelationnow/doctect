import { effect, primitive, runSync } from './cooperativeWork.js';

/** Explicit caller lifetime for a retained prerequisite image; never clones it. */
export function retainRawValue(value, work) {
  let slot = value, released = false, measurement;
  value = undefined;
  const ownership = work.own(0);
  const assertLive = () => { if (released) throw new Error('Retained value has been released.'); };
  return {
    get value() { assertLive(); return slot; },
    measure() {
      assertLive();
      return measurement ??= (async () => {
        const removeGuard = work.addGuard(assertLive);
        try {
          const weight = await work.run(rawValueWeightWork(slot));
          work.assertCurrent(); assertLive();
          ownership.grow(weight.bytes);
          work.note('unmeasuredValues', weight.unmeasuredValues);
        } finally { removeGuard(); }
      })();
    },
    release() {
      if (released) return;
      released = true; slot = undefined; ownership.release();
    },
  };
}

export const JSON_MAX_NESTING = 512;
const maxNesting = JSON_MAX_NESTING;
const encoder = new TextEncoder();
export const JSON_FRAME_UNITS = 64;
const byteOutputs = new WeakMap();
/** Explicit output adaptation, never an input-validity claim. Byte views remain
 * borrowed until the callback completes; ordinary/wrapped emits retain text. */
export function utf8JsonOutput(textEmit, byteEmit) {
  if (typeof textEmit !== 'function' || typeof byteEmit !== 'function') throw new TypeError('Invalid canonical output');
  const output = function* (text) { yield* textEmit(text); };
  byteOutputs.set(output, byteEmit); return Object.freeze(output);
}
// Both callers pass at most 64 UTF-16 units (at most 192 UTF-8 bytes).
// Only the synchronous byte count escapes; no consumer retains this scratch.
const byteCountScratch = new Uint8Array(JSON_FRAME_UNITS * 3);
// Count-only traversal has no output-fragment contract. Each copy and
// encoding operation is charged separately, at most 512 visits apiece.
const lengthScratch = new Uint8Array(512 * 3);
const highSurrogate = code => code >= 0xd800 && code <= 0xdbff;
const lowSurrogate = code => code >= 0xdc00 && code <= 0xdfff;
const reject = reason => { throw new TypeError(`Value must be JSON-compatible: ${reason}`); };

/** Shared byte counter for raw text, ordered JSON and repository frames. */
export function* frameBytesWork(frame) {
  let total = 0;
  yield* frame(function* (fragment) {
    if (typeof fragment !== 'string' || fragment.length > JSON_FRAME_UNITS) throw new TypeError('Invalid frame fragment');
    const bytes = yield* effect(Math.max(1, fragment.length), () => encoder.encodeInto(fragment, byteCountScratch).written);
    yield* effect(1, () => { total += bytes; }, bytes);
  });
  return total;
}

export function* utf8LengthWork(text) {
  if (typeof text === 'string' && text.length > 0 && text.length <= 512) {
    const bytes = yield* effect(text.length, () => encoder.encodeInto(text, lengthScratch).written);
    yield* effect(1, () => {}, bytes);
    return bytes;
  }
  let total = 0;
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + 512, text.length);
    if (end < text.length && highSurrogate(text.charCodeAt(end - 1))
      && lowSurrogate(text.charCodeAt(end))) end--;
    const fragment = yield* effect(end - offset, () => text.slice(offset, end));
    const bytes = yield* effect(fragment.length, () => encoder.encodeInto(fragment, lengthScratch).written);
    yield* effect(1, () => { total += bytes; }, bytes);
    offset = end;
  }
  return total;
}
/** Caller bounds the slice and charges four visits per UTF-16 unit. */
function quotedSliceBytes(text, start, end) {
  let size = 0;
  for (let index = start; index < end; index++) {
    const code = text.charCodeAt(index);
    if (code === 34 || code === 92) size += 2;
    else if (code < 32) size += code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 2 : 6;
    else if (code < 128) size++;
    else if (code < 2048) size += 2;
    else if (highSurrogate(code) && index + 1 < end && lowSurrogate(text.charCodeAt(index + 1))) { size += 4; index++; }
    else size += highSurrogate(code) || lowSurrogate(code) ? 6 : 3;
  }
  return size;
}

/** Count well-formed JSON string bytes directly; no escaped string is materialized. */
function* quotedUtf8LengthWork(text) {
  let total = 2;
  yield* effect(1, () => {}, 2);
  for (let offset = 0; offset < text.length;) {
    // Two scans plus byte accounting cost 2 * (4 * 127 + 1) = 1018
    // visits. At 128 units, 1026 visits would force half-filled quanta.
    let end = Math.min(offset + 127, text.length);
    if (end < text.length && highSurrogate(text.charCodeAt(end - 1)) && lowSurrogate(text.charCodeAt(end))) end--;
    const bytes = yield* effect(4 * (end - offset), () => quotedSliceBytes(text, offset, end));
    yield* effect(1, () => { total += bytes; }, bytes);
    offset = end;
  }
  return total;
}

/** Measurement has no output-token bound. Never build a field string just to
 * measure it; inspect at most 250 units, including both key and string value.
 * Larger fields and non-scalars retain the ordinary checked traversal. */
function scalarFieldMeasureCost(key, value) {
  const string = typeof value === 'string', number = typeof value === 'number';
  if (!string && !(number && Number.isFinite(value)) && value !== null && typeof value !== 'boolean') return 0;
  const units = key.length + (string ? value.length : 0);
  return units > 250 ? 0 : 4 * units + 8;
}
function scalarFieldBytes(key, value, comma, runtime) {
  let bytes = (comma ? 1 : 0) + 3 + quotedSliceBytes(key, 0, key.length);
  if (typeof value === 'string') bytes += 2 + quotedSliceBytes(value, 0, value.length);
  else if (typeof value === 'number') { runtime?.note('primitiveExceptions'); bytes += JSON.stringify(value).length; }
  else bytes += value === null ? 4 : value ? 4 : 5;
  return bytes;
}
function* scalarFieldBytesWork(key, value, comma) {
  const visits = scalarFieldMeasureCost(key, value);
  if (!visits) return;
  return yield {
    visits, utf8Bytes: 0, run: runtime => scalarFieldBytes(key, value, comma, runtime),
  };
}

/** Count-only scalar block. No value survives this block. Stop before the first
 * field requiring the ordinary traversal, retaining its descriptor exactly once.
 * Descriptor capture is bounded separately from UTF-16 measurement. */
function* scalarFieldsBytesWork(frame, emitted) {
  const fields = [], limit = Math.min(16, frame.length - frame.index);
  let visits = 0;
  try {
    yield* effect(16 * limit, () => {
      for (let index = 0; index < limit; index++) {
        const key = frame.keys[frame.index + index];
        const descriptor = Object.getOwnPropertyDescriptor(frame.value, key);
        const cost = descriptor && 'value' in descriptor && descriptor.enumerable
          ? scalarFieldMeasureCost(key, descriptor.value) : 0;
        if (!cost || visits + cost > 1008) {
          frame.hasMeasuredDescriptor = true; frame.measuredDescriptor = descriptor; break;
        }
        visits += cost; fields.push({ key, value: descriptor.value });
      }
    });
    if (!fields.length) return;
    const bytes = yield { visits, utf8Bytes: 0, run(runtime) {
      let total = 0;
      for (let index = 0; index < fields.length; index++) {
        const { key, value } = fields[index];
        total += scalarFieldBytes(key, value, emitted + index > 0, runtime);
      }
      return total;
    } };
    frame.index += fields.length;
    if (frame.emitted !== undefined) frame.emitted += fields.length;
    return bytes;
  } finally { fields.length = 0; }
}

function* jsonBytesWork(value, canonical, context) {
  let bytes = 0, lease;
  const writers = {
    // Traversal sends only punctuation and JSON number/boolean/null tokens here.
    // Keys and string values use the separate Unicode/escaping-aware writer.
    text: function* (text) { yield* effect(2, () => { bytes += text.length; }, text.length); },
    string: function* (text) { bytes += yield* quotedUtf8LengthWork(text); },
    field: function* (key, value, comma) {
      const size = yield* scalarFieldBytesWork(key, value, comma);
      if (size === undefined) return false;
      yield* effect(1, () => { bytes += size; }, size);
      return true;
    },
    fields: function* (frame, emitted) {
      const size = yield* scalarFieldsBytesWork(frame, emitted);
      if (size === undefined) return false;
      yield* effect(1, () => { bytes += size; }, size);
      return true;
    },
  };
  try {
    // At most sixteen borrowed scalar/key pairs, one pending descriptor and
    // bounded numeric-conversion scratch. Register before the postguard.
    yield { visits: 1, utf8Bytes: 0, run(runtime) { lease = runtime?.own(2048); } };
    if (canonical) {
      const nesting = context?.nesting ?? 0;
      if (!Number.isInteger(nesting) || nesting < 0) throw new TypeError('Invalid JSON nesting context');
      yield* canonicalTraversal(value, undefined, nesting, false, writers, context);
    }
    else yield* orderedJsonTraversal(value, writers.text, writers.string, writers.field, writers.fields);
    return bytes;
  } finally { lease?.release(); }
}

export const plainJsonBytesWork = value => jsonBytesWork(value, false);
export const canonicalBytesWork = (value, context) => jsonBytesWork(value, true, context);
/** Measurements from this traversal, never a reusable validation/admission token. */
export function* canonicalInspectionWork(value, context) {
  const measured = { nesting: context?.nesting ?? 0, parent: context?.parent, maximumDepth: -1 };
  const bytes = yield* jsonBytesWork(value, true, measured);
  return { bytes, maximumDepth: measured.maximumDepth };
}

/** Raw logical weighting is not JSON validation. Batch only scalar occurrences;
 * objects still pass through the existing shared-identity/container traversal. */
function* scalarFieldsWeightWork(frame) {
  const fields = [], limit = Math.min(16, frame.keys.length - frame.index);
  let visits = 0;
  try {
    yield* effect(16 * limit, () => {
      for (let index = 0; index < limit; index++) {
        const key = frame.keys[frame.index + index];
        const descriptor = Object.getOwnPropertyDescriptor(frame.value, key);
        const data = descriptor && 'value' in descriptor;
        const value = data ? descriptor.value : undefined;
        const units = key.length + (typeof value === 'string' ? value.length : 0);
        const cost = units + 8;
        if (value !== null && typeof value === 'object' || units > 500 || visits + cost > 1008) {
          frame.hasMeasuredDescriptor = true; frame.measuredDescriptor = descriptor; break;
        }
        visits += cost;
        fields.push({ key, value, opaque: !data || ['bigint', 'symbol', 'function'].includes(typeof value) });
      }
    });
    if (!fields.length) return;
    let bytes = 8 * fields.length, unmeasuredValues = 0, textBytes = 0;
    yield { visits, utf8Bytes: 0, run() {
      for (const field of fields) {
        textBytes += encoder.encodeInto(field.key, lengthScratch).written;
        if (typeof field.value === 'string') textBytes += encoder.encodeInto(field.value, lengthScratch).written;
        if (field.opaque) unmeasuredValues++;
      }
    } };
    yield* effect(1, () => { bytes += textBytes; frame.index += fields.length; }, textBytes);
    return { bytes, unmeasuredValues };
  } finally { fields.length = 0; }
}

/**
 * Read-side logical weights for structured-cloned data, not serialization.
 * Eight bytes per occurrence plus UTF-8 text/binary contents. Opaque interiors
 * are explicitly flagged. Never call application getters, toJSON or toString.
 */
export function* rawValueWeightWork(value) {
  const stack = [{ value }], seen = new Set();
  let bytes = 0, unmeasuredValues = 0, lease;
  try {
    yield { visits: 1, utf8Bytes: 0, run(runtime) { lease = runtime?.own(2048); } };
    while (stack.length) {
      yield* effect(8, () => {});
      const frame = stack[stack.length - 1];
      if (!frame.entered) {
        const current = frame.value;
        bytes += 8;
        if (typeof current === 'string') {
          bytes += yield* utf8LengthWork(current);
          stack.pop(); continue;
        }
        if (current === null || typeof current !== 'object') {
          if (['bigint', 'symbol', 'function'].includes(typeof current)) unmeasuredValues++;
          stack.pop(); continue;
        }
        if (seen.has(current)) { stack.pop(); continue; }
        seen.add(current);
        if (current instanceof Date) { stack.pop(); continue; }
        if (current instanceof ArrayBuffer) {
          bytes += Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get.call(current);
          stack.pop(); continue;
        }
        if (ArrayBuffer.isView(current)) {
          const prototype = current instanceof DataView ? DataView.prototype : Object.getPrototypeOf(Uint8Array.prototype);
          const buffer = Object.getOwnPropertyDescriptor(prototype, 'buffer').get.call(current);
          stack.pop(); stack.push({ value: buffer }); continue;
        }
        if (typeof Blob !== 'undefined' && current instanceof Blob) {
          bytes += Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get.call(current);
          stack.pop(); continue;
        }
        frame.entered = true;
        if (current instanceof Map) {
          frame.iterator = Map.prototype.entries.call(current); frame.map = true;
        } else if (current instanceof Set) {
          frame.iterator = Set.prototype.values.call(current);
        } else {
          const prototype = Object.getPrototypeOf(current);
          if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) unmeasuredValues++;
          frame.keys = yield* primitive('keys', () => Object.keys(current));
          frame.index = 0;
        }
      }
      if (frame.iterator) {
        const next = yield* effect(1, () => frame.iterator.next());
        if (next.done) { stack.pop(); continue; }
        if (frame.map) stack.push({ value: next.value[1] }, { value: next.value[0] });
        else stack.push({ value: next.value });
      } else {
        if (frame.index === frame.keys.length) { stack.pop(); continue; }
        if (!frame.hasMeasuredDescriptor) {
          const measured = yield* scalarFieldsWeightWork(frame);
          if (measured) { bytes += measured.bytes; unmeasuredValues += measured.unmeasuredValues; continue; }
        }
        const key = frame.keys[frame.index++];
        bytes += yield* utf8LengthWork(key);
        let descriptor;
        if (frame.hasMeasuredDescriptor) {
          descriptor = frame.measuredDescriptor; frame.hasMeasuredDescriptor = false; frame.measuredDescriptor = undefined;
        } else descriptor = yield* effect(1, () => Object.getOwnPropertyDescriptor(frame.value, key));
        if (descriptor && 'value' in descriptor) stack.push({ value: descriptor.value });
        else { bytes += 8; unmeasuredValues++; }
      }
    }
    return { bytes, unmeasuredValues };
  } finally {
    stack.length = 0; seen.clear(); lease?.release();
  }
}

/** Bounded fragments; each emitted fragment is independently UTF-8 encodable. */
export function* textWork(text, emit) {
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + JSON_FRAME_UNITS, text.length);
    if (end < text.length && highSurrogate(text.charCodeAt(end - 1))
      && lowSurrogate(text.charCodeAt(end))) end--;
    let fragment;
    // Two traversals, at most 128 visits combined. Keep their exact charge while
    // avoiding a separate runtime dispatch for each tiny fragment copy.
    const bytes = yield* effect(2 * (end - offset), () => {
      fragment = text.slice(offset, end);
      return encoder.encodeInto(fragment, byteCountScratch).written;
    });
    yield* effect(1, () => {}, bytes);
    yield* emit(fragment);
    offset = end;
  }
}

/** One quoted token fits the existing fragment bound; escaping uses the old path. */
function* shortQuotedTokenWork(text, emit) {
  let fragment, bytes = 2;
  // At most 2*n code-unit probes plus concatenations of n+1 and n+2 units.
  // Reserve the full bounded cost even when an escape makes the probe fail.
  const safe = yield* effect(4 * text.length + 3, () => {
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code < 32 || code === 34 || code === 92) return false;
      if (highSurrogate(code)) {
        if (index + 1 === text.length || !lowSurrogate(text.charCodeAt(index + 1))) return false;
        index++; bytes += 4;
      } else if (lowSurrogate(code)) return false;
      else bytes += code < 128 ? 1 : code < 2048 ? 2 : 3;
    }
    fragment = '"' + text + '"';
    return true;
  });
  if (!safe) return false;
  yield* effect(1, () => {}, bytes);
  yield* emit(fragment);
  return true;
}

export function* quoteWork(text, emit) {
  // Primitive-only: no new coercions/getter reads for string-like callers.
  if (typeof text === 'string' && text.length <= JSON_FRAME_UNITS - 2
    && (yield* shortQuotedTokenWork(text, emit))) return;
  yield* textWork('"', emit);
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + JSON_FRAME_UNITS, text.length);
    if (end < text.length && highSurrogate(text.charCodeAt(end - 1))
      && lowSurrogate(text.charCodeAt(end))) end--;
    let fragment; let bytes = 0;
    // Copy and inspect at most 64 units. Most keys/scripts need no escaping;
    // avoid creating an escaped copy or charging work that was not performed.
    const escape = yield* effect((end - offset) * 3, () => {
      fragment = text.slice(offset, end);
      for (let index = 0; index < fragment.length; index++) {
        const code = fragment.charCodeAt(index);
        if (code < 32 || code === 34 || code === 92) return true;
        if (highSurrogate(code)) {
          if (index + 1 >= fragment.length || !lowSurrogate(fragment.charCodeAt(index + 1))) return true;
          index++; bytes += 4;
        } else if (lowSurrogate(code)) return true;
        else bytes += code < 128 ? 1 : code < 2048 ? 2 : 3;
      }
      return false;
    });
    // Native fallback reserves input read, six-unit escapes and quote trimming.
    // Its temporary string is <=384 units; output fragments remain <=64.
    if (escape) {
      const escaped = yield* effect(fragment.length * 13 + 4, () => JSON.stringify(fragment).slice(1, -1));
      yield* textWork(escaped, emit);
    } else {
      yield* effect(1, () => {}, bytes);
      yield* emit(fragment);
    }
    offset = end;
  }
  yield* textWork('"', emit);
}

export function* compareStringsWork(left, right) {
  const end = Math.min(left.length, right.length);
  if (typeof left === 'string' && typeof right === 'string') {
    let width = 1;
    for (let offset = 0; offset < end;) {
      const through = Math.min(offset + width, end);
      // Start with one pair so ordinary unequal keys reserve no unused prefix.
      // Longer equal prefixes grow to at most 64 pairs (128 visits) per operation.
      const difference = yield {
        visits: 2 * (through - offset), utf8Bytes: 0,
        run(runtime) {
          for (let index = offset; index < through; index++) {
            runtime?.note('comparedCodeUnits', 2);
            const result = left.charCodeAt(index) - right.charCodeAt(index);
            if (result) return result;
          }
          return 0;
        },
      };
      if (difference) return difference;
      offset = through; width = Math.min(64, width * 2);
    }
    return left.length - right.length;
  }
  // Preserve Get/call behavior for legacy string-like callers.
  for (let offset = 0; offset < end; offset++) {
    const difference = yield {
      visits: 2, utf8Bytes: 0,
      run(runtime) {
        runtime?.note('comparedCodeUnits', 2);
        return left.charCodeAt(offset) - right.charCodeAt(offset);
      },
    };
    if (difference) return difference;
  }
  return left.length - right.length;
}

/** Stable bottom-up merges; comparisons and each key movement can yield. */
export function* stableSortWork(values, compare) {
  let source = [], destination = [];
  for (let index = 0; index < values.length; index++) {
    yield* effect(1, () => { source.push(values[index]); });
  }
  for (let width = 1; width < source.length; width *= 2) {
    for (let start = 0; start < source.length; start += width * 2) {
      const middle = Math.min(start + width, source.length);
      const end = Math.min(start + width * 2, source.length);
      let left = start, right = middle, output = start;
      while (left < middle || right < end) {
        let takeLeft = right === end;
        if (left < middle && right < end) {
          yield* effect(1, () => {}, 0, 'sortComparisons');
          // NaN is an equal comparison, as with Array.prototype.sort.
          takeLeft = !((yield* compare(source[left], source[right])) > 0);
        }
        yield* effect(1, () => {
          destination[output++] = takeLeft ? source[left++] : source[right++];
        });
      }
    }
    [source, destination] = [destination, source];
  }
  return source;
}

/** JSON punctuation, primitive tokens and fused fields are ASCII and <=64 units. */
function* jsonTokenWork(token, emit) {
  yield* effect(1, () => {}, token.length);
  yield* emit(token);
}

/** Fuse one escape-free ASCII key/scalar field into the existing fragment bound.
 * Non-scalars, escapes and longer text use the original traversal unchanged. */
function* scalarFieldWork(key, value, comma) {
  const string = typeof value === 'string', number = typeof value === 'number';
  if (!string && !(number && Number.isFinite(value)) && value !== null && typeof value !== 'boolean') return;
  const valueBound = string ? value.length + 2 : number ? 25 : value === false ? 5 : 4;
  const bound = key.length + valueBound + 4;
  if (bound > JSON_FRAME_UNITS) return;
  const units = key.length + (string ? value.length : 0);
  return yield {
    visits: 4 * units + 2 * bound + 8, utf8Bytes: 0,
    run(runtime) {
      for (const text of string ? [key, value] : [key]) for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        if (code < 32 || code > 127 || code === 34 || code === 92) return;
      }
      let token;
      if (string) token = '"' + value + '"';
      else if (number) { runtime?.note('primitiveExceptions'); token = JSON.stringify(value); }
      else token = value === null ? 'null' : value ? 'true' : 'false';
      const field = (comma ? ',' : '') + '"' + key + '":' + token;
      return field.length <= JSON_FRAME_UNITS ? field : undefined;
    },
  };
}

/** Coalesce only JSON-produced fragments. They never split surrogate pairs or
 * contain literal unpaired surrogates. Flush before returning to the caller so
 * per-record digest/byte accounting retains its exact boundary. */
function* packedJsonWork(produce, emit) {
  const parts = []; let units = 0, lease;
  function* flush() {
    if (!units) return;
    const text = yield* effect(units + parts.length, () => {
      const result = parts.join(''); parts.length = 0; units = 0; return result;
    });
    yield* emit(text);
  }
  try {
    // <=64 fragment handles, <=192 UTF-8 bytes and one <=192-byte joined copy.
    // Capture the lease inside its operation, before the post-operation guard.
    yield { visits: 1, utf8Bytes: 0, run(runtime) { lease = runtime?.own(1024); } };
    try {
      yield* produce(function* (fragment) {
        if (units + fragment.length > JSON_FRAME_UNITS) yield* flush();
        yield* effect(2, () => { parts.push(fragment); units += fragment.length; });
        if (units === JSON_FRAME_UNITS) yield* flush();
      });
    } catch (error) {
      // Preserve the already-produced prefix for ordinary validation failures.
      // Cancellation closes the generator through finally, without yielding.
      yield* flush(); throw error;
    }
    yield* flush();
  } finally { parts.length = 0; units = 0; lease?.release(); }
}

/** Value-independent ordering only. Every occurrence still validates its own
 * prototype, descriptors, values, ancestry and depth in canonicalTraversal. */
function canonicalKeyOrders() {
  let cache, owner, retained = 0;
  return {
    *sort(keys) {
      let units = 0;
      if (keys.length > 32) return yield* stableSortWork(keys, compareStringsWork);
      const eligible = yield* effect(Math.max(1, keys.length * 2), () => {
        for (const key of keys) { units += key.length; if (key.length > 64 || units > 384) return false; }
        return true;
      });
      if (!eligible) return yield* stableSortWork(keys, compareStringsWork);
      if (!cache) yield { visits: 1, utf8Bytes: 0, run(runtime) {
        // Bounded signature pieces, their joined copy, lookup and array scratch.
        // Register inside the operation before its post-allocation guard.
        owner = runtime?.own(4096); cache = new Map();
      } };
      // <=96 references and <=480 joined units. Charge bounded metadata work
      // together, without changing the generic Work driver or reading values.
      const signature = yield* effect(units + 16 * keys.length + 1, () => {
        const parts = [];
        for (const key of keys) parts.push('' + key.length, ':', key);
        return parts.join('');
      });
      let cached;
      yield* effect(Math.max(1, signature.length * 2), () => { cached = cache.get(signature); });
      if (cached) return cached;
      const sorted = yield* stableSortWork(keys, compareStringsWork);
      const bytes = 64 + 8 * keys.length + 3 * units + 3 * signature.length;
      if (retained + bytes <= 16384) yield* effect(1, () => {
        owner?.grow(bytes); retained += bytes; cache.set(signature, sorted);
      });
      return sorted;
    },
    dispose() { cache = undefined; owner?.release(); owner = undefined; },
  };
}

function canonicalKind(value) {
  if (value === null) return 'null';
  const kind = typeof value;
  if (kind === 'number' && !Number.isFinite(value)) reject('numbers must be finite');
  if (kind !== 'boolean' && kind !== 'number' && kind !== 'string' && kind !== 'object') reject(`${kind} values are not supported`);
  return kind;
}

/** Shared container rules for serialization, inspection and paired comparison. */
function* canonicalContainerWork(current, nesting, ancestors, synchronous, context) {
  if (nesting > maxNesting) reject(`nesting exceeds ${maxNesting}`);
  if (ancestors.has(current)) reject('cycles are not supported');
  const array = Array.isArray(current), prototype = Object.getPrototypeOf(current);
  if (prototype !== (array ? Array.prototype : Object.prototype)) reject('custom prototypes are not supported');
  if (typeof context?.maximumDepth === 'number') yield* effect(2, () => { context.maximumDepth = Math.max(context.maximumDepth, nesting); });
  const keys = synchronous ? Reflect.ownKeys(current) : yield* primitive('keys', () => Reflect.ownKeys(current));
  let hasLength = false;
  for (let offset = 0; offset < keys.length; offset += 64) {
    const end = Math.min(offset + 64, keys.length);
    const check = () => {
      for (let index = offset; index < end; index++) {
        const key = keys[index];
        if (typeof key === 'symbol') reject('symbol keys are not supported');
        if (key === 'length') hasLength = true;
      }
    };
    if (synchronous) check(); else yield* effect(2 * (end - offset), check);
  }
  // Array proxies can run callbacks on either length read. Keep their existing
  // order, but let the driver check liveness before any subsequent reflection.
  if (array) {
    const length = synchronous ? current.length : yield* effect(1, () => current.length);
    if (keys.length !== length + 1 || !hasLength) reject('arrays may contain only dense indexed values');
  }
  return { array, keys, length: array ? (synchronous ? current.length : yield* effect(1, () => current.length)) : keys.length };
}
function* canonicalDescriptorWork(value, key, array, synchronous, allowMissing = false) {
  const descriptor = synchronous ? Object.getOwnPropertyDescriptor(value, key)
    : yield* effect(1, () => Object.getOwnPropertyDescriptor(value, key));
  return canonicalDescriptor(descriptor, array, allowMissing);
}
function canonicalDescriptor(descriptor, array, allowMissing = false) {
  if (allowMissing && !array && !descriptor) return;
  if (!descriptor || !('value' in descriptor)) reject(array ? 'sparse arrays and accessors are not supported' : 'getters and setters are not supported');
  if (!array && !descriptor.enumerable) reject('non-enumerable properties are not supported');
  return descriptor;
}

/** Own validation, comparison and UTF-8 generation in bounded processing batches.
 * No string fragments or encoding buffers are passed between inner stages. */
function* canonicalByteTraversal(expected, actual, paired, emit, nesting) {
  if (!Number.isInteger(nesting) || nesting < 0) throw new TypeError('Invalid JSON nesting context');
  const stack = [], leftAncestors = new Set(), rightAncestors = new Set(), orders = canonicalKeyOrders();
  let buffer, used = 0, owner, equal = true;
  const literal = text => ({ type: 'literal', text, offset: 0 });
  const string = (left, right, compare) => ({ type: 'string', left, right, compare, offset: 0, opened: false });
  function value(left, right, depth, runtime) {
    const kind = canonicalKind(left);
    if (paired && canonicalKind(right) !== kind) { equal = false; return; }
    if (kind === 'object') return { type: 'enter', left, right, nesting: depth };
    if (kind === 'string') {
      if (paired && left.length !== right.length) { equal = false; return; }
      return string(left, right, paired);
    }
    if (paired && left !== right) { equal = false; return; }
    if (kind === 'number') { runtime?.note('primitiveExceptions'); return literal(JSON.stringify(left)); }
    return literal(kind === 'null' ? 'null' : left ? 'true' : 'false');
  }
  function* flush() {
    if (!used) return;
    const size = used; used = 0;
    yield* effect(1, () => {}, size);
    yield* emit(buffer.subarray(0, size));
  }
  try {
    // Fixed traversal-slot upper bound plus the byte packet. Native key-list
    // enumeration and the shared order cache keep their existing ownership model.
    yield { visits: 256, utf8Bytes: 0, run(runtime) {
      owner = runtime?.own((JSON_MAX_NESTING + 8) * 128 + 256); buffer = new Uint8Array(192);
      const first = value(expected, actual, nesting, runtime); if (first) stack.push(first);
    } };
    try {
      while (equal && stack.length) {
        const next = stack[stack.length - 1];
        if (next.type === 'enter') {
          const left = yield* canonicalContainerWork(next.left, next.nesting, leftAncestors, false);
          let right;
          if (paired) {
            right = yield* canonicalContainerWork(next.right, next.nesting, rightAncestors, false);
            if (left.array !== right.array || left.length !== right.length) { equal = false; break; }
          }
          next.array = left.array; next.length = left.length; next.index = 0;
          next.keys = left.array ? left.keys : yield* orders.sort(left.keys);
          next.type = 'container'; leftAncestors.add(next.left); if (paired) rightAncestors.add(next.right);
          stack.push(literal(next.array ? '[' : '{')); continue;
        }
        let full = false;
        yield { visits: 1024, utf8Bytes: 0, run(runtime) {
          let remaining = 1024, compared = 0;
          const append = byte => { buffer[used++] = byte; };
          const flushComparisons = () => {
            if (compared) { runtime?.note('comparedCodeUnits', compared); compared = 0; }
          };
          try { while (equal && stack.length && remaining >= 32) {
            const frame = stack[stack.length - 1];
            if (frame.type === 'enter') break;
            if (frame.type === 'container') {
              // Publish prior character work before any callback-capable input
              // reflection or liveness guard can observe the counters.
              flushComparisons();
              remaining -= 32;
              if (frame.index === frame.length) {
                leftAncestors.delete(frame.left); if (paired) rightAncestors.delete(frame.right);
                stack.pop(); stack.push(literal(frame.array ? ']' : '}')); continue;
              }
              const index = frame.index, key = frame.array ? String(index) : frame.keys[index];
              runtime?.assertCurrent();
              const left = canonicalDescriptor(Object.getOwnPropertyDescriptor(frame.left, key), frame.array);
              runtime?.assertCurrent();
              let right;
              if (paired) {
                right = canonicalDescriptor(Object.getOwnPropertyDescriptor(frame.right, key), frame.array, true);
                runtime?.assertCurrent();
                if (!right) { equal = false; break; }
              }
              const child = value(left.value, right?.value, frame.nesting + 1, runtime);
              if (!equal) break;
              frame.index++; stack.push(child);
              if (!frame.array) { stack.push(literal(':')); stack.push(string(key, undefined, false)); }
              if (index) stack.push(literal(','));
              continue;
            }
            if (frame.type === 'literal') {
              const count = Math.min(frame.text.length - frame.offset, buffer.length - used, Math.floor(remaining / 2));
              for (let index = 0; index < count; index++) append(frame.text.charCodeAt(frame.offset++));
              remaining -= 2 * count;
              if (frame.offset === frame.text.length) stack.pop();
              if (used === buffer.length) { full = true; break; }
              continue;
            }
            if (!frame.opened) {
              if (used === buffer.length) { full = true; break; }
              append(34); remaining -= 2; frame.opened = true;
            }
            if (frame.offset === frame.left.length) {
              if (used === buffer.length) { full = true; break; }
              append(34); remaining -= 2; stack.pop(); continue;
            }
            // Reserve enough for the largest one-code-point decision before any
            // reads. Actual meter cost is input code units, output bytes and cursor movement.
            if (remaining < 16) break;
            const offset = frame.offset, code = frame.left.charCodeAt(offset); let reads = 1, width = 1, point = code;
            if (frame.compare) {
              reads++; compared += 2;
              if (code !== frame.right.charCodeAt(offset)) { equal = false; break; }
            }
            let escape;
            if (code === 34 || code === 92) escape = code;
            else if (code < 32) escape = code === 8 ? 98 : code === 9 ? 116 : code === 10 ? 110 : code === 12 ? 102 : code === 13 ? 114 : 117;
            else if (highSurrogate(code)) {
              const low = offset + 1 < frame.left.length ? frame.left.charCodeAt(offset + 1) : -1;
              if (low !== -1) reads++;
              if (lowSurrogate(low)) {
                width = 2; point = 0x10000 + ((code - 0xd800) << 10) + low - 0xdc00;
                if (frame.compare) {
                  reads++; compared += 2;
                  if (low !== frame.right.charCodeAt(offset + 1)) { equal = false; break; }
                }
              } else escape = 117;
            } else if (lowSurrogate(code)) escape = 117;
            const bytes = escape === 117 ? 6 : escape !== undefined ? 2 : point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
            if (used + bytes > buffer.length) { remaining -= reads; full = true; break; }
            if (escape !== undefined) {
              append(92); append(escape);
              if (escape === 117) for (let shift = 12; shift >= 0; shift -= 4) { const digit = code >> shift & 15; append(digit < 10 ? 48 + digit : 87 + digit); }
            } else if (bytes === 1) append(point);
            else if (bytes === 2) { append(0xc0 | point >> 6); append(0x80 | point & 63); }
            else if (bytes === 3) { append(0xe0 | point >> 12); append(0x80 | point >> 6 & 63); append(0x80 | point & 63); }
            else { append(0xf0 | point >> 18); append(0x80 | point >> 12 & 63); append(0x80 | point >> 6 & 63); append(0x80 | point & 63); }
            frame.offset += width; remaining -= reads + bytes + 1;
            if (used === buffer.length) { full = true; break; }
          } } finally { flushComparisons(); }
        } };
        if (full) yield* flush();
      }
    } catch (error) { yield* flush(); throw error; }
    if (equal) yield* flush();
    return equal;
  } finally {
    used = 0; buffer = undefined; stack.length = 0; leftAncestors.clear(); rightAncestors.clear(); orders.dispose(); owner?.release();
  }
}

/** One validation/traversal implementation, with bounded or synchronous output. */
function* canonicalTraversal(value, emit, nesting, synchronous, writers, context) {
  const writeText = writers?.text ?? (synchronous ? emit : text => jsonTokenWork(text, emit));
  const writeString = writers?.string ?? (synchronous ? function* (text) {
    yield* emit(JSON.stringify(text));
  } : text => quoteWork(text, emit));
  const stack = [{ value, nesting }];
  const ancestors = new Set(context?.parent === undefined ? [] : [context.parent]);
  const orders = canonicalKeyOrders();
  try {
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (!synchronous) yield* effect(1, () => {});
      if (!frame.keys) {
        const current = frame.value, kind = canonicalKind(current);
        if (kind === 'null' || kind === 'boolean' || kind === 'number') {
          const token = synchronous ? JSON.stringify(current)
            : yield* primitive('scalar', () => JSON.stringify(current));
          yield* writeText(token);
          stack.pop();
          continue;
        }
        if (kind === 'string') {
          yield* writeString(current);
          stack.pop();
          continue;
        }
        const container = yield* canonicalContainerWork(current, frame.nesting, ancestors, synchronous, context);
        const keys = container.keys; frame.array = container.array;
        frame.keys = frame.array ? keys : synchronous
          ? keys.sort()
          : yield* orders.sort(keys);
        frame.index = 0;
        frame.length = container.length;
        ancestors.add(current);
        yield* writeText(frame.array ? '[' : '{');
      }
      if (frame.index === frame.length) {
        yield* writeText(frame.array ? ']' : '}');
        ancestors.delete(frame.value);
        stack.pop();
        continue;
      }
      if (!frame.array && !frame.hasMeasuredDescriptor && writers?.fields
        && (yield* writers.fields(frame, frame.index))) continue;
      const key = frame.array ? String(frame.index) : frame.keys[frame.index];
      let descriptor;
      if (frame.hasMeasuredDescriptor) {
        descriptor = frame.measuredDescriptor; frame.hasMeasuredDescriptor = false; frame.measuredDescriptor = undefined;
        descriptor = canonicalDescriptor(descriptor, frame.array);
      } else descriptor = yield* canonicalDescriptorWork(frame.value, key, frame.array, synchronous);
      if (!synchronous && !frame.array) {
        if (writers?.field) {
          if (yield* writers.field(key, descriptor.value, frame.index > 0)) { frame.index++; continue; }
        } else {
          const field = yield* scalarFieldWork(key, descriptor.value, frame.index > 0);
          if (field !== undefined) { yield* writeText(field); frame.index++; continue; }
        }
      }
      if (frame.index > 0) yield* writeText(',');
      if (!frame.array) {
        yield* writeString(key);
        yield* writeText(':');
      }
      frame.index++;
      stack.push({ value: descriptor.value, nesting: frame.nesting + 1 });
    }
  } finally {
    // Lifecycle finalizers only drop owned traversal references; no yield/write.
    orders.dispose();
    stack.length = 0;
    ancestors.clear();
  }
}

/** Always bounded, even if a test or another synchronous caller drains it. */
export function* canonicalWork(value, emit, nesting = 0) {
  const bytes = byteOutputs.get(emit);
  if (bytes) { yield* canonicalByteTraversal(value, undefined, false, bytes, nesting); return; }
  yield* packedJsonWork(output => canonicalTraversal(value, output, nesting, false), emit);
}

/** Existing synchronous API: native string/sort operations, shared validation rules.
 * This does not expose an unbounded Work program to the cooperative driver.
 */
export function canonicalText(value) {
  const chunks = [];
  runSync(canonicalTraversal(value, function* (text) {
    chunks.push(text);
  }, 0, true));
  return chunks.join('');
}

const omittedJsonValue = value => value === undefined || typeof value === 'function' || typeof value === 'symbol';

function jsonScalar(value) {
  if (typeof value === 'bigint') throw new TypeError('BigInt is not JSON-compatible');
  return typeof value === 'number' ? Number.isFinite(value) ? value === 0 ? 0 : value : null : value;
}

function plainArray(value) {
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Expected plain JSON data');
  }
  return array;
}

function* jsonDescriptor(value, key) {
  const descriptor = yield* effect(1, () => Object.getOwnPropertyDescriptor(value, key));
  return checkedJsonDescriptor(descriptor);
}
function checkedJsonDescriptor(descriptor) {
  if (descriptor && !('value' in descriptor)) throw new TypeError('JSON accessors are not supported');
  return descriptor;
}

const defineData = (target, key, value) => Object.defineProperty(target, key,
  { value, enumerable: true, writable: true, configurable: true });

/** Materialize required metadata keys only, never whole payload frames. */
export function* jsonTextWork(value) {
  let text = '';
  yield* orderedJsonWork(value, function* (fragment) {
    yield* effect(1, () => { text += fragment; });
  });
  return text;
}

/** Object.entries snapshot semantics: capture all values before transforming any. */
export function* enumerableEntriesWork(value) {
  if (value === null || value === undefined) throw new TypeError('Cannot convert undefined or null to object');
  const source = Object(value); // Object.entries/values box primitives, unlike Reflect.ownKeys.
  const entries = [];
  const keys = yield* primitive('keys', () => Reflect.ownKeys(source));
  for (const key of keys) {
    yield* effect(1, () => {
      if (typeof key === 'string' && Object.getOwnPropertyDescriptor(source, key)?.enumerable) {
        entries.push([key, source[key]]);
      }
    });
  }
  return entries;
}

/** Spread semantics, including Get and symbols; normalization callers own plain data. */
export function* copyEnumerableWork(value) {
  const target = {};
  const keys = yield* primitive('keys', () => Reflect.ownKeys(value));
  for (const key of keys) {
    yield* effect(1, () => {
      if (Object.getOwnPropertyDescriptor(value, key)?.enumerable) defineData(target, key, value[key]);
    });
  }
  return target;
}

/** Shared copying/owned traversal. Only private, mutable input may use owned mode. */
function* jsonCopyTraversal(value, owned) {
  if (omittedJsonValue(value)) throw new SyntaxError('JSON root has no representation');
  const stack = [{ value }], ancestors = new Set(), completed = new Set();
  let result;
  try {
    while (stack.length) {
      yield* effect(1, () => {});
      const frame = stack[stack.length - 1];
      if (!frame.entered) {
        const current = jsonScalar(frame.value);
        const container = current !== null && typeof current === 'object';
        let target = current;
        if (container) {
          if (ancestors.has(current)) throw new TypeError('JSON cycles are not supported');
          if (owned && completed.has(current)) {
            target = yield* jsonCopyTraversal(current, false);
          } else {
            frame.array = plainArray(current);
            target = yield* effect(1, () => owned ? current : frame.array ? [] : {});
            frame.keys = frame.array ? undefined : yield* primitive('keys', () => Object.keys(current));
            frame.length = frame.array ? current.length : frame.keys.length;
            frame.index = 0;
            frame.entered = true;
            frame.target = target;
            ancestors.add(current);
            if (owned) {
              // JSON discards symbols, hidden object fields and array extras.
              const keys = yield* primitive('keys', () => Reflect.ownKeys(current));
              for (const key of keys) {
                yield* effect(1, () => {
                  const indexed = frame.array && typeof key === 'string' && key.length <= 10
                    && String(Number(key)) === key && Number.isInteger(Number(key))
                    && Number(key) >= 0 && Number(key) < current.length;
                  const keep = frame.array ? key === 'length' || indexed
                    : typeof key === 'string' && Object.getOwnPropertyDescriptor(current, key)?.enumerable;
                  if (!keep) delete current[key];
                });
              }
              if (Object.getPrototypeOf(current) === null) {
                yield* effect(1, () => Object.setPrototypeOf(current, Object.prototype));
              }
            }
          }
        }
        if (frame.parent) yield* effect(1, () => defineData(frame.parent, frame.key, target));
        else result = target;
        if (!frame.entered) { stack.pop(); continue; }
      }
      if (frame.index === frame.length) {
        ancestors.delete(frame.value);
        if (owned) completed.add(frame.value);
        stack.pop();
        continue;
      }
      const key = frame.array ? String(frame.index) : frame.keys[frame.index];
      frame.index++;
      const descriptor = yield* jsonDescriptor(frame.value, key);
      if (!frame.array && (!descriptor?.enumerable || omittedJsonValue(descriptor.value))) {
        if (owned) yield* effect(1, () => { delete frame.target[key]; });
        continue;
      }
      const item = frame.array && omittedJsonValue(descriptor?.value) ? null : descriptor.value;
      stack.push({ value: item, parent: frame.target, key });
    }
    return result;
  } finally {
    stack.length = 0;
    ancestors.clear();
    completed.clear();
  }
}

export function* jsonCloneWork(value, mode) {
  if (mode === 'compat') return yield* primitive('compat-json', () => JSON.parse(JSON.stringify(value)));
  if (mode !== 'plain') throw new TypeError('Invalid JSON copy mode');
  return yield* jsonCopyTraversal(value, false);
}

/** May partially mutate on failure: callers must discard their private working tree. */
export function* normalizeOwnedJsonWork(value) {
  return yield* jsonCopyTraversal(value, true);
}

/** JSON-order output for prevalidated plain data, not the standalone toJSON API.
 * Transform-produced holes/omissions/nonfinite numbers follow JSON conversion.
 * Root values that JSON.stringify omits emit no text. Accessors are never read.
 */
export function* orderedJsonWork(value, emit) {
  yield* packedJsonWork(output => orderedJsonTraversal(value, text => jsonTokenWork(text, output), text => quoteWork(text, output)), emit);
}

function* orderedJsonTraversal(value, writeText, writeString, writeField, writeFields) {
  const stack = [{ value }];
  const ancestors = new Set();
  try {
    while (stack.length) {
      yield* effect(1, () => {});
      const frame = stack[stack.length - 1];
      if (!frame.entered) {
        const current = jsonScalar(frame.value);
        if (omittedJsonValue(current)) {
          stack.pop();
          continue;
        }
        if (current === null || typeof current === 'boolean' || typeof current === 'number') {
          const token = yield* primitive('scalar', () => JSON.stringify(current));
          yield* writeText(token);
          stack.pop();
          continue;
        }
        if (typeof current === 'string') {
          yield* writeString(current);
          stack.pop();
          continue;
        }
        if (ancestors.has(current)) throw new TypeError('JSON cycles are not supported');
        frame.array = plainArray(current);
        frame.keys = frame.array ? undefined : yield* primitive('keys', () => Object.keys(current));
        frame.length = frame.array ? current.length : frame.keys.length;
        frame.index = 0;
        frame.emitted = 0;
        frame.entered = true;
        ancestors.add(current);
        yield* writeText(frame.array ? '[' : '{');
      }
      if (frame.index === frame.length) {
        yield* writeText(frame.array ? ']' : '}');
        ancestors.delete(frame.value);
        stack.pop();
        continue;
      }
      if (!frame.array && !frame.hasMeasuredDescriptor && writeFields
        && (yield* writeFields(frame, frame.emitted))) continue;
      const key = frame.array ? String(frame.index) : frame.keys[frame.index];
      frame.index++;
      let descriptor;
      if (frame.hasMeasuredDescriptor) {
        descriptor = frame.measuredDescriptor; frame.hasMeasuredDescriptor = false; frame.measuredDescriptor = undefined;
        descriptor = checkedJsonDescriptor(descriptor);
      } else descriptor = yield* jsonDescriptor(frame.value, key);
      if (!frame.array && (!descriptor?.enumerable || omittedJsonValue(descriptor.value))) continue;
      const item = frame.array && omittedJsonValue(descriptor?.value) ? null : descriptor.value;
      if (!frame.array) {
        if (writeField) {
          if (yield* writeField(key, item, frame.emitted > 0)) { frame.emitted++; continue; }
        } else {
          const field = yield* scalarFieldWork(key, item, frame.emitted > 0);
          if (field !== undefined) { yield* writeText(field); frame.emitted++; continue; }
        }
      }
      if (frame.emitted++) yield* writeText(',');
      if (!frame.array) {
        yield* writeString(key);
        yield* writeText(':');
      }
      stack.push({ value: item });
    }
  } finally {
    stack.length = 0;
    ancestors.clear();
  }
}

function frameCursor(frame) {
  const cursor = { pending: undefined, value: undefined, method: 'next', done: false };
  cursor.program = frame(function* (text) {
    yield* effect(1, () => {
      if (typeof text !== 'string' || text.length > JSON_FRAME_UNITS) throw new TypeError('Invalid frame fragment');
      if (cursor.pending !== undefined) throw new Error('Unconsumed frame fragment');
      cursor.pending = text;
    });
  });
  return cursor;
}

function* nextFragment(cursor) {
  while (cursor.pending === undefined && !cursor.done) {
    const step = cursor.program[cursor.method](cursor.value);
    cursor.value = undefined;
    if (step.done) {
      cursor.done = true;
      break;
    }
    try {
      cursor.value = yield step.value;
      cursor.method = 'next';
    } catch (error) {
      cursor.value = error;
      cursor.method = 'throw';
    }
  }
  // Do not resume the producer after emission until this fragment is consumed.
  const text = cursor.pending;
  cursor.pending = undefined;
  return text;
}

/** Compare both inputs in one checked walk, without generating actual-side JSON.
 * Container/descriptor rules are shared with canonical traversal; no input is
 * trusted or skipped by identity. Strings/counts remain bounded Work operations. */
export function* compareCanonicalWork(expected, actual, emitExpected) {
  return yield* canonicalComparisonWork(expected, actual, emitExpected, true);
}

/** Hash consumers already count their emitted bytes; avoid a second size pass. */
export function* emitComparedCanonicalWork(expected, actual, emitExpected) {
  const bytes = byteOutputs.get(emitExpected);
  if (bytes) return yield* canonicalByteTraversal(expected, actual, true, bytes, 0);
  return (yield* canonicalComparisonWork(expected, actual, emitExpected, false)).equal;
}

function* canonicalComparisonWork(expected, actual, emitExpected, measure) {
  const stack = [{ left: expected, right: actual, nesting: 0 }];
  const leftAncestors = new Set(), rightAncestors = new Set(), orders = canonicalKeyOrders();
  let owner;
  function* sameString(left, right) {
    if (left.length !== right.length) return false;
    for (let offset = 0; offset < left.length; offset += JSON_FRAME_UNITS) {
      const end = Math.min(offset + JSON_FRAME_UNITS, left.length);
      const same = yield { visits: 2 * (end - offset), utf8Bytes: 0, run(runtime) {
        let compared = 0, equal = true;
        for (let index = offset; index < end; index++) {
          compared += 2;
          if (left.charCodeAt(index) !== right.charCodeAt(index)) { equal = false; break; }
        }
        runtime?.note('comparedCodeUnits', compared); return equal;
      } };
      if (!same) return false;
    }
    return true;
  }
  function* compare(emit) {
    let bytes = 0;
    while (stack.length) {
      yield* effect(1, () => {});
      const frame = stack[stack.length - 1];
      if (!frame.entered) {
        const leftKind = canonicalKind(frame.left), rightKind = canonicalKind(frame.right);
        if (leftKind !== rightKind) return { equal: false, bytes };
        if (leftKind !== 'object') {
          const equal = leftKind === 'string' ? yield* sameString(frame.left, frame.right) : frame.left === frame.right;
          if (!equal) return { equal: false, bytes };
          if (leftKind === 'string') {
            if (measure) bytes += yield* quotedUtf8LengthWork(frame.left);
            if (emit) yield* quoteWork(frame.left, emit);
          } else {
            const text = yield* primitive('scalar', () => JSON.stringify(frame.left));
            if (measure) bytes += text.length;
            if (emit) yield* jsonTokenWork(text, emit);
          }
          stack.pop(); continue;
        }
        const left = yield* canonicalContainerWork(frame.left, frame.nesting, leftAncestors, false);
        const right = yield* canonicalContainerWork(frame.right, frame.nesting, rightAncestors, false);
        if (left.array !== right.array || left.length !== right.length) return { equal: false, bytes };
        frame.array = left.array; frame.length = left.length; frame.index = 0;
        frame.keys = left.array ? left.keys : yield* orders.sort(left.keys);
        frame.entered = true; leftAncestors.add(frame.left); rightAncestors.add(frame.right);
        if (measure) bytes++;
        if (emit) yield* jsonTokenWork(frame.array ? '[' : '{', emit);
      }
      if (frame.index === frame.length) {
        if (measure) bytes++;
        if (emit) yield* jsonTokenWork(frame.array ? ']' : '}', emit);
        leftAncestors.delete(frame.left); rightAncestors.delete(frame.right); stack.pop(); continue;
      }
      const key = frame.array ? String(frame.index) : frame.keys[frame.index];
      const left = yield* canonicalDescriptorWork(frame.left, key, frame.array, false);
      const right = yield* canonicalDescriptorWork(frame.right, key, frame.array, false, true);
      if (!right) return { equal: false, bytes };
      if (!frame.array) {
        const field = yield* scalarFieldWork(key, left.value, frame.index > 0);
        if (field !== undefined) {
          const leftKind = canonicalKind(left.value), rightKind = canonicalKind(right.value);
          if (leftKind !== rightKind || !(leftKind === 'string' ? yield* sameString(left.value, right.value) : left.value === right.value)) {
            return { equal: false, bytes };
          }
          if (measure) bytes += field.length;
          if (emit) yield* jsonTokenWork(field, emit);
          frame.index++; continue;
        }
      }
      if (frame.index) { if (measure) bytes++; if (emit) yield* jsonTokenWork(',', emit); }
      if (!frame.array) {
        if (measure) bytes += (yield* quotedUtf8LengthWork(key)) + 1;
        if (emit) { yield* quoteWork(key, emit); yield* jsonTokenWork(':', emit); }
      }
      frame.index++; stack.push({ left: left.value, right: right.value, nesting: frame.nesting + 1 });
    }
    return { equal: true, bytes };
  }
  try {
    yield { visits: 1, utf8Bytes: 0, run(runtime) { owner = runtime?.own(128); } };
    if (!emitExpected) return yield* compare();
    let result;
    yield* packedJsonWork(function* (emit) { result = yield* compare(emit); }, emitExpected);
    return result;
  } finally {
    stack.length = 0; leftAncestors.clear(); rightAncestors.clear(); orders.dispose(); owner?.release();
  }
}

/** Exact UTF-16 text equality, retaining at most one fragment per producer. */
export function* equalFrameWork(leftFrame, rightFrame) {
  let left, right;
  try {
    left = frameCursor(leftFrame);
    right = frameCursor(rightFrame);
    let leftText = '', rightText = '', leftOffset = 0, rightOffset = 0;
    while (true) {
      while (leftOffset === leftText.length && !left.done) {
        leftText = (yield* nextFragment(left)) ?? '';
        leftOffset = 0;
      }
      while (rightOffset === rightText.length && !right.done) {
        rightText = (yield* nextFragment(right)) ?? '';
        rightOffset = 0;
      }
      if (leftOffset === leftText.length || rightOffset === rightText.length) {
        return left.done && right.done;
      }
      const width = Math.min(leftText.length - leftOffset, rightText.length - rightOffset);
      const same = yield {
        visits: width * 2, utf8Bytes: 0,
        run(runtime) {
          let equal = true, compared = 0;
          // At most 64 pairs. Reserve the full step, but count only units read.
          for (let index = 0; index < width; index++) {
            compared += 2;
            if (leftText.charCodeAt(leftOffset + index) !== rightText.charCodeAt(rightOffset + index)) {
              equal = false;
              break;
            }
          }
          runtime?.note('comparedCodeUnits', compared);
          return equal;
        },
      };
      if (!same) return false;
      leftOffset += width;
      rightOffset += width;
    }
  } finally {
    try { left?.program.return(undefined); }
    finally { right?.program.return(undefined); }
  }
}

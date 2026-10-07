import { effect, primitive, type FrameKind, type WorkRuntime } from '../../../shared/cooperativeWork.js';
import { canonicalWork, orderedJsonWork, compareStringsWork, quoteWork, stableSortWork, textWork, type Frame } from '../../../shared/jsonWork.js';
import { digestFrame } from '../canonical';

export { equalFrameWork, frameBytesWork } from '../../../shared/jsonWork.js';

export const canonicalFrame = (value: unknown): Frame => emit => canonicalWork(value, emit);
export const orderedFrame = (value: unknown): Frame => emit => orderedJsonWork(value, emit);

/** Match captureFrame's enumerable fields, lexical ordering and per-field depth. */
export const envelopeFrame = (label: string, value: object): Frame => function* (emit) {
  const keys = yield* primitive('keys', () => Object.keys(value));
  const entries: [string, unknown][] = [];
  for (const key of keys) {
    yield* effect(1, () => { entries.push([key, (value as Record<string, unknown>)[key]]); });
  }
  const sorted = yield* stableSortWork(entries, (left, right) => compareStringsWork(left[0], right[0]));
  yield* textWork('[', emit);
  yield* quoteWork(label, emit);
  yield* textWork(',{', emit);
  for (let index = 0; index < sorted.length; index++) {
    const [key, item] = sorted[index];
    if (index) yield* textWork(',', emit);
    yield* quoteWork(key, emit);
    yield* textWork(':', emit);
    yield* canonicalWork(item, emit); // Each payload starts at its original depth.
  }
  yield* textWork('}]', emit);
};

export const listFrame = (label: string, values: readonly object[]): Frame => function* (emit) {
  yield* textWork('[', emit);
  yield* quoteWork(label, emit);
  yield* textWork(',', emit); // Historical empty list is [label,], not [label].
  for (let index = 0; index < values.length; index++) {
    if (index) yield* textWork(',', emit);
    yield* envelopeFrame('envelope', values[index])(emit);
  }
  yield* textWork(']', emit);
};

export const hashFrame = (work: WorkRuntime, kind: Exclude<FrameKind, 'none'>, frame: Frame): Promise<string> =>
  digestFrame(frame, work, kind);

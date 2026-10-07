import { effect, primitive, type Ownership, type Work, type WorkRuntime } from '../../shared/cooperativeWork.js';
import { compareStringsWork, utf8LengthWork } from '../../shared/jsonWork.js';
import { digestLegacySnapshot } from './canonical';
import {
  LEGACY_DOCUMENT_KEYS,
  type LegacyDocumentKey,
  type LegacySnapshot,
} from './legacyTypes';

export type LegacyStorage = Pick<Storage, 'getItem'>;

export type LegacyStorageListener = (
  listener: (event: StorageEvent) => void,
) => () => void;

export class LegacyCaptureError extends Error {
  readonly kind = 'legacy-changing' as const;
  readonly category = 'legacy-changing' as const;
  readonly canRetry = true;

  constructor(message: string) {
    super(message);
    this.name = 'LegacyCaptureError';
  }
}

export interface StableLegacyCaptureOptions {
  generation?: () => number;
  assertCurrent?: () => void;
  generationRetries?: number;
  work?: WorkRuntime;
  expected?: { snapshot: LegacySnapshot; digest: string; generation: number };
}

function nativeCaptureOperation<T>(work: WorkRuntime | undefined, operation: () => T): T {
  work?.assertCurrent();
  work?.note('primitiveExceptions');
  try { return operation(); }
  finally { work?.assertCurrent(); }
}

function captureSnapshot(storage: LegacyStorage, work?: WorkRuntime): LegacySnapshot {
  return Object.fromEntries(LEGACY_DOCUMENT_KEYS.map(key => {
    const raw = nativeCaptureOperation(work, () => {
      work?.note('legacyReads');
      return storage.getItem(key);
    });
    return [key, { present: raw !== null, raw }];
  })) as LegacySnapshot;
}

export function captureLegacySnapshot(storage: LegacyStorage, work?: WorkRuntime): LegacySnapshot {
  return captureSnapshot(storage, work);
}

function sameSnapshotNative(left: LegacySnapshot, right: LegacySnapshot, work?: WorkRuntime): boolean {
  for (const key of LEGACY_DOCUMENT_KEYS) {
    if (!nativeCaptureOperation(work, () => left[key].present === right[key].present)
      || !nativeCaptureOperation(work, () => left[key].raw === right[key].raw)) return false;
  }
  return true;
}

function* sameSnapshotWork(left: LegacySnapshot, right: LegacySnapshot): Work<boolean> {
  for (const key of LEGACY_DOCUMENT_KEYS) {
    yield* effect(1, () => {});
    if (left[key].present !== right[key].present) return false;
    const a = left[key].raw, b = right[key].raw;
    if (a === null || b === null) {
      if (a !== b) return false;
    } else if (yield* compareStringsWork(a, b)) return false;
  }
  return true;
}

function* measureCapture(snapshot: LegacySnapshot, ownership?: Ownership): Work<number> {
  let bytes = 0;
  for (const key of LEGACY_DOCUMENT_KEYS) {
    const raw = snapshot[key].raw;
    if (raw !== null) bytes += yield* utf8LengthWork(raw);
  }
  yield { visits: 1, utf8Bytes: 0, run(runtime) {
    runtime?.note('legacyReadBytes', bytes);
    ownership?.grow(bytes);
  } };
  return bytes;
}

export async function captureStableLegacySnapshot<T>(
  storage: LegacyStorage,
  prepare: (source: LegacySnapshot) => T | Promise<T>,
  subtle?: SubtleCrypto,
  options: StableLegacyCaptureOptions = {},
): Promise<T> {
  const retries = options.generationRetries ?? 3;
  const work = options.work;
  const removeGuard = work && options.assertCurrent ? work.addGuard(options.assertCurrent) : undefined;
  try {
    for (let attempt = 0; ; attempt += 1) {
      work?.assertCurrent();
      work?.note('legacyCaptures');
      // Raw UTF-8 image weights during this attempt, not measured heap. A
      // returned preparation/snapshot has its own caller-controlled lifetime.
      const ownership = work?.own(0);
      try {
        const generation = options.generation?.();
        const source = work
          ? await work.run(effect(64, () => captureSnapshot(storage, work)))
          : captureLegacySnapshot(storage);
        if (work) await work.run(measureCapture(source, ownership));
        const sourceDigest = await digestLegacySnapshot(source, subtle, work);
        work?.assertCurrent();
        options.assertCurrent?.();
        const prepared = work ? await work.wait(async () => prepare(source)) : await prepare(source);
        work?.assertCurrent();
        options.assertCurrent?.();
        const current = work
          ? await work.run(effect(64, () => captureSnapshot(storage, work)))
          : captureLegacySnapshot(storage);
        const currentBytes = work ? await work.run(measureCapture(current, ownership)) : 0;
        const currentDigest = await digestLegacySnapshot(current, subtle, work);
        work?.assertCurrent();
        options.assertCurrent?.();
        const sourceMatches = currentDigest === sourceDigest && (work
          ? await work.run(sameSnapshotWork(source, current))
          : sameSnapshotNative(source, current));

        // Reserve before entering this tail. Four reads and the fixed set of
        // guarded native comparisons must have no observer/task between them.
        const finishCapture = () => {
          const afterHash = captureSnapshot(storage, work);
          const finalGeneration = generation !== undefined || options.expected
            ? options.generation?.() : undefined;
          const generationChanged = generation !== undefined && finalGeneration !== generation;
          const tailMatches = sameSnapshotNative(current, afterHash, work);
          const expected = options.expected;
          const expectedMatches = !expected || (
            nativeCaptureOperation(work, () => finalGeneration === expected.generation)
            && nativeCaptureOperation(work, () => currentDigest === expected.digest)
            && sameSnapshotNative(afterHash, expected.snapshot, work)
          );
          if (tailMatches) {
            // Only exact raw/presence equality licenses reusing byte weights.
            work?.note('legacyReadBytes', currentBytes);
            ownership?.grow(currentBytes);
          }
          return { afterHash, generationChanged, tailMatches, expectedMatches };
        };
        const tail = work ? await work.run(effect(64, finishCapture)) : finishCapture();
        work?.assertCurrent();
        if (sourceMatches && tail.tailMatches && tail.expectedMatches && !tail.generationChanged) return prepared;
        // No successful path reaches another CPU-work await after the tail.
        if (work && !tail.tailMatches) await work.run(measureCapture(tail.afterHash, ownership));
        if (tail.generationChanged && attempt < retries) {
          work?.note('retries');
          continue;
        }
        throw new LegacyCaptureError('Legacy storage changed during migration preparation.');
      } finally {
        ownership?.release();
      }
    }
  } finally {
    removeGuard?.();
  }
}

export async function captureStableLegacySnapshotWithDigest(
  storage: LegacyStorage,
  subtle?: SubtleCrypto,
  options: StableLegacyCaptureOptions = {},
): Promise<{ snapshot: LegacySnapshot; digest: string }> {
  return captureStableLegacySnapshot(storage, async source => {
    const snapshot = options.work
      ? await options.work.run(primitive('clone', () => structuredClone(source)))
      : structuredClone(source);
    const digest = await digestLegacySnapshot(source, subtle, options.work);
    options.work?.assertCurrent();
    return { snapshot, digest };
  }, subtle, options);
}

export function monitorLegacyKeys(
  addStorageListener: LegacyStorageListener,
  onChange: (event: StorageEvent) => void,
): () => void {
  const legacyKeys = new Set<LegacyDocumentKey>(LEGACY_DOCUMENT_KEYS);
  return addStorageListener(event => {
    if (event.key === null || legacyKeys.has(event.key as LegacyDocumentKey)) onChange(event);
  });
}

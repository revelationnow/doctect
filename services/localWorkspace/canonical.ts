import type { WorkspaceSnapshot } from './contracts';
import { JSON_FRAME_UNITS, canonicalText, canonicalWork, copyEnumerableWork, textWork, utf8JsonOutput, type Frame, type JsonEmit } from '../../shared/jsonWork.js';
import { assertWorkRuntime, effect, type FrameKind, type Ownership, type Work, type WorkRuntime } from '../../shared/cooperativeWork.js';
import { createNormalizationSha256, type NormalizationSha256 } from './normalized/incrementalSha256';
import {
  LEGACY_DOCUMENT_KEYS,
  type LegacySnapshot,
} from './legacyTypes';

export function canonicalStringify(value: unknown): string {
  return canonicalText(value);
}

const hashMetrics = {
  source: 'sourceHashBytes', target: 'targetHashBytes', proof: 'proofHashBytes',
  stage: 'stageHashBytes', marker: 'markerHashBytes', legacy: 'legacyHashBytes',
} as const;
const typedArrayName = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag)!.get!;
const typedArrayAt = Uint8Array.prototype.at;

declare const digestIdentity: unique symbol;
export interface FrameDigest { readonly [digestIdentity]: true }
export interface FrameDigests {
  createDigest(): Work<FrameDigest>;
  emit(...digests: FrameDigest[]): JsonEmit;
  finish(digest: FrameDigest): Work<string>;
}

/** Scoped, bounded hash fan-out. Only encoded fragments are shared; each digest
 * owns independent SHA state and charges every byte/compression operation. */
export async function withFrameDigests<T>(work: WorkRuntime, kind: Exclude<FrameKind, 'none'>,
  produce: (digests: FrameDigests) => Work<T>): Promise<T> {
  assertWorkRuntime(work);
  if (!Object.prototype.hasOwnProperty.call(hashMetrics, kind)) throw new TypeError('Invalid hash frame kind');
  const metric = hashMetrics[kind];
  interface State { hash: NormalizationSha256; ownership?: Ownership; pendingBytes: number; closed: boolean }
  function* program(): Work<T> {
    const states = new Map<FrameDigest, State>(); let closed = false;
    const encoder = new TextEncoder();
    const current = (runtime?: WorkRuntime) => { if (closed || runtime !== work) throw Error('Frame digest scope is unavailable'); };
    function* step<R>(visits: number, run: () => R, utf8Bytes = 0): Work<R> {
      return (yield { visits, utf8Bytes, run(runtime) { current(runtime); return run(); } }) as R;
    }
    const stateFor = (token: FrameDigest): State => {
      const value = states.get(token); if (closed || !value || value.closed) throw Error('Frame digest is unavailable'); return value;
    };
    const release = (token: FrameDigest, value: State) => {
      value.closed = true; states.delete(token);
      const released = value.hash.dispose(); value.ownership?.release();
      if (released.visits) work.note('primitiveExceptions');
    };
    const group: FrameDigests = {
      *createDigest() {
        if (closed || states.size >= 3) throw Error('Frame digest scratch limit exceeded');
        const token = Object.freeze({}) as FrameDigest;
        yield* step(136, () => {
          if (states.size >= 3) throw Error('Frame digest scratch limit exceeded');
          const value: State = { hash: createNormalizationSha256(), pendingBytes: 0, closed: false };
          // Register before ownership's post-allocation guard can fail.
          states.set(token, value); value.ownership = work.own(value.hash.retainedBytes());
        });
        return token;
      },
      emit(...tokens) {
        if (!tokens.length || tokens.length > 3 || new Set(tokens).size !== tokens.length) throw Error('Invalid frame digest targets');
        const targets = tokens.map(stateFor);
        const available = () => { if (closed || targets.some(value => value.closed)) throw Error('Frame digest is unavailable'); };
        const encoded = function* (bytes: Uint8Array): Work<void> {
          available();
          // Host encoders can return another realm's Uint8Array. Use its intrinsic
          // brand, not constructor identity or a spoofable public toStringTag.
          if (typedArrayName.call(bytes) !== 'Uint8Array' || bytes.length > JSON_FRAME_UNITS * 3) throw new TypeError('Invalid encoded frame fragment');
          typedArrayAt.call(bytes, bytes.length); // Validate attachment without reading payload bytes.
          for (const value of targets) {
            const expectedVisits = bytes.length + 136 * Math.floor((value.pendingBytes + bytes.length) / 64);
            yield* step(Math.max(1, expectedVisits), () => {
              if (value.closed) throw Error('Frame digest is unavailable');
              const actual = value.hash.update(bytes);
              if (actual.visits !== expectedVisits || actual.inputBytes !== bytes.length) throw Error('Incremental hash work accounting mismatch');
              value.pendingBytes = (value.pendingBytes + bytes.length) % 64;
              work.note('frameBytes', bytes.length); work.note('hashBytes', bytes.length); work.note(metric, bytes.length);
            }, bytes.length);
          }
        };
        return utf8JsonOutput(function* (fragment) {
          if (closed || targets.some(value => value.closed)) throw Error('Frame digest is unavailable');
          if (typeof fragment !== 'string' || fragment.length > JSON_FRAME_UNITS) throw new TypeError('Invalid frame fragment');
          const bytes = yield* step(Math.max(1, fragment.length), () => encoder.encode(fragment));
          yield* encoded(bytes);
        }, encoded);
      },
      *finish(token) {
        const value = stateFor(token), blocks = value.pendingBytes < 56 ? 1 : 2;
        const finishVisits = blocks * 64 - value.pendingBytes + 136 * blocks + 8 + 136;
        const digest = yield* step(finishVisits, () => {
          if (value.closed) throw Error('Frame digest is unavailable');
          const result = value.hash.finish();
          if (result.work.visits !== finishVisits || !/^[a-f0-9]{64}$/.test(result.digest)) throw new Error('Invalid incremental hash completion');
          return result.digest;
        });
        release(token, value); return digest;
      },
    };
    try { return yield* produce(group); }
    finally {
      closed = true;
      for (const [token, value] of states) release(token, value);
    }
  }
  return work.run(program());
}

/** Hash bounded frame fragments without constructing a complete frame string. */
export async function digestFrame(frame: Frame, work: WorkRuntime, kind: Exclude<FrameKind, 'none'>): Promise<string> {
  return withFrameDigests(work, kind, function* (group) {
    const digest = yield* group.createDigest();
    yield* frame(group.emit(digest));
    return yield* group.finish(digest);
  });
}

export async function sha256Hex(
  value: string,
  subtle?: SubtleCrypto,
  work?: WorkRuntime,
): Promise<string> {
  if (work !== undefined) return digestFrame(emit => textWork(value, emit), work, 'source');
  const crypto = subtle === undefined ? globalThis.crypto.subtle : subtle;
  const digest = await crypto.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

const legacyEnvelope = (snapshot: LegacySnapshot) => ({
    format: 'doctect-legacy-source',
    version: 1,
    entries: LEGACY_DOCUMENT_KEYS.map(key => ({
      key,
      present: snapshot[key].present,
      raw: snapshot[key].present ? snapshot[key].raw : null,
    })),
});

export const legacySnapshotFrame = (snapshot: LegacySnapshot): Frame =>
  emit => canonicalWork(legacyEnvelope(snapshot), emit);

export async function digestLegacySnapshot(
  snapshot: LegacySnapshot,
  subtle?: SubtleCrypto,
  work?: WorkRuntime,
): Promise<string> {
  if (work !== undefined) return digestFrame(legacySnapshotFrame(snapshot), work, 'legacy');
  return sha256Hex(canonicalStringify(legacyEnvelope(snapshot)), subtle);
}

/** Exact canonical envelope order/depth, without workspace-sized projection arrays.
 * Only one shallow pending-import projection is retained at a time; payloads are
 * streamed from the caller-owned snapshot, never cloned or concatenated here.
 */
export const workspaceContentFrame = (snapshot: WorkspaceSnapshot): Frame => function* (emit) {
  yield* textWork('{"activeProjectId":', emit);
  yield* canonicalWork(snapshot.activeProjectId, emit, 1);
  yield* textWork(',"customPresets":', emit);
  yield* canonicalWork(snapshot.customPresets, emit, 1);
  yield* textWork(',"format":"doctect-indexeddb-workspace","pendingImports":[', emit);
  if (!Array.isArray(snapshot.pendingImports)) throw new TypeError('Expected pending-import array');
  for (let index = 0; index < snapshot.pendingImports.length; index++) {
    const present = yield* effect(1, () => index in snapshot.pendingImports);
    if (!present) throw new TypeError('Value must be JSON-compatible: sparse arrays are not supported');
    const pending = yield* copyEnumerableWork(snapshot.pendingImports[index]);
    yield* effect(1, () => { delete pending.createdAt; });
    if (index) yield* textWork(',', emit);
    yield* canonicalWork(pending, emit, 2);
  }
  yield* textWork('],"projectOrder":[', emit);
  if (!Array.isArray(snapshot.projects)) throw new TypeError('Expected project array');
  for (let index = 0; index < snapshot.projects.length; index++) {
    const id = yield* effect(1, () => snapshot.projects[index].id);
    if (index) yield* textWork(',', emit);
    yield* canonicalWork(id, emit, 2);
  }
  yield* textWork('],"projects":', emit);
  yield* canonicalWork(snapshot.projects, emit, 1);
  yield* textWork(',"version":1}', emit);
};

export async function digestWorkspaceContent(
  snapshot: WorkspaceSnapshot,
  subtle?: SubtleCrypto,
  work?: WorkRuntime,
): Promise<string> {
  if (work !== undefined) return digestFrame(workspaceContentFrame(snapshot), work, 'source');
  const envelope = {
    format: 'doctect-indexeddb-workspace',
    version: 1,
    projectOrder: snapshot.projects.map(project => project.id),
    projects: snapshot.projects,
    activeProjectId: snapshot.activeProjectId,
    customPresets: snapshot.customPresets,
    pendingImports: snapshot.pendingImports.map(({ createdAt: _createdAt, ...pending }) => pending),
  };
  return sha256Hex(canonicalStringify(envelope), subtle);
}

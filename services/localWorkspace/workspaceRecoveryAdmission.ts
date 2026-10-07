import { createWorkRuntime } from '../../shared/cooperativeWork.js';
import { captureLegacySnapshot, captureStableLegacySnapshotWithDigest, type LegacyStorage } from './legacy';
import { LEGACY_DOCUMENT_KEYS, type LegacySnapshot } from './legacyTypes';
import type { WorkspaceCommandAdmission } from './workspaceCommandAdmission';
import type { WorkspaceRecoveryIntent } from './normalized/workspaceRecovery';
import type { WorkspaceStamp } from './normalized/workspaceManifest';
import { WorkspaceStoreError } from './contracts';

declare const recoveryCapabilityBrand: unique symbol;
export interface WorkspaceRecoveryCapability { readonly [recoveryCapabilityBrand]: true }
export interface CapturedWorkspaceRecovery {
  readonly intent: WorkspaceRecoveryIntent; readonly expected: WorkspaceStamp;
  /** Final browser-only synchronous fence. No observer or await may follow before posting. */
  assertQuiet(): void;
}
const captures = new WeakMap<WorkspaceRecoveryCapability, { workspace: WorkspaceCommandAdmission; value: CapturedWorkspaceRecovery; claimed: boolean }>();
const refused = () => new WorkspaceStoreError('Legacy recovery source changed; confirmation is required.', 'authority-lost');

export function claimWorkspaceRecovery(capability: WorkspaceRecoveryCapability, workspace: WorkspaceCommandAdmission): CapturedWorkspaceRecovery {
  const entry = captures.get(capability);
  if (!entry || entry.workspace !== workspace || entry.claimed) throw refused();
  entry.claimed = true; captures.delete(capability); return entry.value;
}

/** Private source bridge only. No IndexedDB access, payload validation, copy allocation or writer. */
export function createWorkspaceRecoveryAdmission(options: {
  workspace: WorkspaceCommandAdmission; legacyStorage: LegacyStorage; subtle?: SubtleCrypto;
  /** Owner aborts this signal when its source/lifecycle epoch is revoked. */
  signal: AbortSignal;
  expected?: { snapshot: LegacySnapshot; digest: string; generation: number };
  generation(): number; assertCurrent(): void;
}) {
  const signal = options.signal, aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
  const assertLive = () => { if (aborted.call(signal)) throw refused(); };
  const assertCurrent = () => { assertLive(); options.assertCurrent(); assertLive(); };
  assertLive(); // Require a genuine native lifecycle pin, not a getter-bearing lookalike.
  return {
    async prepare(recoveryId: string): Promise<WorkspaceRecoveryCapability> {
      if (typeof recoveryId !== 'string' || !recoveryId.length || new TextEncoder().encode(recoveryId).length > 256) throw refused();
      assertCurrent(); const catalog = options.workspace.catalog(), expected = Object.freeze({ ...catalog.stamp });
      const generation = options.generation(), work = createWorkRuntime({ assertCurrent });
      try {
        const source = await captureStableLegacySnapshotWithDigest(options.legacyStorage, options.subtle,
          { generation: options.generation, assertCurrent, generationRetries: 0, work, expected: options.expected });
        assertCurrent();
        if (options.generation() !== generation || options.workspace.catalog() !== catalog) throw refused();
        for (const key of LEGACY_DOCUMENT_KEYS) Object.freeze(source.snapshot[key]); Object.freeze(source.snapshot);
        const intent: WorkspaceRecoveryIntent = Object.freeze({ type: 'recover-legacy-as-copies', recoveryId, source: source.snapshot, sourceDigest: source.digest });
        const value: CapturedWorkspaceRecovery = Object.freeze({ intent, expected, assertQuiet() {
          assertCurrent();
          if (options.generation() !== generation) throw refused();
          const current = captureLegacySnapshot(options.legacyStorage);
          const final = captureLegacySnapshot(options.legacyStorage);
          assertLive();
          for (const key of LEGACY_DOCUMENT_KEYS) if (current[key].present !== source.snapshot[key].present
            || current[key].raw !== source.snapshot[key].raw || final[key].present !== current[key].present || final[key].raw !== current[key].raw) throw refused();
        } });
        const capability = Object.freeze({}) as WorkspaceRecoveryCapability;
        captures.set(capability, { workspace: options.workspace, value, claimed: false }); return capability;
      } finally { work.dispose(); }
    },
    commit(capability: WorkspaceRecoveryCapability) { return options.workspace.recoverLegacy(capability); },
  };
}

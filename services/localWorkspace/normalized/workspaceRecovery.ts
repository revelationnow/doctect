import type { LegacySnapshot } from '../legacyTypes';
import { LEGACY_DOCUMENT_KEYS } from '../legacyTypes';
import type { LegacyBackupRecord } from '../schema';
import { digestLegacySnapshot } from '../canonical';
import { prepareLegacyRecoveryCopies, type RecoveryPreparationEnvironment } from '../recovery';
import { validateHistoricalBackup } from '../historicalBootstrap';
import type { CapturedWorkspaceCommand } from './workspaceCommands';
import { effect, type WorkRuntime } from '../../../shared/cooperativeWork.js';
import { compareStringsWork } from '../../../shared/jsonWork.js';
import { exactFields, exactFieldsWork, privateId, requireContract, validDigest } from './commitProof';

export interface WorkspaceRecoveryIntent {
  readonly type: 'recover-legacy-as-copies'; readonly recoveryId: string;
  readonly source: LegacySnapshot; readonly sourceDigest: string;
}
declare const workspaceRecoveryBrand: unique symbol;
export interface WorkspaceRepositoryRecovery { readonly [workspaceRecoveryBrand]: true }
export interface WorkspaceRecoveryPreparation {
  readonly token: WorkspaceRepositoryRecovery;
  readonly counts: { readonly projects: number; readonly presets: number; readonly pendingImports: number };
}
export const recoveryBackupId = (intent: WorkspaceRecoveryIntent) => `local-storage-to-indexeddb-v1:conflict:${intent.recoveryId}`;

/** Four fixed source envelopes, without parsing or walking raw payloads. */
export function frameRecoverySource(value: unknown): void {
  const source = exactFields(value, LEGACY_DOCUMENT_KEYS);
  for (const key of LEGACY_DOCUMENT_KEYS) {
    const entry = exactFields(source[key], ['present', 'raw']);
    requireContract(typeof entry.present === 'boolean' && (entry.present ? typeof entry.raw === 'string' : entry.raw === null), 'Invalid recovery source');
  }
}

export async function validateRecoverySource(intent: WorkspaceRecoveryIntent, work: WorkRuntime): Promise<void> {
  privateId(intent.recoveryId); validDigest(intent.sourceDigest);
  await work.run(exactFieldsWork(intent.source, LEGACY_DOCUMENT_KEYS));
  for (const key of LEGACY_DOCUMENT_KEYS) {
    const entry = await work.run(exactFieldsWork(intent.source[key], ['present', 'raw']));
    requireContract(typeof entry.present === 'boolean' && (entry.present ? typeof entry.raw === 'string' : entry.raw === null), 'Invalid recovery source');
  }
  requireContract(await digestLegacySnapshot(intent.source, undefined, work) === intent.sourceDigest, 'Recovery source digest mismatch');
}

/** The accepted source comes only from the independently validated capture, never the caller. */
export async function prepareWorkspaceRecoveryCopies(captured: CapturedWorkspaceCommand, intent: WorkspaceRecoveryIntent,
  requestDigest: string, now: string, environment: RecoveryPreparationEnvironment, work: WorkRuntime) {
  await validateRecoverySource(intent, work);
  requireContract(captured.recovery, 'Missing independently admitted recovery capture');
  const acceptance = captured.manifest.legacyAcceptance;
  let accepted: LegacySnapshot;
  const backupId = recoveryBackupId(intent);
  for (const backup of captured.recovery.backups) {
    requireContract((await work.run(compareStringsWork(backup.id, backupId))) !== 0, 'Recovery ID has already been used');
  }
  if (acceptance.kind === 'accepted') {
    let found: LegacyBackupRecord | undefined;
    for (const backup of captured.recovery.backups) if ((await work.run(compareStringsWork(backup.id, acceptance.backupId))) === 0) {
      requireContract(!found, 'Duplicate accepted backup'); found = backup;
    }
    accepted = (await validateHistoricalBackup(found, { id: acceptance.backupId, digest: acceptance.digest }, environment.crypto.subtle, work)).snapshot;
  } else {
    accepted = Object.fromEntries(LEGACY_DOCUMENT_KEYS.map(key => [key, { present: false, raw: null }])) as LegacySnapshot;
  }
  const acceptedDigest = acceptance.kind === 'accepted' ? acceptance.digest : await digestLegacySnapshot(accepted, undefined, work);
  requireContract(intent.sourceDigest !== acceptedDigest, 'Recovery requires a changed legacy source');
  const projects: { id: string; consumedImportId?: string }[] = [];
  for (const member of captured.manifest.members) await work.run(effect(1, () => {
    projects.push({ id: member.projectId, ...(member.consumedImport.consumedImportId ? { consumedImportId: member.consumedImport.consumedImportId } : {}) });
  }));
  let ordinal = 0;
  const copies = await prepareLegacyRecoveryCopies(intent.source, intent.sourceDigest, accepted, acceptedDigest,
    { projects, presets: captured.presets, pendingImports: captured.pendingImports }, now,
    { ...environment, randomUUID: () => `${requestDigest}-${++ordinal}` }, work, captured.recovery.durableIds);
  const backup: LegacyBackupRecord = { id: backupId, kind: 'conflict', capturedAt: now, snapshot: intent.source, digest: intent.sourceDigest };
  return { ...copies, backup };
}

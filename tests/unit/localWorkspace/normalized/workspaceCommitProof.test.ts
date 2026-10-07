import { expect, it } from 'vitest';
import { canonicalStringify } from '../../../../services/localWorkspace/canonical';
import { hashFrame } from '../../../../services/localWorkspace/normalized/work';
import { appendWorkspaceReceipt, validateWorkspaceWindowWork, verifyWorkspaceReceipts, workspaceReceiptFrame }
  from '../../../../services/localWorkspace/normalized/workspaceCommitProof';
import { workspaceManifestCoreFrame, type WorkspaceReceipt, type WorkspaceCommitWindow,
  type WorkspaceStamp, type NormalizedWorkspaceManifest } from '../../../../services/localWorkspace/normalized/workspaceManifest';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';
import { testHash } from '../../../helpers/incrementalStoreHarness';

function receipt(before: WorkspaceStamp, id = `cmd-${before.revision + 1}`, clientId = 'client'): WorkspaceReceipt {
  const core = { identity: { clientId, commandSequence: before.revision + 1, commandId: id },
    requestDigest: testHash('request'), before, after: { revision: before.revision + 1, coreDigest: testHash(`core-${before.revision + 1}`) },
    postconditionDigest: testHash('effect') };
  return { ...core, proofDigest: testHash(canonicalStringify(['doctect-workspace-receipt-v1', core])) };
}
const initial = { revision: 0, coreDigest: testHash('core-0') };
const empty = (): WorkspaceCommitWindow => ({ floorRevision: 0, floorCoreDigest: initial.coreDigest, entries: [] });

it('frames receipt contents without recursively including its own digest', async () => {
  const w = makeWorkHarness('reopen'); const value = receipt(initial);
  expect(await hashFrame(w.runtime, 'proof', workspaceReceiptFrame(value))).toBe(value.proofDigest);
});

it('retains 32 receipts with an exact evicted chain floor', async () => {
  const w = makeWorkHarness('reopen'); let stamp = initial; let window = empty(); let last: WorkspaceReceipt | null = null;
  for (let revision = 1; revision <= 33; revision++) {
    last = receipt(stamp); window = await appendWorkspaceReceipt(window, last, w.runtime); stamp = last.after;
  }
  expect(window.entries).toHaveLength(32); expect(window.floorRevision).toBe(1);
  expect(window.floorCoreDigest).toBe(testHash('core-1'));
  await expect(w.runtime.run(validateWorkspaceWindowWork(window, stamp, last))).resolves.toEqual(window);
  expect(Buffer.byteLength(canonicalStringify(window))).toBeLessThanOrEqual(64 * 1024);
});

it('evicts by exact serialized bytes below the count limit without imposing a smaller private ID cap', async () => {
  const w = makeWorkHarness('reopen'), values: WorkspaceReceipt[] = []; let stamp = initial, window = empty();
  const clientId = '\0'.repeat(255);
  for (let revision = 1; revision <= 24; revision++) {
    const value = receipt(stamp, `${String(revision).padStart(3, '0')}${'\0'.repeat(252)}`, clientId), before = structuredClone(window);
    expect(Buffer.byteLength(value.identity.commandId)).toBe(255);
    const next = await appendWorkspaceReceipt(window, value, w.runtime); expect(window).toEqual(before);
    window = next; stamp = value.after; values.push(value);
  }
  expect(window.entries.length).toBeLessThan(24); expect(window.entries.length).toBeLessThan(32);
  expect(Buffer.byteLength(canonicalStringify(window))).toBeLessThanOrEqual(64 * 1024);
  expect(window.floorRevision).toBe(24 - window.entries.length);
  expect(window.floorCoreDigest).toBe(values[window.floorRevision - 1].after.coreDigest);
  await expect(w.runtime.run(validateWorkspaceWindowWork(window, stamp, values.at(-1)!))).resolves.toEqual(window);
  const evicted = values[window.floorRevision - 1];
  const over = { floorRevision: evicted.before.revision, floorCoreDigest: evicted.before.coreDigest, entries: [evicted, ...window.entries] };
  expect(over.entries.length).toBeLessThanOrEqual(32); expect(Buffer.byteLength(canonicalStringify(over))).toBeGreaterThan(64 * 1024);
  await expect(w.runtime.run(validateWorkspaceWindowWork(over, stamp, values.at(-1)!))).rejects.toThrow('bytes exceeded');
});

it.each(['gap', 'floor', 'head', 'duplicate', 'sequence', 'private-id', 'accessor', 'overflow', 'extra'])(
  'rejects malformed workspace receipt evidence: %s', async change => {
    const first = receipt(initial); const second = receipt(first.after);
    const window: WorkspaceCommitWindow = { ...empty(), entries: [first, second] };
    let getter = 0;
    if (change === 'gap') second.before.revision = 0;
    if (change === 'floor') window.floorCoreDigest = testHash('wrong');
    if (change === 'head') second.after.revision = 4;
    if (change === 'duplicate') second.identity.commandId = first.identity.commandId;
    if (change === 'sequence') second.identity.commandSequence = first.identity.commandSequence;
    if (change === 'private-id') second.identity.clientId = 'é'.repeat(129);
    if (change === 'accessor') Object.defineProperty(second.identity, 'commandId', { enumerable: true, get() { getter++; return 'id'; } });
    if (change === 'overflow') second.after.revision = Number.MAX_SAFE_INTEGER + 1;
    if (change === 'extra') Object.assign(second, { ignoredPayload: true });
    const w = makeWorkHarness('reopen');
    await expect(w.runtime.run(validateWorkspaceWindowWork(window,
      { revision: 2, coreDigest: testHash('core-2') }, second))).rejects.toThrow();
    expect(getter).toBe(0);
  });

it('refuses to append a receipt with a false proof digest', async () => {
  const w = makeWorkHarness('reopen'); const value = receipt(initial); value.requestDigest = testHash('changed');
  await expect(appendWorkspaceReceipt(empty(), value, w.runtime)).rejects.toThrow();
});

it('verifies initial core against activation rather than a self-declared digest', async () => {
  const w = makeWorkHarness('reopen');
  const value: NormalizedWorkspaceManifest = { id: 'current', kind: 'normalized-workspace', formatVersion: 3, manifestVersion: 1,
    storageGeneration: 'g1', activation: { attemptId: 'a', sourceKind: 'fresh', sourceDigest: testHash('s'), sourceArchiveId: 'archive',
      sourceArchiveDigest: testHash('archive'), sourceWorkspaceRevision: 0 }, revision: 0,
    members: [{ projectId: 'p', incarnation: 'i', consumedImport: {}, birth: { kind: 'migration', sourceRevision: 0,
      sourceUpdatedAt: '2026-09-26T00:00:00.000Z', projectDigest: testHash('p') } }], activeProjectId: 'p', presets: [], pendingImports: [],
    legacyAcceptance: { kind: 'fresh' }, coreDigest: '', lastCommit: null, commitWindow: empty() };
  value.coreDigest = await hashFrame(w.runtime, 'proof', workspaceManifestCoreFrame(value));
  value.commitWindow.floorCoreDigest = value.coreDigest;
  await expect(verifyWorkspaceReceipts(value, { revision: 0, coreDigest: value.coreDigest }, w.runtime)).resolves.toBeUndefined();
  await expect(verifyWorkspaceReceipts(value, initial, w.runtime)).rejects.toThrow();
  const expected = { revision: 0, coreDigest: value.coreDigest }; value.activeProjectId = 'changed';
  await expect(verifyWorkspaceReceipts(value, expected, w.runtime)).rejects.toThrow();
});

// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createNormalizedRepository } from '../../../../services/localWorkspace/normalized/repository';
import type { CommitIdentity, DocumentBatch } from '../../../../services/localWorkspace/normalized/schema';
import { createNormalizationHarness, physicalRows, mutateRow } from '../../../helpers/normalizationHarness';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';
import { createWorkRuntime } from '../../../../shared/cooperativeWork.js';

let h: Awaited<ReturnType<typeof createNormalizationHarness>>;
let repository: ReturnType<typeof createNormalizedRepository>;
let opened: Awaited<ReturnType<typeof repository.openEditingWorkspace>>;
let batch: DocumentBatch;
beforeEach(async () => {
  h = await createNormalizationHarness(); repository = createNormalizedRepository(h.environment);
  expect((repository as any).resumeAbortedWorkspace).toBeTypeOf('function');
  expect((await h.run()).status).toBe('active');
  opened = await repository.openEditingWorkspace(makeWorkHarness().runtime);
  const project = opened.active.snapshot.projects[0], member = opened.admission.projectAuthorities[0];
  batch = { scope: member.scope, clientId: 'rollback-client', commitId: 'rollback-attempt', commitGeneration: 1,
    editorGeneration: 1, expectedRevision: member.authority.documentRevision,
    changes: [{ type: 'put-node', node: { ...project.initialState.nodes[project.initialState.rootId], title: 'Retained failed edit' } }] };
});
afterEach(() => { h?.adapter.close(); });
const failed = () => [{ scope: batch.scope, identity: { clientId: batch.clientId, commitId: batch.commitId,
  commitGeneration: batch.commitGeneration, editorGeneration: batch.editorGeneration, lane: 'document' } as CommitIdentity }];
async function abort(phase = 'before-put') {
  h.environment.fault = point => { if (point.phase === phase) throw new DOMException('Injected write failure', 'AbortError'); };
  await expect(repository.commitDocument(batch)).rejects.toThrow('Injected write failure');
  h.environment.fault = undefined;
}
const resume = (token = opened.admission.token, failures = failed(), work = makeWorkHarness()) =>
  (repository as any).resumeAbortedWorkspace(token, failures, work.runtime) as Promise<typeof opened.admission>;

it.each(['before-put', 'after-put', 'before-complete'])('continues after settled %s rollback using only exact metadata guards', async phase => {
  const before = await physicalRows(h); await abort(phase); expect(await physicalRows(h)).toEqual(before);
  const operations: { store: string; method: string }[] = [];
  h.environment.onWorkspaceOperation = operation => { operations.push(operation); };
  h.environment.onOperation = operation => { operations.push(operation); };
  const work = makeWorkHarness(), continued = await resume(undefined, undefined, work);
  expect(continued.token).not.toBe(opened.admission.token);
  expect(continued.catalog).toEqual(opened.admission.catalog);
  expect(continued.projectAuthorities).toEqual(opened.admission.projectAuthorities);
  expect(operations.length).toBeGreaterThan(0);
  expect(operations.every(op => ['normalizationLedger', 'workspace', 'projectHeaders', 'projectPreferences'].includes(op.store))).toBe(true);
  expect(operations.every(op => op.method === 'get')).toBe(true);
  expect(work.runtime.snapshot().ownedBytes).toBe(0);
  await expect(resume()).rejects.toBeDefined();
  await repository.commitDocument({ ...batch, commitId: 'explicit-retry', commitGeneration: 2 });
  const rows = await physicalRows(h, ['projectNodes']);
  expect(rows.projectNodes.some(row => row.value.title === 'Retained failed edit')).toBe(true);
});

it.each(['none', 'pre-transaction', 'after-commit', 'identity', 'foreign-token', 'new-owner', 'fenced', 'cancelled', 'evicted'] as const)
('refuses rollback continuation for %s', async kind => {
  if (kind === 'pre-transaction') {
    h.environment.fault = point => { if (point.phase === 'before-readback') throw Error('unused'); };
    await expect(repository.commitDocument({ ...batch, expectedRevision: batch.expectedRevision + 1 })).rejects.toBeDefined();
  } else if (kind === 'after-commit') await abort('after-commit');
  else if (kind !== 'none') await abort();
  if (kind === 'new-owner') await repository.openAdmittedProject(batch.scope);
  if (kind === 'fenced') await repository.fenceWorkspace(opened.admission.token);
  if (kind === 'evicted') {
    for (let index = 0; index < 33; index++) { batch = { ...batch, commitId: `later-abort-${index}`, commitGeneration: index + 2 }; await abort(); }
    batch = { ...batch, commitId: 'rollback-attempt', commitGeneration: 1 };
  }
  const work = makeWorkHarness(); if (kind === 'cancelled') work.cancel();
  const attempts = failed(); if (kind === 'identity') attempts[0].identity.clientId = 'different-client';
  await expect(resume(kind === 'foreign-token' ? Object.freeze({}) as any : undefined, attempts, work)).rejects.toBeDefined();
  expect(work.runtime.snapshot().ownedBytes).toBe(0);
});

it.each(['workspace', 'normalizationLedger', 'projectHeaders', 'projectPreferences'])
('refuses same-revision %s metadata substitution without returning a new capability', async store => {
  await abort(); const rows = await physicalRows(h, [store]), row = rows[store][0];
  await mutateRow(h, store, target => target.put({ ...row, unexpectedContinuationField: true }));
  await expect(resume()).rejects.toBeDefined();
});

it('refuses changed project authority rather than rebasing the failed edit', async () => {
  await abort(); await repository.commitDocument({ ...batch, commitId: 'other-success', commitGeneration: 2,
    changes: [{ type: 'put-node', node: { ...(batch.changes[0] as any).node, title: 'Different saved version' } }] });
  await expect(resume()).rejects.toBeDefined();
});

it.each(['owner-replaced', 'attempt-evicted'] as const)('revokes continuation after an intervening %s operation completes', async kind => {
  await abort(); let intervened = false;
  const original = failed();
  const work = createWorkRuntime({ assertCurrent() {}, yieldTask: async () => {
    if (!intervened && work.snapshot().candidateRows > 0) {
      intervened = true;
      if (kind === 'owner-replaced') await repository.openAdmittedProject(batch.scope);
      else for (let index = 0; index < 33; index++) { batch = { ...batch, commitId: `intervening-${index}`, commitGeneration: index + 2 }; await abort(); }
    }
  } });
  try {
    await expect(repository.resumeAbortedWorkspace(opened.admission.token, original, work)).rejects.toBeDefined();
    expect(intervened).toBe(true); expect(work.snapshot().ownedBytes).toBe(0);
  } finally { work.dispose(); }
});

it.each(['getter', 'symbol', 'hidden', 'prototype'] as const)('rejects original malformed %s evidence framing without sanitizing it', async kind => {
  await abort(); const input = failed(); let gets = 0;
  if (kind === 'getter') { const scope = input[0].scope; Object.defineProperty(input[0], 'scope', { enumerable: true, get() { gets++; return scope; } }); }
  if (kind === 'symbol') Object.defineProperty(input[0].identity, Symbol('extra'), { enumerable: true, value: true });
  if (kind === 'hidden') Object.defineProperty(input[0].identity, 'extra', { value: true });
  if (kind === 'prototype') Object.setPrototypeOf(input[0].identity, { extra: true });
  await expect(resume(undefined, input)).rejects.toBeDefined(); expect(gets).toBe(0);
});

it.each(['cancel', 'seal-race'] as const)('releases continuation custody and refuses %s during capture', async kind => {
  await abort(); const rows = await physicalRows(h, ['normalizationLedger']); let interrupted = false;
  const work = createWorkRuntime({ assertCurrent() { if (kind === 'cancel' && interrupted) throw new DOMException('Cancelled', 'AbortError'); },
    yieldTask: async () => {
      if (!interrupted && work.snapshot().candidateRows >= 2) {
        interrupted = true;
        if (kind === 'seal-race') await mutateRow(h, 'normalizationLedger', store => store.put({ ...rows.normalizationLedger[0], sourceKind: 'fresh' }));
      }
    } });
  try {
    await expect(repository.resumeAbortedWorkspace(opened.admission.token, failed(), work)).rejects.toBeDefined();
    expect(interrupted).toBe(true); expect(work.snapshot().ownedBytes).toBe(0);
    if (kind === 'cancel') await expect(resume()).resolves.toHaveProperty('token');
  } finally { work.dispose(); }
});

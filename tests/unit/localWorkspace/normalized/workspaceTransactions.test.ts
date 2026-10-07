// @vitest-environment node
import 'fake-indexeddb/auto';
import { IDBTransaction as FakeTransaction } from 'fake-indexeddb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceCommandHarness } from '../../../helpers/workspaceCommandHarness';
import { createNormalizationHarness, mutateRow, physicalRows } from '../../../helpers/normalizationHarness';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { createNormalizedRepository } from '../../../../services/localWorkspace/normalized/repository';
import type { WorkspaceRepositoryAdmission, WorkspaceRepositoryMethods } from '../../../../services/localWorkspace/normalized/workspaceCommands';
import { testHash } from '../../../helpers/incrementalStoreHarness';
import { decomposeProject } from '../../../../services/localWorkspace/normalized/codec';
import { NORMALIZED_STORE_NAMES, type ProjectStoreName } from '../../../../services/localWorkspace/normalized/schema';

const projectStores = NORMALIZED_STORE_NAMES.filter((store): store is ProjectStoreName => store !== 'normalizationLedger');
const matrixProject = { ...makeIncrementalProject(2), id: 'fault-matrix' };
const matrixImage = decomposeProject(matrixProject, { storageGeneration: 'matrix', projectId: matrixProject.id, incarnation: 'matrix-incarnation' });
const matrixRecordCount = projectStores.reduce((sum, store) => sum + matrixImage[store].size, 0);

describe('workspace transactions', () => {
  let h: Awaited<ReturnType<typeof createWorkspaceCommandHarness>>;
  beforeEach(async () => { h = await createWorkspaceCommandHarness(); });
  afterEach(() => h?.adapter.close());
  const ready = () => { expect(typeof h.repository.commitWorkspace).toBe('function'); };

  it('creates, saves, closes and recreates without reviving the old incarnation', async () => {
    ready(); const retained = (await h.repository.readRetainedSource()).snapshot;
    const project = { ...makeIncrementalProject(2), id: 'created' };
    const first = await h.commit({ type: 'create-and-activate-project', project });
    const oldScope = first.projects[0].scope;
    const admitted = await h.repository.bindAdmittedProject(first.projects[0].records);
    const saved = await h.repository.commitDocument({ scope: oldScope, clientId: 'old', commitGeneration: 1,
      commitId: 'before-close', editorGeneration: 1, expectedRevision: admitted.documentRevision,
      changes: [{ type: 'put-node', node: { ...project.initialState.nodes.root, title: 'Saved before close' } }] });
    h.noteAck(oldScope, saved);
    await h.commit({ type: 'close-project', projectId: project.id });
    const second = await h.commit({ type: 'create-and-activate-project', project });
    expect(second.projects[0].scope.incarnation).not.toBe(oldScope.incarnation);
    expect((await h.repository.readActiveSnapshot())!.snapshot.projects.map(row => row.id)).toEqual([h.a.id, h.b.id, project.id]);
    expect((await h.repository.readRetainedSource()).snapshot).toEqual(retained);
    await expect(h.repository.commitDocument({ scope: oldScope, clientId: 'old', commitGeneration: 2,
      commitId: 'stale', editorGeneration: 2, expectedRevision: saved.revision,
      changes: [{ type: 'put-node', node: { ...project.initialState.nodes.root, title: 'Stale' } }] })).rejects.toThrow();
  });

  it('closes the last member and installs its successor together', async () => {
    ready(); await h.commit({ type: 'close-project', projectId: h.b.id });
    await expect(h.commit({ type: 'close-project', projectId: h.a.id })).rejects.toThrow();
    const result = await h.commit({ type: 'close-project', projectId: h.a.id, successor: { ...makeIncrementalProject(2), id: 'successor' } });
    expect(result.projects[0].scope.projectId).toBe('successor');
    const current = await h.repository.readActiveSnapshot();
    expect(current!.snapshot.projects.map(row => row.id)).toEqual(['successor']);
    expect(current!.snapshot.activeProjectId).toBe('successor');
  });

  it('preserves preset order through real save and delete transactions', async () => {
    ready();
    const preset = (id: string) => ({ id, title: id, desc: '', isCustom: true as const, initialState: makeIncrementalProject(2).initialState });
    await h.commit({ type: 'save-custom-preset', preset: preset('one') });
    await h.commit({ type: 'save-custom-preset', preset: preset('two') });
    await h.commit({ type: 'save-custom-preset', preset: { ...preset('one'), title: 'Changed' } });
    await h.commit({ type: 'delete-custom-preset', presetId: 'one' });
    expect((await physicalRows(h, ['presets'])).presets.map(row => [row.id, row.position])).toEqual([['two', 0]]);
    expect((await h.repository.readActiveSnapshot())!.snapshot.customPresets.map(row => row.id)).toEqual(['two']);
  });

  it('stages, replaces and consumes exactly one import, preserving retry provenance', async () => {
    ready();
    const pendingImport = { id: 'old-import', targetProjectId: 'old-target', name: 'Import', state: makeIncrementalProject(2).initialState, createdAt: h.preparation.now() };
    const attemptProvenance = { sourceKeyDigest: testHash('source'), payloadDigest: testHash('old') };
    await h.commit({ type: 'stage-import', pendingImport, attemptProvenance });
    expect((await h.commit({ type: 'stage-import', pendingImport, attemptProvenance })).outcome).toBe('already-staged');
    await h.commit({ type: 'replace-staged-import', expected: { importId: pendingImport.id, targetProjectId: pendingImport.targetProjectId,
      createdAt: pendingImport.createdAt, ...attemptProvenance }, replacement: {
      pendingImport: { ...pendingImport, id: 'new-import', targetProjectId: 'new-target' },
      attemptProvenance: { ...attemptProvenance, payloadDigest: testHash('new') } } });
    const consumed = await h.commit({ type: 'consume-import', importId: 'new-import' });
    expect(consumed.outcome).toBe('consumed');
    await h.commit({ type: 'activate-project', projectId: h.a.id });
    expect((await h.commit({ type: 'consume-import', importId: 'new-import' })).outcome).toBe('already-consumed');
    const current = await h.repository.readActiveSnapshot();
    expect(current!.snapshot.activeProjectId).toBe(h.a.id);
    expect(current!.snapshot.projects.filter(row => row.id === 'new-target')).toHaveLength(1);
    expect(current!.snapshot.pendingImports).toEqual([]);
  });

  it('rejects a forged token before inspecting command payload', async () => {
    ready(); let reads = 0;
    const batch = { get intent() { reads++; throw Error('payload'); } } as any;
    await expect(h.repository.commitWorkspace({} as WorkspaceRepositoryAdmission, batch)).rejects.toThrow();
    expect(reads).toBe(0);
  });

  it('rejects foreign and stale workspace admissions without rebasing', async () => {
    ready();
    const other = createNormalizedRepository(h.environment) as ReturnType<typeof createNormalizedRepository> & WorkspaceRepositoryMethods;
    const admission = await other.admitWorkspace(); const batch = h.request({ type: 'activate-project', projectId: h.b.id });
    await expect(other.commitWorkspace(h.admission.token, batch)).rejects.toThrow();
    await h.commit({ type: 'activate-project', projectId: h.b.id });
    await expect(other.commitWorkspace(admission.token, batch)).rejects.toThrow();
    expect((await physicalRows(h, ['workspace'])).workspace[0].revision).toBe(h.catalog().stamp.revision);
  });

  it.each(['after-put', 'before-complete'])('rolls back every affected row at %s', async phase => {
    ready(); const before = await physicalRows(h, ['workspace', 'projectHeaders', 'projectNodes', 'projectVariants', 'projectTemplates', 'projectSources', 'projectExtensions', 'projectPreferences']);
    h.environment.workspaceFault = point => { if (point.phase === phase) throw new DOMException('quota', 'QuotaExceededError'); };
    await expect(h.commit({ type: 'create-and-activate-project', project: { ...makeIncrementalProject(2), id: 'rolled-back' } })).rejects.toThrow();
    h.environment.workspaceFault = undefined;
    expect(await physicalRows(h, ['workspace', 'projectHeaders', 'projectNodes', 'projectVariants', 'projectTemplates', 'projectSources', 'projectExtensions', 'projectPreferences'])).toEqual(before);
  });

  it('inspects a lost acknowledgement as committed, not rollback', async () => {
    ready(); const batch = h.request({ type: 'create-and-activate-project', project: { ...makeIncrementalProject(2), id: 'lost-ack' } });
    h.environment.workspaceFault = point => { if (point.phase === 'after-commit') throw Error('lost acknowledgement'); };
    await expect(h.repository.commitWorkspace(h.admission.token, batch)).rejects.toThrow('lost acknowledgement');
    h.environment.workspaceFault = undefined;
    const fence = await h.repository.fenceWorkspace(h.admission.token);
    const inspected = await h.repository.inspectWorkspaceAttempt(batch, fence);
    expect(inspected.type).toBe('committed');
    if (inspected.type === 'committed') expect(inspected.result.projects[0].scope.projectId).toBe('lost-ack');
    expect((await physicalRows(h, ['projectHeaders'])).projectHeaders.filter(row => row.value.id === 'lost-ack')).toHaveLength(1);
  });

  it('refuses close when the physical header belongs to another incarnation', async () => {
    ready(); const rows = await physicalRows(h, ['projectHeaders']);
    const header = rows.projectHeaders.find(row => row.value.id === h.b.id);
    await mutateRow(h, 'projectHeaders', store => store.put({ ...header, incarnation: 'different-incarnation' }));
    const before = await physicalRows(h, ['workspace', 'projectHeaders']);
    await expect(h.commit({ type: 'close-project', projectId: h.b.id })).rejects.toThrow();
    expect(await physicalRows(h, ['workspace', 'projectHeaders'])).toEqual(before);
  });

  it('requires the matching owner fence and refuses changed request identity for absence', async () => {
    ready(); const batch = h.request({ type: 'create-and-activate-project', project: { ...makeIncrementalProject(2), id: 'not-written' } });
    h.environment.workspaceFault = point => { if (point.phase === 'before-cas') throw Error('not written'); };
    await expect(h.repository.commitWorkspace(h.admission.token, batch)).rejects.toThrow('not written'); h.environment.workspaceFault = undefined;
    expect((await h.repository.inspectWorkspaceAttempt(batch)).type).toBe('unknown');
    const other = await h.repository.admitWorkspace(); const unrelated = await h.repository.fenceWorkspace(other.token);
    expect((await h.repository.inspectWorkspaceAttempt(batch, unrelated)).type).toBe('unknown');
    const matching = await h.repository.fenceWorkspace(h.admission.token);
    expect((await h.repository.inspectWorkspaceAttempt(batch, matching)).type).toBe('not-committed');
    const changed = structuredClone(batch); (changed.intent as { project: { name: string } }).project.name = 'different request';
    expect(await h.repository.inspectWorkspaceAttempt(changed, matching)).toEqual({ type: 'conflict', reason: 'identity-mismatch' });
  });

  it('fences incomplete capture before it can write and does not invent an absence proof', async () => {
    ready(); const batch = h.request({ type: 'create-and-activate-project', project: { ...makeIncrementalProject(2), id: 'cancelled', retained: 'x'.repeat(100_000) } });
    const pending = h.repository.commitWorkspace(h.admission.token, batch);
    const fenced = h.repository.fenceWorkspace(h.admission.token);
    await expect(pending).rejects.toThrow(); const fence = await fenced;
    expect((await h.repository.inspectWorkspaceAttempt(batch, fence)).type).toBe('unknown');
    expect((await physicalRows(h, ['projectHeaders'])).projectHeaders.some(row => row.value.id === 'cancelled')).toBe(false);
    await expect(h.repository.commitWorkspace(h.admission.token, batch)).rejects.toThrow('ingress-required');
  });

  it('returns a proven current attempt once without advancing its revision again', async () => {
    ready(); const batch = h.request({ type: 'activate-project', projectId: h.b.id });
    const first = await h.repository.commitWorkspace(h.admission.token, batch);
    const again = await h.repository.commitWorkspace(h.admission.token, batch);
    expect(again).toEqual(first);
    expect((await physicalRows(h, ['workspace'])).workspace[0].revision).toBe(first.receipt.after.revision);
  });

  it('does not publish an older catalog after a later workspace command', async () => {
    ready(); const batch = h.request({ type: 'activate-project', projectId: h.b.id });
    const first = await h.repository.commitWorkspace(h.admission.token, batch);
    await h.repository.commitWorkspace(h.admission.token, { ...h.request({ type: 'activate-project', projectId: h.a.id }), expected: first.delta.after });
    expect(await h.repository.inspectWorkspaceAttempt(batch)).toEqual({ type: 'conflict', reason: 'authority-changed' });
  });

  it('does not reuse a failed attempt identity for a different payload', async () => {
    ready(); const batch = h.request({ type: 'create-and-activate-project', project: { ...makeIncrementalProject(2), id: 'immutable-attempt' } });
    h.environment.workspaceFault = point => { if (point.phase === 'before-cas') throw Error('before write'); };
    await expect(h.repository.commitWorkspace(h.admission.token, batch)).rejects.toThrow('before write');
    h.environment.workspaceFault = undefined;
    const changed = structuredClone(batch); (changed.intent as { project: { name: string } }).project.name = 'changed';
    await expect(h.repository.commitWorkspace(h.admission.token, changed)).rejects.toThrow('identity-mismatch');
    expect((await physicalRows(h, ['projectHeaders'])).projectHeaders.some(row => row.value.id === 'immutable-attempt')).toBe(false);
  });

  it('rejects two pending imports reserving the same target', async () => {
    ready(); const pendingImport = { id: 'first-import', targetProjectId: 'shared-target', name: 'Import',
      state: makeIncrementalProject(2).initialState, createdAt: h.preparation.now() };
    await h.commit({ type: 'stage-import', pendingImport });
    await expect(h.commit({ type: 'stage-import', pendingImport: { ...pendingImport, id: 'second-import' } })).rejects.toThrow();
    expect((await physicalRows(h, ['pendingImports'])).pendingImports.map(row => row.id)).toEqual(['first-import']);
  });

  it.each(['consume', 'stage'])('refuses %s replay when consumed target header is missing', async operation => {
    ready(); const pendingImport = { id: 'header-replay', targetProjectId: 'header-target', name: 'Import',
      state: makeIncrementalProject(2).initialState, createdAt: h.preparation.now() };
    await h.commit({ type: 'stage-import', pendingImport });
    const result = await h.commit({ type: 'consume-import', importId: pendingImport.id });
    await mutateRow(h, 'projectHeaders', store => store.delete([result.projects[0].scope.storageGeneration, pendingImport.targetProjectId]));
    const before = await physicalRows(h, ['workspace']);
    await expect(h.commit(operation === 'consume' ? { type: 'consume-import', importId: pendingImport.id }
      : { type: 'stage-import', pendingImport })).rejects.toThrow();
    expect(await physicalRows(h, ['workspace'])).toEqual(before);
  });

  it('does not normalize an invalid payload into the identity of a changed retry', async () => {
    ready(); const batch = h.request({ type: 'create-and-activate-project', project: { ...makeIncrementalProject(2), id: 'undefined-identity', extra: undefined } });
    await expect(h.repository.commitWorkspace(h.admission.token, batch)).rejects.toThrow();
    const changed = structuredClone(batch); delete (changed.intent as { project: Record<string, unknown> }).project.extra;
    await expect(h.repository.commitWorkspace(h.admission.token, changed)).rejects.toThrow('identity-mismatch');
    expect((await physicalRows(h, ['projectHeaders'])).projectHeaders.some(row => row.value.id === 'undefined-identity')).toBe(false);
  });

  it('detaches restart inspection input before asynchronous workspace admission', async () => {
    ready(); const batch = h.request({ type: 'activate-project', projectId: h.b.id });
    await h.repository.commitWorkspace(h.admission.token, batch);
    const reader = createNormalizedRepository(h.environment);
    const inspection = reader.inspectWorkspaceAttempt(batch);
    (batch.intent as { projectId: string }).projectId = h.a.id;
    expect((await inspection).type).toBe('committed');
  });

  it('reports a conflict after a created target has been edited', async () => {
    ready(); const project = { ...makeIncrementalProject(2), id: 'advanced-target' };
    const batch = h.request({ type: 'create-and-activate-project', project });
    const result = await h.repository.commitWorkspace(h.admission.token, batch), material = result.projects[0];
    await h.repository.bindAdmittedProject(material.records);
    await h.repository.commitDocument({ scope: material.scope, clientId: 'edit', commitGeneration: 1, commitId: 'edit', editorGeneration: 1,
      expectedRevision: 0, changes: [{ type: 'put-node', node: { ...project.initialState.nodes.root, title: 'Edited' } }] });
    expect(await h.repository.inspectWorkspaceAttempt(batch)).toEqual({ type: 'conflict', reason: 'authority-changed' });
  });

  it.each(['document', 'preferences', 'structure'] as const)('refuses stale close after a remote %s save wins', async lane => {
    const project = { ...makeIncrementalProject(2), id: 'remote-edit' };
    const material = (await h.commit({ type: 'create-and-activate-project', project })).projects[0];
    const close = h.request({ type: 'close-project', projectId: project.id });
    const remote = createNormalizedRepository(h.environment); await remote.bindAdmittedProject(material.records);
    const identity = { scope: material.scope, clientId: 'remote', commitId: 'remote-edit', commitGeneration: 1, editorGeneration: 1 };
    if (lane === 'preferences') await remote.commitPreferences({ ...identity, observedPreferenceRevision: 0, patch: { scale: 2 } });
    else if (lane === 'document') await remote.commitDocument({ ...identity, expectedRevision: 0,
      changes: [{ type: 'put-node', node: { ...project.initialState.nodes.root, title: 'Remote edit' } }] });
    else {
      const template = material.records.projectTemplates.values().next().value!.value;
      await remote.commitDocument({ ...identity, expectedRevision: 0, changes: [{ type: 'put-template', variantId: 'default',
        template: { ...template, layers: [...template.layers!, { ...template.layers![0], id: 'new-layer' }] } }],
        structural: { expectedFoldStructureGeneration: 0, mappings: [
          { type: 'continue', from: { variantId: 'default', templateId: template.id, position: 0 }, to: { variantId: 'default', templateId: template.id, position: 0 } },
          { type: 'create', to: { variantId: 'default', templateId: template.id, position: 1 }, cell: { present: false } },
        ] } });
    }
    const before = await physicalRows(h, ['workspace', ...projectStores]);
    await expect(h.repository.commitWorkspace(h.admission.token, close)).rejects.toThrow();
    expect(await physicalRows(h, ['workspace', ...projectStores])).toEqual(before);
    expect((await h.repository.readActiveSnapshot())!.snapshot.projects.some(row => row.id === project.id)).toBe(true);
  });

  it('refuses an already preparing remote save when close commits first', async () => {
    const project = { ...makeIncrementalProject(2), id: 'close-wins' };
    const material = (await h.commit({ type: 'create-and-activate-project', project })).projects[0];
    let release!: () => void, entered!: () => void, pause = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const remote = createNormalizedRepository({ ...h.environment, hash: async text => {
      if (pause) { pause = false; entered(); await gate; } return testHash(text);
    } });
    await remote.bindAdmittedProject(material.records); pause = true;
    const saving = remote.commitDocument({ scope: material.scope, clientId: 'remote', commitId: 'late-save', commitGeneration: 1,
      editorGeneration: 1, expectedRevision: 0, changes: [{ type: 'put-node', node: { ...project.initialState.nodes.root, title: 'Late' } }] })
      .then(() => 'saved', error => error);
    try {
      await reached; await h.commit({ type: 'close-project', projectId: project.id }); release();
      expect(await saving).toBeInstanceOf(Error);
      expect((await physicalRows(h, ['projectHeaders'])).projectHeaders.some(row => row.value.id === project.id)).toBe(false);
      expect((await h.repository.readActiveSnapshot())!.snapshot.projects.map(row => row.id)).toEqual([h.a.id, h.b.id]);
    } finally { release(); await saving; }
  });

  it('accepts only one of two concurrent workspace commands with the same before-stamp', async () => {
    const remote = createNormalizedRepository(h.environment), admitted = await remote.admitWorkspace();
    const before = h.catalog().stamp;
    const outcomes = await Promise.allSettled([
      h.repository.commitWorkspace(h.admission.token, h.request({ type: 'activate-project', projectId: h.b.id })),
      remote.commitWorkspace(admitted.token, h.request({ type: 'activate-project', projectId: h.a.id })),
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await physicalRows(h, ['workspace'])).workspace[0].revision).toBe(before.revision + 1);
  });

  it('retires project cache on durable completion even when the post-completion guard fails', async () => {
    ready(); const project = { ...makeIncrementalProject(2), id: 'durably-retired' };
    const result = await h.commit({ type: 'create-and-activate-project', project }), material = result.projects[0];
    await h.repository.bindAdmittedProject(material.records);
    let fenced: ReturnType<typeof h.repository.fenceWorkspace> | undefined;
    const dispatch = FakeTransaction.prototype.dispatchEvent;
    const spy = vi.spyOn(FakeTransaction.prototype, 'dispatchEvent').mockImplementation(function (event) {
      if (!fenced && event.type === 'complete' && this.mode === 'readwrite' && this.objectStoreNames.contains('workspace')) {
        fenced = h.repository.fenceWorkspace(h.admission.token);
      }
      return dispatch.call(this, event);
    });
    try { await expect(h.commit({ type: 'close-project', projectId: project.id })).rejects.toThrow(); }
    finally { spy.mockRestore(); }
    expect(fenced).toBeDefined(); await fenced;
    expect((await physicalRows(h, ['projectHeaders'])).projectHeaders.some(row => row.value.id === project.id)).toBe(false);
    await expect(h.repository.commitDocument({ scope: material.scope, clientId: 'old', commitGeneration: 1, commitId: 'late', editorGeneration: 1,
      expectedRevision: 0, changes: [{ type: 'put-node', node: { ...project.initialState.nodes.root, title: 'Too late' } }] })).rejects.toThrow('ingress-required');
  });

  it.each(Array.from({ length: matrixRecordCount + 1 }, (_, index) => index + 1))('aborts create atomically at actual put ordinal %s', async ordinal => {
    ready(); const before = await physicalRows(h, ['workspace', ...projectStores]); let fired = false;
    h.environment.workspaceFault = point => {
      if (point.phase === 'after-put' && point.ordinal === ordinal) { fired = true; throw new DOMException('quota', 'QuotaExceededError'); }
    };
    await expect(h.commit({ type: 'create-and-activate-project', project: matrixProject })).rejects.toThrow();
    h.environment.workspaceFault = undefined; expect(fired).toBe(true);
    expect(await physicalRows(h, ['workspace', ...projectStores])).toEqual(before);
  });

  it.each(Array.from({ length: matrixRecordCount }, (_, index) => index + 1))('aborts close atomically at actual delete ordinal %s', async ordinal => {
    ready(); const created = await h.commit({ type: 'create-and-activate-project', project: matrixProject });
    expect(projectStores.reduce((sum, store) => sum + created.projects[0].records[store].size, 0)).toBe(matrixRecordCount);
    const before = await physicalRows(h, ['workspace', ...projectStores]); let fired = false;
    h.environment.workspaceFault = point => {
      if (point.phase === 'after-delete' && point.ordinal === ordinal) { fired = true; throw Error('delete fault'); }
    };
    await expect(h.commit({ type: 'close-project', projectId: matrixProject.id })).rejects.toThrow();
    h.environment.workspaceFault = undefined; expect(fired).toBe(true);
    expect(await physicalRows(h, ['workspace', ...projectStores])).toEqual(before);
  });

  it('keeps activation and presets away from unchanged document and historical payloads', async () => {
    ready(); const calls: { store: string; method: string; phase: string }[] = [];
    h.environment.onWorkspaceOperation = operation => { calls.push(operation); };
    await h.commit({ type: 'activate-project', projectId: h.b.id });
    expect(calls.every(call => ['workspace', 'normalizationLedger', 'projectHeaders'].includes(call.store))).toBe(true);
    expect(calls.filter(call => call.phase === 'write').map(call => call.store)).toEqual(['workspace']);
    calls.length = 0;
    await h.commit({ type: 'save-custom-preset', preset: { id: 'isolated', title: 'Preset', desc: '', isCustom: true, initialState: makeIncrementalProject(2).initialState } });
    expect(calls.every(call => ['workspace', 'normalizationLedger', 'presets'].includes(call.store))).toBe(true);
    expect(calls.filter(call => call.phase === 'write').map(call => call.store)).toEqual(['presets', 'workspace']);
  });

  it('classifies a malformed current receipt window as verification conflict, not unavailable storage', async () => {
    ready(); const batch = h.request({ type: 'activate-project', projectId: h.b.id });
    await h.repository.commitWorkspace(h.admission.token, batch);
    const rows = await physicalRows(h, ['workspace']);
    await mutateRow(h, 'workspace', store => store.put({ ...rows.workspace[0], commitWindow: { ...rows.workspace[0].commitWindow, entries: 'invalid' } }));
    expect(await h.repository.inspectWorkspaceAttempt(batch)).toEqual({ type: 'conflict', reason: 'verification-failed' });
  });
});

describe('historically admitted workspace imports', () => {
  let legacy: Awaited<ReturnType<typeof createNormalizationHarness>>;
  let admission: Awaited<ReturnType<typeof legacy.repository.admitWorkspace>>;
  beforeAll(async () => {
    legacy = await createNormalizationHarness(); await legacy.exportSource();
    const previous = await physicalRows(legacy, ['pendingImports']);
    const position = Math.max(-1, ...previous.pendingImports.map(row => row.position)) + 1;
    const pending = { targetProjectId: 'historical-shared', name: 'Historical import',
      state: makeIncrementalProject(2).initialState, createdAt: legacy.preparation.now(), warnings: [] };
    // Historical setup only. The actual normalizer establishes current authority.
    await mutateRow(legacy, 'pendingImports', store => {
      store.put({ id: 'historical-one', position, pendingImport: { ...pending, id: 'historical-one' } });
      store.put({ id: 'historical-two', position: position + 1, pendingImport: { ...pending, id: 'historical-two' } });
    });
    expect((await legacy.run()).status).toBe('active'); admission = await legacy.repository.admitWorkspace();
  });
  afterAll(() => legacy?.adapter.close());
  it('consumes an admitted historical target collision without erasing the other pending import', async () => {
    const result = await legacy.repository.commitWorkspace(admission.token, { storageGeneration: admission.catalog.storageGeneration,
      identity: { clientId: 'historical', commandId: 'consume', commandSequence: 1 }, expected: admission.catalog.stamp,
      targets: [], intent: { type: 'consume-import', importId: 'historical-one' } });
    expect(result.outcome).toBe('consumed');
    const active = await legacy.repository.readActiveSnapshot();
    expect(active!.snapshot.pendingImports.some(row => row.id === 'historical-two')).toBe(true);
    expect(active!.snapshot.projects.some(row => row.id === 'historical-shared')).toBe(true);
  });
});

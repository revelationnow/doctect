// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspaceWorkerHandler } from '../../../../services/localWorkspace/normalized/coordinator';
import { describeRequest, validateResponse } from '../../../../services/localWorkspace/workspaceWorkerProtocol';
import { createNormalizationHarness } from '../../../helpers/normalizationHarness';

it('frames rollback continuation separately and correlates the new binding ID', () => {
  const request = { type: 'workspace-resume-aborted', storageGeneration: 'generation', admissionId: 7 };
  const expected = describeRequest(request);
  expect(expected.context).toEqual({ requestType: request.type, storageGeneration: 'generation', admissionId: 7 });
  const response: any = { protocolVersion: 1, workerEpoch: 2, requestId: 8, context: expected.context,
    response: { type: 'workspace-resumed', admissionId: 8, catalog: { storageGeneration: 'generation', stamp: { revision: 0, coreDigest: 'a'.repeat(64) },
      members: [], activeProjectId: 'project', presets: [], pendingImports: [] }, projectAuthorities: [] } };
  expect(() => validateResponse(response, expected, 8, 2)).not.toThrow();
  response.response.admissionId = 7; expect(() => validateResponse(response, expected, 8, 2)).toThrow();
  for (const value of [{ ...request, admissionId: 0 }, { ...request, proof: 'caller assertion' }, { ...request, storageGeneration: '' }])
    expect(() => describeRequest(value)).toThrow();
});

describe('live worker rollback continuation', () => {
  let h: Awaited<ReturnType<typeof createNormalizationHarness>>, handler: ReturnType<typeof createWorkspaceWorkerHandler>, id: number, editor: any;
  const request = async (value: any) => {
    const expected = describeRequest(value), requestId = ++id;
    const response = await handler.handle({ protocolVersion: 1, workerEpoch: 1, requestId, request: value });
    return validateResponse(response, expected, requestId, 1) as any;
  };
  beforeEach(async () => {
    h = await createNormalizationHarness(); expect((await h.run()).status).toBe('active');
    handler = createWorkspaceWorkerHandler(h.environment); id = 0;
    const opened = await request({ type: 'normalization-open' });
    let response = await request({ type: 'normalization-step', sessionId: opened.sessionId, operation: 'editor' });
    while (response.type === 'normalization-progress') response = await request({ type: 'normalization-continue', sessionId: opened.sessionId, operationId: response.operationId });
    expect(response.type).toBe('normalization-result'); editor = response.value;
    await request({ type: 'normalization-close', sessionId: opened.sessionId });
  });
  afterEach(() => { handler?.dispose(); h?.adapter.close(); });
  const batch = () => {
    const project = editor.active.snapshot.projects[0], binding = editor.projects[0];
    return { scope: binding.scope, clientId: 'retry-client', commitId: 'failed-attempt', commitGeneration: 1, editorGeneration: 1,
      expectedRevision: binding.authority.documentRevision,
      changes: [{ type: 'put-node', node: { ...project.initialState.nodes[project.initialState.rootId], title: 'Retried worker edit' } }] };
  };
  const continuation = () => request({ type: 'workspace-resume-aborted', storageGeneration: editor.workspace.catalog.storageGeneration,
    admissionId: editor.workspace.admissionId });

  it('keeps the failed binding stale and rotates all bindings only after proven rollback', async () => {
    const input = batch(), oldId = editor.projects[0].admissionId;
    h.environment.fault = point => { if (point.phase === 'before-put') throw new DOMException('write abort', 'AbortError'); };
    expect(await request({ type: 'document-batch', admissionId: oldId, batch: input })).toMatchObject({ type: 'failed', admission: 'invalidated' });
    h.environment.fault = undefined;
    expect(await request({ type: 'document-batch', admissionId: oldId, batch: input })).toMatchObject({ type: 'failed', code: 'stale-admission' });
    const resumed = await continuation(); expect(resumed.type).toBe('workspace-resumed'); expect(resumed.admissionId).not.toBe(oldId);
    expect(resumed.projectAuthorities).toEqual(editor.workspace.projectAuthorities);
    expect(await continuation()).toMatchObject({ type: 'failed', code: 'stale-admission' });
    expect(await request({ type: 'document-batch', admissionId: oldId, batch: input })).toMatchObject({ type: 'failed', code: 'stale-admission' });
    expect(await request({ type: 'document-batch', admissionId: resumed.admissionId,
      batch: { ...input, commitId: 'retry-attempt', commitGeneration: 2 } })).toMatchObject({ type: 'document-result' });
  });

  it('does not invent rollback from a post-commit AbortError', async () => {
    h.environment.fault = point => { if (point.phase === 'after-commit') throw new DOMException('lost acknowledgement', 'AbortError'); };
    expect(await request({ type: 'document-batch', admissionId: editor.projects[0].admissionId, batch: batch() })).toMatchObject({ type: 'failed' });
    h.environment.fault = undefined;
    expect(await continuation()).toMatchObject({ type: 'failed' });
  });

  it('requires an authentic failed attempt without retiring healthy bindings on a refused probe', async () => {
    expect(await continuation()).toMatchObject({ type: 'failed' });
    expect(await request({ type: 'document-batch', admissionId: editor.projects[0].admissionId, batch: batch() })).toMatchObject({ type: 'document-result' });
  });
});

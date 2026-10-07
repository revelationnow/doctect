import { expect, it } from 'vitest';
import { describeRequest, validateResponse, type WorkspaceWorkerRequest } from '../../../../services/localWorkspace/workspaceWorkerProtocol';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { partitionState } from '../../../../services/document/partition';
import type { BulkDocumentBatch } from '../../../../services/localWorkspace/normalized/schema';

function fixture() {
  const project = makeIncrementalProject(1), scope = { storageGeneration: 'g', projectId: project.id, incarnation: 'i' };
  const batch: BulkDocumentBatch = { scope, clientId: 'c', commitId: 'r', commitGeneration: 4, editorGeneration: 8,
    expected: { documentRevision: 2, preferenceRevision: 3, foldStructureGeneration: 1 },
    state: project.initialState, preferences: partitionState(project.initialState).preferences };
  const request: WorkspaceWorkerRequest = { type: 'replace-document', admissionId: 7, batch };
  const expected = describeRequest(request);
  const response = { protocolVersion: 1, workerEpoch: 1, requestId: 9, context: expected.context, response: {
    type: 'replacement-result', ack: { type: 'document-replaced', projectId: scope.projectId, incarnation: 'i', commitId: 'r',
      editorGeneration: 8, authority: { documentRevision: 3, preferenceRevision: 4, foldStructureGeneration: 2 }, boundaryDigest: 'a'.repeat(64) } } };
  return { batch, request, expected, response };
}
it('accepts exact bulk metadata without reading state or preference payloads', () => {
  const h = fixture(); let reads = 0;
  Object.defineProperty(h.batch.state, 'nodes', { enumerable: true, get() { reads++; throw Error('opaque'); } });
  Object.defineProperty(h.batch.preferences, 'layerCollapsed', { enumerable: true, get() { reads++; throw Error('opaque'); } });
  expect(() => describeRequest(h.request)).not.toThrow(); expect(reads).toBe(0);
  expect(validateResponse(h.response, h.expected, 9, 1)).toEqual(h.response.response);
});
it.each(['documentRevision', 'preferenceRevision', 'foldStructureGeneration'] as const)('requires exactly one %s increment', field => {
  const h = fixture(); h.response.response.ack.authority[field]++;
  expect(() => validateResponse(h.response, h.expected, 9, 1)).toThrow();
});
it.each(['commitId', 'incarnation', 'projectId', 'boundaryDigest'] as const)('rejects wrong replacement %s', field => {
  const h = fixture(); h.response.response.ack[field] = 'wrong';
  expect(() => validateResponse(h.response, h.expected, 9, 1)).toThrow();
});
it('pins expected counter values even when caller changes the request afterward', () => {
  const h = fixture(); h.batch.expected.preferenceRevision = 99;
  expect(() => validateResponse(h.response, h.expected, 9, 1)).not.toThrow();
});
it('does not accept a replacement result for a cut-authority request', () => {
  const h = fixture(), expected = describeRequest({ type: 'project-cut-authority', admissionId: 7, scope: h.batch.scope });
  expect(() => validateResponse({ ...h.response, context: expected.context }, expected, 9, 1)).toThrow();
});

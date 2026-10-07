// @vitest-environment node
import { expect, it } from 'vitest';
import { describeRequest, validateResponse } from '../../../../services/localWorkspace/workspaceWorkerProtocol';
import { legacySnapshot, LEGACY_KEYS } from '../../../helpers/localWorkspaceFixtures';
import type { WorkspaceBatch } from '../../../../services/localWorkspace/normalized/workspaceCommands';

function request() {
  const batch: WorkspaceBatch = { storageGeneration: 'generation', identity: { clientId: 'client', commandId: 'command', commandSequence: 1 },
    expected: { revision: 0, coreDigest: '0'.repeat(64) }, targets: [],
    intent: { type: 'recover-legacy-as-copies', recoveryId: 'drift', sourceDigest: '1'.repeat(64), source: legacySnapshot({}) } };
  return { type: 'workspace-recovery-prepare' as const, admissionId: 1, batch };
}
it('frames recovery source descriptors before transport can invoke an accessor', () => {
  const input = request(); if (input.batch.intent.type !== 'recover-legacy-as-copies') throw Error('fixture');
  let reads = 0; Object.defineProperty(input.batch.intent.source[LEGACY_KEYS.projects], 'raw', { enumerable: true, get() { reads++; return null; } });
  expect(() => describeRequest(input)).toThrow(); expect(reads).toBe(0);
});
it.each(['admissionId', 'preparationId', 'sourceDigest', 'recoveryId', 'counts', 'workerEpoch', 'identity', 'expected'] as const)(
  'correlates prepared recovery %s', field => {
    const expected = describeRequest(request());
    const envelope = { protocolVersion: 1, workerEpoch: 1, requestId: 2, context: structuredClone(expected.context), response: {
      type: 'workspace-recovery-prepared', admissionId: 1, preparationId: 2, sourceDigest: '1'.repeat(64), recoveryId: 'drift',
      counts: { projects: 1, presets: 0, pendingImports: 0 } } };
    expect(() => validateResponse(envelope, expected, 2, 1)).not.toThrow();
    if (field === 'workerEpoch') envelope.workerEpoch++;
    else if (field === 'identity') Object.assign(envelope.context, { identity: { clientId: 'other', commandId: 'command', commandSequence: 1 } });
    else if (field === 'expected') Object.assign(envelope.context, { expected: { revision: 1, coreDigest: '0'.repeat(64) } });
    else if (field === 'counts') envelope.response.counts.projects = -1;
    else Object.assign(envelope.response, { [field]: typeof envelope.response[field] === 'number' ? 99 : 'wrong' });
    expect(() => validateResponse(envelope, expected, 2, 1)).toThrow();
  });
it('ordinary workspace protocol cannot carry the recovery intent', () => {
  expect(() => describeRequest({ ...request(), type: 'workspace-command' })).toThrow();
});

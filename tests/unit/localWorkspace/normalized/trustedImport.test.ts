// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { runSync } from '../../../../shared/cooperativeWork.js';
import { canonicalText } from '../../../../shared/jsonWork.js';
import { canonicalFrame, envelopeFrame, envelopeFrameText, hashFrame } from '../../../../services/localWorkspace/normalized/work';
import * as commands from '../../../../services/localWorkspace/normalized/workspaceCommands';
import { preparePendingImport, preparePendingImportWork } from '../../../../services/localWorkspace/validation';
import { makeWorkHarness } from '../../../helpers/normalizationWorkHarness';
import { makeIncrementalProject } from '../../../helpers/incrementalFixtures';
import { createPlannerProject } from '../../../../services/presets';
import type { StoredPendingImport } from '../../../../services/localWorkspace/schema';

const sha256Hex = async (text: string) => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
  byte => byte.toString(16).padStart(2, '0')).join('');
const frameText = (frame: ReturnType<typeof envelopeFrame>) => {
  const chunks: string[] = [];
  runSync(frame(function* (text: string) { chunks.push(text); }));
  return chunks.join('');
};
/** A gallery project published before layers existed (schema 7). */
const legacyState = () => {
  const state = structuredClone(makeIncrementalProject(2).initialState) as any;
  state.schemaVersion = 7;
  for (const variant of Object.values(state.variants) as any[]) for (const template of Object.values(variant.templates) as any[]) {
    delete template.layers; for (const element of template.elements) delete element.layerId;
  }
  return state;
};
const pendingInput = (state: unknown, id = 'gallery-import') => ({ id, targetProjectId: `${id}-target`, name: 'Gallery 雪 😀', state,
  createdAt: '2026-10-14T00:00:00.000Z' });
const storedRow = (state: unknown): StoredPendingImport => ({ id: 'gallery-import', position: 0,
  pendingImport: preparePendingImport(pendingInput(state), { warningPolicy: 'retain' }),
  attemptProvenance: { sourceKeyDigest: 'a'.repeat(64), payloadDigest: 'b'.repeat(64), pendingImportDigest: 'c'.repeat(64) } });
const awkward = { b: 1, a: [1, { z: 1, y: 2 }], '😀 key': 'value ', '': '', 'lone \ud800': 'tail \udc00', 'Ä': null, 'a\u0000': 'nul' };

describe('trusted import twins', () => {
  it.each([['workspace-import-v1'], ['workspace-seal']])('envelopeFrameText(%s) is byte-identical to envelopeFrame', label => {
    for (const value of [awkward, storedRow(createPlannerProject()), storedRow(legacyState())]) {
      expect(envelopeFrameText(label, value)).toBe(frameText(envelopeFrame(label, value)));
    }
  });

  it('trustedImportDescriptor equals the metered import descriptor digests', async () => {
    for (const row of [storedRow(createPlannerProject()), storedRow(legacyState()), { ...storedRow(legacyState()), attemptProvenance: undefined } as any]) {
      if (row.attemptProvenance === undefined) delete row.attemptProvenance;
      const w = makeWorkHarness();
      const expected = { id: row.id, position: row.position, targetProjectId: row.pendingImport.targetProjectId, createdAt: row.pendingImport.createdAt,
        recordDigest: await hashFrame(w.runtime, 'proof', envelopeFrame('workspace-import-v1', row)),
        pendingImportDigest: await hashFrame(w.runtime, 'proof', canonicalFrame(row.pendingImport)),
        ...(Object.hasOwn(row, 'attemptProvenance') ? { attemptProvenance: { ...row.attemptProvenance } } : {}) };
      expect(await commands.trustedImportDescriptor(row, sha256Hex)).toEqual(expected);
    }
  });

  it('hash(canonicalText(x)) equals the metered canonical proof digest', async () => {
    for (const value of [awkward, storedRow(createPlannerProject()).pendingImport]) {
      expect(await sha256Hex(canonicalText(value))).toBe(await hashFrame(makeWorkHarness().runtime, 'proof', canonicalFrame(value)));
    }
  });

  it.each([['planner', () => createPlannerProject()], ['schema-7 pre-layer', legacyState]])(
    'preparePendingImport (sync) equals preparePendingImportWork for a %s state', async (_name, state) => {
      for (const warningPolicy of ['retain', 'reject'] as const) {
        const input = pendingInput(state());
        let sync: unknown, syncError: unknown, metered: unknown, meteredError: unknown;
        try { sync = preparePendingImport(structuredClone(input), { warningPolicy }); } catch (error) { syncError = error; }
        try { metered = await makeWorkHarness().runtime.run(preparePendingImportWork(structuredClone(input), { warningPolicy })); } catch (error) { meteredError = error; }
        expect(String(syncError ?? '')).toBe(String(meteredError ?? ''));
        expect(sync).toEqual(metered);
      }
      const prepared = preparePendingImport(pendingInput(legacyState()), { warningPolicy: 'retain' }) as any;
      for (const variant of Object.values(prepared.state.variants) as any[]) for (const template of Object.values(variant.templates) as any[]) {
        expect(template.layers.map((layer: any) => layer.id)).toEqual(['layer_default']);
      }
    });

  it.each([
    ['numeric createdAt', (input: any) => ({ ...input, createdAt: 1 })],
    ['future schema', (input: any) => ({ ...input, state: { ...input.state, schemaVersion: 99 } })],
    ['missing name', (input: any) => { const { name: _name, ...rest } = input; return rest; }],
    ['extra field', (input: any) => ({ ...input, surprise: true })],
  ])('preparePendingImport rejects %s exactly like the metered preparation', async (_name, change) => {
    const input = change(pendingInput(legacyState()));
    let syncError: unknown, meteredError: unknown;
    try { preparePendingImport(structuredClone(input), { warningPolicy: 'retain' }); } catch (error) { syncError = error; }
    try { await makeWorkHarness().runtime.run(preparePendingImportWork(structuredClone(input), { warningPolicy: 'retain' })); } catch (error) { meteredError = error; }
    expect(syncError).toBeDefined();
    expect(String(syncError)).toBe(String(meteredError));
  });
});

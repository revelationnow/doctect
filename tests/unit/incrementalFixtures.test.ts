// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAX_STATE_BYTES } from '../../shared/projectLimits.js';
import { loadStickerPressProject, makeIncrementalProject } from '../helpers/incrementalFixtures';
import { currentState } from '../helpers/localWorkspaceFixtures';
import { restoreDocument, snapshotDocument } from '../../services/projectDocumentSnapshot';
import { validateWorkspaceProject } from '../../services/localWorkspace/validation';

describe('incremental fixtures', { timeout: 30_000 }, () => {
  it('keeps the normal control saveable after undo restores its content layer', () => {
    const project = makeIncrementalProject();
    const restored = restoreDocument(project.initialState, snapshotDocument(project.initialState));
    expect(() => validateWorkspaceProject({ ...project, initialState: restored }, { warningPolicy: 'reject' })).not.toThrow();
    expect(restored.activeLayerId).toBe('content');
  });
  it('keeps historical absent-activeLayerId undo saveable without changing historical fixtures', () => {
    const initialState = currentState();
    const project = { id: 'historical-undo', name: 'Historical undo', initialState };
    expect(Object.hasOwn(initialState, 'activeLayerId')).toBe(false);
    expect(() => validateWorkspaceProject(project, { warningPolicy: 'reject' })).not.toThrow();
    const restored = restoreDocument(initialState, snapshotDocument(initialState));
    expect(Object.hasOwn(restored, 'activeLayerId')).toBe(false);
    expect(restored.activeLayerId).toBeUndefined();
    expect(() => validateWorkspaceProject({ ...project, initialState: restored }, { warningPolicy: 'reject' })).not.toThrow();
  });
  it('reproduces the approved large fixture without a database', () => {
    const project = loadStickerPressProject();
    expect(Object.keys(project.initialState.variants)).toHaveLength(4);
    expect(Object.keys(project.initialState.nodes)).toHaveLength(437);
    const bytes = new TextEncoder().encode(JSON.stringify(project.initialState)).length;
    expect(bytes).toBeGreaterThan(20_000_000);
    expect(bytes).toBeLessThan(MAX_STATE_BYTES);
    console.info(`Sticker Press state bytes: ${bytes}`);
    // Playwright's native ESM loader cannot import the application's legacy
    // svg2pdf dependency. Generate disposable inputs through the tested builder
    // under Vitest instead; browser still imports only through the real UI.
    const output = process.env.INCREMENTAL_OUTPUT_DIR;
    if (output) {
      if (!output.startsWith('/tmp/opencode/') || resolve(output) !== output) throw new Error('Unsafe fixture artifact directory');
      writeFileSync(`${output}/sticker-press.json`, JSON.stringify(project), { mode: 0o600 });
      writeFileSync(`${output}/small-control.json`, JSON.stringify(makeIncrementalProject()), { mode: 0o600 });
    }
  });
  it('is deterministic and returns independent values', () => {
    const first = loadStickerPressProject();
    const second = loadStickerPressProject();
    const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    expect(hash(first)).toBe(hash(second));
    expect(first.initialState.nodes).not.toBe(second.initialState.nodes);
  });
  it('preserves the pinned source bytes and complete credit text', () => {
    const state = loadStickerPressProject().initialState;
    for (const [file, field, fingerprint] of [
      ['templates.js', 'templateScript', 'ba0e0b6f9432375f42f887e89085b882f1e0d0bf6483db15f43f4e77d06f9c50'],
      ['hierarchy.js', 'hierarchyScript', '7c47c3b419ae03767db0f79aaef38a8390f5c35e2a2434534855fb6ef2da3693'],
    ]) {
      const bytes = readFileSync(new URL(`../fixtures/incremental/sticker-press/${file}`, import.meta.url));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(fingerprint);
      expect(state.generator![field]).toBe(bytes.toString('utf8'));
    }
    expect(state.generator!.templateScript).toContain('CC-BY 4.0');
    expect(state.generator!.templateScript).toContain('Copyright (c) 2013-present Cole Bemis');
  });
  it('builds small independent fixtures with distinct template IDs and valid selections', () => {
    const project = makeIncrementalProject(3);
    const state = project.initialState;
    expect(Object.keys(state.variants.default.templates)).toEqual(['page-0', 'page-1', 'page-2']);
    expect(state.selectedTemplateId).toBe('page-0');
    expect(state.nodes.root.type).toBe('page-0');
    state.variants.default.templates['page-0'].elements[0].text = 'changed';
    expect(state.variants.default.templates['page-1'].elements[0].text).not.toBe('changed');
    expect(makeIncrementalProject()).toEqual(makeIncrementalProject());
  });
  it.each([0, -1, 1.5, NaN])('rejects invalid template count %s', count => {
    expect(() => makeIncrementalProject(count)).toThrow(/positive integer/);
  });
});

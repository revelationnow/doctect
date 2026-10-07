import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { WorkspaceProject } from '../../services/localWorkspace/contracts';
import { validateGeneratedProject } from '../../services/validateGeneratedProject';
import { createGeneratedAppState } from '../../services/generatedProjectState';
import { createBlankProject } from '../../services/presets';
import { currentState } from './localWorkspaceFixtures';

export function makeIncrementalProject(templateCount = 2): WorkspaceProject {
  if (!Number.isSafeInteger(templateCount) || templateCount < 1) throw new Error('templateCount must be a positive integer');
  const initialState = currentState();
  const template = initialState.variants.default.templates.page;
  // Normal control starts on its existing content layer. Historical fixtures
  // deliberately retain absent activeLayerId for the Task 4 undo regression.
  initialState.activeLayerId = template.layers![0].id;
  initialState.variants.default.templates = Object.fromEntries(Array.from({ length: templateCount }, (_, index) => {
    const id = `page-${index}`;
    return [id, { ...structuredClone(template), id, name: `Page ${index + 1}` }];
  }));
  initialState.nodes.root.type = 'page-0';
  initialState.selectedTemplateId = 'page-0';
  initialState.selectedTemplateIds = ['page-0'];
  return { id: 'incremental-control', name: 'Incremental control', initialState };
}

export function loadStickerPressProject(): WorkspaceProject {
  const trusted = (file: string, expected: string) => {
    const bytes = readFileSync(new URL(`../fixtures/incremental/sticker-press/${file}`, import.meta.url));
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`Untrusted fixture: ${file}`);
    return bytes.toString('utf8');
  };
  const templateScript = trusted('templates.js', 'ba0e0b6f9432375f42f887e89085b882f1e0d0bf6483db15f43f4e77d06f9c50');
  const hierarchyScript = trusted('hierarchy.js', '7c47c3b419ae03767db0f79aaef38a8390f5c35e2a2434534855fb6ef2da3693');
  // These two pinned repository fixture sources are the only executable inputs.
  const templates = new Function(templateScript)();
  // Normal generation repairs absent layers with random IDs. Supply the same
  // default layer semantics with stable IDs in this test-only assembly instead.
  for (const variant of Object.values(templates.variants) as any[]) {
    for (const template of Object.values(variant.templates) as any[]) {
      if (!template.layers?.length) template.layers = [{ id: 'fixture-layer', name: 'Layer 1', order: 0, visible: true, locked: false }];
    }
  }
  const hierarchy = new Function('templates', hierarchyScript)(templates.variants[templates.activeVariantId].templates);
  const validation = validateGeneratedProject({ templates, hierarchy });
  if (validation.ok === false) throw new Error(`Sticker Press fixture validation: ${validation.message}`);
  return {
    id: 'incremental-sticker-press',
    name: 'Sticker Press fixture',
    initialState: createGeneratedAppState(createBlankProject(), validation.project, {
      formatVersion: 1, templateScript, hierarchyScript,
    }, '2026-09-13T00:00:00.000Z'),
  };
}

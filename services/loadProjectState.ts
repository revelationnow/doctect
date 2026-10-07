import type { AppState } from '../types';
import { migrateStateWork, migrateOwnedStateWork } from './migration';
import { normalizeGeneratorProvenance, normalizeGeneratorProvenanceWork } from '../shared/generatorMetadata.js';
import { primitive, runSync, type Work } from '../shared/cooperativeWork.js';
import { copyEnumerableWork, type JsonMode } from '../shared/jsonWork.js';

export interface ProjectLoadResult { state: AppState; warnings: string[] }

export const loadProjectState = (raw: unknown): ProjectLoadResult => {
  return runSync(loadProjectTraversal(raw, 'compat', true));
};

export function* loadProjectStateWork(raw: unknown, mode: JsonMode = 'compat'): Work<ProjectLoadResult> {
  return yield* loadProjectTraversal(raw, mode, false);
}

function* loadProjectTraversal(raw: unknown, mode: JsonMode, synchronous: boolean): Work<ProjectLoadResult> {
  const cloned = yield* primitive('clone', () => structuredClone(raw));
  return yield* finishLoadWork(yield* migrateStateWork(cloned, mode), synchronous);
}

/** Private mutable working state only; failure/cancellation requires discarding it. */
export function* loadOwnedProjectStateWork(state: Record<string, any>): Work<ProjectLoadResult> {
  return yield* finishLoadWork(yield* migrateOwnedStateWork(state));
}

function* finishLoadWork(migrated: AppState, synchronous = false): Work<ProjectLoadResult> {
  // Native counting is reachable only from the synchronous public API. Both
  // public Work paths always use bounded traversal of the same validation rules.
  const normalized = synchronous ? normalizeGeneratorProvenance(migrated.generator)
    : yield* normalizeGeneratorProvenanceWork(migrated.generator);
  const state = yield* copyEnumerableWork(migrated);
  if (!normalized.warning) {
    if (normalized.generator) state.generator = normalized.generator as AppState['generator'];
    return { state, warnings: [] };
  }
  delete state.generator;
  return { state, warnings: [normalized.warning] };
}

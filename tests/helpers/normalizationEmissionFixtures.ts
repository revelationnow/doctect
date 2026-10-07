import type { WorkspaceProject } from '../../services/localWorkspace/contracts';
import type { NormalizationSource } from '../../services/localWorkspace/normalized/schema';
import type { TargetCursor, TargetRecord } from '../../services/localWorkspace/normalized/codec';
import type { WorkRuntime } from '../../shared/cooperativeWork.js';
import { makeIncrementalProject } from './incrementalFixtures';

/** Pure codec input only; these fixture digests never certify durable state. */
export function makeEmissionSource(projects: readonly WorkspaceProject[] = [makeIncrementalProject(1)]): NormalizationSource {
  if (!projects.length) throw new Error('Emission fixture needs a project');
  const rows = projects.map((project, index) => ({ id: project.id, project, incarnation: `fixture-incarnation-${index}`,
    storageRevision: index + 3, updatedAt: '2026-09-26T00:00:00.000Z' }));
  const workspace = { id: 'current' as const, projectOrder: projects.map(project => project.id), activeProjectId: projects[0].id, revision: 5 };
  return { kind: 'fresh', records: { projects: rows, workspace, presets: [], pendingImports: [] },
    snapshot: { projects: [...projects], activeProjectId: workspace.activeProjectId, customPresets: [], pendingImports: [] },
    ledger: null, backups: [], sourceProjects: rows.map(row => ({ projectId: row.id, incarnation: row.incarnation,
      revision: row.storageRevision, digest: 'b'.repeat(64) })), sourceDigest: 'a'.repeat(64), contentDigest: 'c'.repeat(64) };
}
/** Caller retains cursor through plan transfer, then disposes it in finally. */
export async function collectTarget(cursor: TargetCursor, work: WorkRuntime): Promise<TargetRecord[]> {
  const records: TargetRecord[] = [];
  for (;;) {
    const next = await work.run(cursor.next()); if (next.done === true) return records;
    records.push(next.value);
  }
}

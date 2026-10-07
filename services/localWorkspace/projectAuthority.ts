import type { WorkspaceProject, WorkspaceSnapshot } from './contracts';
import type { BulkDocumentAck, DocumentSaveAck } from './normalized/schema';
import {
  nextProjectLineage,
  sameProjectLineage,
  type ProjectLineage,
} from './schema';

interface InstalledProjectAuthority {
  token: object;
  lineage: ProjectLineage;
}

const installedAuthorities = new WeakMap<WorkspaceProject, InstalledProjectAuthority>();

const getInstalledProjectAuthority = (
  project: WorkspaceProject,
): InstalledProjectAuthority | undefined => installedAuthorities.get(project);

export const getInstalledProjectAuthorityToken = (
  project: WorkspaceProject,
): object | undefined => getInstalledProjectAuthority(project)?.token;

export const getInstalledProjectAuthorityLineage = (
  project: WorkspaceProject,
): ProjectLineage | undefined => getInstalledProjectAuthority(project)?.lineage;

export const registerInstalledProjectAuthority = (
  project: WorkspaceProject,
  lineage: ProjectLineage,
  token: object = {},
): object => {
  installedAuthorities.set(project, {
    token,
    lineage: { ...lineage },
  });
  return token;
};

export const inheritInstalledProjectAuthority = (
  target: WorkspaceProject,
  source: WorkspaceProject,
): void => {
  const authority = getInstalledProjectAuthority(source);
  if (authority) registerInstalledProjectAuthority(target, authority.lineage, authority.token);
};

export const advanceInstalledProjectAuthorityFromSave = (
  survivingProject: WorkspaceProject,
  submittedProject: WorkspaceProject,
  returnedProject: WorkspaceProject,
): void => {
  const surviving = getInstalledProjectAuthority(survivingProject);
  const submitted = getInstalledProjectAuthority(submittedProject);
  const returned = getInstalledProjectAuthority(returnedProject);
  if (!surviving || !submitted || !returned) return;
  if (surviving.token !== submitted.token || returned.token !== submitted.token) return;
  if (!sameProjectLineage(surviving.lineage, submitted.lineage)) return;
  if (!sameProjectLineage(returned.lineage, nextProjectLineage(submitted.lineage))) return;
  registerInstalledProjectAuthority(survivingProject, returned.lineage, returned.token);
};

/** Publish an already submission-verified document receipt onto a compatible
 * working wrapper. The queue/facade must first match commit ID and editor
 * generation; a receipt cannot install a capability on an unregistered object.
 * This updates lineage only, never document content or UI saved/dirty state.
 */
export const advanceInstalledProjectAuthorityFromAck = (
  target: WorkspaceProject,
  submittedAuthority: WorkspaceProject,
  ack: Readonly<DocumentSaveAck | BulkDocumentAck>,
): void => {
  const surviving = getInstalledProjectAuthority(target);
  const submitted = getInstalledProjectAuthority(submittedAuthority);
  if (!surviving || !submitted || surviving.token !== submitted.token) return;
  if (!sameProjectLineage(surviving.lineage, submitted.lineage)) return;
  if (target.id !== submittedAuthority.id || ack.projectId !== submittedAuthority.id
    || ack.incarnation !== submitted.lineage.incarnation || ack.type !== 'document-saved' && ack.type !== 'document-replaced') return;
  if (!Number.isSafeInteger(submitted.lineage.revision) || submitted.lineage.revision < 0
    || submitted.lineage.revision >= Number.MAX_SAFE_INTEGER) return;
  const revision = ack.type === 'document-replaced' ? ack.authority?.documentRevision : ack.revision;
  const fold = ack.type === 'document-replaced' ? ack.authority?.foldStructureGeneration : ack.foldStructureGeneration;
  if (ack.type === 'document-replaced' && (!Number.isSafeInteger(ack.authority?.preferenceRevision) || ack.authority.preferenceRevision < 1
    || typeof ack.boundaryDigest !== 'string' || !/^[a-f0-9]{64}$/.test(ack.boundaryDigest))) return;
  if (!Number.isSafeInteger(revision) || revision !== submitted.lineage.revision + 1
    || !Number.isSafeInteger(ack.editorGeneration) || ack.editorGeneration < 0
    || !Number.isSafeInteger(fold) || fold < 0
    || typeof ack.commitId !== 'string' || ack.commitId.length === 0) return;
  registerInstalledProjectAuthority(target, nextProjectLineage(submitted.lineage), submitted.token);
};

export const cloneWorkspaceSnapshotWithProjectAuthority = (
  snapshot: WorkspaceSnapshot,
): WorkspaceSnapshot => {
  const cloned = structuredClone(snapshot);
  const sourceProjects = new Map(snapshot.projects.map(project => [project.id, project]));
  for (const project of cloned.projects) {
    const source = sourceProjects.get(project.id);
    if (source) inheritInstalledProjectAuthority(project, source);
  }
  return cloned;
};

import type { InstalledQueueAuthority } from './incrementalQueue';
import { counter, frameFields, requireFrame } from './workspaceWorkerProtocol';

/** Store-owned live installation table. Both private admissions share this table. */
export interface ProjectInstallationRegistry {
  get(projectId: string): InstalledQueueAuthority | undefined;
  set(projectId: string, authority: InstalledQueueAuthority): void;
  delete(projectId: string, expected?: InstalledQueueAuthority): boolean;
}
declare const installationLeaseBrand: unique symbol;
export interface ProjectInstallationLease { readonly [installationLeaseBrand]: true }
interface RegistryState { generation: string; values: Map<string, { authority: InstalledQueueAuthority }> }
const registries = new WeakMap<ProjectInstallationRegistry, RegistryState>();
const leases = new WeakMap<ProjectInstallationLease, { state: RegistryState; id: string; cell: { authority: InstalledQueueAuthority } }>();

export function assertProjectInstallationRegistry(registry: ProjectInstallationRegistry, generation: string): void {
  requireFrame(registries.get(registry)?.generation === generation);
}
export function createProjectInstallationRegistry(generation: string): ProjectInstallationRegistry {
  requireFrame(typeof generation === 'string' && generation.length > 0);
  const values = new Map<string, { authority: InstalledQueueAuthority }>();
  const state = { generation, values };
  const registry: ProjectInstallationRegistry = {
    get: id => values.get(id)?.authority,
    set(id, authority) {
      requireFrame(typeof id === 'string' && id.length > 0);
      const a = frameFields(authority, ['source', 'transport', 'binding', 'editorGenerationFloor']); counter(a.editorGenerationFloor);
      requireFrame(a.source !== null && typeof a.source === 'object');
      const b = frameFields(a.binding, ['type', 'scope', 'authority', 'admissionId']); requireFrame(b.type === 'bootstrapped'); counter(b.admissionId, true);
      const scope = frameFields(b.scope, ['storageGeneration', 'projectId', 'incarnation']);
      requireFrame(scope.storageGeneration === generation && scope.projectId === id && typeof scope.incarnation === 'string' && scope.incarnation.length > 0);
      const stamp = frameFields(b.authority, ['documentRevision', 'preferenceRevision', 'foldStructureGeneration']);
      counter(stamp.documentRevision); counter(stamp.preferenceRevision); counter(stamp.foldStructureGeneration);
      if (values.get(id)?.authority !== authority) values.set(id, { authority });
    },
    delete(id, expected) {
      if (expected !== undefined && values.get(id)?.authority !== expected) return false;
      return values.delete(id);
    },
  };
  registries.set(registry, state); return registry;
}
export function captureProjectInstallation(registry: ProjectInstallationRegistry, authority: InstalledQueueAuthority): ProjectInstallationLease {
  const state = registries.get(registry); requireFrame(state);
  const id = authority.binding.scope.projectId, cell = state.values.get(id); requireFrame(cell?.authority === authority);
  const lease = Object.freeze({}) as ProjectInstallationLease; leases.set(lease, { state, id, cell }); return lease;
}
/** No caller callback: replacement/removal synchronously invalidates this proof. */
export function isProjectInstallationCurrent(lease: ProjectInstallationLease): boolean {
  const captured = leases.get(lease); return !!captured && captured.state.values.get(captured.id) === captured.cell;
}

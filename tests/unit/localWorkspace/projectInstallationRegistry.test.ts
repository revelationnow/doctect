import { expect, it } from 'vitest';
import type { InstalledQueueAuthority } from '../../../services/localWorkspace/incrementalQueue';
const modules = import.meta.glob<typeof import('../../../services/localWorkspace/projectInstallationRegistry')>('../../../services/localWorkspace/projectInstallationRegistry.ts', { eager: true });
const load = () => { expect(Object.keys(modules), 'private installation registry').toHaveLength(1); return Object.values(modules)[0]; };
const authority = (id = 'p'): InstalledQueueAuthority => ({ source: {}, transport: { request: async () => { throw Error('Unused'); } }, editorGenerationFloor: 0,
  binding: { type: 'bootstrapped', admissionId: 1, scope: { storageGeneration: 'g', projectId: id, incarnation: 'i' },
    authority: { documentRevision: 0, preferenceRevision: 0, foldStructureGeneration: 0 } } });

it('revokes old leases synchronously when an installation is replaced or removed', () => {
  const m = load(), registry = m.createProjectInstallationRegistry('g'), old = authority(); registry.set('p', old);
  const lease = m.captureProjectInstallation(registry, old); expect(m.isProjectInstallationCurrent(lease)).toBe(true);
  const next = { ...old, source: {} }; registry.set('p', next);
  expect(m.isProjectInstallationCurrent(lease)).toBe(false); expect(registry.get('p')).toBe(next);
  const current = m.captureProjectInstallation(registry, next); expect(registry.delete('p', old)).toBe(false);
  expect(m.isProjectInstallationCurrent(current)).toBe(true); expect(registry.delete('p', next)).toBe(true);
  expect(m.isProjectInstallationCurrent(current)).toBe(false);
});

it('refuses forged registry or lease objects without inspecting authority payload', () => {
  const m = load(); let read = false;
  const forged = Object.defineProperty({}, 'binding', { get() { read = true; throw Error('payload'); } });
  expect(() => m.captureProjectInstallation({} as any, forged as InstalledQueueAuthority)).toThrow();
  expect(read).toBe(false); expect(m.isProjectInstallationCurrent({} as any)).toBe(false);
});

it('validates scoped metadata but leaves opaque source contents and long public IDs untouched', () => {
  const m = load(), registry = m.createProjectInstallationRegistry('g'), id = '公'.repeat(300), value = authority(id);
  let read = false; Object.defineProperty(value.source, 'payload', { get() { read = true; throw Error('opaque'); } });
  registry.set(id, value); expect(m.isProjectInstallationCurrent(m.captureProjectInstallation(registry, value))).toBe(true);
  expect(() => registry.set('other', value)).toThrow();
  expect(() => registry.set(id, { ...value, binding: { ...value.binding, scope: { ...value.binding.scope, storageGeneration: 'foreign' } } })).toThrow();
  expect(registry.get(id)).toBe(value); expect(read).toBe(false);
});

import React, { useLayoutEffect } from 'react';
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectEditor } from '../../components/ProjectEditor';
import { useIncrementalProjectWrites, type IncrementalProjectWrites } from '../../hooks/useIncrementalProjectWrites';
import { type InstalledQueueAuthority, type QueueEvent } from '../../services/localWorkspace/incrementalQueue';
import { createIncrementalCommandAdmission } from '../../services/localWorkspace/incrementalCommandAdmission';
import { createWorkspaceCommandDispatcher } from '../../services/localWorkspace/commandDispatcher';
import { WorkspaceStoreError, type ProjectMetadataCommand } from '../../services/localWorkspace/contracts';
import { registerInstalledProjectAuthority } from '../../services/localWorkspace/projectAuthority';
import type { DocumentSaveAck, PreferenceSaveAck } from '../../services/localWorkspace/normalized/schema';
import type { EditorDocumentEvent, EditorPersistenceDrain, EditorSourceBinding } from '../../services/document/contracts';
import type { ProjectScope } from '../../services/localWorkspace/normalized/schema';
import * as documentEditor from '../../hooks/useDocumentEditor';
import * as snapshots from '../../services/projectDocumentSnapshot';
import { makeIncrementalProject } from '../helpers/incrementalFixtures';
import { createIncrementalWorkerHarness } from '../helpers/incrementalWorkerHarness';
import { createWorkspaceLifecycleHarness } from '../helpers/workspaceCommandHarness';
import { createProjectInstallationRegistry } from '../../services/localWorkspace/projectInstallationRegistry';

vi.mock('../../services/analytics', () => ({ trackEvent: vi.fn() }));

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '12px sans-serif', measureText: (text: string) => ({ width: text.length * 6 }),
  } as CanvasRenderingContext2D);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function renderLifecycleEditors() {
  const h = await createWorkspaceLifecycleHarness();
  expect(typeof h.lifecycle.registerWrites, 'authenticated lifecycle write-owner registration').toBe('function');
  for (const scope of h.lifecycle.catalog().members) await h.install(scope);
  const writers = new Map<string, IncrementalProjectWrites>(), editors = new Map<object, documentEditor.DocumentEditor>();
  const cleanups = new Map<string, Partial<Record<'editor' | 'writer', () => void>>>();
  const rememberCleanup = (id: string, kind: 'editor' | 'writer', cleanup: () => void) => {
    cleanups.set(id, { ...cleanups.get(id), [kind]: cleanup }); return cleanup;
  };
  const bindings = new Map<string, EditorSourceBinding>();
  const originalEditor = documentEditor.useDocumentEditor;
  vi.spyOn(documentEditor, 'useDocumentEditor').mockImplementation((...args) => {
    const editor = originalEditor(...args); if (args[1]) editors.set(args[1].source, editor); return editor;
  });
  const hooks = { beforeDocument: undefined as ((scope: ProjectScope, event: EditorDocumentEvent) => void) | undefined,
    transformDocument: (event: EditorDocumentEvent) => event };
  const store = { commit: createWorkspaceCommandDispatcher({ document: command => h.incremental.document(command), preferences: command => h.incremental.preferences(command),
    replacement: command => h.incremental.replacement(command),
    metadata: command => h.incremental.metadata(command), workspace: command => h.lifecycle.workspace(command),
    snapshot: async () => { throw Error('Historical writer is not installed in lifecycle fixture'); } }) };
  for (const scope of h.lifecycle.catalog().members) {
    const authority = h.installed.get(scope.projectId)!;
    bindings.set(scope.projectId, { source: authority.source, editorGenerationFloor: 0, foldStructureGeneration: authority.binding.authority.foldStructureGeneration,
      assertEditable: () => h.lifecycle.assertEditable(scope),
      capturePersistenceCut: generation => writers.get(scope.projectId)!.capturePersistenceCut(scope.projectId, generation),
      registerPersistenceDrain: drain => rememberCleanup(scope.projectId, 'editor', h.lifecycle.registerEditor(scope, authority.source, drain)) });
  }
  function BoundEditor({ scope, active }: { scope: ProjectScope; active: boolean }) {
    const project = h.working.get(scope.projectId)!, binding = bindings.get(scope.projectId)!;
    const writer = useIncrementalProjectWrites({ projectId: project.id, authorityEpoch: 7, binding, store,
      resolveAuthority: () => h.working.get(project.id), flushPending: () => h.incremental.flush(project.id) });
    useLayoutEffect(() => { writers.set(project.id, writer); });
    useLayoutEffect(() => rememberCleanup(scope.projectId, 'writer', h.lifecycle.registerWrites(scope, writer.writeOwner)), [writer.writeOwner]);
    return <section data-testid={`lifecycle-${project.id}`}><ProjectEditor projectId={project.id} projectName={project.name}
      initialState={project.initialState} isActive={active} incremental={binding}
      onDocumentEdit={event => { void h.lifecycle.persistEditor(scope, binding.source, event.editorGeneration, () => {
        hooks.beforeDocument?.(scope, event); return writers.get(project.id)!.updateDocument(project.id, hooks.transformDocument(event), 7);
      }); }}
      onPreferencesChange={(patch, metadata) => { void h.lifecycle.persistEditor(scope, binding.source, metadata.editorGeneration,
        () => writers.get(project.id)!.updatePreferences(project.id, patch, metadata, 7)); }}
      onNameChange={() => { throw Error('Historical name writer'); }} onStateChange={() => { throw Error('Historical state writer'); }}
      onCreateGeneratedProject={async () => false} onSaveCustomPreset={async () => false} /></section>;
  }
  let updateCatalog!: () => void;
  function Workspace() {
    const [catalog, setCatalog] = React.useState(h.lifecycle.catalog()); updateCatalog = () => setCatalog(h.lifecycle.catalog());
    return <>{catalog.members.map(scope => <BoundEditor key={`${scope.projectId}:${scope.incarnation}`} scope={scope} active={scope.projectId === catalog.activeProjectId} />)}</>;
  }
  const notify = h.options.onCatalog; h.options.onCatalog = result => { notify(result); updateCatalog(); };
  const view = render(<Workspace />);
  const region = (id: string) => within(view.getByTestId(`lifecycle-${id}`));
  const owner = (id: string) => editors.get(bindings.get(id)!.source)!;
  return { ...h, ...view, hooks, region, owner, writers, cleanups,
    get lifecycle() { return h.lifecycle; }, get incremental() { return h.incremental; }, get client() { return h.client; }, get options() { return h.options; },
    select(id: string) { const ui = region(id); fireEvent.click(ui.getByTitle('Layers')); fireEvent.click(ui.getByTestId('element-row-title')); },
    type(id: string, value: string) { fireEvent.change(region(id).getByPlaceholderText('Text content or {{field}}'), { target: { value } }); },
    mutate(id: string, action: (editor: documentEditor.DocumentEditor) => void) {
      const editor = owner(id), scope = h.lifecycle.catalog().members.find(scope => scope.projectId === id)!;
      act(() => { action(editor); editor.drainEffects(effect => {
        void h.lifecycle.persistEditor(scope, bindings.get(id)!.source, effect.event.editorGeneration, () => {
          if (effect.type === 'document') { hooks.beforeDocument?.(scope, effect.event); return writers.get(id)!.updateDocument(id, hooks.transformDocument(effect.event), 7); }
          return writers.get(id)!.updatePreferences(id, effect.event.patch, effect.event, 7);
        });
      }); });
    },
    async flush() { await act(async () => { await h.incremental.flush(); }); },
    dispose() { view.unmount(); h.dispose(); } };
}

describe('private workspace lifecycle editor composition', () => {
  let h: Awaited<ReturnType<typeof renderLifecycleEditors>>;
  beforeEach(async () => { h = await renderLifecycleEditors(); });
  afterEach(() => { h?.dispose(); });

  it.each(['acknowledged', 'lost-reply', 'foreign-preference'] as const)('checks exact preference evidence after structural save (%s) before its retained replacement', async outcome => {
    const editor = h.owner(h.a.id), writer = h.writers.get(h.a.id)!.writeOwner;
    if (outcome === 'lost-reply') h.environment.fault = point => { if (point.phase === 'after-readback') throw Error('Structural reply lost'); };
    h.mutate(h.a.id, editor => editor.edit(({ document }) => {
      const template = document.variants.default.templates['page-0'], count = template.layers!.length;
      const address = (position: number) => ({ variantId: 'default', templateId: 'page-0', position });
      return { changes: [{ type: 'put-template', variantId: 'default', template: { ...template,
        layers: [...template.layers!, { id: 'added', name: 'Added', order: count, visible: true, locked: false }] } }],
      mappings: [...Array.from({ length: count }, (_, i) => ({ type: 'continue' as const, from: address(i), to: address(i) })),
        { type: 'create', to: address(count), cell: { present: true, value: true } }] };
    }));
    if (outcome !== 'lost-reply') await h.flush();
    h.mutate(h.a.id, editor => editor.replace({ ...editor.exportState(), scale: 2 }));
    if (outcome === 'lost-reply') await act(async () => { await h.incremental.flush().catch(() => {}); });
    h.environment.fault = undefined;
    if (outcome === 'foreign-preference') {
      await act(async () => { h.lifecycle.dispose(); await h.incremental.queue.freeze('Foreign preference after acknowledged document').whenQuiescent; });
      const scope = h.binding.catalog.members[0];
      const authority = await h.repository.bindAdmittedProject(await h.readRecords(scope));
      await h.repository.commitPreferences({ scope, clientId: 'foreign', commitId: 'foreign', commitGeneration: 1, editorGeneration: 1,
        observedPreferenceRevision: authority.preferenceRevision, patch: { scale: 4 } });
      await act(async () => { await expect(h.restart()).rejects.toMatchObject({ code: 'source-changed', cause: { code: 'authority-changed' } }); });
      expect(editor.getCurrent().preferences.scale).toBe(2); expect(h.writers.get(h.a.id)!.hasUnsavedDocument).toBe(true);
      expect(h.messages.some(row => row.request.type === 'document-readmission-authority')).toBe(true);
      expect(h.messages.some(row => row.request.type === 'replace-document')).toBe(false);
      return;
    }
    await act(async () => { const next = await h.restart(); await next.resume(); });
    expect(h.writers.get(h.a.id)!.documentState).toEqual({ status: 'saved' });
    expect(h.writers.get(h.a.id)!.preferenceState).toEqual({ status: 'saved' });
    expect(h.writers.get(h.a.id)!.writeOwner).toBe(writer); expect(h.owner(h.a.id).getCurrent).toBe(editor.getCurrent);
    const replacement = h.messages.find(row => row.request.type === 'replace-document')!.request;
    expect(replacement).toMatchObject({ batch: { expected: { documentRevision: 1, preferenceRevision: 1, foldStructureGeneration: 1 } } });
    expect(h.messages.filter(row => row.request.type === 'structural-command')).toHaveLength(1);
    expect(h.messages.filter(row => row.request.type === 'replace-document')).toHaveLength(1);
    expect((await h.repository.readActiveSnapshot())!.snapshot.projects[0].initialState.scale).toBe(2);
    h.mutate(h.a.id, editor => editor.undo()); await h.flush();
    expect(h.writers.get(h.a.id)!.hasUnsavedDocument).toBe(false);
  });

  it('persists replacement, late edit and both Undo/Redo boundaries without replacing the editor owner', async () => {
    const failures: unknown[] = [], document = h.incremental.document;
    vi.spyOn(h.incremental, 'document').mockImplementation(command => document(command).catch(error => { failures.push(error.cause ?? error); throw error; }));
    h.select(h.a.id); await h.flush();
    const editor = h.owner(h.a.id), owner = h.writers.get(h.a.id)!.writeOwner;
    const original = editor.exportState(), replacement = structuredClone(original);
    replacement.nodes.root.title = 'Replacement root'; replacement.scale = 1.75;
    h.mutate(h.a.id, editor => editor.replace(replacement));
    h.select(h.a.id);
    h.type(h.a.id, 'Typed behind replacement');
    await h.flush();
    const saved = async () => (await h.repository.readActiveSnapshot())!.snapshot.projects[0];
    expect((await saved()).initialState.variants.default.templates['page-0'].elements[0].text).toBe('Typed behind replacement');
    expect((await saved()).name).toBe('Replacement root');
    expect(h.writers.get(h.a.id)!.documentState.status).toBe('saved');
    expect(h.writers.get(h.a.id)!.preferenceState.status).toBe('saved');
    h.mutate(h.a.id, editor => editor.undo()); await h.flush();
    expect(editor.getCurrent().document.variants.default.templates['page-0'].elements[0].text).toBe('Café ☕ 😀');
    expect(failures).toEqual([]);
    expect(h.writers.get(h.a.id)!.documentState).toEqual({ status: 'saved' });
    expect((await saved()).initialState.variants.default.templates['page-0'].elements[0].text).toBe('Café ☕ 😀');
    h.mutate(h.a.id, editor => editor.undo()); await h.flush();
    const undone = await saved();
    expect(undone.initialState.nodes.root.title).toBe(original.nodes.root.title);
    expect(undone.initialState.scale).toBe(1.75);
    h.mutate(h.a.id, editor => editor.redo()); await h.flush();
    expect((await saved()).initialState.nodes.root.title).toBe('Replacement root');
    h.mutate(h.a.id, editor => editor.redo()); await h.flush();
    expect((await saved()).initialState.variants.default.templates['page-0'].elements[0].text).toBe('Typed behind replacement');
    expect(h.owner(h.a.id).getCurrent).toBe(editor.getCurrent); expect(h.writers.get(h.a.id)!.writeOwner).toBe(owner);
    expect(h.messages.filter(row => row.request.type === 'replace-document')).toHaveLength(3);
  });

  it('captures replacement preferences once and resolves later folds after intervening metadata clocks', async () => {
    const editor = h.owner(h.a.id), replacement = editor.exportState();
    let event: EditorDocumentEvent | undefined; h.hooks.beforeDocument = (_scope, value) => { event = value; };
    let metadata!: Promise<boolean>; act(() => { metadata = h.writers.get(h.a.id)!.updateMetadata(h.a.id, { name: 'Earlier metadata' }, 7); });
    h.mutate(h.a.id, editor => editor.replace({ ...replacement, scale: 2 }));
    expect(event?.kind).toBe('replace');
    if (event?.kind !== 'replace') throw Error('Replacement event missing');
    expect(event).toHaveProperty('preferences.scale', 2);
    let duplicate!: Promise<boolean>; act(() => { duplicate = h.writers.get(h.a.id)!.updatePreferences(h.a.id, event!.preferencePatch, event!, 7); });
    expect(await duplicate).toBe(false);
    h.mutate(h.a.id, editor => editor.setLayerCollapsed({ variantId: 'default', templateId: 'page-0', position: 0 }, true));
    await h.flush(); expect(await metadata).toBe(true);
    const requests = h.messages.flatMap(row => row.request.type === 'replace-document' ? [row.request] : []);
    expect(requests).toHaveLength(1); expect(requests[0].batch.editorGeneration).toBeGreaterThan(event.editorGeneration);
    expect(requests[0].batch.preferences.scale).toBe(2);
    const preferences = h.messages.filter(row => row.request.type === 'preferences'); expect(preferences).toHaveLength(1);
    const saved = (await h.repository.readActiveSnapshot())!.snapshot.projects[0];
    expect(saved.initialState.scale).toBe(2); expect(saved.initialState.variants.default.templates['page-0'].layers![0].collapsed).toBe(true);
    expect(h.writers.get(h.a.id)!.preferenceState.status).toBe('saved');
  });

  it('readmits a lost replacement reply with its late edit and original Undo history', async () => {
    h.select(h.a.id); await h.flush();
    const editor = h.owner(h.a.id), owner = h.writers.get(h.a.id)!.writeOwner;
    h.environment.workspaceFault = point => { if (point.phase === 'after-commit') throw Error('Replacement reply lost'); };
    h.mutate(h.a.id, editor => editor.replace({ ...editor.exportState(), scale: 2 }));
    h.select(h.a.id); h.type(h.a.id, 'Late retained text');
    await act(async () => { await h.incremental.flush().catch(() => {}); });
    expect(h.writers.get(h.a.id)!.hasUnsavedDocument).toBe(true);
    h.environment.workspaceFault = undefined;
    await act(async () => { const next = await h.restart(); await next.resume(); });
    expect(h.writers.get(h.a.id)!.hasUnsavedDocument).toBe(false);
    expect(h.writers.get(h.a.id)!.writeOwner).toBe(owner); expect(h.owner(h.a.id).getCurrent).toBe(editor.getCurrent);
    expect(h.messages.filter(row => row.request.type === 'replace-document')).toHaveLength(1);
    expect((await h.repository.readActiveSnapshot())!.snapshot.projects[0].initialState.variants.default.templates['page-0'].elements[0].text).toBe('Late retained text');
    h.mutate(h.a.id, editor => editor.undo()); await h.flush();
    expect(h.region(h.a.id).getByPlaceholderText('Text content or {{field}}')).toHaveValue('Café ☕ 😀');
  });

  it('restarts pending document, preferences and metadata in place before reopening Undo and editing', async () => {
    h.select(h.a.id); h.type(h.a.id, 'Retained through workspace restart');
    const editor = h.owner(h.a.id), before = editor.getCurrent().document, writer = h.writers.get(h.a.id)!.writeOwner;
    const scope = h.lifecycle.catalog().members[0], source = h.installed.get(h.a.id)!.source;
    let metadata!: Promise<boolean>; act(() => { metadata = h.lifecycle.persistEditor(scope, source, undefined,
      () => h.writers.get(h.a.id)!.updateMetadata(h.a.id, { name: 'Retained metadata' }, 7)); });
    let next!: Awaited<ReturnType<typeof h.restart>>;
    await act(async () => { next = await h.restart(); });
    expect(await metadata).toBe(false); expect(() => editor.undo()).toThrow();
    expect(editor.getCurrent().document).toBe(before); expect(h.writers.get(h.a.id)!.writeOwner).toBe(writer);
    await act(async () => { await next.resume(); });
    expect(h.writers.get(h.a.id)!.documentState.status).toBe('saved'); expect(h.writers.get(h.a.id)!.preferenceState.status).toBe('saved');
    const saved = (await h.repository.readActiveSnapshot())!.snapshot.projects[0];
    expect(saved.name).toBe('Retained metadata'); expect(saved.initialState.variants.default.templates['page-0'].elements[0].text).toBe('Retained through workspace restart');
    expect(h.owner(h.a.id).getCurrent).toBe(editor.getCurrent); expect(await metadata).toBe(false);
    fireEvent.click(h.region(h.a.id).getByTitle('Undo (Ctrl+Z)')); await h.flush();
    expect(h.region(h.a.id).getByPlaceholderText('Text content or {{field}}')).toHaveValue('Café ☕ 😀');
    fireEvent.click(h.region(h.a.id).getByTitle('Redo (Ctrl+Y)')); await h.flush();
    expect(h.region(h.a.id).getByPlaceholderText('Text content or {{field}}')).toHaveValue('Retained through workspace restart');
  });

  it('resumes a surviving editor after independently recovering a lost close without reviving the closed source', async () => {
    await act(async () => { await h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.b.id } }); });
    h.select(h.b.id); await h.flush(); h.type(h.b.id, 'Before uncertain close');
    h.environment.workspaceFault = point => { if (point.phase === 'after-commit') throw Error('Close reply lost'); };
    let closing!: ReturnType<typeof h.lifecycle.workspace>;
    act(() => { closing = h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'close-project', projectId: h.a.id } }); void closing.catch(() => {}); });
    h.type(h.b.id, 'Surviving unsaved edit'); const editor = h.owner(h.b.id), before = editor.getCurrent().document, retired = h.owner(h.a.id);
    await act(async () => { await expect(closing).rejects.toThrow(); }); h.environment.workspaceFault = undefined;
    let next!: Awaited<ReturnType<typeof h.restart>>; await act(async () => { next = await h.restart(); await next.resume(); });
    expect(h.queryByTestId(`lifecycle-${h.a.id}`)).not.toBeInTheDocument(); expect(() => retired.undo()).toThrow();
    expect(h.owner(h.b.id).getCurrent).toBe(editor.getCurrent); expect(editor.getCurrent().document).toBe(before);
    expect(h.writers.get(h.b.id)!.hasUnsavedDocument).toBe(false);
    expect((await h.repository.readActiveSnapshot())!.snapshot.projects[0].initialState.variants.default.templates['page-0'].elements[0].text).toBe('Surviving unsaved edit');
    expect(h.messages.filter(row => row.request.type === 'workspace-command')).toHaveLength(2);
    fireEvent.click(h.region(h.b.id).getByTitle('Undo (Ctrl+Z)')); await h.flush();
    expect(h.region(h.b.id).getByPlaceholderText('Text content or {{field}}')).toHaveValue('Before uncertain close');
  });

  it('keeps an unrepresented editor handoff blocked during workspace restart despite an empty save queue', async () => {
    h.select(h.a.id); await h.flush(); h.hooks.transformDocument = event => ({ ...event, foldBasis: { type: 'after-replacement', editorGeneration: 0 } });
    h.type(h.a.id, 'Cannot claim this saved'); const editor = h.owner(h.a.id), before = editor.getCurrent().document;
    await act(async () => { await expect(h.restart()).rejects.toThrow(); });
    expect(editor.getCurrent().document).toBe(before); expect(editor.getCurrent().historyStatus.canUndo).toBe(true);
    expect(() => editor.undo()).toThrow(); expect(h.writers.get(h.a.id)!.hasUnsavedDocument).toBe(true);
    expect(h.messages.some(row => row.request.type === 'workspace-command')).toBe(false);
  });

  it('releases never-invoked metadata producers FIFO only after readmission and never retries their lifecycle cut', async () => {
    const editor = h.owner(h.a.id), scope = h.lifecycle.catalog().members[0], source = h.installed.get(h.a.id)!.source;
    const invoked: string[] = []; let first!: Promise<boolean>, lifecycle!: ReturnType<typeof h.lifecycle.workspace>;
    act(() => {
      expect(() => editor.edit(context => {
        lifecycle = h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.b.id } }); void lifecycle.catch(() => {});
        first = h.lifecycle.persistEditor(scope, source, undefined, () => {
          invoked.push('first'); void h.lifecycle.persistEditor(scope, source, undefined, () => {
            invoked.push('second'); return h.writers.get(h.a.id)!.updateMetadata(h.a.id, { name: 'Second queued metadata' }, 7);
          });
          return h.writers.get(h.a.id)!.updateMetadata(h.a.id, { name: 'First queued metadata' }, 7);
        });
        h.lifecycle.dispose();
        return { changes: [{ type: 'put-node', node: { ...context.document.nodes.root, title: 'Never accepted' } }], mappings: [] };
      })).toThrow();
    });
    expect(invoked).toEqual([]); expect(await first).toBe(false);
    await act(async () => { const next = await h.restart(); expect(invoked).toEqual([]); await next.resume(); });
    expect(invoked).toEqual(['first', 'second']); expect(await first).toBe(false);
    expect(h.messages.some(row => row.request.type === 'workspace-command')).toBe(false);
    expect((await h.repository.readActiveSnapshot())!.snapshot.projects[0].name).toBe('Second queued metadata');
  });

  it('holds replay before a reentrant constructor ownership check attempts to flush', async () => {
    h.select(h.a.id); h.type(h.a.id, 'Held before constructor callback');
    const check = h.options.assertCurrent; let flushing: Promise<void> | undefined;
    h.options.assertCurrent = function () {
      check(); if (this?.recovery && !flushing) { flushing = this.queue.flush(); void flushing.catch(() => {}); }
    };
    let next!: Awaited<ReturnType<typeof h.restart>>; await act(async () => { next = await h.restart(); });
    await expect(flushing).rejects.toMatchObject({ code: 'retry-required' });
    expect((await h.repository.readActiveSnapshot())!.snapshot.projects[0].initialState.variants.default.templates['page-0'].elements[0].text).toBe('Café ☕ 😀');
    await act(async () => { await next.resume(); }); expect(h.writers.get(h.a.id)!.hasUnsavedDocument).toBe(false);
  });

  it('keeps original recovery custody after constructor refusal and permits a later verified attempt', async () => {
    h.select(h.a.id); h.type(h.a.id, 'Keep original custody'); const check = h.options.assertCurrent; let refuse = true;
    h.options.assertCurrent = function () { check(); if (this?.recovery && refuse) throw Error('First constructor refused'); };
    await act(async () => { await expect(h.restart()).rejects.toThrow('First constructor refused'); });
    refuse = false;
    await act(async () => { const next = await h.restart(); await next.resume(); });
    expect(h.writers.get(h.a.id)!.hasUnsavedDocument).toBe(false);
    expect(h.region(h.a.id).getByPlaceholderText('Text content or {{field}}')).toHaveValue('Keep original custody');
  });

  it('recaptures every hook and the genuine successor checkpoint after partial attachment fails', async () => {
    h.select(h.a.id); h.type(h.a.id, 'Pending first owner'); const editor = h.owner(h.a.id), before = editor.getCurrent().document;
    let next!: Awaited<ReturnType<typeof h.restart>>; await act(async () => { next = await h.restart(); });
    let first: Awaited<ReturnType<typeof h.incremental.prepareWriteRecovery>> | undefined;
    await act(async () => { await expect(next.owner.resumeRecovery(async (scope, writes, queue) => {
      first ??= await h.incremental.prepareWriteRecovery(writes, queue, h.installed, () => h.working.get(scope.projectId)); return first;
    })).rejects.toThrow(); });
    expect(() => editor.undo()).toThrow(); expect(editor.getCurrent().document).toBe(before);
    await act(async () => { const retry = await h.restart(); await retry.resume(); });
    expect(h.owner(h.a.id).getCurrent).toBe(editor.getCurrent); expect(h.writers.get(h.a.id)!.hasUnsavedDocument).toBe(false);
    expect((await h.repository.readActiveSnapshot())!.snapshot.projects[0].initialState.variants.default.templates['page-0'].elements[0].text).toBe('Pending first owner');
  });

  it('retains replay failures for a second restart when the original worker can prove abort', async () => {
    h.select(h.a.id); h.type(h.a.id, 'Replay twice, save once'); const editor = h.owner(h.a.id);
    let next!: Awaited<ReturnType<typeof h.restart>>; await act(async () => { next = await h.restart(); });
    h.environment.fault = point => { if (point.phase === 'before-complete') throw Error('Replay transaction failed'); };
    await act(async () => { await expect(next.resume()).rejects.toBeDefined(); }); h.environment.fault = undefined;
    expect(h.writers.get(h.a.id)!.hasUnsavedDocument).toBe(true); expect(() => editor.undo()).toThrow();
    await act(async () => { const retry = await h.restart({ terminateOld: false }); await retry.resume(); });
    expect(h.owner(h.a.id).getCurrent).toBe(editor.getCurrent); expect(editor.getCurrent().historyStatus.canUndo).toBe(true);
    expect(h.writers.get(h.a.id)!.hasUnsavedDocument).toBe(false);
  });

  it('refuses an unexplained fresh preference revision instead of merging it into retained local edits', async () => {
    h.select(h.a.id); h.type(h.a.id, 'Retain across remote conflict'); const scope = h.lifecycle.catalog().members[0];
    await act(async () => { h.lifecycle.dispose(); await h.incremental.queue.freeze('Remote writer setup').whenQuiescent; });
    const before = (await h.repository.readActiveSnapshot())!.snapshot.projects[0].initialState;
    const base = await h.repository.bindAdmittedProject(await h.readRecords(scope));
    await h.repository.commitPreferences({ scope, clientId: 'remote', commitId: 'remote-preference', commitGeneration: 1, editorGeneration: 1,
      observedPreferenceRevision: base.preferenceRevision, patch: { scale: 4 } });
    await act(async () => { await expect(h.restart()).rejects.toBeDefined(); });
    expect(h.region(h.a.id).getByPlaceholderText('Text content or {{field}}')).toHaveValue('Retain across remote conflict');
    expect(h.writers.get(h.a.id)!.hasUnsavedDocument).toBe(true); expect(() => h.owner(h.a.id).undo()).toThrow();
    expect((await h.repository.readActiveSnapshot())!.snapshot.projects[0].initialState.variants.default.templates['page-0'].elements[0].text)
      .toBe(before.variants.default.templates['page-0'].elements[0].text);
  });

  it('drains publication-time metadata before newer producers can overtake it', async () => {
    h.environment.workspaceFault = point => { if (point.phase === 'after-commit') throw Error('Lost activation'); };
    await act(async () => { await expect(h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.b.id } })).rejects.toThrow(); });
    h.environment.workspaceFault = undefined;
    const notify = h.options.onCatalog, scope = h.lifecycle.catalog().members[0], source = h.installed.get(h.a.id)!.source;
    const order: string[] = []; let published!: Promise<boolean>;
    h.options.onCatalog = result => {
      notify(result); published = h.lifecycle.persistEditor(scope, source, undefined, () => {
        order.push('publication'); return h.writers.get(h.a.id)!.updateMetadata(h.a.id, { name: 'Publication metadata' }, 7);
      });
    };
    await act(async () => { const next = await h.restart(); await next.resume(); });
    expect(order).toEqual(['publication']); expect(await published).toBe(true);
    await act(async () => {
      const later = h.lifecycle.persistEditor(scope, source, undefined, () => {
        order.push('later'); return h.writers.get(h.a.id)!.updateMetadata(h.a.id, { name: 'Later metadata' }, 7);
      });
      await h.incremental.flush(); expect(await later).toBe(true);
    });
    expect(order).toEqual(['publication', 'later']); expect(h.published).toHaveLength(1);
    expect((await h.repository.readActiveSnapshot())!.snapshot.projects[0].name).toBe('Later metadata');
  });

  it.each(['editor', 'writer'] as const)('refuses final source-resolver reentry that removes an earlier %s attachment', async kind => {
    h.environment.workspaceFault = point => { if (point.phase === 'after-commit') throw Error('Lost activation'); };
    await act(async () => { await expect(h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.b.id } })).rejects.toThrow(); });
    h.environment.workspaceFault = undefined;
    const notify = h.options.onCatalog; let armed = false, removed = false;
    h.options.onCatalog = result => { notify(result); armed = true; };
    h.options.resolveInstalled = scope => {
      if (armed && !removed && scope.projectId === h.b.id) { removed = true; h.cleanups.get(h.a.id)![kind]!(); }
      return h.installed.get(scope.projectId);
    };
    await act(async () => { const next = await h.restart(); await expect(next.resume()).rejects.toThrow(); });
    expect(removed).toBe(true); expect(() => h.owner(h.a.id).undo()).toThrow();
  });

  it('retains a refused metadata producer even when its callback stops flush before failure handling', async () => {
    let next!: Awaited<ReturnType<typeof h.restart>>; await act(async () => { next = await h.restart(); });
    const scope = h.lifecycle.catalog().members[0], source = h.installed.get(h.a.id)!.source; let invoked = 0;
    const producing = h.lifecycle.persistEditor(scope, source, undefined, async () => {
      invoked++; h.incremental.queue.freeze('Stopped before hook admission'); return false;
    });
    await act(async () => { await expect(next.resume()).rejects.toBeDefined(); }); expect(await producing).toBe(false);
    await act(async () => { await expect(h.restart()).rejects.toBeDefined(); });
    expect(invoked).toBe(1); expect(() => h.owner(h.a.id).undo()).toThrow();
  });

  it('waits for an invoked metadata producer across disposal rather than activating before its failure', async () => {
    let enter!: () => void, settle!: (value: boolean) => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), outcome = new Promise<boolean>(resolve => { settle = resolve; });
    let resumed: Promise<void> | undefined, retrying: ReturnType<typeof h.restart> | undefined;
    try {
      let next!: Awaited<ReturnType<typeof h.restart>>; await act(async () => { next = await h.restart(); });
      const scope = h.lifecycle.catalog().members[0], source = h.installed.get(h.a.id)!.source;
      const producing = h.lifecycle.persistEditor(scope, source, undefined, () => { enter(); return outcome; });
      await act(async () => { resumed = next.resume(); void resumed.catch(() => {}); await entered; });
      act(() => { retrying = h.restart(); void retrying.catch(() => {}); });
      await act(async () => { await vi.waitFor(() => expect(h.responses.filter(row => row.response.type === 'workspace-bootstrapped')).toHaveLength(3)); });
      await act(async () => { settle(false); await expect(retrying).rejects.toBeDefined(); await expect(resumed).rejects.toBeDefined(); });
      expect(await producing).toBe(false); expect(() => h.owner(h.a.id).undo()).toThrow();
    } finally { settle(false); await resumed?.catch(() => {}); await retrying?.catch(() => {}); }
  });

  it.each(['dispose', 'throw'] as const)('keeps never-invoked metadata queued when producer validation can %s', async interruption => {
    let next!: Awaited<ReturnType<typeof h.restart>>; await act(async () => { next = await h.restart(); });
    const scope = h.lifecycle.catalog().members[0], source = h.installed.get(h.a.id)!.source;
    let invoked = 0, settled = false, interrupted = false;
    const producing = h.lifecycle.persistEditor(scope, source, undefined, () => {
      invoked++; return h.writers.get(h.a.id)!.updateMetadata(h.a.id, { name: 'Still queued metadata' }, 7);
    });
    void producing.then(() => { settled = true; });
    const resolve = h.options.resolveInstalled;
    h.options.resolveInstalled = scope => {
      // Target the actual per-producer resolver, not the surrounding batch fence.
      if (!interrupted && !(new Error().stack ?? '').includes('checkRecoveryEditors')) {
        interrupted = true; if (interruption === 'dispose') h.lifecycle.dispose(); else throw Error('Producer resolver failed');
      }
      return resolve(scope);
    };
    await act(async () => { await expect(next.resume()).rejects.toBeDefined(); });
    expect(interrupted).toBe(true); expect(invoked).toBe(0); expect(settled).toBe(true); expect(await producing).toBe(false);
    h.options.resolveInstalled = resolve;
    await act(async () => { const retry = await h.restart(); await retry.resume(); });
    expect(invoked).toBe(1); expect(await producing).toBe(false);
    expect((await h.repository.readActiveSnapshot())!.snapshot.projects[0].name).toBe('Still queued metadata');
  });

  it('releases an obsolete predecessor checkpoint after failed attachment transfers custody to its successor', async () => {
    const { setFlagsFromString } = await import('node:v8'), { runInNewContext } = await import('node:vm');
    setFlagsFromString('--expose_gc'); const gc: () => void = runInNewContext('gc');
    let retained!: ReturnType<typeof h.lifecycle.dispose>, weak!: WeakRef<object>;
    // The installed resolver must not share the temporary checkpoint scope.
    const prepare: Parameters<typeof h.lifecycle.resumeRecovery>[0] = (scope, writes, queue) =>
      h.incremental.prepareWriteRecovery(writes, queue, h.installed, () => h.working.get(scope.projectId));
    await (async () => {
      const scope = h.lifecycle.catalog().members[0], source = h.installed.get(h.a.id)!.source;
      let saving!: Promise<boolean>; act(() => { saving = h.lifecycle.persistEditor(scope, source, undefined,
        () => h.writers.get(h.a.id)!.updateMetadata(h.a.id, { name: 'Obsolete checkpoint payload' }, 7)); });
      const checkpoint = h.incremental.queue.freeze('Capture payload');
      weak = new WeakRef(checkpoint.projects[0].pending.find(row => row.lane === 'document')!);
      const original = h.lifecycle;
      let first!: Awaited<ReturnType<typeof h.restart>>; await act(async () => { first = await h.restart(); }); retained = original.dispose();
      expect(await saving).toBe(false);
      let proof: Awaited<ReturnType<typeof h.incremental.prepareWriteRecovery>> | undefined;
      await act(async () => {
        // Vitest's async rejection assertion retains the Error/async call-site
        // chain until test completion, including the checkpoint being measured.
        const rejectedWithError = await first.owner.resumeRecovery(async (scope, writes, queue) => {
          proof ??= await prepare(scope, writes, queue); return proof;
        }).then(() => false, error => error instanceof Error);
        expect(rejectedWithError).toBe(true);
      });
      await act(async () => { const next = await h.restart(); await next.resume(); });
    })();
    for (let index = 0; index < 12; index++) { await new Promise(resolve => setTimeout(resolve, 0)); gc(); }
    expect(Object.isFrozen(retained)).toBe(true); expect(weak.deref()).toBeUndefined();
  });

  it('activates another project and returns without remounting working state or losing Undo history', async () => {
    h.select(h.a.id); h.type(h.a.id, 'Before switching'); await h.flush();
    const owner = h.owner(h.a.id), document = owner.getCurrent().document;
    await act(async () => { await h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.b.id } }); });
    await act(async () => { await h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.a.id } }); });
    expect(h.owner(h.a.id).getCurrent).toBe(owner.getCurrent); expect(h.owner(h.a.id).getCurrent().document).toBe(document);
    fireEvent.click(h.region(h.a.id).getByTitle('Undo (Ctrl+Z)')); await h.flush();
    expect((await h.repository.readActiveSnapshot())!.snapshot.projects[0].initialState.variants.default.templates['page-0'].elements[0].text).toBe('Café ☕ 😀');
  });

  it('closes only after document, preferences and metadata drain and rejects immediate target Undo', async () => {
    h.select(h.a.id); h.type(h.a.id, 'Accepted before close');
    let metadata!: Promise<boolean>; act(() => { metadata = h.lifecycle.persistEditor(h.lifecycle.catalog().members[0], h.installed.get(h.a.id)!.source,
      undefined, () => h.writers.get(h.a.id)!.updateMetadata(h.a.id, { name: 'Before close metadata' }, 7)); });
    const owner = h.owner(h.a.id), before = owner.getCurrent(); let closing!: ReturnType<typeof h.lifecycle.workspace>;
    await act(async () => {
      closing = h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'close-project', projectId: h.a.id } });
      expect(() => owner.undo()).toThrow(); expect(owner.getCurrent()).toBe(before); await closing;
    });
    expect(await metadata).toBe(true); expect(h.queryByTestId(`lifecycle-${h.a.id}`)).not.toBeInTheDocument();
    expect((await h.repository.readActiveSnapshot())!.snapshot.projects.map(project => project.id)).toEqual([h.b.id]);
    const command = h.messages.find(message => message.request.type === 'workspace-command')!.request;
    if (command.type !== 'workspace-command' || command.batch.targets[0].type !== 'lineage') throw Error('Close target required');
    expect(command.batch.targets[0].authority).toMatchObject({ documentRevision: 2, preferenceRevision: 1 });
  });

  it('defers reentrant close during preparation and refuses the not-yet-accepted edit without losing prior work', async () => {
    h.select(h.a.id); h.type(h.a.id, 'Earlier accepted work'); const owner = h.owner(h.a.id), before = owner.getCurrent();
    let closing!: ReturnType<typeof h.lifecycle.workspace>;
    await act(async () => {
      expect(() => owner.edit(context => {
        closing = h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'close-project', projectId: h.a.id } });
        return { changes: [{ type: 'put-node', node: { ...context.document.nodes.root, title: 'Must not be accepted' } }], mappings: [] };
      })).toThrow();
      expect(owner.getCurrent()).toBe(before); await closing;
    });
    expect(h.published.at(-1)!.outcome).toBe('closed');
    const documents = h.messages.flatMap(({ request }) => request.type === 'document-batch' ? [request.batch]
      : request.type === 'structural-command' ? [request.command.batch] : []);
    expect(documents).toHaveLength(1);
    expect(documents[0].changes).toEqual([expect.objectContaining({ type: 'put-template', template: expect.objectContaining({
      elements: expect.arrayContaining([expect.objectContaining({ text: 'Earlier accepted work' })]),
    }) })]);
  });

  it('defers reentrant close during document delivery until that exact effect reaches persistence', async () => {
    h.select(h.a.id); await h.flush(); let closing: ReturnType<typeof h.lifecycle.workspace> | undefined;
    h.hooks.beforeDocument = scope => { closing ??= h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'close-project', projectId: scope.projectId } }); };
    h.type(h.a.id, 'Delivery already accepted');
    await act(async () => { expect((await closing!).outcome).toBe('closed'); });
    const types = h.messages.map(message => message.request.type), close = types.indexOf('workspace-command');
    const document = types.findIndex(type => type === 'document-batch' || type === 'structural-command');
    expect(document).toBeGreaterThanOrEqual(0); expect(document).toBeLessThan(close);
    expect((await h.repository.readActiveSnapshot())!.snapshot.projects.map(project => project.id)).toEqual([h.b.id]);
  });

  it('never posts close after early handoff failure and preserves working text, history and unsaved status', async () => {
    h.select(h.a.id); await h.flush();
    h.hooks.transformDocument = event => ({ ...event, foldBasis: { type: 'after-replacement', editorGeneration: 0 } });
    h.type(h.a.id, 'Unsaved working text'); const owner = h.owner(h.a.id), before = owner.getCurrent().document;
    await act(async () => {
      await expect(h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'close-project', projectId: h.a.id } })).rejects.toThrow();
    });
    expect(h.messages.some(message => message.request.type === 'workspace-command')).toBe(false);
    expect(h.owner(h.a.id).getCurrent().document).toBe(before); expect(h.owner(h.a.id).getCurrent().historyStatus.canUndo).toBe(true);
    expect(h.writers.get(h.a.id)!.hasUnsavedDocument).toBe(true);
    expect(h.region(h.a.id).getByPlaceholderText('Text content or {{field}}')).toHaveValue('Unsaved working text');
    expect(() => owner.undo()).toThrow();
  });

  it('retains newer survivor typing behind close and preserves its Undo history afterwards', async () => {
    await act(async () => { await h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.b.id } }); });
    h.select(h.b.id); await h.flush(); h.type(h.b.id, 'Before close');
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const request = h.client.request.bind(h.client);
    vi.spyOn(h.client, 'request').mockImplementation(async message => {
      const result = await request(message); if (message.type === 'workspace-command') await gate; return result;
    });
    let closing!: ReturnType<typeof h.lifecycle.workspace>;
    act(() => { closing = h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'close-project', projectId: h.a.id } }); });
    h.type(h.b.id, 'After cut'); const owner = h.owner(h.b.id);
    try {
      await act(async () => { await vi.waitFor(() => expect(h.responses.filter(row => row.response.type === 'workspace-command-result')).toHaveLength(2)); });
      const beforeRelease = await h.repository.readActiveSnapshot();
      expect(beforeRelease!.snapshot.projects[0].initialState.variants.default.templates['page-0'].elements[0].text).toBe('Before close');
      await act(async () => { release(); await closing; await h.incremental.flush(); });
      expect(h.owner(h.b.id).getCurrent).toBe(owner.getCurrent);
      expect((await h.repository.readActiveSnapshot())!.snapshot.projects[0].initialState.variants.default.templates['page-0'].elements[0].text).toBe('After cut');
      fireEvent.click(h.region(h.b.id).getByTitle('Undo (Ctrl+Z)')); await h.flush();
      expect(h.region(h.b.id).getByPlaceholderText('Text content or {{field}}')).toHaveValue('Before close');
    } finally { release(); }
  });

  it('keeps survivor text unsaved after a lost close result and inspects without replay or history remount', async () => {
    await act(async () => { await h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'activate-project', projectId: h.b.id } }); });
    h.select(h.b.id); await h.flush(); h.type(h.b.id, 'Before loss');
    h.environment.workspaceFault = point => { if (point.phase === 'after-commit') throw Error('Close acknowledgement lost'); };
    let closing!: ReturnType<typeof h.lifecycle.workspace>;
    act(() => { closing = h.lifecycle.workspace({ type: 'workspace-lifecycle', intent: { type: 'close-project', projectId: h.a.id } }); void closing.catch(() => {}); });
    h.type(h.b.id, 'Retained after loss'); const owner = h.owner(h.b.id), document = owner.getCurrent().document;
    await act(async () => { await expect(closing).rejects.toThrow(); }); h.environment.workspaceFault = undefined;
    expect(h.writers.get(h.b.id)!.hasUnsavedDocument).toBe(true);
    expect(h.region(h.b.id).getByPlaceholderText('Text content or {{field}}')).toHaveValue('Retained after loss');
    await act(async () => { expect((await h.lifecycle.inspectBlocked()).type).toBe('committed'); });
    expect(h.owner(h.b.id).getCurrent).toBe(owner.getCurrent); expect(owner.getCurrent().document).toBe(document);
    expect(owner.getCurrent().historyStatus.canUndo).toBe(true); expect(() => owner.undo()).toThrow();
    expect(h.writers.get(h.b.id)!.hasUnsavedDocument).toBe(true);
    expect(h.messages.filter(row => row.request.type === 'workspace-command')).toHaveLength(2);
    expect((await h.repository.readActiveSnapshot())!.snapshot.projects[0].initialState.variants.default.templates['page-0'].elements[0].text).toBe('Before loss');
  });
});

/** Private composition proof only: actual editor/queue/coordinator/repository,
 * inline structured-cloning worker port and isolated fake IndexedDB. This is
 * neither public-store wiring nor production migration/browser evidence.
 */
async function renderPersistedEditor(project = makeIncrementalProject(2)) {
  const worker = await createIncrementalWorkerHarness(project);
  const binding = worker.responses.find(response => response.response.type === 'bootstrapped')!.response;
  if (binding.type !== 'bootstrapped') throw new Error('Real worker bootstrap required');
  let authority: InstalledQueueAuthority = {
    source: registerInstalledProjectAuthority(project, { incarnation: binding.scope.incarnation,
      revision: binding.authority.documentRevision }), transport: worker.client, binding, editorGenerationFloor: 0,
  };
  const installations = createProjectInstallationRegistry(binding.scope.storageGeneration); installations.set(project.id, authority);
  let editable = true;
  let installed = true; let sequence = 0;
  const events: QueueEvent[] = []; const acknowledgements: Array<DocumentSaveAck | PreferenceSaveAck> = [];
  const failures: unknown[] = []; const pending: Array<Promise<DocumentSaveAck | PreferenceSaveAck>> = [];
  const admission = createIncrementalCommandAdmission({
    transport: worker.client,
    clock: { now: () => Date.now(), setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    uuid: () => `editor-integration-${++sequence}`,
    resolveAuthority: id => installed && id === project.id ? authority : undefined,
    onEvent: event => events.push(event),
  });
  let activeAdmission = admission, activeClient = worker.client;
  const recoveredAdmissions: ReturnType<typeof createIncrementalCommandAdmission>[] = [];
  const recoveredClients: ReturnType<typeof worker.createWorkspaceWorkerClient>[] = [];
  const documentEnqueues = vi.spyOn(admission, 'document');
  function track<T extends DocumentSaveAck | PreferenceSaveAck>(promise: Promise<T>): Promise<T> {
    pending.push(promise);
    void promise.then(ack => { acknowledgements.push(ack); }, error => { failures.push(error); });
    return promise;
  }
  const commit = createWorkspaceCommandDispatcher({ document: command => track(admission.document(command)),
    preferences: command => track(admission.preferences(command)), metadata: command => track(admission.metadata(command)),
    snapshot: async () => { throw new WorkspaceStoreError('Snapshot path is outside this private fixture.', 'unavailable'); } });
  const store = { commit };
  let drain: EditorPersistenceDrain | undefined;
  const incremental = { source: authority.source, editorGenerationFloor: authority.editorGenerationFloor,
    foldStructureGeneration: binding.authority.foldStructureGeneration,
    assertEditable() { if (!editable) throw Error('Editor awaits verified write readmission'); },
    capturePersistenceCut: (generation: number) => writes().capturePersistenceCut(project.id, generation),
    registerPersistenceDrain(handle: EditorPersistenceDrain) {
      drain = handle; return () => { if (drain === handle) drain = undefined; };
    } };
  let committedWrites: IncrementalProjectWrites | undefined;
  const writes = () => { if (!committedWrites) throw new Error('Hook has not committed'); return committedWrites; };
  const onStateChange = vi.fn(); const onNameChange = vi.fn();
  function BoundEditor() {
    const writer = useIncrementalProjectWrites({ projectId: project.id, authorityEpoch: 7, binding: incremental, store,
      resolveAuthority: () => installed ? project : undefined, flushPending: () => admission.flush(project.id) });
    useLayoutEffect(() => { committedWrites = writer; });
    return <ProjectEditor projectId={project.id} projectName={project.name} initialState={project.initialState} isActive incremental={incremental}
      onDocumentEdit={event => { void writer.updateDocument(project.id, event, 7); }}
      onPreferencesChange={(patch, metadata) => { void writer.updatePreferences(project.id, patch, metadata, 7); }}
      onStateChange={onStateChange} onNameChange={onNameChange}
      onCreateGeneratedProject={async () => { throw new Error('Not part of this interaction fixture'); }}
      onSaveCustomPreset={async () => { throw new Error('Not part of this interaction fixture'); }} />;
  }
  const view = render(<BoundEditor />);
  const messageStart = worker.messages.length;
  const snapshot = vi.spyOn(snapshots, 'snapshotDocument'); const restore = vi.spyOn(snapshots, 'restoreDocument');
  worker.clearOperations();
  return { ...worker, ...view, project, events, acknowledgements, failures, documentEnqueues, onStateChange, onNameChange, snapshot, restore,
    admission, authority, get drain() { if (!drain) throw Error('Editor drain is not registered'); return drain; },
    get writes() { return writes(); },
    get requests() { return worker.messages.slice(messageStart).map(message => message.request); },
    invalidate() { installed = false; },
    metadata(patch: ProjectMetadataCommand['patch']) {
      return writes().updateMetadata(project.id, patch, 7);
    },
    async flush() { await act(async () => {
      const complete = await writes().flushPendingProject(project.id); await Promise.all(pending);
      if (!complete) throw new Error('Private source has unfinished or failed writes');
    }); },
    async restartWrites() {
      editable = false;
      let retained!: ReturnType<IncrementalProjectWrites['retainForRecovery']>, checkpoint!: ReturnType<typeof admission.queue.freeze>;
      await act(async () => {
        checkpoint = activeAdmission.queue.freeze('worker owner replaced'); retained = writes().retainForRecovery();
        await checkpoint.whenQuiescent;
      });
      activeClient.dispose();
      const client = worker.createWorkspaceWorkerClient(worker.factory); recoveredClients.push(client);
      const records = await worker.readRecords(), fresh = await client.request({ type: 'bootstrap', project: records });
      if (fresh.type !== 'bootstrapped') throw Error('Fresh readmission bootstrap failed');
      const resolutions = await Promise.all(checkpoint.projects[0].attempts.map(async original => {
        if (original.attempt.lane === 'replacement') throw Error('This fixture only admits ordinary saves');
        const response = await client.request({ type: 'inspect-commit', attempt: original.attempt });
        if (response.type !== 'commit-inspection') throw Error('Independent attempt inspection required');
        return { attempt: original.attempt, inspection: response };
      }));
      authority = { ...authority, transport: client, binding: fresh }; installations.set(project.id, authority);
      const next = createIncrementalCommandAdmission({ transport: client,
        clock: { now: () => Date.now(), setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
        uuid: () => `editor-readmitted-${++sequence}`, resolveAuthority: id => installed && id === project.id ? installations.get(id) : undefined,
        onEvent: event => events.push(event), recovery: { retained: checkpoint, projects: [{ previous: checkpoint.projects[0], authority, resolutions }] } });
      recoveredAdmissions.push(next); const release = next.queue.holdWorkspaceRecovery();
      const verified = await next.prepareWriteRecovery(retained, checkpoint, installations, () => installed ? project : undefined);
      let ready!: Promise<boolean>; act(() => { ready = writes().readmit(verified); });
      await act(async () => { release(); await next.flush(); if (!await ready) throw Error('Write owner readmission refused'); });
      activeAdmission = next; activeClient = client; pending.length = 0; editable = true;
    },
    selectLabel() {
      fireEvent.click(screen.getByTitle('Layers'));
      fireEvent.click(screen.getByTestId('element-row-title'));
    },
    assertNoLegacySave() {
      expect(onStateChange).not.toHaveBeenCalled(); expect(onNameChange).not.toHaveBeenCalled();
      expect(snapshot).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled();
    },
    dispose() { view.unmount(); admission.dispose(); worker.client.dispose(); for (const value of recoveredAdmissions) value.dispose(); for (const value of recoveredClients) value.dispose(); },
  };
}

describe('private editor to durable incremental records', () => {
  it('readmits queued editor work after a worker restart without resetting history or metadata-separated clocks', async () => {
    let editor!: documentEditor.DocumentEditor; const original = documentEditor.useDocumentEditor;
    vi.spyOn(documentEditor, 'useDocumentEditor').mockImplementation((...args) => { editor = original(...args); return editor; });
    const h = await renderPersistedEditor();
    try {
      h.selectLabel(); fireEvent.change(screen.getByPlaceholderText('Text content or {{field}}'), { target: { value: 'Retained through restart' } });
      let metadata!: Promise<boolean>; act(() => { metadata = h.metadata({ name: 'Metadata clock between edits' }); });
      const before = editor.getCurrent, document = editor.getCurrent().document;
      await h.restartWrites(); expect(await metadata).toBe(false);
      expect(editor.getCurrent).toBe(before); expect(editor.getCurrent().document).toBe(document);
      expect(h.writes.hasUnsavedDocument).toBe(false);
      const saved = await h.exportFresh(); expect(saved.name).toBe('Metadata clock between edits');
      expect(saved.initialState.variants.default.templates['page-0'].elements[0].text).toBe('Retained through restart');
      fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)')); await h.flush();
      expect(screen.getByPlaceholderText('Text content or {{field}}')).toHaveValue('Café ☕ 😀');
      fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)')); await h.flush();
      expect((await h.exportFresh()).initialState.variants.default.templates['page-0'].elements[0].text).toBe('Retained through restart');
      expect(h.factory).toHaveBeenCalledTimes(2); h.assertNoLegacySave();
    } finally { h.dispose(); }
  });
  it('proves a real editor persistence cut through both lanes and older metadata without waiting before queue admission', async () => {
    const h = await renderPersistedEditor();
    try {
      h.selectLabel(); fireEvent.change(screen.getByPlaceholderText('Text content or {{field}}'), { target: { value: 'Captured edit' } });
      let metadata!: Promise<boolean>; act(() => { metadata = h.metadata({ name: 'Captured metadata' }); });
      fireEvent.wheel(h.container.querySelector('.canvas-scroll-container')!, { ctrlKey: true, deltaY: -125 });
      await act(async () => {
        const generation = h.drain.generation(), handoff = h.drain.drainThrough(generation);
        const cutting = h.admission.queue.workspaceBarrier({ targets: [h.authority], retireScopes: [], run: async cut => {
          expect(await handoff).toBe(true);
          const records = await h.readRecords();
          expect(cut.targets[0].stamp).toEqual({ documentRevision: records.projectHeaders.values().next().value!.storageRevision,
            preferenceRevision: records.projectPreferences.values().next().value!.revision,
            foldStructureGeneration: records.projectHeaders.values().next().value!.foldStructureGeneration });
          return { type: 'completed', value: cut };
        } });
        await cutting; expect(await metadata).toBe(true);
      });
      const exported = await h.exportFresh();
      expect(exported.name).toBe('Captured metadata');
      expect(exported.initialState.variants.default.templates['page-0'].elements[0].text).toBe('Captured edit');
      expect(h.writes.documentState.status).toBe('saved'); expect(h.writes.preferenceState.status).toBe('saved');
      expect(screen.getByTitle('Undo (Ctrl+Z)')).not.toBeDisabled(); h.assertNoLegacySave();
    } finally { h.dispose(); }
  });

  it('refuses an empty-queue cut after failed handoff while preserving unsaved working text and history', async () => {
    const h = await renderPersistedEditor();
    try {
      h.selectLabel(); await h.flush(); const before = await h.readRecords(), sent = h.requests.length;
      h.documentEnqueues.mockRejectedValueOnce(new WorkspaceStoreError('Failure before enqueue', 'conflict'));
      fireEvent.change(screen.getByPlaceholderText('Text content or {{field}}'), { target: { value: 'Still unsaved' } });
      const continuation = vi.fn();
      await act(async () => {
        const handoff = h.drain.drainThrough(h.drain.generation());
        await expect(h.admission.queue.workspaceBarrier({ targets: [h.authority], retireScopes: [], run: async () => {
          if (!await handoff) return { type: 'failed', failure: { type: 'queue', code: 'retry-required' } };
          continuation(); return { type: 'completed', value: undefined };
        } })).rejects.toMatchObject({ code: 'retry-required' });
      });
      expect(continuation).not.toHaveBeenCalled(); expect(h.requests.length).toBe(sent);
      expect(await h.readRecords()).toEqual(before); expect(h.writes.hasUnsavedDocument).toBe(true);
      expect(screen.getByPlaceholderText('Text content or {{field}}')).toHaveValue('Still unsaved');
      expect(screen.getByTitle('Undo (Ctrl+Z)')).not.toBeDisabled(); h.assertNoLegacySave();
    } finally { h.dispose(); }
  });

  it('translates a real layer dependency after metadata separates the editor and write clocks', async () => {
    const h = await renderPersistedEditor();
    try {
      h.selectLabel(); await h.flush();
      let metadata!: ReturnType<typeof h.metadata>;
      act(() => { metadata = h.metadata({ name: 'Metadata before layers' }); });
      await h.flush(); expect(await metadata).toBe(true);
      fireEvent.click(screen.getByTitle('Add layer')); await h.flush();
      fireEvent.click(within(screen.getByTestId('layer-row-content')).getByTitle('Collapse layer')); await h.flush();
      const exported = await h.exportFresh();
      expect(exported.initialState.variants.default.templates['page-0'].layers!.find(layer => layer.id === 'content')!.collapsed).toBe(true);
      const structure = h.requests.find(request => request.type === 'structural-command');
      if (structure?.type !== 'structural-command') throw new Error('Missing structural request');
      expect(structure.command.batch.editorGeneration).toBe(3);
      const fold = h.requests.find(request => request.type === 'preferences' && request.batch.folds);
      if (fold?.type !== 'preferences') throw new Error('Missing fold request');
      expect(fold.batch.editorGeneration).toBe(4); expect(fold.batch.folds?.expectedFoldStructureGeneration).toBe(1);
      expect(h.writes.documentState.status).toBe('saved'); expect(h.writes.preferenceState.status).toBe('saved');
      h.assertNoLegacySave();
    } finally { h.dispose(); }
  });

  it('metadata between a text edit and undo/redo preserves history and strictly increasing write generations', async () => {
    const h = await renderPersistedEditor();
    try {
      h.selectLabel(); await h.flush();
      fireEvent.change(screen.getByPlaceholderText('Text content or {{field}}'), { target: { value: 'Edited before metadata' } });
      await h.flush();
      let metadata!: ReturnType<typeof h.metadata>;
      act(() => { metadata = h.metadata({ name: 'Independent project name' }); });
      await h.flush(); await metadata;
      expect((await h.exportFresh()).name).toBe('Independent project name');
      fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)')); await h.flush();
      let exported = await h.exportFresh();
      expect(exported.initialState.variants.default.templates['page-0'].elements[0].text).toBe('Café ☕ 😀');
      expect(exported.name).toBe('Independent project name');
      fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)')); await h.flush();
      exported = await h.exportFresh();
      expect(exported.initialState.variants.default.templates['page-0'].elements[0].text).toBe('Edited before metadata');
      expect(exported.name).toBe('Independent project name');
      expect(h.acknowledgements.filter(ack => ack.type === 'document-saved').map(ack => ack.editorGeneration)).toEqual([2, 3, 4, 5]);
      expect(h.failures).toEqual([]); h.assertNoLegacySave();
    } finally { h.dispose(); }
  });

  it('root rename, undo and redo atomically persist linked names without a second save callback', async () => {
    const h = await renderPersistedEditor();
    try {
      const original = h.project.initialState.nodes.root.title;
      const renamed = 'Linked title 根';
      const row = h.container.querySelector('[data-node-id="root"]')!;
      fireEvent.click(row.querySelector('[title="Edit Title"]')!);
      fireEvent.change(row.querySelector('input')!, { target: { value: renamed } });
      fireEvent.keyDown(row.querySelector('input')!, { key: 'Enter' });
      for (const [index, title] of [renamed, original, renamed].entries()) {
        if (index) fireEvent.click(screen.getByTitle(index === 1 ? 'Undo (Ctrl+Z)' : 'Redo (Ctrl+Y)'));
        await h.flush();
        const exported = await h.exportFresh();
        expect(exported.name).toBe(title); expect(exported.initialState.nodes.root.title).toBe(title);
        expect(h.acknowledgements.filter(ack => ack.type === 'document-saved')).toHaveLength(index + 1);
      }
      const writes = h.operations.filter(operation => operation.phase === 'write');
      const transactions = new Set(writes.map(operation => operation.transactionId));
      expect(transactions.size).toBe(3);
      for (const id of transactions) expect(new Set(writes.filter(operation => operation.transactionId === id).map(operation => operation.store)))
        .toEqual(new Set(['projectHeaders', 'projectNodes']));
      expect(h.failures).toEqual([]); h.assertNoLegacySave();
    } finally { h.dispose(); }
  });

  it('node selection persists only preferences without reading node or template payloads', async () => {
    const project = makeIncrementalProject(2);
    project.initialState.nodes.root.children = ['child'];
    project.initialState.nodes.child = { ...project.initialState.nodes.root, id: 'child', parentId: 'root',
      title: 'Child page', type: 'page-1', children: [] };
    const h = await renderPersistedEditor(project);
    try {
      const before = await h.readRecords();
      fireEvent.click(h.container.querySelector('[data-node-id="child"]')!); await h.flush();
      const after = await h.readRecords();
      expect(after.projectHeaders).toEqual(before.projectHeaders);
      expect(after.projectNodes).toEqual(before.projectNodes);
      expect(after.projectTemplates).toEqual(before.projectTemplates);
      expect((await h.exportFresh()).initialState.selectedNodeId).toBe('child');
      expect(h.requests.length).toBeGreaterThan(0);
      expect(h.requests.every(request => request.type === 'preferences')).toBe(true);
      expect(h.operations.filter(operation => ['projectNodes', 'projectTemplates'].includes(operation.store))).toEqual([]);
      expect(h.failures).toEqual([]); h.assertNoLegacySave();
    } finally { h.dispose(); }
  });

  it('persists template navigation and zoom without document writes or legacy saves', async () => {
    const h = await renderPersistedEditor();
    try {
      const before = await h.readRecords();
      fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
      fireEvent.click(h.container.querySelector('[data-template-id="page-1"]')!);
      fireEvent.wheel(h.container.querySelector('.canvas-scroll-container')!, { ctrlKey: true, deltaY: -125 });
      await h.flush();
      const after = await h.readRecords();
      for (const store of ['projectHeaders', 'projectNodes', 'projectVariants', 'projectTemplates', 'projectSources', 'projectExtensions'] as const) {
        expect(after[store]).toEqual(before[store]);
      }
      const exported = await h.exportFresh();
      expect(exported.initialState.selectedTemplateId).toBe('page-1');
      expect(exported.initialState.viewMode).toBe('templates');
      expect(exported.initialState.scale).toBeCloseTo(1);
      expect(h.requests.length).toBeGreaterThan(0);
      expect(h.requests.every(request => request.type === 'preferences')).toBe(true);
      expect(h.acknowledgements.every(ack => ack.type === 'preferences-saved')).toBe(true);
      const writes = h.operations.filter(operation => operation.phase === 'write');
      expect(writes.length).toBeGreaterThan(0);
      expect(writes.every(operation => operation.store === 'projectPreferences')).toBe(true);
      expect(h.operations.filter(operation => ['projectTemplates', 'projectNodes', 'projectSources'].includes(operation.store))).toEqual([]);
      expect(h.failures).toEqual([]); h.assertNoLegacySave();
    } finally { h.dispose(); }
  });

  it('element selection is session-only and posts no save request', async () => {
    const h = await renderPersistedEditor();
    try {
      // Expanding the panel is itself a persisted preference; isolate the click.
      fireEvent.click(screen.getByTitle('Layers')); await h.flush();
      const before = await h.readRecords(); const messages = h.requests.length; const acks = h.acknowledgements.length;
      fireEvent.click(screen.getByTestId('element-row-title')); await h.flush();
      expect(screen.getByPlaceholderText('Text content or {{field}}')).toHaveValue('Café ☕ 😀');
      expect(h.requests.slice(messages)).toEqual([]); expect(h.acknowledgements.slice(acks)).toEqual([]);
      expect(await h.readRecords()).toEqual(before); h.assertNoLegacySave();
    } finally { h.dispose(); }
  });

  it('text edit, undo and redo persist the selected template through real worker acknowledgements', async () => {
    const h = await renderPersistedEditor();
    try {
      const before = await h.readRecords(); h.selectLabel();
      const editor = screen.getByPlaceholderText('Text content or {{field}}');
      const original = 'Café ☕ 😀'; const changed = 'Saved through the incremental queue';
      for (const [index, text] of [changed, original, changed].entries()) {
        if (index === 0) fireEvent.change(editor, { target: { value: changed } });
        else fireEvent.click(screen.getByTitle(index === 1 ? 'Undo (Ctrl+Z)' : 'Redo (Ctrl+Y)'));
        // History restores selection and can remount the properties editor.
        expect(screen.getByPlaceholderText('Text content or {{field}}')).toHaveValue(text); await h.flush();
        const exported = await h.exportFresh();
        expect(exported.initialState.variants.default.templates['page-0'].elements[0].text).toBe(text);
        const after = await h.readRecords();
        expect(after.projectNodes).toEqual(before.projectNodes);
        const otherKey = JSON.stringify([h.scope.storageGeneration, h.scope.projectId, h.scope.incarnation, 'default', 'page-1']);
        expect(before.projectTemplates.has(otherKey)).toBe(true);
        expect(after.projectTemplates.get(otherKey)).toEqual(before.projectTemplates.get(otherKey));
        expect(after.projectHeaders.values().next().value!.storageRevision).toBe(index + 1);
      }
      expect(h.acknowledgements.filter(ack => ack.type === 'document-saved')).toHaveLength(3);
      expect(h.operations.some(operation => operation.method === 'getAll')).toBe(false);
      const templates = h.operations.filter(operation => operation.store === 'projectTemplates');
      expect(templates.length).toBeGreaterThan(0);
      expect(templates.every(operation => operation.key?.[4] === 'page-0')).toBe(true);
      for (const request of h.requests) {
        expect(['document-batch', 'structural-command', 'preferences']).toContain(request.type);
        const text = JSON.stringify(request);
        expect(text).not.toContain('initialState'); expect(text).not.toContain('page-1');
        expect(request).not.toHaveProperty('authority');
      }
      expect(h.failures).toEqual([]); h.assertNoLegacySave();
    } finally { h.dispose(); }
  });

  it('an invalidated source cannot persist a later optimistic edit', async () => {
    const h = await renderPersistedEditor();
    try {
      h.selectLabel(); await h.flush();
      const messages = h.requests.length; const acknowledgements = h.acknowledgements.length;
      h.invalidate();
      fireEvent.change(screen.getByPlaceholderText('Text content or {{field}}'), { target: { value: 'Not persisted' } });
      expect(screen.getByPlaceholderText('Text content or {{field}}')).toHaveValue('Not persisted');
      expect(h.documentEnqueues).not.toHaveBeenCalled();
      expect(h.writes.documentState.status).toBe('conflict'); expect(h.writes.hasUnsavedDocument).toBe(true);
      await expect(h.flush()).rejects.toBeDefined();
      expect(h.requests.slice(messages)).toEqual([]); expect(h.acknowledgements.slice(acknowledgements)).toEqual([]);
      expect(h.failures).toEqual([]); // Refused by the hook before storage admission.
      expect((await h.exportFresh()).initialState.variants.default.templates['page-0'].elements[0].text).toBe('Café ☕ 😀');
      h.assertNoLegacySave();
    } finally { h.dispose(); }
  });

  it('implicit continuations preserve raw fold exceptions without sending their values back', async () => {
    const project = makeIncrementalProject(2);
    const raw = { marker: 'opaque-fold-cell', values: ['☕', false] };
    Object.assign(project.initialState.variants.default.templates['page-0'].layers![0], { collapsed: raw });
    const h = await renderPersistedEditor(project);
    try {
      h.selectLabel(); await h.flush();
      fireEvent.change(screen.getByPlaceholderText('Text content or {{field}}'), { target: { value: 'Text beside a raw fold' } });
      await h.flush();
      const edited = (await h.exportFresh()).initialState.variants.default.templates['page-0'];
      expect(edited.elements[0].text).toBe('Text beside a raw fold');
      expect(edited.layers![0].collapsed).toEqual(raw);
      fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)')); await h.flush();
      const exported = await h.exportFresh();
      const template = exported.initialState.variants.default.templates['page-0'];
      expect(template.elements[0].text).toBe('Café ☕ 😀');
      expect(template.layers![0].collapsed).toEqual(raw);
      expect(h.acknowledgements.filter(ack => ack.type === 'document-saved')).toHaveLength(2);
      expect(JSON.stringify(h.requests)).not.toContain('opaque-fold-cell');
      expect(h.failures).toEqual([]); h.assertNoLegacySave();
    } finally { h.dispose(); }
  });

  it('a real failed template write rolls back and produces no saved acknowledgement', async () => {
    const h = await renderPersistedEditor();
    try {
      h.selectLabel(); await h.flush();
      const before = await h.readRecords(); const acknowledged = h.acknowledgements.length;
      let fired = false;
      h.setFault(point => {
        if (point.phase === 'before-put' && point.store === 'projectTemplates') {
          fired = true; throw new DOMException('Injected isolated quota failure', 'QuotaExceededError');
        }
      });
      fireEvent.change(screen.getByPlaceholderText('Text content or {{field}}'), { target: { value: 'Keep this unsaved edit' } });
      await expect(h.flush()).rejects.toBeDefined();
      expect(fired).toBe(true); expect(h.acknowledgements.slice(acknowledged)).toEqual([]);
      expect(h.events.some(event => event.type === 'project-blocked')).toBe(true);
      expect(await h.readRecords()).toEqual(before);
      expect(screen.getByPlaceholderText('Text content or {{field}}')).toHaveValue('Keep this unsaved edit');
      h.assertNoLegacySave();
    } finally { h.dispose(); }
  });
});

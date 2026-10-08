import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { Router } from '@remix-run/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormFactorProvider } from '../../components/editor-layout/FormFactorContext';
import { BackDismissProvider, overlayDepthOf } from '../../components/editor-layout/useBackDismiss';
import { OverflowMenu } from '../../components/editor-layout/OverflowMenu';
import { SavePresetModal } from '../../components/SavePresetModal';
import { DeleteConfirmModal } from '../../components/DeleteConfirmModal';
import { CloseProjectConfirmModal } from '../../components/CloseProjectConfirmModal';
import { NewProjectModal } from '../../components/NewProjectModal';
import { GeneratorVisualPreviewModal } from '../../components/GeneratorVisualPreviewModal';
import { HierarchyGeneratorModal } from '../../components/HierarchyGeneratorModal';
import { makeActions } from '../helpers/touchActions';
import { createBlankProject } from '../../services/presets';
import type { GeneratorPreviewPayload } from '../../services/generatorVisualPreview';
import type { GeneratorProvenance, PageTemplate } from '../../types';

// The per-overlay dismiss handlers behind the touch back gesture, each on a real data router
// (phone form factor, `/app` with `/` beneath it). `router.navigate(-1)` is the back gesture.

vi.mock('../../components/canvas/ReadOnlyPagePreview', () => ({
    ReadOnlyPagePreview: ({ template }: { template: PageTemplate }) => <div>{template.name}</div>,
}));

const mountOnPhone = (ui: React.ReactNode) => {
    const router = createMemoryRouter([
        { path: '/app', element: <FormFactorProvider value="phone"><BackDismissProvider>{ui}</BackDismissProvider></FormFactorProvider> },
        { path: '/', element: <div>home route</div> },
    ], { initialEntries: ['/', '/app'], initialIndex: 1 });
    render(<RouterProvider router={router} />);
    return router;
};
const depth = (router: Router) => overlayDepthOf(router.state.location);
const back = (router: Router) => act(() => { void router.navigate(-1); });
const never = () => new Promise<never>(() => {});

afterEach(() => { cleanup(); vi.restoreAllMocks(); document.documentElement.removeAttribute('data-form-factor'); });

describe('sheet handoff (R39)', () => {
    it('⋯ → Save preset hands the sheet\'s entry to the preset dialog; back closes the dialog and stays on /app', () => {
        const onClose = vi.fn();
        function Host() {
            const [menu, setMenu] = useState(false);
            const [preset, setPreset] = useState(false);
            return (
                <>
                    <button type="button" onClick={() => setMenu(true)}>More actions</button>
                    <OverflowMenu open={menu} onClose={() => setMenu(false)} chrome={null}
                        actions={makeActions({ savePreset: () => setPreset(true) })} />
                    <SavePresetModal isOpen={preset} onClose={() => { onClose(); setPreset(false); }} onSave={async () => true} defaultTitle="Root" />
                </>
            );
        }
        const router = mountOnPhone(<Host />);
        const log: string[] = [];
        router.subscribe(state => log.push(state.historyAction));
        fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
        expect(depth(router)).toBe(1);
        fireEvent.click(within(screen.getByRole('dialog', { name: 'More actions' })).getByRole('button', { name: 'Save preset' }));
        expect(screen.queryByRole('dialog', { name: 'More actions' })).toBeNull();
        expect(screen.getByRole('dialog', { name: 'Save As Preset' })).toBeTruthy();
        // The swap cost no history operation: still one entry.
        expect(log).toEqual(['PUSH']);
        expect(depth(router)).toBe(1);
        back(router);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog', { name: 'Save As Preset' })).toBeNull();
        expect(router.state.location.pathname).toBe('/app');
        expect(depth(router)).toBe(0);
    });

    it('SavePresetModal keeps its entry while a save is in flight', () => {
        const onClose = vi.fn();
        const router = mountOnPhone(<SavePresetModal isOpen onClose={onClose} onSave={never} defaultTitle="Root" />);
        fireEvent.click(screen.getByRole('button', { name: 'Save Preset' }));
        expect(screen.getByRole('dialog', { name: 'Save As Preset' }).getAttribute('aria-busy')).toBe('true');
        back(router);
        expect(onClose).not.toHaveBeenCalled();
        expect(depth(router)).toBe(1);
        expect(router.state.location.pathname).toBe('/app');
    });
});

describe('simple confirmation dialogs (R39)', () => {
    it('DeleteConfirmModal: back cancels like Cancel, without confirming', () => {
        const onClose = vi.fn(), onConfirm = vi.fn();
        const router = mountOnPhone(<DeleteConfirmModal isOpen onClose={onClose} onConfirm={onConfirm} nodeTitle="Chapter" />);
        expect(depth(router)).toBe(1);
        back(router);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
        expect(depth(router)).toBe(0);
    });

    it('CloseProjectConfirmModal: back cancels, but not while a close is running', () => {
        const onClose = vi.fn();
        const router = mountOnPhone(<CloseProjectConfirmModal isOpen onClose={onClose} onConfirmClose={never} onSaveAndClose={never} projectName="Planner" />);
        fireEvent.click(screen.getByRole('button', { name: /Close Without Saving|Close without saving|Discard/i }));
        back(router);
        expect(onClose).not.toHaveBeenCalled();
        expect(depth(router)).toBe(1);
    });
});

describe('NewProjectModal', () => {
    const customPreset = { id: 'p1', title: 'My Custom Preset', desc: 'd', isCustom: true as const, initialState: createBlankProject() };
    function Host({ busy = false, onClose }: { busy?: boolean; onClose: () => void }) {
        const [open, setOpen] = useState(true);
        return <NewProjectModal isOpen={open} customPresets={[customPreset]} busy={busy} error={null}
            onClose={() => { onClose(); setOpen(false); }} onSelectPreset={async () => undefined} onDeleteCustomPreset={async () => undefined} />;
    }

    it('back closes a pending delete confirmation first, then the dialog', () => {
        const onClose = vi.fn();
        const router = mountOnPhone(<Host onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Delete My Custom Preset' }));
        expect(screen.getByRole('alertdialog', { name: 'Delete Preset?' })).toBeTruthy();
        back(router);
        expect(screen.queryByRole('alertdialog', { name: 'Delete Preset?' })).toBeNull();
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Close new project' })).toBeTruthy();
        expect(depth(router)).toBe(1);
        back(router);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(depth(router)).toBe(0);
    });

    it('back is refused while a command is busy', () => {
        const onClose = vi.fn();
        const router = mountOnPhone(<Host busy onClose={onClose} />);
        back(router);
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Close new project' })).toBeTruthy();
        expect(depth(router)).toBe(1);
    });
});

describe('GeneratorVisualPreviewModal', () => {
    const template = (id: string, name: string): PageTemplate => ({ id, name, width: 500, height: 700, layers: [], elements: [] });
    const payload: GeneratorPreviewPayload = {
        project: {
            schemaVersion: 12, rootId: 'root', activeVariantId: 'primary',
            nodes: { root: { id: 'root', parentId: null, type: 'template-0', title: 'Cover page', data: {}, children: [] } },
            variants: { primary: { id: 'primary', name: 'Primary', templates: { 'template-0': template('template-0', 'Template 0') } } },
        },
        summary: { variantCount: 1, variantNames: ['Primary'], templateCount: 1, nodeCount: 1, estimatedPageCount: 1, warnings: [] },
        source: { formatVersion: 1, templateScript: 'return templates;', hierarchyScript: 'return hierarchy;' },
    } as GeneratorPreviewPayload;
    const mountPreview = (onCreateProject: () => Promise<boolean> = async () => true) => {
        const onBack = vi.fn();
        const router = mountOnPhone(<GeneratorVisualPreviewModal payload={payload} currentProjectName="Current" onBack={onBack}
            onReplace={() => true} onCreateProject={onCreateProject} />);
        return { router, onBack };
    };

    it('back closes the lightbox first, then the naming form, then the preview', () => {
        const { router, onBack } = mountPreview();
        expect(depth(router)).toBe(1);
        fireEvent.click(screen.getByRole('button', { name: 'Template 0, Primary, 1 use' }));
        expect(screen.getByRole('dialog', { name: 'Template 0 preview' })).toBeTruthy();
        back(router);
        expect(screen.queryByRole('dialog', { name: 'Template 0 preview' })).toBeNull();
        expect(onBack).not.toHaveBeenCalled();
        expect(depth(router)).toBe(1);

        fireEvent.click(screen.getByRole('button', { name: 'Create As New Project' }));
        expect(screen.getByRole('dialog', { name: 'Create Generated Project' })).toBeTruthy();
        back(router);
        expect(screen.queryByRole('dialog', { name: 'Create Generated Project' })).toBeNull();
        expect(onBack).not.toHaveBeenCalled();
        expect(depth(router)).toBe(1);

        back(router);
        expect(onBack).toHaveBeenCalledTimes(1);
        expect(depth(router)).toBe(0);
    });

    it('back is refused while a project is being created', () => {
        const { router, onBack } = mountPreview(never);
        fireEvent.click(screen.getByRole('button', { name: 'Create As New Project' }));
        const naming = screen.getByRole('dialog', { name: 'Create Generated Project' });
        fireEvent.click(within(naming).getByRole('button', { name: 'Create Project' }));
        expect(within(naming).getByRole('button', { name: 'Creating…' })).toBeTruthy();
        back(router);
        expect(screen.getByRole('dialog', { name: 'Create Generated Project' })).toBeTruthy();
        expect(onBack).not.toHaveBeenCalled();
        expect(depth(router)).toBe(1);
    });
});

describe('HierarchyGeneratorModal', () => {
    const saved: GeneratorProvenance = {
        formatVersion: 1,
        templateScript: 'return { page: { id: "page", name: "Saved Page", width: 509, height: 679, elements: [] } };',
        hierarchyScript: 'return { nodes: {}, rootId: "saved-root" };',
        generatedAt: '2026-07-14T10:00:00.000Z',
    };

    it('a cancelled "Discard draft generator changes?" keeps the dialog and its entry; agreeing closes it', () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const onClose = vi.fn();
        const router = mountOnPhone(<HierarchyGeneratorModal isOpen projectName="Current" savedGenerator={saved} onClose={onClose}
            onApplyGenerated={() => true} onCreateGeneratedProject={async () => true} />);
        expect(depth(router)).toBe(1);
        fireEvent.change(screen.getByLabelText('Template script'), { target: { value: 'draft edit' } });
        back(router);
        expect(confirm).toHaveBeenCalledWith('Discard draft generator changes?');
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Template script')).toHaveValue('draft edit');
        expect(depth(router)).toBe(1);
        expect(router.state.location.pathname).toBe('/app');
        confirm.mockReturnValue(true);
        back(router);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(depth(router)).toBe(0);
    });
});

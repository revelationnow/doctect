import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeActions } from '../helpers/touchActions';
import { TouchToolButtons } from '../../components/editor-layout/TouchToolButtons';
import { OverflowMenu } from '../../components/editor-layout/OverflowMenu';
import { PhoneTopBar } from '../../components/editor-layout/PhoneTopBar';
import { TabletToolbar } from '../../components/editor-layout/TabletToolbar';
import { ProjectSwitcher } from '../../components/editor-layout/ProjectSwitcher';
import { EditorChromeContext, EditorChrome } from '../../components/editor-layout/EditorChromeContext';

const chrome: EditorChrome = {
    projects: [{ id: 'a', name: 'Planner' }, { id: 'b', name: 'Notebook' }], activeProjectId: 'a',
    onSelectProject: vi.fn(), onCloseProject: vi.fn(), onNewProject: vi.fn(),
    saveStatus: <span>saved</span>, cloudMenu: <span>cloud-menu</span>, accountMenu: <span>account-menu</span>,
};

describe('TouchToolButtons', () => {
    it('offers select, hand, text, shapes and fit, and marks the active tool', () => {
        const actions = makeActions({ tool: 'text' });
        render(<TouchToolButtons actions={actions} showFit />);
        for (const name of ['Select', 'Pan', 'Text', 'Rectangle', 'Ellipse', 'Triangle', 'Line', 'Grid', 'Fit page to width']) {
            expect(screen.getByRole('button', { name })).toBeTruthy();
        }
        expect(screen.getByRole('button', { name: 'Text' }).getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
        expect(actions.setTool).toHaveBeenCalledWith('rect');
        fireEvent.click(screen.getByRole('button', { name: 'Fit page to width' }));
        expect(actions.fitToWidth).toHaveBeenCalled();
    });

    it('omits the fit button unless asked for it', () => {
        render(<TouchToolButtons actions={makeActions()} />);
        expect(screen.queryByRole('button', { name: 'Fit page to width' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Select' }).getAttribute('aria-pressed')).toBe('true');
    });
});

describe('OverflowMenu', () => {
    it('groups project actions and reaches cloud and account menus', () => {
        const actions = makeActions({ hasSelection: true });
        render(<OverflowMenu open onClose={vi.fn()} actions={actions} chrome={chrome} />);
        fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
        fireEvent.click(screen.getByRole('button', { name: 'Duplicate selection' }));
        fireEvent.click(screen.getByRole('button', { name: 'Generator' }));
        expect(actions.exportPdf).toHaveBeenCalled();
        expect(actions.duplicateSelection).toHaveBeenCalled();
        expect(actions.openGenerator).toHaveBeenCalled();
        expect(screen.getByText('cloud-menu')).toBeTruthy();
        expect(screen.getByText('account-menu')).toBeTruthy();
    });

    it('hides the selection group with nothing selected', () => {
        render(<OverflowMenu open onClose={vi.fn()} actions={makeActions()} chrome={null} />);
        expect(screen.queryByRole('button', { name: 'Duplicate selection' })).toBeNull();
    });

    it('renders nothing while closed', () => {
        render(<OverflowMenu open={false} onClose={vi.fn()} actions={makeActions()} chrome={chrome} />);
        expect(screen.queryByRole('dialog', { name: 'More actions' })).toBeNull();
        expect(screen.queryByText('cloud-menu')).toBeNull();
    });

    it('closes after a one-shot action, on backdrop tap and on Escape, but stays open for toggles', () => {
        const onClose = vi.fn();
        const actions = makeActions();
        render(<OverflowMenu open onClose={onClose} actions={actions} chrome={null} />);
        fireEvent.click(screen.getByRole('button', { name: 'Snap to grid' }));
        expect(actions.toggleSnap).toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
        expect(actions.openJson).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('overflow-menu-backdrop'));
        expect(onClose).toHaveBeenCalledTimes(2);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(3);
    });

    it('disables exports while exporting and reflects toggle state', () => {
        const actions = makeActions({ isExporting: true, canExportAllVariants: false, greyscale: true, showGrid: true });
        render(<OverflowMenu open onClose={vi.fn()} actions={actions} chrome={null} />);
        expect(screen.getByRole('button', { name: 'Export PDF' })).toHaveProperty('disabled', true);
        expect(screen.getByRole('button', { name: 'Export all variants' })).toHaveProperty('disabled', true);
        expect(screen.getByRole('button', { name: 'Greyscale export' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'Show grid' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'Snap to grid' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('offers the preview-node choice only when the actions provide one', () => {
        const onSelect = vi.fn();
        const { unmount } = render(<OverflowMenu open onClose={vi.fn()} actions={makeActions()} chrome={null} />);
        expect(screen.queryByRole('combobox', { name: 'Preview node' })).toBeNull();
        unmount();
        const preview = { options: [{ id: 'd1', title: 'Mon' }, { id: 'd2', title: 'Tue' }], selectedId: 'd1', onSelect };
        render(<OverflowMenu open onClose={vi.fn()} actions={makeActions({ preview })} chrome={null} />);
        const select = screen.getByRole('combobox', { name: 'Preview node' }) as HTMLSelectElement;
        expect(select.value).toBe('d1');
        fireEvent.change(select, { target: { value: 'd2' } });
        expect(onSelect).toHaveBeenCalledWith('d2');
    });
});

describe('ProjectSwitcher', () => {
    it('lists projects with close buttons and a new-project entry', () => {
        const local: EditorChrome = { ...chrome, onSelectProject: vi.fn(), onCloseProject: vi.fn(), onNewProject: vi.fn() };
        render(<ProjectSwitcher chrome={local} />);
        const trigger = screen.getByRole('button', { name: /Planner/ });
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByRole('menu')).toBeNull();
        fireEvent.click(trigger);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        fireEvent.click(screen.getByRole('button', { name: 'Close Notebook' }));
        expect(local.onCloseProject).toHaveBeenCalledWith('b');
        expect(screen.queryByRole('menu')).toBeNull();
        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('menuitem', { name: 'New project' }));
        expect(local.onNewProject).toHaveBeenCalled();
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('closes on outside tap and Escape without selecting anything', () => {
        const local: EditorChrome = { ...chrome, onSelectProject: vi.fn() };
        render(<div><p>canvas</p><ProjectSwitcher chrome={local} /></div>);
        const trigger = screen.getByRole('button', { name: /Planner/ });
        fireEvent.click(trigger);
        expect(screen.getByRole('menu')).toBeTruthy();
        fireEvent.pointerDown(screen.getByText('canvas'));
        expect(screen.queryByRole('menu')).toBeNull();
        fireEvent.click(trigger);
        fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Notebook' }));
        expect(screen.getByRole('menu')).toBeTruthy();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('menu')).toBeNull();
        expect(local.onSelectProject).not.toHaveBeenCalled();
    });

    it('falls back to Untitled when no project is active', () => {
        render(<ProjectSwitcher chrome={{ ...chrome, activeProjectId: null }} />);
        expect(screen.getByRole('button', { name: /Untitled/ })).toBeTruthy();
    });
});

describe('PhoneTopBar', () => {
    it('shows drawer, project switcher, save status, undo/redo and overflow', () => {
        const actions = makeActions();
        const onOpenSidebar = vi.fn();
        render(
            <EditorChromeContext.Provider value={chrome}>
                <PhoneTopBar actions={actions} onOpenSidebar={onOpenSidebar} />
            </EditorChromeContext.Provider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Open pages and templates' }));
        expect(onOpenSidebar).toHaveBeenCalled();
        expect(screen.getByText('saved')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Redo' })).toHaveProperty('disabled', true);
        fireEvent.click(screen.getByRole('button', { name: /Planner/ }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Notebook' }));
        expect(chrome.onSelectProject).toHaveBeenCalledWith('b');
        fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
        expect(screen.getByRole('button', { name: 'Export PDF' })).toBeTruthy();
    });

    it('calls undo and still renders without page chrome', () => {
        const actions = makeActions();
        render(<PhoneTopBar actions={actions} onOpenSidebar={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(actions.undo).toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: /Planner/ })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
        expect(screen.getByRole('dialog', { name: 'More actions' })).toBeTruthy();
        expect(screen.queryByText('cloud-menu')).toBeNull();
    });
});

describe('TabletToolbar', () => {
    it('collapses drawer, tools, undo/redo, Export PDF and overflow into one row', () => {
        const actions = makeActions({ tool: 'hand' });
        const onOpenSidebar = vi.fn();
        render(<TabletToolbar actions={actions} onOpenSidebar={onOpenSidebar} />);
        fireEvent.click(screen.getByRole('button', { name: 'Open pages and templates' }));
        expect(onOpenSidebar).toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Pan' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'Fit page to width' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
        expect(actions.exportPdf).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Redo' })).toHaveProperty('disabled', true);
        fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
        const dialog = screen.getByRole('dialog', { name: 'More actions' });
        expect(dialog).toBeTruthy();
        // Tablet keeps the desktop page header, so cloud and account are not duplicated here.
        expect(screen.queryByText('cloud-menu')).toBeNull();
        expect(screen.getAllByRole('button', { name: 'Export PDF' })).toHaveLength(2);
    });
});

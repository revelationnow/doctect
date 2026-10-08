import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeActions } from '../helpers/touchActions';
import { TouchToolButtons } from '../../components/editor-layout/TouchToolButtons';
import { OverflowMenu } from '../../components/editor-layout/OverflowMenu';
import { PhoneTopBar } from '../../components/editor-layout/PhoneTopBar';
import { TabletToolbar } from '../../components/editor-layout/TabletToolbar';
import { ProjectSwitcher } from '../../components/editor-layout/ProjectSwitcher';
import { EditorChromeContext, EditorChrome } from '../../components/editor-layout/EditorChromeContext';
import { useMenuListHost } from '../../components/editor-layout/MenuListContext';

const chrome: EditorChrome = {
    projects: [{ id: 'a', name: 'Planner' }, { id: 'b', name: 'Notebook' }], activeProjectId: 'a',
    onSelectProject: vi.fn(), onCloseProject: vi.fn(), onNewProject: vi.fn(),
    saveStatus: <span>saved</span>, cloudMenu: <span>cloud-menu</span>, accountMenu: <span>account-menu</span>,
};

// `chrome` and its vi.fn()s are shared across tests; clear call history so a `toHaveBeenCalledWith`
// in one test cannot be satisfied by an earlier one.
beforeEach(() => vi.clearAllMocks());

describe('TouchToolButtons', () => {
    it('offers select, select multiple, hand, text, shapes and fit, and marks the active tool', () => {
        const actions = makeActions({ tool: 'text' });
        render(<TouchToolButtons actions={actions} showFit />);
        for (const name of ['Select', 'Select multiple', 'Pan', 'Text', 'Rectangle', 'Ellipse', 'Triangle', 'Line', 'Grid', 'Fit page to width']) {
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

    it('shows Select multiple as a 44px pressed toggle beside Select', () => {
        const actions = makeActions({ multiSelect: true });
        render(<TouchToolButtons actions={actions} />);
        const toggle = screen.getByRole('button', { name: 'Select multiple' });
        expect(toggle.getAttribute('aria-pressed')).toBe('true');
        expect(toggle.className).toMatch(/\bh-11\b/);
        expect(toggle.className).toMatch(/\bw-11\b/);
        expect(toggle.previousElementSibling).toBe(screen.getByRole('button', { name: 'Select' }));
        fireEvent.click(toggle);
        expect(actions.toggleMultiSelect).toHaveBeenCalledTimes(1);
        expect(actions.setTool).not.toHaveBeenCalled();
    });

    it('renders the toggle unpressed while Select multiple is off', () => {
        render(<TouchToolButtons actions={makeActions({ multiSelect: false })} />);
        expect(screen.getByRole('button', { name: 'Select multiple' }).getAttribute('aria-pressed')).toBe('false');
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

    it('hosts the cloud and account slots as sheet rows whose completed actions close the sheet', () => {
        // CloudMenu / AccountMenu switch to their row rendering under this host (their own tests
        // cover the rows); here a probe stands in for them. Slots outside the sheet get no host.
        const Probe = ({ name }: { name: string }) => {
            const host = useMenuListHost();
            return <button type="button" onClick={() => host?.onDismiss()}>{host ? `${name} rows` : `${name} popover`}</button>;
        };
        const onClose = vi.fn();
        render(
            <>
                <Probe name="outside" />
                <OverflowMenu open onClose={onClose} actions={makeActions()}
                    chrome={{ ...chrome, cloudMenu: <Probe name="cloud" />, accountMenu: <Probe name="account" /> }} />
            </>,
        );
        expect(screen.getByRole('button', { name: 'outside popover' })).toBeTruthy();
        const dialog = screen.getByRole('dialog', { name: 'More actions' });
        expect(within(dialog).getByRole('heading', { name: 'Cloud' }).nextElementSibling).toBe(within(dialog).getByRole('button', { name: 'cloud rows' }));
        expect(within(dialog).getByRole('heading', { name: 'Account' }).nextElementSibling).toBe(within(dialog).getByRole('button', { name: 'account rows' }));
        fireEvent.click(within(dialog).getByRole('button', { name: 'cloud rows' }));
        expect(onClose).toHaveBeenCalledTimes(1);
        fireEvent.click(within(dialog).getByRole('button', { name: 'account rows' }));
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('dismisses through the latest onClose when the host closure changes after opening', () => {
        const Probe = () => { const host = useMenuListHost(); return <button type="button" onClick={() => host?.onDismiss()}>dismiss</button>; };
        const first = vi.fn();
        const second = vi.fn();
        const withProbe = { ...chrome, cloudMenu: <Probe /> };
        const { rerender } = render(<OverflowMenu open onClose={first} actions={makeActions()} chrome={withProbe} />);
        rerender(<OverflowMenu open onClose={second} actions={makeActions()} chrome={withProbe} />);
        fireEvent.click(screen.getByRole('button', { name: 'dismiss' }));
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('adds a final Navigate group of router links when the chrome provides page routes', () => {
        const onClose = vi.fn();
        const navigation = [{ label: 'Home', to: '/' }, { label: 'Gallery', to: '/gallery' }, { label: 'Docs', to: '/docs' }];
        render(
            <MemoryRouter>
                <OverflowMenu open onClose={onClose} actions={makeActions()} chrome={{ ...chrome, navigation }} />
            </MemoryRouter>,
        );
        const headings = screen.getAllByRole('heading').map(heading => heading.textContent);
        expect(headings[headings.length - 1]).toBe('Navigate');
        expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/');
        expect(screen.getByRole('link', { name: 'Gallery' }).getAttribute('href')).toBe('/gallery');
        expect(screen.getByRole('link', { name: 'Docs' }).getAttribute('href')).toBe('/docs');
        fireEvent.click(screen.getByRole('link', { name: 'Gallery' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('shows no Navigate group when the chrome has no page routes', () => {
        render(<OverflowMenu open onClose={vi.fn()} actions={makeActions()} chrome={chrome} />);
        expect(screen.queryByRole('heading', { name: 'Navigate' })).toBeNull();
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('hides the selection group with nothing selected', () => {
        render(<OverflowMenu open onClose={vi.fn()} actions={makeActions()} chrome={null} />);
        expect(screen.queryByRole('button', { name: 'Duplicate selection' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Clear selection' })).toBeNull();
    });

    it('offers Clear selection with the selection group, closing the sheet', () => {
        const onClose = vi.fn();
        const actions = makeActions({ hasSelection: true });
        render(<OverflowMenu open onClose={onClose} actions={actions} chrome={null} />);
        fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
        expect(actions.clearSelection).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('shows the Arrange group only once two or more elements are selected', () => {
        const { unmount } = render(<OverflowMenu open onClose={vi.fn()} actions={makeActions({ hasSelection: true, canAlign: false })} chrome={null} />);
        expect(screen.queryByRole('heading', { name: 'Arrange' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Align left' })).toBeNull();
        unmount();
        const onClose = vi.fn();
        const actions = makeActions({ hasSelection: true, canAlign: true });
        render(<OverflowMenu open onClose={onClose} actions={actions} chrome={null} />);
        expect(screen.getByRole('heading', { name: 'Arrange' })).toBeTruthy();
        const labels = ['Align left', 'Align center', 'Align right', 'Align top', 'Align middle', 'Align bottom', 'Distribute horizontally', 'Distribute vertically'];
        const types = ['left', 'center', 'right', 'top', 'middle', 'bottom', 'dist-h', 'dist-v'];
        labels.forEach((label, index) => {
            fireEvent.click(screen.getByRole('button', { name: label }));
            expect(actions.align).toHaveBeenLastCalledWith(types[index]);
        });
        expect(actions.align).toHaveBeenCalledTimes(8);
        expect(onClose).toHaveBeenCalledTimes(8); // one-shot actions close the sheet
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

    it('renders its overlay in a portal on document.body so bar stacking contexts cannot trap it', () => {
        render(<header><OverflowMenu open onClose={vi.fn()} actions={makeActions()} chrome={null} /></header>);
        const dialog = screen.getByRole('dialog', { name: 'More actions' });
        expect(dialog.closest('header')).toBeNull();
        expect(screen.getByTestId('overflow-menu-backdrop').closest('header')).toBeNull();
        expect(dialog.parentElement?.parentElement).toBe(document.body);
    });

    it('still closes on Escape when onClose changes identity after opening', () => {
        const first = vi.fn();
        const second = vi.fn();
        const { rerender } = render(<OverflowMenu open onClose={first} actions={makeActions()} chrome={null} />);
        rerender(<OverflowMenu open onClose={second} actions={makeActions()} chrome={null} />);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
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

    it('portals the menu to document.body, fixed just below the trigger', () => {
        render(<header><ProjectSwitcher chrome={chrome} /></header>);
        const trigger = screen.getByRole('button', { name: /Planner/ });
        vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
            top: 4, bottom: 40, left: 52, right: 160, width: 108, height: 36, x: 52, y: 4, toJSON: () => ({}),
        } as DOMRect);
        fireEvent.click(trigger);
        const menu = screen.getByRole('menu');
        expect(menu.closest('header')).toBeNull();
        expect(menu.parentElement).toBe(document.body);
        expect(menu.style.position).toBe('fixed');
        expect(menu.style.top).toBe('44px');
        expect(menu.style.left).toBe('52px');
    });

    it('keeps the menu inside the viewport when the trigger sits near the right edge', () => {
        render(<ProjectSwitcher chrome={chrome} />);
        const trigger = screen.getByRole('button', { name: /Planner/ });
        vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
            top: 4, bottom: 40, left: window.innerWidth - 20, right: window.innerWidth, width: 20, height: 36,
            x: window.innerWidth - 20, y: 4, toJSON: () => ({}),
        } as DOMRect);
        fireEvent.click(trigger);
        const menu = screen.getByRole('menu');
        expect(parseFloat(menu.style.left) + parseFloat(menu.style.width)).toBeLessThanOrEqual(window.innerWidth);
    });

    it('closes on window resize and on scroll so a stale position is never shown', () => {
        render(<ProjectSwitcher chrome={chrome} />);
        const trigger = screen.getByRole('button', { name: /Planner/ });
        fireEvent.click(trigger);
        expect(screen.getByRole('menu')).toBeTruthy();
        fireEvent(window, new Event('resize'));
        expect(screen.queryByRole('menu')).toBeNull();
        fireEvent.click(trigger);
        expect(screen.getByRole('menu')).toBeTruthy();
        fireEvent.scroll(document);
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('stays open while its own project list scrolls', () => {
        const many = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, name: `Project ${i}` }));
        render(<ProjectSwitcher chrome={{ ...chrome, projects: many, activeProjectId: 'p0' }} />);
        fireEvent.click(screen.getByRole('button', { name: /Project 0/ }));
        const menu = screen.getByRole('menu');
        expect(menu.className).toMatch(/overflow-y-auto/);
        fireEvent.scroll(menu);
        expect(screen.getByRole('menu')).toBeTruthy();
        fireEvent.scroll(document);
        expect(screen.queryByRole('menu')).toBeNull();
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

    it('moves focus into the sheet on open and back to the ⋯ trigger on every close path', () => {
        render(<PhoneTopBar actions={makeActions()} onOpenSidebar={vi.fn()} />);
        const more = screen.getByRole('button', { name: 'More actions' });
        more.focus();
        fireEvent.click(more);
        expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'More actions' }));
        fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
        expect(screen.queryByRole('dialog', { name: 'More actions' })).toBeNull();
        expect(document.activeElement).toBe(more);

        fireEvent.click(more);
        expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'More actions' }));
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(document.activeElement).toBe(more);

        fireEvent.click(more);
        fireEvent.click(screen.getByTestId('overflow-menu-backdrop'));
        expect(document.activeElement).toBe(more);
    });

    it('hands focus to a modal opened by an item instead of stealing it back to the trigger', () => {
        // Mirrors SavePresetModal / HierarchyGeneratorModal / NewProjectModal, which focus in a
        // useLayoutEffect on mount. The sheet's focus restore must run before that, not after it.
        function ModalLike() {
            const input = React.useRef<HTMLInputElement>(null);
            React.useLayoutEffect(() => { input.current?.focus(); }, []);
            return <div role="dialog" aria-label="Save preset"><input ref={input} aria-label="Preset title" /></div>;
        }
        function Harness() {
            const [modalOpen, setModalOpen] = React.useState(false);
            const actions = React.useMemo(() => makeActions({ savePreset: () => setModalOpen(true) }), []);
            return (
                <>
                    <PhoneTopBar actions={actions} onOpenSidebar={() => {}} />
                    {modalOpen && <ModalLike />}
                </>
            );
        }
        render(<Harness />);
        const more = screen.getByRole('button', { name: 'More actions' });
        more.focus();
        fireEvent.click(more);
        fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));
        expect(screen.queryByRole('dialog', { name: 'More actions' })).toBeNull();
        expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Preset title' }));
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
        expect(screen.queryByRole('heading', { name: 'Navigate' })).toBeNull();
        expect(screen.getAllByRole('button', { name: 'Export PDF' })).toHaveLength(2);
    });

    it('tags its row as the top bar so the quick format bar keeps clear of it', () => {
        const { container } = render(<TabletToolbar actions={makeActions()} onOpenSidebar={vi.fn()} />);
        expect(container.firstElementChild!.getAttribute('data-touch-chrome')).toBe('top-bar');
    });
});

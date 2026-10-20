import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeActions } from '../helpers/touchActions';
import { TouchToolButtons } from '../../components/editor-layout/TouchToolButtons';
import { OverflowMenu } from '../../components/editor-layout/OverflowMenu';
import { PhoneTopBar } from '../../components/editor-layout/PhoneTopBar';
import { TabletToolbar } from '../../components/editor-layout/TabletToolbar';
import { ProjectSwitcher } from '../../components/editor-layout/ProjectSwitcher';
import { EditorChromeContext, EditorChrome } from '../../components/editor-layout/EditorChromeContext';
import { FormFactorProvider } from '../../components/editor-layout/FormFactorContext';
import { BackDismissProvider, overlayDepthOf } from '../../components/editor-layout/useBackDismiss';
import { useMenuListHost } from '../../components/editor-layout/MenuListContext';
import { layOutEveryElement } from '../helpers/jsdomLayout';

// The sheet's Tab trap skips controls that are not rendered; jsdom renders nothing (see the helper).
layOutEveryElement();

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

    it('leaves out Select multiple when the actions offer no toggle (mouse input)', () => {
        render(<TouchToolButtons actions={makeActions({ toggleMultiSelect: undefined })} />);
        expect(screen.getByRole('button', { name: 'Select' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Select multiple' })).toBeNull();
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

    it('opens Export as template from the Export group and closes the sheet', () => {
        const actions = makeActions();
        const onClose = vi.fn();
        render(<OverflowMenu open onClose={onClose} actions={actions} chrome={chrome} />);
        const item = screen.getByRole('button', { name: 'Export as template…' });
        expect(item.previousElementSibling?.textContent).toContain('Export all variants');
        fireEvent.click(item);
        expect(actions.exportForDevice).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalled();
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

    // The sheet is aria-modal with a non-inert page behind it: Tab wraps within the sheet, from its
    // first row (Export PDF with nothing selected) to its last (the Navigate links), and the Cloud
    // and Account rows in between are part of the cycle. The hidden SVG file input is skipped.
    it('traps Tab inside the sheet, cloud and account rows and navigate links included', () => {
        const Row = ({ name }: { name: string }) => <button type="button" className="row">{name}</button>;
        const navigation = [{ label: 'Home', to: '/' }, { label: 'Docs', to: '/docs' }];
        render(
            <MemoryRouter>
                <button type="button">Outside</button>
                <OverflowMenu open onClose={vi.fn()} actions={makeActions()}
                    chrome={{ ...chrome, cloudMenu: <Row name="Save to cloud" />, accountMenu: <Row name="Sign out" />, navigation }} />
            </MemoryRouter>,
        );
        const dialog = screen.getByRole('dialog', { name: 'More actions' });
        const first = within(dialog).getByRole('button', { name: 'Export PDF' });
        const last = within(dialog).getByRole('link', { name: 'Docs' });
        expect(document.activeElement).toBe(dialog);
        expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false);
        expect(document.activeElement).toBe(first);
        expect(fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })).toBe(false);
        expect(document.activeElement).toBe(last);
        expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false);
        expect(document.activeElement).toBe(first);
        const cloudRow = within(dialog).getByRole('button', { name: 'Save to cloud' });
        cloudRow.focus();
        expect(fireEvent.keyDown(cloudRow, { key: 'Tab' })).toBe(true); // mid-sheet: the browser's move
        expect(document.activeElement).toBe(cloudRow);
    });

    it('leaves Tab to a modal a cloud row opened instead of fighting its trap', () => {
        // CloudMenu renders its modals itself, inside the sheet's DOM (the sheet stays open under
        // them), and each prevents Tab at its own edges. Rendered as the sheet's last content, the
        // modal's last button is also the sheet's last tabbable, so without deferring to the
        // modal's handling the sheet would wrap that Tab to its own first row (Export PDF).
        const Modal = () => (
            <div role="dialog" aria-label="Publish" onKeyDown={event => { if (event.key === 'Tab') event.preventDefault(); }}>
                <button type="button">Publish first</button>
                <button type="button">Publish last</button>
            </div>
        );
        render(
            <OverflowMenu open onClose={vi.fn()} actions={makeActions()}
                chrome={{ ...chrome, cloudMenu: <span />, accountMenu: <Modal /> }} />,
        );
        const dialog = screen.getByRole('dialog', { name: 'More actions' });
        const publishLast = screen.getByRole('button', { name: 'Publish last' });
        expect(within(dialog).getAllByRole('button').at(-1)).toBe(publishLast);
        publishLast.focus();
        expect(fireEvent.keyDown(publishLast, { key: 'Tab' })).toBe(false); // the modal prevented it
        expect(document.activeElement).toBe(publishLast);                     // the sheet did not wrap it
        // A key the modal leaves alone at the sheet's edge still wraps: the sheet's trap is live.
        const first = within(dialog).getByRole('button', { name: 'Export PDF' });
        first.focus();
        expect(fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })).toBe(false);
        expect(document.activeElement).toBe(publishLast);
    });

    it('leaves a Tab whose focus sits in a child portal outside the sheet to the browser', () => {
        // DOM-outside but React-inside: the keydown bubbles to the sheet's handler. A portalled
        // control is never the sheet's first or last tabbable, so this pins only that the key is
        // not swallowed; the containment guard's load-bearing case is in focusTrap.test.tsx.
        const Portalled = () => createPortal(<button type="button">Portalled</button>, document.body);
        render(<OverflowMenu open onClose={vi.fn()} actions={makeActions()} chrome={{ ...chrome, cloudMenu: <Portalled /> }} />);
        const portalled = screen.getByRole('button', { name: 'Portalled' });
        portalled.focus();
        expect(fireEvent.keyDown(portalled, { key: 'Tab' })).toBe(true);
        expect(document.activeElement).toBe(portalled);
    });
});

// A Navigate row leaves the editor from inside the open sheet: the route change unmounts the
// editor in the same render, so the provider cannot consume the sheet's history entry itself. The
// row's link replaces that entry instead of stacking on it, so one back from the destination lands
// on the bare editor (and the next back leaves it), with no entry for the provider to pop later.
describe('OverflowMenu Navigate rows and the sheet\'s history entry', () => {
    afterEach(() => { document.documentElement.removeAttribute('data-form-factor'); });
    const navigation = [{ label: 'Gallery', to: '/gallery' }];
    function Host() {
        const [menu, setMenu] = useState(false);
        return (
            <>
                <button type="button" onClick={() => setMenu(true)}>More actions</button>
                <OverflowMenu open={menu} onClose={() => setMenu(false)} actions={makeActions()} chrome={{ ...chrome, navigation }} />
            </>
        );
    }
    const mountOnPhone = () => {
        const router = createMemoryRouter([
            { path: '/app', element: <FormFactorProvider value="phone"><BackDismissProvider><Host /></BackDismissProvider></FormFactorProvider> },
            { path: '/gallery', element: <div>gallery route</div> },
            { path: '/', element: <div>home route</div> },
        ], { initialEntries: ['/', '/app'], initialIndex: 1 });
        render(<RouterProvider router={router} />);
        return router;
    };

    it('replaces the open sheet\'s entry with the destination, so back from there lands on the editor with nothing open', () => {
        const router = mountOnPhone();
        fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
        expect(overlayDepthOf(router.state.location)).toBe(1);
        fireEvent.click(screen.getByRole('link', { name: 'Gallery' }));
        expect(router.state.location.pathname).toBe('/gallery');
        expect(router.state.historyAction).toBe('REPLACE');
        act(() => { void router.navigate(-1); });
        expect(router.state.location.pathname).toBe('/app');
        expect(overlayDepthOf(router.state.location)).toBe(0);
        expect(screen.queryByRole('dialog', { name: 'More actions' })).toBeNull();
        act(() => { void router.navigate(-1); });
        expect(router.state.location.pathname).toBe('/');
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
        fireEvent.click(screen.getByRole('menuitem', { name: 'Close Notebook' }));
        expect(local.onCloseProject).toHaveBeenCalledWith('b');
        expect(screen.queryByRole('menu')).toBeNull();
        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('menuitem', { name: 'New project' }));
        expect(local.onNewProject).toHaveBeenCalled();
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('exposes every row of the menu as a menuitem, the per-project Close included', () => {
        render(<ProjectSwitcher chrome={chrome} />);
        fireEvent.click(screen.getByRole('button', { name: /Planner/ }));
        const menu = screen.getByRole('menu');
        expect(within(menu).getAllByRole('menuitem').map(item => item.getAttribute('aria-label') ?? item.textContent?.trim()))
            .toEqual(['Planner', 'Close Planner', 'Notebook', 'Close Notebook', 'New project']);
        expect(within(menu).queryAllByRole('button')).toEqual([]); // no row is a bare button among menuitems
        for (const wrapper of Array.from(menu.children)) {
            // Direct children of a menu are menuitems or transparent wrappers.
            expect(['menuitem', 'none']).toContain(wrapper.getAttribute('role'));
        }
    });

    // APG menu button: the menu is named by its trigger, opens with an item focused, the arrow
    // keys move through every item (project rows and their Close alike) and wrap, Home/End jump
    // to the ends, and closing hands focus back to the trigger.
    it('opens with its first item focused, named by the trigger, and moves through items with the arrow keys', () => {
        render(<ProjectSwitcher chrome={chrome} />);
        const trigger = screen.getByRole('button', { name: /Planner/ });
        fireEvent.click(trigger);
        const menu = screen.getByRole('menu', { name: 'Planner' });
        expect(menu.getAttribute('aria-labelledby')).toBe(trigger.id);
        const items = within(menu).getAllByRole('menuitem');
        expect(items).toHaveLength(5);
        expect(document.activeElement).toBe(items[0]);
        const press = (key: string) => fireEvent.keyDown(document.activeElement!, { key });
        expect(press('ArrowDown')).toBe(false);
        expect(document.activeElement).toBe(items[1]);
        press('End');
        expect(document.activeElement).toBe(items[4]);
        press('ArrowDown');
        expect(document.activeElement).toBe(items[0]); // wraps
        press('ArrowUp');
        expect(document.activeElement).toBe(items[4]);
        press('Home');
        expect(document.activeElement).toBe(items[0]);
        expect(press('Enter')).toBe(true); // not ours: activates the item as a click would
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('menu')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it('opens from the trigger with Down Arrow on the first item and Up Arrow on the last; Tab closes it', () => {
        render(<ProjectSwitcher chrome={chrome} />);
        const trigger = screen.getByRole('button', { name: /Planner/ });
        trigger.focus();
        expect(fireEvent.keyDown(trigger, { key: 'ArrowUp' })).toBe(false);
        let items = within(screen.getByRole('menu')).getAllByRole('menuitem');
        expect(document.activeElement).toBe(items[4]);
        // Tab is not prevented: once the menu is gone and the trigger has focus again, the
        // browser's own move carries focus on to the next control after the trigger.
        expect(fireEvent.keyDown(items[4], { key: 'Tab' })).toBe(true);
        expect(screen.queryByRole('menu')).toBeNull();
        expect(document.activeElement).toBe(trigger);
        expect(fireEvent.keyDown(trigger, { key: 'ArrowDown' })).toBe(false);
        items = within(screen.getByRole('menu')).getAllByRole('menuitem');
        expect(document.activeElement).toBe(items[0]);
        fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Notebook' }));
        expect(chrome.onSelectProject).toHaveBeenCalledWith('b');
        expect(document.activeElement).toBe(trigger); // a choice closes it: focus returns too
    });

    it('leaves focus where an outside tap put it when that closes the menu', () => {
        render(<div><button type="button">canvas</button><ProjectSwitcher chrome={chrome} /></div>);
        fireEvent.click(screen.getByRole('button', { name: /Planner/ }));
        expect(screen.getByRole('menu')).toBeTruthy();
        const canvas = screen.getByRole('button', { name: 'canvas' });
        canvas.focus();
        fireEvent.pointerDown(canvas);
        expect(screen.queryByRole('menu')).toBeNull();
        expect(document.activeElement).toBe(canvas);
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

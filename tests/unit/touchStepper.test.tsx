import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppNode, AppState, TemplateElement } from '../../types';

let canvasProps: any = null;
vi.mock('../../components/Canvas', () => ({ Canvas: (props: any) => { canvasProps = props; return <div data-testid="editor-canvas" />; } }));
vi.mock('../../components/Sidebar', () => ({ Sidebar: () => <div data-testid="sidebar" /> }));
vi.mock('../../components/LayersPanel', () => ({ LayersPanel: () => <div /> }));
vi.mock('../../components/JsonModal', () => ({ JsonModal: () => null }));
vi.mock('../../components/NodeSelectorModal', () => ({ NodeSelectorModal: () => null }));
vi.mock('../../components/DeleteConfirmModal', () => ({ DeleteConfirmModal: () => null }));
vi.mock('../../components/SavePresetModal', () => ({ SavePresetModal: () => null }));
vi.mock('../../components/NewVariantModal', () => ({ NewVariantModal: () => null }));
vi.mock('../../components/EditorToolbar', () => ({ EditorToolbar: () => <div data-mock="desktop-toolbar" /> }));
vi.mock('../../components/HierarchyGeneratorModal', () => ({ HierarchyGeneratorModal: () => null }));
vi.mock('../../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../../services/pdfService', () => ({ generatePDF: vi.fn(async () => {}) }));

import { PropertiesPanel, type IncrementalPropertyActions } from '../../components/PropertiesPanel';
import { ProjectEditor } from '../../components/ProjectEditor';
import { FormFactorProvider } from '../../components/editor-layout/FormFactorContext';
import { STEPPER_REPEAT_DELAY_MS, STEPPER_REPEAT_INTERVAL_MS } from '../../components/properties/TouchStepper';
import { editorState } from '../helpers/editorFixtures';
import { makeIncrementalProject } from '../helpers/incrementalFixtures';

type FormFactor = 'desktop' | 'tablet' | 'phone';

const activeNode: AppNode = { id: 'root', parentId: null, type: 'page', title: 'Root', data: {}, children: [] };

const rect = (id: string, overrides: Partial<TemplateElement> = {}): TemplateElement => ({
    id, type: 'rect', x: 10, y: 20, w: 50, h: 40, rotation: 0, fill: '#ffffff', stroke: '#000000',
    strokeWidth: 1, opacity: 1, zIndex: 0, ...overrides,
});

const text = (id: string, overrides: Partial<TemplateElement> = {}): TemplateElement => ({
    id, type: 'text', x: 5, y: 7, w: 100, h: 40, rotation: 0, fill: '', stroke: '', strokeWidth: 0,
    opacity: 1, text: id, fontSize: 14, fontFamily: 'helvetica', autoWidth: false,
    textPadding: { top: 2, right: 4, bottom: 6, left: 8 }, ...overrides,
});

const stateFor = (elements: TemplateElement[], selectedElementIds: string[]): AppState => ({
    nodes: { root: activeNode }, rootId: 'root', variants: {
        default: { id: 'default', name: 'Default', templates: {
            page: { id: 'page', name: 'Page', width: 500, height: 700, elements },
        } },
    },
    activeVariantId: 'default', viewMode: 'hierarchy', selectedNodeId: 'root',
    selectedNodeIds: ['root'], selectedTemplateId: '', selectedTemplateIds: [],
    selectedElementIds, scale: 1, tool: 'select', showJsonModal: false,
    sidebarWidth: 240, propertiesPanelWidth: 300, snapToGrid: false, showGrid: false,
    showNodeSelector: false, nodeSelectorMode: 'grid_source', editingElementId: null,
    clipboard: [], schemaVersion: 12,
});

const callbacks = () => ({
    onUpdateElements: vi.fn(), onUpdateNode: vi.fn(), onDeleteElements: vi.fn(),
    onOpenNodeSelector: vi.fn(), onUpdateTemplate: vi.fn(),
});

const incrementalActions = () => {
    const patchElements = vi.fn<IncrementalPropertyActions['patchElements']>();
    const actions: IncrementalPropertyActions = { contextEpoch: 0, patchElements, patchNodes: vi.fn(), setPanelExpanded: vi.fn(), panelsExpanded: {} };
    return { actions, patchElements };
};

const renderPanel = (formFactor: FormFactor, state: AppState, extra: Partial<React.ComponentProps<typeof PropertiesPanel>> = {}) => {
    const props = callbacks();
    const view = render(
        <FormFactorProvider value={formFactor}>
            <PropertiesPanel state={state} {...props} {...extra} />
        </FormFactorProvider>,
    );
    return { ...view, props };
};

const button = (name: string) => screen.getByRole('button', { name, hidden: true });
const tap = (name: string) => {
    const target = button(name);
    fireEvent.pointerDown(target);
    fireEvent.pointerUp(target);
};

/**
 * Holds the button for the initial delay plus `ticks` repeat intervals, then releases it. Each
 * tick is its own act, as each browser timer task is, so React commits between ticks.
 */
const hold = (name: string, ticks: number) => {
    const target = button(name);
    fireEvent.pointerDown(target);
    act(() => vi.advanceTimersByTime(STEPPER_REPEAT_DELAY_MS));
    for (let tick = 0; tick < ticks; tick++) act(() => vi.advanceTimersByTime(STEPPER_REPEAT_INTERVAL_MS));
    fireEvent.pointerUp(target);
};

// jsdom has no PointerEvent, and fireEvent.pointerDown's plain Event drops `button`, `buttons` and
// `isPrimary`: dispatch a MouseEvent under the pointer name, defining `isPrimary` when given.
const pointerDown = (target: Element, init: { button?: number; isPrimary?: boolean }) => {
    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: init.button ?? 0 });
    if (init.isPrimary !== undefined) Object.defineProperty(event, 'isPrimary', { value: init.isPrimary });
    return fireEvent(target, event);
};
// React derives onPointerLeave from the bubbling pointerout (as fireEvent.pointerLeave does).
const pointerLeave = (target: Element, init: { buttons: number }) =>
    fireEvent(target, new MouseEvent('pointerout', { bubbles: true, buttons: init.buttons }));

const GEOMETRY_FIELDS = ['X', 'Y', 'W', 'H', 'Rot', 'Z-Index'];

beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        font: '12px sans-serif', measureText: (value: string) => ({ width: value.length * 6 }),
    } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.documentElement.removeAttribute('data-form-factor');
    canvasProps = null;
});

describe('touch steppers on numeric property fields', () => {
    it.each(['phone', 'tablet'] as const)('%s renders 44px −/+ buttons around a 44px, 16px input instead of the micro-stepper', formFactor => {
        const { container } = renderPanel(formFactor, stateFor([rect('a')], ['a']));

        for (const field of GEOMETRY_FIELDS) {
            for (const name of [`Decrease ${field}`, `Increase ${field}`]) {
                const control = button(name);
                expect(control).toHaveAttribute('type', 'button');
                expect(control).toHaveClass('h-11', 'w-11', 'touch-none');
            }
        }
        const input = screen.getByLabelText('X');
        expect(input).toHaveAttribute('type', 'number');
        expect(input).toHaveValue(10);
        expect(input).toHaveClass('h-11', 'text-base');
        const row = button('Decrease X').parentElement!;
        expect(Array.from(row.children)).toEqual([button('Decrease X'), input, button('Increase X')]);
        // Every stepper field, the Z-Index row included, spans its grid so three targets fit at 320px.
        expect(row.parentElement).toHaveClass('col-span-full');
        expect(button('Decrease Z-Index').closest('.flex.items-end')).toHaveClass('col-span-full');
        expect(container.querySelector('[data-micro-stepper]')).toBeNull();
    });

    it('desktop keeps the hover micro-steppers and renders no touch buttons', () => {
        const { container } = renderPanel('desktop', stateFor([rect('a')], ['a']));

        expect(container.querySelectorAll('[data-micro-stepper]')).toHaveLength(GEOMETRY_FIELDS.length);
        expect(container.querySelector('[data-touch-stepper]')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Increase X' })).toBeNull();
        expect(screen.getByTitle('Bring Forward').parentElement!.parentElement).toHaveClass('col-span-2');
    });

    it('a tap nudges once, cancels pointerdown so the input is not focused, and does not repeat', () => {
        vi.useFakeTimers();
        const source = rect('a');
        const { props } = renderPanel('phone', stateFor([source], ['a']));
        const increase = button('Increase X');

        expect(fireEvent.pointerDown(increase)).toBe(false);
        fireEvent.pointerUp(increase);
        expect(document.activeElement).not.toBe(screen.getByLabelText('X'));
        expect(props.onUpdateElements).toHaveBeenCalledOnce();
        expect(props.onUpdateElements).toHaveBeenCalledWith([{ ...source, x: 11 }], true);

        act(() => vi.advanceTimersByTime(STEPPER_REPEAT_DELAY_MS + STEPPER_REPEAT_INTERVAL_MS * 4));
        expect(props.onUpdateElements).toHaveBeenCalledOnce();

        tap('Decrease Y');
        expect(props.onUpdateElements).toHaveBeenLastCalledWith([{ ...source, y: 19 }], true);
    });

    it('holding repeats at the desktop delay and rate until release, cancel or leave', () => {
        vi.useFakeTimers();
        const { props } = renderPanel('phone', stateFor([rect('a')], ['a']));
        const increase = button('Increase X');

        fireEvent.pointerDown(increase);
        expect(props.onUpdateElements).toHaveBeenCalledOnce();
        act(() => vi.advanceTimersByTime(STEPPER_REPEAT_DELAY_MS + STEPPER_REPEAT_INTERVAL_MS - 1));
        expect(props.onUpdateElements).toHaveBeenCalledOnce();
        act(() => vi.advanceTimersByTime(1));
        expect(props.onUpdateElements).toHaveBeenCalledTimes(2);
        act(() => vi.advanceTimersByTime(STEPPER_REPEAT_INTERVAL_MS * 2));
        expect(props.onUpdateElements).toHaveBeenCalledTimes(4);
        fireEvent.pointerUp(increase);
        act(() => vi.advanceTimersByTime(1000));
        expect(props.onUpdateElements).toHaveBeenCalledTimes(4);

        fireEvent.pointerDown(increase);
        fireEvent.pointerCancel(increase);
        act(() => vi.advanceTimersByTime(1000));
        expect(props.onUpdateElements).toHaveBeenCalledTimes(5);

        fireEvent.pointerDown(increase);
        pointerLeave(increase, { buttons: 1 });
        act(() => vi.advanceTimersByTime(1000));
        expect(props.onUpdateElements).toHaveBeenCalledTimes(6);

        // A touch lift's pointerleave (nothing down any more) also ends a hold that outlived pointerup.
        fireEvent.pointerDown(increase);
        pointerLeave(increase, { buttons: 0 });
        act(() => vi.advanceTimersByTime(1000));
        expect(props.onUpdateElements).toHaveBeenCalledTimes(7);
    });

    it('ignores a second finger and secondary mouse buttons, consumes the tap\'s click and nudges once on keyboard activation', () => {
        const { props } = renderPanel('phone', stateFor([rect('a')], ['a']));
        const increase = button('Increase X');

        pointerDown(increase, { isPrimary: false });
        pointerDown(increase, { button: 2 });
        expect(props.onUpdateElements).not.toHaveBeenCalled();

        // A touch tap: pointerdown, pointerup, the lift's pointerleave (a touch pointer cannot
        // hover), then the browser's click (Chromium gives it detail 0).
        pointerDown(increase, { isPrimary: true, button: 0 });
        fireEvent.pointerUp(increase);
        pointerLeave(increase, { buttons: 0 });
        fireEvent.click(increase, { detail: 0 });
        expect(props.onUpdateElements).toHaveBeenCalledOnce();

        // Keyboard or assistive-technology activation: a click with no press before it.
        fireEvent.click(increase, { detail: 0 });
        expect(props.onUpdateElements).toHaveBeenCalledTimes(2);

        // A press that slides off the button while down gets no click; the next click is a
        // fresh activation.
        fireEvent.pointerDown(increase);
        pointerLeave(increase, { buttons: 1 });
        expect(props.onUpdateElements).toHaveBeenCalledTimes(3);
        fireEvent.click(increase, { detail: 0 });
        expect(props.onUpdateElements).toHaveBeenCalledTimes(4);
    });

    it('stops a hold when the field unmounts', () => {
        vi.useFakeTimers();
        const { props, unmount } = renderPanel('phone', stateFor([rect('a')], ['a']));

        fireEvent.pointerDown(button('Increase X'));
        unmount();
        act(() => vi.advanceTimersByTime(1000));
        expect(props.onUpdateElements).toHaveBeenCalledOnce();
    });

    it('nudges a multi-selection relatively and keeps mixed values mixed', () => {
        const first = rect('a', { x: 10 });
        const second = rect('b', { x: 30 });
        const { props, rerender } = renderPanel('phone', stateFor([first, second], ['a', 'b']));
        const input = screen.getByLabelText('X');
        expect(input).toHaveValue(null);
        expect(input).toHaveAttribute('placeholder', 'Mixed');

        tap('Increase X');
        expect(props.onUpdateElements).toHaveBeenCalledOnce();
        const [moved] = props.onUpdateElements.mock.calls[0] as [TemplateElement[], boolean];
        expect(moved).toEqual([{ ...first, x: 11 }, { ...second, x: 31 }]);

        rerender(
            <FormFactorProvider value="phone">
                <PropertiesPanel state={stateFor(moved, ['a', 'b'])} {...props} />
            </FormFactorProvider>,
        );
        expect(screen.getByLabelText('X')).toHaveValue(null);
        tap('Decrease W');
        expect(props.onUpdateElements).toHaveBeenLastCalledWith([{ ...first, x: 11, w: 49 }, { ...second, x: 31, w: 49 }], true);
    });

    it('matches the desktop micro-stepper nudge for the pattern Gap and Weight steps', () => {
        const patterned = rect('a', { fillType: 'pattern', patternType: 'lines-h', patternSpacing: 12, patternWeight: 1 });
        const desktop = renderPanel('desktop', stateFor([patterned], ['a']));
        const steppers = desktop.container.querySelectorAll('[data-micro-stepper]');
        const weightUp = steppers[steppers.length - 1].querySelector('button')!;
        fireEvent.mouseDown(weightUp);
        fireEvent.mouseUp(weightUp);
        const gapUp = steppers[steppers.length - 2].querySelector('button')!;
        fireEvent.mouseDown(gapUp);
        fireEvent.mouseUp(gapUp);
        expect(desktop.props.onUpdateElements).toHaveBeenCalledTimes(2);
        cleanup();

        const touch = renderPanel('phone', stateFor([patterned], ['a']));
        tap('Increase Weight');
        tap('Increase Gap');
        expect(touch.props.onUpdateElements.mock.calls).toEqual(desktop.props.onUpdateElements.mock.calls);
        expect(touch.props.onUpdateElements).toHaveBeenLastCalledWith([{ ...patterned, patternSpacing: 13 }], true);
    });

    it('incremental panel path: every nudge is one saved relative patch of the whole selection', () => {
        vi.useFakeTimers();
        const first = rect('a', { x: 10 });
        const second = rect('b', { x: 30 });
        const { actions, patchElements } = incrementalActions();
        renderPanel('phone', stateFor([first, second], ['a', 'b']), { incrementalActions: actions });
        const patchOf = (call: Parameters<IncrementalPropertyActions['patchElements']>) => {
            const [, updates] = call;
            return typeof updates === 'function' ? updates : () => updates;
        };

        tap('Increase X');
        expect(patchElements).toHaveBeenCalledOnce();
        const [ids, , saveHistory] = patchElements.mock.calls[0];
        expect(ids).toEqual(['a', 'b']);
        expect(saveHistory).toBe(true);
        expect(patchOf(patchElements.mock.calls[0])(first)).toEqual({ x: 11 });
        expect(patchOf(patchElements.mock.calls[0])(second)).toEqual({ x: 31 });

        hold('Decrease Rot', 2);
        expect(patchElements).toHaveBeenCalledTimes(4);
        for (const call of patchElements.mock.calls.slice(1)) {
            expect(call[0]).toEqual(['a', 'b']);
            expect(call[2]).toBe(true);
            expect(patchOf(call)({ ...first, rotation: 5 })).toEqual({ rotation: 4 });
        }
    });
});

describe('touch steppers on text padding', () => {
    it('renders one full row per side with 44px −/+ and nudges through linked mode', () => {
        const source = text('one');
        const { props, container } = renderPanel('phone', stateFor([source], ['one']));

        for (const side of ['top', 'right', 'bottom', 'left']) {
            expect(button(`Decrease ${side} padding`)).toHaveClass('h-11', 'w-11');
            expect(button(`Increase ${side} padding`)).toHaveClass('h-11', 'w-11');
            const input = screen.getByLabelText(`Padding ${side}`);
            expect(input).toHaveClass('h-11', 'text-base');
            expect(button(`Decrease ${side} padding`).parentElement!.parentElement).toHaveClass('basis-full');
        }
        expect(screen.getByText('Bottom')).toBeTruthy();
        expect(screen.getByLabelText('Link padding sides').parentElement).toHaveClass('h-11', 'w-11');
        expect(container.querySelector('[data-micro-stepper]')).toBeNull();

        tap('Increase top padding');
        expect(props.onUpdateElements).toHaveBeenCalledOnce();
        expect(props.onUpdateElements).toHaveBeenCalledWith([{ ...source, textPadding: { top: 3, right: 3, bottom: 3, left: 3 } }], true);
    });

    it('holds repeat, respect unlinked sides and the zero floor, and stop with the selection set', () => {
        vi.useFakeTimers();
        const first = text('first', { textPadding: { top: 2, right: 0, bottom: 3, left: 4 } });
        const second = text('second', { textPadding: { top: 5, right: 0, bottom: 7, left: 8 } });
        const { props, rerender } = renderPanel('phone', stateFor([first, second], ['first', 'second']));
        fireEvent.click(screen.getByLabelText('Link padding sides'));

        hold('Increase top padding', 2);
        expect(props.onUpdateElements).toHaveBeenCalledTimes(3);
        expect(props.onUpdateElements).toHaveBeenLastCalledWith([
            { ...first, textPadding: { ...first.textPadding!, top: 3 } },
            { ...second, textPadding: { ...second.textPadding!, top: 3 } },
        ], true);

        tap('Decrease right padding');
        expect(props.onUpdateElements).toHaveBeenLastCalledWith([first, second], true);

        // The selection set changes under a held button (first element still shown): the hold stops.
        fireEvent.pointerDown(button('Increase bottom padding'));
        expect(props.onUpdateElements).toHaveBeenCalledTimes(5);
        rerender(
            <FormFactorProvider value="phone">
                <PropertiesPanel state={stateFor([first, second], ['first'])} {...props} />
            </FormFactorProvider>,
        );
        act(() => vi.advanceTimersByTime(1000));
        expect(props.onUpdateElements).toHaveBeenCalledTimes(5);
    });

    it('disables the buttons for auto-width text', () => {
        vi.useFakeTimers();
        const { props } = renderPanel('phone', stateFor([text('one', { autoWidth: true })], ['one']));

        const increase = button('Increase top padding');
        expect(increase).toBeDisabled();
        expect(button('Decrease left padding')).toBeDisabled();
        fireEvent.pointerDown(increase);
        fireEvent.click(increase, { detail: 0 });
        act(() => vi.advanceTimersByTime(1000));
        expect(props.onUpdateElements).not.toHaveBeenCalled();
    });
});

describe('touch steppers through the editors', () => {
    const legacyState = () => {
        const state = editorState();
        state.variants.default.templates.page.elements = [rect('r1', { x: 10, layerId: 'l1' }), rect('r2', { x: 30, layerId: 'l1' })];
        return { ...state, selectedElementIds: ['r1', 'r2'] };
    };
    const xs = () => (canvasProps.elements as TemplateElement[]).map(element => element.x);
    const undo = () => fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    it('legacy phone editor: one undo step per tap and per hold tick, applied to every selected element', () => {
        vi.useFakeTimers();
        render(
            <FormFactorProvider value="phone">
                <ProjectEditor projectId="p" projectName="Root" initialState={legacyState()} isActive
                    onNameChange={() => {}} onStateChange={() => {}}
                    onCreateGeneratedProject={async () => false} onSaveCustomPreset={async () => false} />
            </FormFactorProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Resize properties sheet' }));
        expect(screen.getByLabelText('X')).toHaveValue(null);

        tap('Increase X');
        expect(xs()).toEqual([11, 31]);
        hold('Increase X', 2);
        expect(xs()).toEqual([14, 34]);
        expect(screen.getByLabelText('X')).toHaveValue(null);

        undo();
        expect(xs()).toEqual([13, 33]);
        undo(); undo(); undo();
        expect(xs()).toEqual([10, 30]);
        expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    });

    it('incremental tablet editor: every tap and hold tick is a document edit and its own undo step', () => {
        vi.useFakeTimers();
        const project = makeIncrementalProject(1);
        const onDocumentEdit = vi.fn();
        render(
            <FormFactorProvider value="tablet">
                <ProjectEditor projectId={project.id} projectName={project.name} initialState={project.initialState} isActive
                    incremental={{ source: {}, editorGenerationFloor: 10, foldStructureGeneration: 4 }}
                    onDocumentEdit={onDocumentEdit} onPreferencesChange={() => {}}
                    onStateChange={() => { throw new Error('Full-state autosave reached the incremental editor.'); }}
                    onNameChange={() => {}} onCreateGeneratedProject={async () => true} onSaveCustomPreset={async () => true} />
            </FormFactorProvider>,
        );
        act(() => canvasProps.onSelectElements(['title']));
        fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
        fireEvent.click(screen.getByRole('button', { name: 'Duplicate selection' }));
        const [duplicateId] = canvasProps.selectedElementIds as string[];
        act(() => canvasProps.onSelectElements(['title', duplicateId]));
        const before = xs();
        expect(before).toHaveLength(2);
        const edits = onDocumentEdit.mock.calls.length;

        tap('Increase X');
        expect(xs()).toEqual(before.map(x => x + 1));
        expect(onDocumentEdit).toHaveBeenCalledTimes(edits + 1);
        hold('Decrease Y', 2);
        expect(onDocumentEdit).toHaveBeenCalledTimes(edits + 4);
        const ys = (canvasProps.elements as TemplateElement[]).map(element => element.y);

        undo();
        expect((canvasProps.elements as TemplateElement[]).map(element => element.y)).toEqual(ys.map(y => y + 1));
        undo(); undo();
        expect(xs()).toEqual(before.map(x => x + 1));
        undo();
        expect(xs()).toEqual(before);
    });
});

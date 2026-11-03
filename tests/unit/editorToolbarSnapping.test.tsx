import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { EditorToolbar } from '../../components/EditorToolbar';
import { AppState } from '../../types';

const state = {
    tool: 'select', selectedElementIds: [], selectedTemplateId: 'tpl1', activeVariantId: 'v1',
    variants: { v1: { id: 'v1', name: 'V', templates: {} } }, viewMode: 'templates', templatePreviewNodeId: null,
    selectedNodeId: 'root', nodes: {}, rootId: 'root', snapToGrid: false, showGrid: false, scale: 1,
} as unknown as AppState;
const renderToolbar = (overrides: Partial<AppState> = {}) => {
    const onPreferencesChange = vi.fn();
    const actions = { onToolChange: vi.fn(), onPreferencesChange, onAlign: vi.fn() } as any;
    render(<EditorToolbar state={{ ...state, ...overrides }} actions={actions} onImportSvg={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Snapping options'));
    return onPreferencesChange;
};

describe('Snapping popover', () => {
    it('shows the defaults for a project without stored values', () => {
        renderToolbar();
        expect(screen.getByRole('switch', { name: 'Smart guides' })).toBeChecked();
        expect(screen.getByLabelText('Grid size (pt)')).toHaveValue(10);
        expect(screen.getByText(/to move without snapping/)).toBeTruthy();
    });
    it('turning snap on also shows the grid', () => {
        const change = renderToolbar();
        fireEvent.click(screen.getByRole('switch', { name: 'Snap to grid' }));
        expect(change).toHaveBeenLastCalledWith({ snapToGrid: true, showGrid: true });
    });
    it('toggles smart guides', () => {
        const change = renderToolbar();
        fireEvent.click(screen.getByRole('switch', { name: 'Smart guides' }));
        expect(change).toHaveBeenLastCalledWith({ smartGuides: false });
    });
    it('commits a typed size on Enter, clamped, and reverts text that is not a number', () => {
        const change = renderToolbar();
        const input = screen.getByLabelText('Grid size (pt)');
        fireEvent.change(input, { target: { value: '450' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(change).toHaveBeenLastCalledWith({ gridSize: 200 });
        change.mockClear();
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.blur(input);
        expect(change).not.toHaveBeenCalled();
        expect(input).toHaveValue(10);
    });
    it('quick picks set the size', () => {
        const change = renderToolbar();
        fireEvent.click(screen.getByRole('button', { name: '20 pt' }));
        expect(change).toHaveBeenLastCalledWith({ gridSize: 20 });
    });
    it('closes on Escape and outside click', () => {
        renderToolbar();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'Snapping' })).toBeNull();
        fireEvent.click(screen.getByTitle('Snapping options'));
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('dialog', { name: 'Snapping' })).toBeNull();
    });
    it('reflects stored values and marks the matching quick pick', () => {
        renderToolbar({ snapToGrid: true, showGrid: true, gridSize: 20, smartGuides: false } as Partial<AppState>);
        expect(screen.getByRole('switch', { name: 'Snap to grid' })).toBeChecked();
        expect(screen.getByRole('switch', { name: 'Show grid' })).toBeChecked();
        expect(screen.getByRole('switch', { name: 'Smart guides' })).not.toBeChecked();
        expect(screen.getByLabelText('Grid size (pt)')).toHaveValue(20);
        expect(screen.getByRole('button', { name: '20 pt' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: '10 pt' })).toHaveAttribute('aria-pressed', 'false');
    });
    it('legacy setState path applies the patch to the editor state', () => {
        const setState = vi.fn();
        render(<EditorToolbar state={state} setState={setState} onImportSvg={vi.fn()} />);
        fireEvent.click(screen.getByTitle('Snapping options'));
        fireEvent.click(screen.getByRole('button', { name: '5 pt' }));
        fireEvent.click(screen.getByRole('switch', { name: 'Smart guides' }));
        const apply = (s: AppState) => setState.mock.calls.reduce((acc, [updater]) => updater(acc), s);
        expect(apply(state)).toMatchObject({ gridSize: 5, smartGuides: false, snapToGrid: false });
    });
});

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectEditor } from '../../components/ProjectEditor';
import { makeIncrementalProject } from '../helpers/incrementalFixtures';
import type { AppState } from '../../types';

beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        font: '12px sans-serif', measureText: (text: string) => ({ width: text.length * 6 }),
    } as CanvasRenderingContext2D);
});
afterEach(() => vi.restoreAllMocks());

// The legacy (non-incremental) editor's window keydown handler. The incremental editor's arrow nudge is
// covered in ProjectEditor.incrementalChanges.test.tsx; both share services/snapping/nudge.ts.
const renderLegacy = (mutate: (state: AppState) => void = () => {}) => {
    const project = makeIncrementalProject(1); mutate(project.initialState);
    const onStateChange = vi.fn();
    render(<ProjectEditor projectId={project.id} projectName={project.name} initialState={project.initialState} isActive={true}
        onStateChange={onStateChange} onNameChange={vi.fn()} onCreateGeneratedProject={vi.fn(async () => true)} onSaveCustomPreset={vi.fn(async () => true)} />);
    const title = () => (onStateChange.mock.calls.at(-1)![0] as AppState).variants.default.templates['page-0'].elements[0];
    return { onStateChange, title };
};
const selectTitle = () => { fireEvent.click(screen.getByTitle('Layers')); fireEvent.click(screen.getByTestId('element-row-title')); };

describe('legacy editor arrow nudge', () => {
    it('moves 1 pt, or 10 with Shift, when snap is off', () => {
        const h = renderLegacy(); selectTitle();
        fireEvent.keyDown(window, { key: 'ArrowRight' }); expect(h.title().x).toBe(13);
        fireEvent.keyDown(window, { key: 'ArrowUp', shiftKey: true }); expect(h.title().y).toBe(14);
    });
    it('moves to the next grid line, and ten grid steps with Shift, when snap is on', () => {
        const h = renderLegacy(); selectTitle(); fireEvent.click(screen.getByTitle('Snap to Grid'));
        fireEvent.keyDown(window, { key: 'ArrowRight' }); expect(h.title().x).toBe(20); // 12 → next line
        fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true }); expect(h.title().x).toBe(120); // on a line: ten full steps
        fireEvent.keyDown(window, { key: 'ArrowUp' }); expect(h.title().y).toBe(20); // 24 → previous line
        expect(screen.getByTitle('Undo (Ctrl+Z)')).not.toBeDisabled();
    });
    it('records no history entry when the selection resolves to no element', () => {
        const h = renderLegacy(state => { state.selectedElementIds = ['ghost']; });
        const reported = h.onStateChange.mock.calls.length;
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
        expect(h.onStateChange).toHaveBeenCalledTimes(reported);
    });
});

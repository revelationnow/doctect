import React from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTouchMultiSelect } from '../../components/editor-layout/useTouchMultiSelect';

let latest: ReturnType<typeof useTouchMultiSelect>;
const Harness = ({ tool, enabled = true, setTool = vi.fn() }: { tool: string; enabled?: boolean; setTool?: (tool: 'select') => void }) => {
    latest = useTouchMultiSelect({ tool, enabled, setTool });
    return null;
};

describe('useTouchMultiSelect', () => {
    it('starts off and toggles on and off without touching anything else', () => {
        const setTool = vi.fn();
        render(<Harness tool="select" setTool={setTool} />);
        expect(latest.multiSelect).toBe(false);
        act(() => latest.toggleMultiSelect());
        expect(latest.multiSelect).toBe(true);
        act(() => latest.toggleMultiSelect());
        expect(latest.multiSelect).toBe(false);
        expect(setTool).not.toHaveBeenCalled();
    });

    it('turns off when the tool leaves Select and stays off when it comes back', () => {
        const { rerender } = render(<Harness tool="select" />);
        act(() => latest.toggleMultiSelect());
        expect(latest.multiSelect).toBe(true);
        rerender(<Harness tool="rect" />);
        expect(latest.multiSelect).toBe(false);
        rerender(<Harness tool="select" />);
        expect(latest.multiSelect).toBe(false);
    });

    it('switches back to Select when turned on from another tool', () => {
        const setTool = vi.fn();
        const { rerender } = render(<Harness tool="hand" setTool={setTool} />);
        act(() => latest.toggleMultiSelect());
        expect(setTool).toHaveBeenCalledWith('select');
        rerender(<Harness tool="select" setTool={setTool} />);
        expect(latest.multiSelect).toBe(true);
    });

    it('is inert outside the touch form factors', () => {
        const setTool = vi.fn();
        render(<Harness tool="select" enabled={false} setTool={setTool} />);
        act(() => latest.toggleMultiSelect());
        expect(latest.multiSelect).toBe(false);
        expect(setTool).not.toHaveBeenCalled();
    });
});

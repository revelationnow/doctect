import React, { useState } from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTouchMultiSelect } from '../../components/editor-layout/useTouchMultiSelect';

let latest: ReturnType<typeof useTouchMultiSelect>;
const Harness = ({ tool, enabled = true, setTool = vi.fn() }: { tool: string; enabled?: boolean; setTool?: (tool: 'select') => void }) => {
    latest = useTouchMultiSelect({ tool, enabled, setTool });
    return null;
};
/** The editor's wiring: `setTool` really changes the tool the hook is rendered with. */
const StatefulHarness = ({ initialTool, onSetTool }: { initialTool: string; onSetTool: (tool: 'select') => void }) => {
    const [tool, setTool] = useState(initialTool);
    latest = useTouchMultiSelect({ tool, enabled: true, setTool: next => { onSetTool(next); setTool(next); } });
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

    it('switches back to Select when turned on from another tool, and is on once the tool has changed', () => {
        // The tool is state here, so the reset effect sees the switch the hook itself asked for
        // (with a static `tool` prop the effect would never re-run and the case would prove nothing).
        const setTool = vi.fn();
        render(<StatefulHarness initialTool="hand" onSetTool={setTool} />);
        act(() => latest.toggleMultiSelect());
        expect(setTool).toHaveBeenCalledWith('select');
        expect(latest.multiSelect).toBe(true);
        act(() => latest.toggleMultiSelect());
        expect(latest.multiSelect).toBe(false);
        expect(setTool).toHaveBeenCalledTimes(1);
    });

    it('is inert outside the touch form factors', () => {
        const setTool = vi.fn();
        render(<Harness tool="select" enabled={false} setTool={setTool} />);
        act(() => latest.toggleMultiSelect());
        expect(latest.multiSelect).toBe(false);
        expect(setTool).not.toHaveBeenCalled();
    });
});

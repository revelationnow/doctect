import { useEffect, useState } from 'react';

/**
 * The touch "Select multiple" toggle: session-only editor state that is never persisted. While it
 * is on, canvas taps, Layers rows and the long-press menu toggle elements in and out of the
 * selection instead of replacing it. It is a mode of the Select tool: switching to any other tool
 * turns it off, and turning it on from another tool switches back to Select. Turning it off never
 * touches the selection. Always off outside the touch form factors, which never render the toggle.
 */
export function useTouchMultiSelect({ tool, enabled, setTool }: {
    tool: string; enabled: boolean; setTool: (tool: 'select') => void;
}): { multiSelect: boolean; toggleMultiSelect: () => void } {
    const [on, setOn] = useState(false);
    useEffect(() => { if (tool !== 'select' || !enabled) setOn(false); }, [tool, enabled]);
    const multiSelect = enabled && on && tool === 'select';
    const toggleMultiSelect = () => {
        if (!enabled) return;
        if (multiSelect) { setOn(false); return; }
        if (tool !== 'select') setTool('select');
        setOn(true);
    };
    return { multiSelect, toggleMultiSelect };
}

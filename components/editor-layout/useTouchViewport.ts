import { useCallback, useState } from 'react';

export interface TouchViewport {
    /** Session-local canvas zoom for touch layouts; never written to AppState. */
    scale: number;
    setScale: (s: number) => void;
    /** Bumped by requestFit; Canvas refits the page width whenever it changes. Starts truthy so touch mounts fitted. */
    fitSignal: number;
    requestFit: () => void;
}

export function useTouchViewport(): TouchViewport {
    const [scale, setScale] = useState(1);
    const [fitSignal, setFitSignal] = useState(1);
    const requestFit = useCallback(() => setFitSignal(n => n + 1), []);
    return { scale, setScale, fitSignal, requestFit };
}

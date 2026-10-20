import type { AlignType } from '../../services/alignElements';

export interface PreviewNodeChoice { options: { id: string; title: string }[]; selectedId: string; onSelect: (id: string) => void; }
export interface TouchEditorActions {
    undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean;
    exportPdf: () => void; exportAllVariants: () => void; exportForDevice: () => void; canExportAllVariants: boolean; isExporting: boolean;
    greyscale: boolean; toggleGreyscale: () => void;
    openJson: () => void; openGenerator: () => void; savePreset: () => void;
    importSvg: (file: File) => void; insertSvgPlaceholder: () => void;
    snapToGrid: boolean; toggleSnap: () => void; showGrid: boolean; toggleGrid: () => void;
    tool: string; setTool: (tool: string) => void;
    fitToWidth: () => void;
    hasSelection: boolean; duplicateSelection: () => void; deleteSelection: () => void; clearSelection: () => void;
    /**
     * Session-only "Select multiple" mode: taps and Layers rows toggle elements in and out of the
     * selection. Touch input only: `toggleMultiSelect` is absent for a mouse in a narrow window,
     * which selects several with Ctrl/Cmd/Shift-click (the canvas reads the mode in its tap handlers only).
     */
    multiSelect: boolean; toggleMultiSelect?: () => void;
    /** Align/distribute (the desktop toolbar's handlers); `canAlign` once two or more elements are selected. */
    canAlign: boolean; align: (type: AlignType) => void;
    preview: PreviewNodeChoice | null;
}

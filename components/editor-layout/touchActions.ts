export interface PreviewNodeChoice { options: { id: string; title: string }[]; selectedId: string; onSelect: (id: string) => void; }
export interface TouchEditorActions {
    undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean;
    exportPdf: () => void; exportAllVariants: () => void; canExportAllVariants: boolean; isExporting: boolean;
    greyscale: boolean; toggleGreyscale: () => void;
    openJson: () => void; openGenerator: () => void; savePreset: () => void;
    importSvg: (file: File) => void; insertSvgPlaceholder: () => void;
    snapToGrid: boolean; toggleSnap: () => void; showGrid: boolean; toggleGrid: () => void;
    tool: string; setTool: (tool: string) => void;
    fitToWidth: () => void;
    hasSelection: boolean; duplicateSelection: () => void; deleteSelection: () => void;
    preview: PreviewNodeChoice | null;
}

import { vi } from 'vitest';
import type { TouchEditorActions } from '../../components/editor-layout/touchActions';

export const makeActions = (overrides: Partial<TouchEditorActions> = {}): TouchEditorActions => ({
    undo: vi.fn(), redo: vi.fn(), canUndo: true, canRedo: false,
    exportPdf: vi.fn(), exportAllVariants: vi.fn(), canExportAllVariants: true, isExporting: false,
    greyscale: false, toggleGreyscale: vi.fn(), openJson: vi.fn(), openGenerator: vi.fn(), savePreset: vi.fn(),
    importSvg: vi.fn(), insertSvgPlaceholder: vi.fn(), snapToGrid: false, toggleSnap: vi.fn(),
    showGrid: false, toggleGrid: vi.fn(), tool: 'select', setTool: vi.fn(), fitToWidth: vi.fn(),
    hasSelection: false, duplicateSelection: vi.fn(), deleteSelection: vi.fn(), clearSelection: vi.fn(),
    multiSelect: false, toggleMultiSelect: vi.fn(), canAlign: false, align: vi.fn(), preview: null,
    ...overrides,
});

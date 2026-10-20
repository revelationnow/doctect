import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePDF } from '../../services/pdfService';
import type { AppState, TemplateElement } from '../../types';

// The canvas draws a uniform border inside the element box (CSS border-box); a PDF stroke is
// centred on its path. So the PDF strokes rects, text boxes and ellipses half a stroke width
// inside the edge, and the border covers exactly the band the canvas shows. Triangles are
// stroked centred on their outline on both sides (an SVG stroke on the canvas).

const element = (overrides: Partial<TemplateElement>): TemplateElement => ({
    id: 'shape', type: 'rect', layerId: 'main', zIndex: 1,
    x: 40, y: 50, w: 100, h: 60, rotation: 0, opacity: 1,
    fill: '#eeeeee', stroke: '#ff0000', strokeWidth: 4,
    ...overrides,
} as TemplateElement);

const stateWith = (el: TemplateElement): AppState => ({
    schemaVersion: 12,
    nodes: { root: { id: 'root', parentId: null, type: 'page', title: 'Root', data: {}, children: [] } },
    rootId: 'root',
    variants: { default: { id: 'default', name: 'Default', templates: { page: {
        id: 'page', name: 'Page', width: 300, height: 300,
        layers: [{ id: 'main', name: 'Main', order: 0, visible: true, locked: false }],
        elements: [el],
    } } } },
    activeVariantId: 'default', viewMode: 'hierarchy', selectedNodeId: 'root', selectedNodeIds: ['root'],
    selectedTemplateId: 'page', selectedTemplateIds: ['page'], selectedElementIds: [],
    scale: 1, tool: 'select', showJsonModal: false, sidebarWidth: 288, propertiesPanelWidth: 320,
    snapToGrid: false, showGrid: false, showNodeSelector: false,
    nodeSelectorMode: 'grid_source', editingElementId: null, clipboard: [],
} as AppState);

// jsPDF attaches its shape methods to each instance, so a subclass records them as they are drawn.
const calls = vi.hoisted(() => ({} as Record<string, unknown[][]>));
vi.mock('jspdf', async importOriginal => {
    const actual = await importOriginal<typeof import('jspdf')>();
    class RecordingPDF extends actual.jsPDF {
        constructor(...args: ConstructorParameters<typeof actual.jsPDF>) {
            super(...args);
            for (const name of ['roundedRect', 'ellipse', 'triangle']) {
                const draw = (this as any)[name].bind(this);
                (this as any)[name] = (...drawArgs: unknown[]) => { (calls[name] ??= []).push(drawArgs); return draw(...drawArgs); };
            }
        }
    }
    return { ...actual, jsPDF: RecordingPDF, default: RecordingPDF };
});

const callsWith = (name: string, style: string) =>
    (calls[name] ?? []).filter(call => call[call.length - 1] === style);

beforeEach(() => { for (const name of Object.keys(calls)) delete calls[name]; });

describe('PDF uniform borders sit inside the element, as on the canvas', () => {
    it('insets a rect stroke by half its width and keeps the fill at the full box', async () => {
        await generatePDF(stateWith(element({ borderRadius: 10 })), { output: 'arraybuffer' });
        expect(callsWith('roundedRect', 'F')).toEqual([[40, 50, 100, 60, 10, 10, 'F']]);
        // Outer radius 10 (CSS border-radius) → the stroke's centre line curves at 10 − 2.
        expect(callsWith('roundedRect', 'D')).toEqual([[42, 52, 96, 56, 8, 8, 'D']]);
    });

    it('insets a text box border the same way', async () => {
        await generatePDF(stateWith(element({ type: 'text', text: '', fill: '' })), { output: 'arraybuffer' });
        expect(callsWith('roundedRect', 'D')).toEqual([[42, 52, 96, 56, 0, 0, 'D']]);
    });

    it('insets an ellipse stroke by half its width', async () => {
        await generatePDF(stateWith(element({ type: 'ellipse' })), { output: 'arraybuffer' });
        expect(callsWith('ellipse', 'F')).toEqual([[90, 80, 50, 30, 'F']]);
        expect(callsWith('ellipse', 'D')).toEqual([[90, 80, 48, 28, 'D']]);
    });

    it('insets the border of a pattern-filled rect, drawn over the pattern', async () => {
        await generatePDF(stateWith(element({
            fillType: 'pattern', patternType: 'grid', fill: '#000000', patternSpacing: 10, patternWeight: 1,
        })), { output: 'arraybuffer' });
        expect(callsWith('roundedRect', 'D')).toEqual([[42, 52, 96, 56, 0, 0, 'D']]);
    });

    it('never insets past the middle of a box thinner than its stroke', async () => {
        await generatePDF(stateWith(element({ w: 3, h: 60, strokeWidth: 8 })), { output: 'arraybuffer' });
        expect(callsWith('roundedRect', 'D')).toEqual([[41.5, 51.5, 0, 57, 0, 0, 'D']]);
    });

    it('keeps a triangle stroked on its outline', async () => {
        await generatePDF(stateWith(element({ type: 'triangle' })), { output: 'arraybuffer' });
        expect(callsWith('triangle', 'D')).toEqual([[90, 50, 40, 110, 140, 110, 'D']]);
    });
});

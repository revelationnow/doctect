import React, { useMemo, useRef, useState, useEffect } from 'react';
import { MousePointer2, Hand, Type, Square, Circle, Triangle, Minus, Grid3X3, Magnet, GripVertical, ZoomOut, ZoomIn, Wand2, Save, Eye, AlignLeft, AlignCenter, AlignRight, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignHorizontalSpaceAround, AlignVerticalSpaceAround, FileImage, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { AppState, AppNode } from '../types';
import type { EditorScalarPreferencePatch } from '../services/document/contracts';
import { alignSelectedElements, type AlignType } from '../services/alignElements';

export interface ToolbarActions {
    onToolChange(tool: AppState['tool']): void;
    onPreferencesChange(patch: EditorScalarPreferencePatch): void;
    onPreviewNodeChange(nodeId: string): void;
    onAlign(type: AlignType): void;
}

type EditorToolbarProps = ({ setState: React.Dispatch<React.SetStateAction<AppState>>; actions?: never }
    | { actions: ToolbarActions; setState?: never }) & {
    state: AppState;
    onOpenScriptGen?: () => void;
    onSavePreset?: () => void;
    onImportSvg?: (file: File) => void;
    onInsertSvgPlaceholder?: () => void;
}

const ToolButton: React.FC<{ active?: boolean, icon: any, onClick: () => void, title?: string }> = ({ active, icon: Icon, onClick, title }) => (
    <button onClick={onClick} title={title} className={clsx("p-1.5 rounded transition-all", active ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100")}>
        <Icon size={16} />
    </button>
);

export const EditorToolbar: React.FC<EditorToolbarProps> = ({ state, setState, actions, onOpenScriptGen, onSavePreset, onImportSvg, onInsertSvgPlaceholder }) => {
    const setTool = (tool: AppState['tool']) => actions ? actions.onToolChange(tool) : setState(s => ({ ...s, tool }));
    const preferences = (patch: EditorScalarPreferencePatch) => actions ? actions.onPreferencesChange(patch) : setState(s => ({ ...s, ...patch }));
    const svgInputRef = useRef<HTMLInputElement>(null);
    const [svgMenuOpen, setSvgMenuOpen] = useState(false);
    const svgMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onDocMouseDown = (e: MouseEvent) => {
            if (svgMenuRef.current && !svgMenuRef.current.contains(e.target as Node)) setSvgMenuOpen(false);
        };
        document.addEventListener('mousedown', onDocMouseDown);
        return () => document.removeEventListener('mousedown', onDocMouseDown);
    }, []);
    // Compute nodes that use the current template
    const nodesForCurrentTemplate = useMemo(() => {
        if (state.viewMode !== 'templates') return [];
        const templateId = state.selectedTemplateId;
        return (Object.values(state.nodes) as AppNode[]).filter(node => node.type === templateId);
    }, [state.viewMode, state.selectedTemplateId, state.nodes]);

    // Determine the effective preview node
    const effectivePreviewNodeId = useMemo(() => {
        if (state.viewMode !== 'templates') return state.selectedNodeId;
        if (state.templatePreviewNodeId) {
            const node = state.nodes[state.templatePreviewNodeId];
            if (node && node.type === state.selectedTemplateId) {
                return state.templatePreviewNodeId;
            }
        }
        if (nodesForCurrentTemplate.length > 0) {
            return nodesForCurrentTemplate[0].id;
        }
        return state.rootId;
    }, [state.viewMode, state.templatePreviewNodeId, state.selectedTemplateId, state.nodes, state.rootId, nodesForCurrentTemplate]);

    // Legacy path: the computation lives in services/alignElements so the touch Arrange menu runs
    // the very same handler (ProjectEditor's view model exposes it as `alignElements`).
    const handleAlign = (type: AlignType) => {
        if (actions) { actions.onAlign(type); return; }
        setState(s => alignSelectedElements(s, type));
    };

    return (
        <div className="min-h-[40px] py-1 bg-slate-50 border-b flex flex-wrap items-center justify-center gap-4 shadow-sm z-10 flex-shrink-0 px-4">
            <div className="flex bg-white border border-slate-200 p-0.5 rounded gap-0.5 shadow-sm">
                <ToolButton active={state.tool === 'select'} icon={MousePointer2} onClick={() => setTool('select')} title="Select Tool (V)" />
                <ToolButton active={state.tool === 'hand'} icon={Hand} onClick={() => setTool('hand')} title="Pan Tool (H)" />
                <div className="w-px bg-slate-200 mx-1"></div>
                <ToolButton active={state.tool === 'text'} icon={Type} onClick={() => setTool('text')} title="Text Box (T)" />
                <ToolButton active={state.tool === 'rect'} icon={Square} onClick={() => setTool('rect')} title="Rectangle (R)" />
                <ToolButton active={state.tool === 'ellipse'} icon={Circle} onClick={() => setTool('ellipse')} title="Circle/Ellipse (E)" />
                <ToolButton active={state.tool === 'triangle'} icon={Triangle} onClick={() => setTool('triangle')} title="Triangle (Y)" />
                <ToolButton active={state.tool === 'line'} icon={Minus} onClick={() => setTool('line')} title="Line (L)" />
                <ToolButton active={state.tool === 'grid'} icon={Grid3X3} onClick={() => setTool('grid')} title="Data Grid (G)" />
                {onImportSvg && (
                    <>
                        <div className="w-px bg-slate-200 mx-1"></div>
                        <div className="relative" ref={svgMenuRef}>
                            <button
                                onClick={() => setSvgMenuOpen(o => !o)}
                                title="SVG Tools"
                                className={clsx("p-1.5 rounded transition-all flex items-center gap-0.5", svgMenuOpen ? "bg-slate-100 text-slate-700" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100")}
                            >
                                <FileImage size={16} />
                                <ChevronDown size={10} />
                            </button>
                            {svgMenuOpen && (
                                <div className="absolute left-0 top-full mt-1 w-48 bg-white border border-slate-200 rounded shadow-lg py-1 z-30">
                                    <button
                                        onClick={() => { setSvgMenuOpen(false); svgInputRef.current?.click(); }}
                                        className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                                    >
                                        Import SVG file…
                                    </button>
                                    {onInsertSvgPlaceholder && (
                                        <button
                                            onClick={() => { setSvgMenuOpen(false); onInsertSvgPlaceholder(); }}
                                            className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                                        >
                                            Insert placeholder SVG
                                        </button>
                                    )}
                                </div>
                            )}
                            <input
                                ref={svgInputRef}
                                type="file"
                                accept=".svg"
                                className="hidden"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                        onImportSvg(file);
                                        e.target.value = ''; // Reset so same file can be re-imported
                                    }
                                }}
                            />
                        </div>
                    </>
                )}
            </div>

            {/* Alignment Tools - Only visible when multiple items selected */}
            {state.selectedElementIds.length > 1 && (
                <>
                    <div className="h-6 w-px bg-slate-300 mx-1"></div>
                    <div className="flex bg-white border border-slate-200 p-0.5 rounded gap-0.5 shadow-sm">
                        <ToolButton icon={AlignLeft} onClick={() => handleAlign('left')} title="Align Left" />
                        <ToolButton icon={AlignCenter} onClick={() => handleAlign('center')} title="Align Center (Horizontal)" />
                        <ToolButton icon={AlignRight} onClick={() => handleAlign('right')} title="Align Right" />
                        <div className="w-px bg-slate-200 mx-0.5"></div>
                        <ToolButton icon={AlignVerticalJustifyStart} onClick={() => handleAlign('top')} title="Align Top" />
                        <ToolButton icon={AlignVerticalJustifyCenter} onClick={() => handleAlign('middle')} title="Align Middle (Vertical)" />
                        <ToolButton icon={AlignVerticalJustifyEnd} onClick={() => handleAlign('bottom')} title="Align Bottom" />
                        <div className="w-px bg-slate-200 mx-0.5"></div>
                        <ToolButton icon={AlignHorizontalSpaceAround} onClick={() => handleAlign('dist-h')} title="Distribute Horizontally" />
                        <ToolButton icon={AlignVerticalSpaceAround} onClick={() => handleAlign('dist-v')} title="Distribute Vertically" />
                    </div>
                </>
            )}

            <div className="h-6 w-px bg-slate-300 mx-1"></div>
            <div className="flex bg-white border border-slate-200 p-0.5 rounded gap-0.5 shadow-sm">
                <ToolButton active={state.snapToGrid} icon={Magnet} onClick={() => actions ? preferences({ snapToGrid: !state.snapToGrid, showGrid: !state.snapToGrid ? true : state.showGrid }) : setState(s => ({ ...s, snapToGrid: !s.snapToGrid, showGrid: !s.snapToGrid ? true : s.showGrid }))} title="Snap to Grid" />
                <ToolButton active={state.showGrid} icon={GripVertical} onClick={() => actions ? preferences({ showGrid: !state.showGrid }) : setState(s => ({ ...s, showGrid: !s.showGrid }))} title="Show Grid" />
            </div>
            <div className="h-6 w-px bg-slate-300 mx-1"></div>
            <div className="flex items-center gap-1">
                <button className="p-1 hover:bg-white rounded text-slate-600" onClick={() => actions ? preferences({ scale: Math.max(0.2, state.scale - 0.1) }) : setState(s => ({ ...s, scale: Math.max(0.2, s.scale - 0.1) }))}><ZoomOut size={16} /></button>
                <span className="text-xs font-mono text-slate-500 w-10 text-center">{Math.round(state.scale * 100)}%</span>
                <button className="p-1 hover:bg-white rounded text-slate-600" onClick={() => actions ? preferences({ scale: Math.min(10, state.scale + 0.1) }) : setState(s => ({ ...s, scale: Math.min(10, s.scale + 0.1) }))}><ZoomIn size={16} /></button>
            </div>

            {/* Template Preview Node Selector - only visible in template mode */}
            {state.viewMode === 'templates' && (
                <>
                    <div className="h-6 w-px bg-slate-300 mx-1"></div>
                    <div className="flex items-center gap-2 bg-white border border-slate-200 px-2 py-1 rounded shadow-sm">
                        <Eye size={14} className="text-slate-400" />
                        <span className="text-xs text-slate-500 hidden sm:inline">Preview:</span>
                        <select
                            className="text-xs border-0 bg-transparent text-slate-700 font-medium focus:outline-none max-w-[150px] truncate"
                            value={effectivePreviewNodeId}
                            onChange={(e) => actions ? actions.onPreviewNodeChange(e.target.value) : setState(s => ({ ...s, templatePreviewNodeId: e.target.value }))}
                        >
                            {nodesForCurrentTemplate.length > 0 ? (
                                nodesForCurrentTemplate.map(node => (
                                    <option key={node.id} value={node.id}>
                                        {node.title || node.id}
                                    </option>
                                ))
                            ) : (
                                <option value={state.rootId}>No nodes use this template</option>
                            )}
                        </select>
                    </div>
                </>
            )}

            {(onOpenScriptGen || onSavePreset) && (
                <>
                    <div className="h-6 w-px bg-slate-300 mx-1"></div>
                    <div className="flex gap-2">
                        {onOpenScriptGen && (
                            <button
                                onClick={onOpenScriptGen}
                                className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded transition-colors"
                                title="Generate Hierarchy via Script"
                            >
                                <Wand2 size={14} />
                                <span className="hidden lg:inline">Generator</span>
                            </button>
                        )}
                        {onSavePreset && (
                            <button
                                onClick={onSavePreset}
                                className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded transition-colors"
                                title="Save current project as a reusable preset"
                            >
                                <Save size={14} />
                                <span className="hidden lg:inline">Save Preset</span>
                            </button>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

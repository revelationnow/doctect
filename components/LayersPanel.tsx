import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import {
    ChevronDown, ChevronRight, Circle, Eye, EyeOff, Grid3X3, GripVertical, Image as ImageIcon,
    Layers, Lock, Minus, Plus, Search, Square, Trash2, Triangle, Type, Unlock,
} from 'lucide-react';
import { Layer, PageTemplate, TemplateElement } from '../types';
import { addLayer, getElementLabel, moveElementsToLayer, moveLayerToIndex, removeLayerFromTemplate } from '../services/layers';
import type { LayerEditAction } from '../services/document/editOperations';

export interface LayerPanelActions {
    readonly sequence?: readonly Layer[];
    moveElements(ids: readonly string[], position: number): void;
    setCollapsed(position: number, value: boolean): void;
    edit(action: LayerEditAction): void;
}

const LAYER_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', ''];

const TYPE_ICONS: Record<string, React.FC<any>> = {
    rect: Square, ellipse: Circle, triangle: Triangle, text: Type, grid: Grid3X3, line: Minus, svg: ImageIcon,
};

interface LayersPanelProps {
    template: PageTemplate;
    selectedElementIds: string[];
    activeLayerId?: string;
    onUpdateTemplate: (updates: Partial<PageTemplate>) => void;
    onUpdateElements: (elements: TemplateElement[], saveHistory?: boolean) => void;
    onSelectElements: (ids: string[]) => void;
    onSetActiveLayer: (layerId: string) => void;
    layerActions?: LayerPanelActions;
}

export const LayersPanel: React.FC<LayersPanelProps> = ({
    template, selectedElementIds, activeLayerId,
    onUpdateTemplate, onUpdateElements, onSelectElements, onSetActiveLayer, layerActions,
}) => {
    const layers = (template.layers ?? []).flatMap((layer, position) =>
        layerActions && (!layer || typeof layer !== 'object' || Array.isArray(layer)) ? [] : [{ ...layer, position }])
        .sort((a, b) => b.order - a.order); // frontmost first; retain original occurrence positions
    const rowKey = (layer: Layer & { position: number }) => layerActions ? String(layer.position) : layer.id;
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [colorPickerId, setColorPickerId] = useState<string | null>(null);
    const [dragLayerId, setDragLayerId] = useState<string | null>(null);
    const [filter, setFilter] = useState('');
    const [dragElementId, setDragElementId] = useState<string | null>(null);

    // Dismiss the color popover when a mousedown lands outside it (or its chip).
    useEffect(() => {
        if (!colorPickerId) return;
        const onWindowMouseDown = (e: MouseEvent) => {
            if (!(e.target as HTMLElement)?.closest?.('[data-color-popover]')) setColorPickerId(null);
        };
        window.addEventListener('mousedown', onWindowMouseDown);
        return () => window.removeEventListener('mousedown', onWindowMouseDown);
    }, [colorPickerId]);

    const rowAnchorRef = React.useRef<string | null>(null);
    React.useLayoutEffect(() => {
        if (!layerActions) return;
        setRenamingId(null); setRenameValue(''); setColorPickerId(null);
        setDragLayerId(null); setDragElementId(null); rowAnchorRef.current = null;
    }, [layerActions?.sequence]);

    const updateLayer = (id: string, updates: Partial<Layer>) => {
        if (layerActions) {
            const position = Number(id);
            if (Object.hasOwn(updates, 'collapsed')) layerActions.setCollapsed(position, updates.collapsed!);
            else layerActions.edit({ type: 'update', position, patch: updates });
            return;
        }
        onUpdateTemplate({ layers: (template.layers ?? []).map(l => (l.id === id ? { ...l, ...updates } : l)) });
    };

    // Visible element rows of a layer, in display order (zIndex desc, filter applied).
    const visibleElementsOf = (layer: Layer) => template.elements
        .filter(el => el.layerId === layer.id)
        .filter(el => {
            if (!filter.trim()) return true;
            const q = filter.trim().toLowerCase();
            return getElementLabel(el).toLowerCase().includes(q) || el.type.includes(q);
        })
        .sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));

    // Element-row click: plain = single select (sets range anchor); ctrl/cmd = toggle;
    // shift = display-order range from the anchor.
    const handleRowClick = (e: React.MouseEvent, id: string) => {
        if (e.ctrlKey || e.metaKey) {
            rowAnchorRef.current = id;
            onSelectElements(selectedElementIds.includes(id)
                ? selectedElementIds.filter(x => x !== id)
                : [...selectedElementIds, id]);
            return;
        }
        if (e.shiftKey && rowAnchorRef.current && rowAnchorRef.current !== id) {
            const flatIds = layers.flatMap(l => (l.collapsed ? [] : visibleElementsOf(l).map(el => el.id)));
            const a = flatIds.indexOf(rowAnchorRef.current);
            const b = flatIds.indexOf(id);
            if (a !== -1 && b !== -1) {
                onSelectElements(flatIds.slice(Math.min(a, b), Math.max(a, b) + 1));
                return;
            }
        }
        rowAnchorRef.current = id;
        onSelectElements([id]);
    };

    const commitRename = () => {
        if (renamingId && renameValue.trim()) updateLayer(renamingId, { name: renameValue.trim() });
        setRenamingId(null);
    };

    const handleAdd = () => {
        if (layerActions) { layerActions.edit({ type: 'add' }); return; }
        const { layers: next, newLayer } = addLayer(template.layers ?? []);
        onUpdateTemplate({ layers: next });
        onSetActiveLayer(newLayer.id);
    };

    const handleDelete = (id: string) => {
        if (layerActions) { layerActions.edit({ type: 'delete', position: Number(id) }); return; }
        const next = removeLayerFromTemplate(template, id);
        if (next === template) return;
        onUpdateTemplate({ layers: next.layers });
        onUpdateElements(next.elements, true);
    };

    const handleDropOnLayer = (targetId: string) => {
        if (!dragLayerId || dragLayerId === targetId) { setDragLayerId(null); return; }
        if (layerActions) {
            layerActions.edit({ type: 'move', position: Number(dragLayerId), targetPosition: Number(targetId) });
            setDragLayerId(null); return;
        }
        const asc = [...(template.layers ?? [])].sort((a, b) => a.order - b.order);
        const targetIndex = asc.findIndex(l => l.id === targetId);
        onUpdateTemplate({ layers: moveLayerToIndex(template.layers ?? [], dragLayerId, targetIndex) });
        setDragLayerId(null);
    };

    return (
        <div data-testid="layers-panel" className="border-b border-slate-200 bg-white flex flex-col max-h-[45%] overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 uppercase tracking-wide">
                    <Layers size={13} /> Layers
                </div>
                <button title="Add layer" onClick={handleAdd}
                    className="p-1 rounded text-slate-500 hover:text-slate-700 hover:bg-slate-100">
                    <Plus size={14} />
                </button>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-100">
                <div className="flex items-center gap-1 flex-1 min-w-0 bg-slate-50 rounded px-1.5">
                    <Search size={11} className="text-slate-400 flex-shrink-0" />
                    <input value={filter} onChange={e => setFilter(e.target.value)}
                        placeholder="Filter elements…"
                        className="w-full bg-transparent py-1 text-xs outline-none" />
                </div>
                {selectedElementIds.length > 0 && (
                    <select data-testid="move-selection-select" value=""
                        title="Move selection to layer"
                        className="text-xs border border-slate-200 rounded py-1 max-w-[110px]"
                        onChange={e => {
                            if (!e.target.value) return;
                            if (layerActions) {
                                const target = layers.find(layer => layer.id === e.target.value);
                                if (target) layerActions.moveElements(selectedElementIds, target.position);
                            } else onUpdateElements(moveElementsToLayer(template.elements, selectedElementIds, e.target.value), true);
                        }}>
                        <option value="">Move to…</option>
                        {layers.filter(l => !layerActions || typeof l.id === 'string').map(l => <option key={rowKey(l)} value={l.id}>{l.name}</option>)}
                    </select>
                )}
            </div>
            <div className="overflow-y-auto">
                {layers.map(layer => (
                    <React.Fragment key={rowKey(layer)}>
                    <div data-testid={`layer-row-${layer.id}`} data-layer-position={layer.position}
                        draggable
                        onDragStart={() => setDragLayerId(rowKey(layer))}
                        onDragEnd={() => { setDragElementId(null); setDragLayerId(null); }}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => {
                            // Only retag when an element drag was actually in progress (no layer
                            // reorder underway) — an aborted element drag must not hijack a reorder.
                            if (dragElementId && !dragLayerId) {
                                if (layerActions) layerActions.moveElements([dragElementId], layer.position);
                                else onUpdateElements(moveElementsToLayer(template.elements, [dragElementId], layer.id), true);
                                setDragElementId(null);
                            } else {
                                handleDropOnLayer(rowKey(layer));
                            }
                        }}
                        className={clsx('group flex items-center gap-1 px-2 py-1.5 border-b border-slate-50 text-sm',
                            activeLayerId === layer.id ? 'bg-blue-50' : 'hover:bg-slate-50')}>
                        <span title="Reorder layer" className="cursor-grab text-slate-300 group-hover:text-slate-400">
                            <GripVertical size={12} />
                        </span>
                        <button title="Collapse layer" className="text-slate-400"
                            onClick={() => updateLayer(rowKey(layer), { collapsed: !layer.collapsed })}>
                            {layer.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                        </button>
                        <button title="Toggle visibility" className="text-slate-500"
                            onClick={() => updateLayer(rowKey(layer), { visible: !layer.visible })}>
                            {layer.visible ? <Eye size={13} /> : <EyeOff size={13} className="text-slate-300" />}
                        </button>
                        <button title="Toggle lock" className="text-slate-500"
                            onClick={() => updateLayer(rowKey(layer), { locked: !layer.locked })}>
                            {layer.locked ? <Lock size={13} /> : <Unlock size={13} className="text-slate-300" />}
                        </button>
                        <span className="relative" data-color-popover>
                            <button title="Layer color"
                                className="w-3 h-3 rounded-full border border-slate-300"
                                style={{ backgroundColor: layer.color || 'transparent' }}
                                onClick={() => setColorPickerId(colorPickerId === rowKey(layer) ? null : rowKey(layer))} />
                            {colorPickerId === rowKey(layer) && (
                                <span className="absolute left-0 top-4 z-40 flex gap-1 bg-white border border-slate-200 rounded p-1 shadow">
                                    {LAYER_COLORS.map(c => (
                                        <button key={c || 'none'} data-testid={`layer-color-swatch-${c || 'none'}`}
                                            className="w-3.5 h-3.5 rounded-full border border-slate-300"
                                            style={{ backgroundColor: c || 'transparent' }}
                                            onClick={() => { updateLayer(rowKey(layer), { color: c || undefined }); setColorPickerId(null); }} />
                                    ))}
                                </span>
                            )}
                        </span>
                        {renamingId === rowKey(layer) ? (
                            <input autoFocus value={renameValue}
                                className="flex-1 min-w-0 px-1 py-0.5 text-sm border border-blue-300 rounded"
                                onChange={e => setRenameValue(e.target.value)}
                                onBlur={commitRename}
                                onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }} />
                        ) : (
                            <span data-testid="layer-name"
                                className={clsx('flex-1 min-w-0 truncate cursor-default', !layer.visible && 'text-slate-400')}
                                onClick={() => { if (!layerActions || typeof layer.id === 'string') onSetActiveLayer(layer.id); }}
                                onDoubleClick={() => { setRenamingId(rowKey(layer)); setRenameValue(layer.name); }}>
                                {layer.name}
                            </span>
                        )}
                        <button title="Delete layer" disabled={(template.layers ?? []).length <= 1}
                            className="p-0.5 text-slate-300 hover:text-red-500 disabled:opacity-30 disabled:hover:text-slate-300"
                            onClick={() => handleDelete(rowKey(layer))}>
                            <Trash2 size={12} />
                        </button>
                    </div>
                    {!layer.collapsed && visibleElementsOf(layer)
                        .map(el => {
                            const Icon = TYPE_ICONS[el.type] || Square;
                            const isSelected = selectedElementIds.includes(el.id);
                            return (
                                <div key={el.id} data-testid={`element-row-${el.id}`}
                                    aria-selected={isSelected}
                                    draggable
                                    onDragStart={e => { e.stopPropagation(); setDragElementId(el.id); }}
                                    onDragEnd={() => { setDragElementId(null); setDragLayerId(null); }}
                                    onClick={e => handleRowClick(e, el.id)}
                                    className={clsx('flex items-center gap-1.5 pl-9 pr-2 py-1 text-xs cursor-pointer border-b border-slate-50',
                                        isSelected ? 'bg-blue-100 text-blue-800' : 'text-slate-500 hover:bg-slate-50')}>
                                    <Icon size={11} className="flex-shrink-0" />
                                    <span className="truncate">{getElementLabel(el)}</span>
                                </div>
                            );
                        })}
                    </React.Fragment>
                ))}
            </div>
        </div>
    );
};

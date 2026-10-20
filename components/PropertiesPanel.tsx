

import React, { useCallback } from 'react';
import { AppState, AppNode, TemplateElement, PageTemplate } from '../types';
import { Trash, Settings2, RectangleVertical, RectangleHorizontal, ToggleRight, ToggleLeft } from 'lucide-react';

import { PAGE_PRESETS, RM_PP_WIDTH, RM_PP_HEIGHT, toDisplayUnit, fromDisplayUnit } from '../constants/editor';
import {
    SingleElementEditor,
    type ElementPropertySectionKey,
    type ElementPropertySectionState,
} from './properties/SingleElementEditor';
import { NodeProperties } from './properties/NodeProperties';
import { CollapsibleSection } from './CollapsibleSection';
import { useFormFactor } from './editor-layout/FormFactorContext';
import clsx from 'clsx';
import { resolveTextPadding, TEXT_PADDING_SIDES } from '../services/textPadding';
import type { TextPaddingSelection } from './properties/TextPaddingControls';

export interface IncrementalPropertyActions {
    readonly contextEpoch: number | string;
    patchElements(ids: readonly string[], updates: Partial<TemplateElement> | ((previous: TemplateElement) => Partial<TemplateElement>), saveHistory: boolean): void;
    patchNodes(ids: readonly string[], updates: Partial<AppNode>): void;
    setPanelExpanded(key: string, expanded: boolean): void;
    panelsExpanded: Readonly<Record<string, boolean>>;
}

interface PropertiesPanelProps {
    state: AppState;
    activePreviewNode?: AppNode;
    onUpdateElements: (elements: TemplateElement[], saveHistory: boolean) => void;
    onUpdateNode: (id: string, updates: Partial<AppNode>) => void;
    onDeleteElements: (ids: string[]) => void;
    onOpenNodeSelector: (mode: 'grid_source' | 'link_element', elementId: string) => void; // Pass elementId context
    onUpdateTemplate: (id: string, updates: Partial<PageTemplate>, autoReflow?: boolean, scaleFontSize?: boolean) => void;
    layersSlot?: React.ReactNode;
    incrementalActions?: IncrementalPropertyActions;
}

const INITIAL_ELEMENT_PROPERTY_SECTIONS: ElementPropertySectionState = {
    grid: true,
    geometry: true,
    appearance: true,
    typography: true,
    interaction: true,
    svgSource: true,
};

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ state, activePreviewNode, onUpdateElements, onUpdateNode, onDeleteElements, onOpenNodeSelector, onUpdateTemplate, layersSlot, incrementalActions }) => {
    const { nodes, selectedNodeId, viewMode, selectedElementIds, variants, activeVariantId, selectedTemplateId } = state;
    // Session-local: Template Settings starts expanded, collapsible from its header.
    const [localSettingsExpanded, setSettingsExpanded] = React.useState(true);
    const settingsExpanded = incrementalActions ? incrementalActions.panelsExpanded['template-settings'] ?? true : localSettingsExpanded;
    // A narrow layout (the tablet's docked strip or the phone sheet) with a selection: the element's
    // settings come first and the page/node section sits below, collapsed (its own session-only
    // state, so the desktop/persisted expansion is untouched).
    const narrow = useFormFactor() !== 'desktop';
    const [narrowSettingsExpanded, setNarrowSettingsExpanded] = React.useState(false);
    const [localElementPropertySections, setElementPropertySections] = React.useState<ElementPropertySectionState>(
        () => ({ ...INITIAL_ELEMENT_PROPERTY_SECTIONS }),
    );
    const elementPropertySections = incrementalActions ? Object.fromEntries(Object.entries(INITIAL_ELEMENT_PROPERTY_SECTIONS)
        .map(([key, fallback]) => [key, incrementalActions.panelsExpanded[`element.${key}`] ?? fallback])) as ElementPropertySectionState : localElementPropertySections;
    const toggleElementPropertySection = useCallback((section: ElementPropertySectionKey) => {
        if (incrementalActions) {
            incrementalActions.setPanelExpanded(`element.${section}`, !elementPropertySections[section]); return;
        }
        setElementPropertySections(current => ({
            ...current,
            [section]: !current[section],
        }));
    }, [incrementalActions, elementPropertySections]);
    const node = nodes[selectedNodeId];
    const isHierarchyMode = viewMode === 'hierarchy';

    const effectiveTemplateId = isHierarchyMode ? node?.type : selectedTemplateId;
    const template = effectiveTemplateId ? variants[activeVariantId]?.templates[effectiveTemplateId] : undefined;

    // Derived selected elements
    const selectedElements = React.useMemo(() => {
        if (!template) return [];
        return selectedElementIds.map(id => template.elements.find(el => el.id === id)).filter(Boolean) as TemplateElement[];
    }, [selectedElementIds, template]);
    const narrowElementFirst = narrow && selectedElements.length > 0;
    const selectionIsTextOnly = selectedElements.length > 0
        && selectedElements.every(element => element.type === 'text');
    const enabledAutoWidthCount = selectionIsTextOnly
        ? selectedElements.filter(element => !!element.autoWidth).length
        : 0;
    const autoWidthSelection: boolean | 'mixed' = enabledAutoWidthCount === 0
        ? false
        : enabledAutoWidthCount === selectedElements.length
            ? true
            : 'mixed';
    const textPaddingSelection = React.useMemo<TextPaddingSelection | null>(() => {
        if (!selectionIsTextOnly) return null;
        const paddings = selectedElements.map(resolveTextPadding);
        return Object.fromEntries(TEXT_PADDING_SIDES.map(side => {
            const first = paddings[0][side];
            return [side, paddings.every(padding => padding[side] === first) ? first : 'mixed'];
        })) as TextPaddingSelection;
    }, [selectedElements, selectionIsTextOnly]);
    const textPaddingSelectionKey = React.useMemo(
        () => [...selectedElementIds].sort().join('\u0000'),
        [selectedElementIds],
    );

    // Generate a "Synthetic" element for Multi-Edit
    // If values match across all selected, show key. If not, show "Mixed" or special value.
    const displayElement = React.useMemo(() => {
        if (selectedElements.length === 0) return null;
        if (selectedElements.length === 1) return selectedElements[0];

        // console.log("DEBUG: Calculating Mixed Element for", selectedElements.length, "items.");
        const base = { ...selectedElements[0] };
        const keys = Object.keys(base) as (keyof TemplateElement)[];

        keys.forEach(key => {
            const firstValue = base[key];
            const allMatch = selectedElements.every(el => el[key] === firstValue);
            if (!allMatch) {
                // console.log(`DEBUG: Property ${key} mismatch. Setting to Mixed.`);
                (base as any)[key] = "Mixed";
            }
        });

        // console.log("DEBUG: Final displayElement:", base);
        return base;
    }, [selectedElements]);


    // Inputs show/accept the selected display unit; the template stays canonical (pt).
    const updateDim = (dim: 'width' | 'height', val: number) => {
        if (template && !isNaN(val)) {
            onUpdateTemplate(template.id, { [dim]: fromDisplayUnit(val, dimUnit) }, autoReflow, scaleFontSize);
        }
    };

    const getDim = (dim: 'width' | 'height') => {
        if (!template) return 0;
        return toDisplayUnit(template[dim] || (dim === 'width' ? RM_PP_WIDTH : RM_PP_HEIGHT), dimUnit);
    };

    const [dimUnit, setDimUnit] = React.useState<'px' | 'pt' | 'in' | 'mm'>('px');
    const [autoReflow, setAutoReflow] = React.useState(true);
    const [scaleFontSize, setScaleFontSize] = React.useState(true);
    // Positional traversal controls retain a sequence token across field edits,
    // but not across add/remove. Weak keys never retain old document payloads.
    const traversalSequences = React.useRef(new WeakMap<object, object>());

    const applyPreset = (key: string) => {
        const p = PAGE_PRESETS[key];
        if (p && template) {
            onUpdateTemplate(template.id, { width: p.w, height: p.h }, autoReflow, scaleFontSize);
        }
    };

    const toggleOrientation = (mode: 'portrait' | 'landscape') => {
        if (!template) return;
        const { width, height } = template;
        const isPortrait = height >= width;

        if (mode === 'portrait' && !isPortrait) {
            onUpdateTemplate(template.id, { width: height, height: width }, autoReflow, scaleFontSize);
        } else if (mode === 'landscape' && isPortrait) {
            onUpdateTemplate(template.id, { width: height, height: width }, autoReflow, scaleFontSize);
        }
    };

    // Hooks must be called before any early returns
    const handleUpdate = useCallback((updates: Partial<TemplateElement> | ((prev: TemplateElement) => Partial<TemplateElement>), saveHistory: boolean = true) => {
        if (incrementalActions) {
            if (typeof updates !== 'function' && updates.borderSides) {
                const sides = updates.borderSides;
                const before = displayElement?.borderSides ?? {};
                incrementalActions.patchElements(selectedElementIds, previous => {
                    const next = { ...previous.borderSides };
                    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
                        if (Object.hasOwn(before, side) && !Object.hasOwn(sides, side)) delete next[side];
                        else if (Object.hasOwn(sides, side) && sides[side] !== before[side]) {
                            const value = sides[side];
                            next[side] = value ? { ...next[side], ...Object.fromEntries(Object.entries(value).filter(([key, field]) =>
                                !before[side] || !Object.hasOwn(before[side], key) || !Object.is(before[side]?.[key as keyof typeof value], field))) } as typeof value : value;
                        }
                    }
                    return { ...updates, borderSides: next };
                }, saveHistory);
                return;
            }
            // SingleElementEditor still emits a rendered whole gridConfig. Translate
            // that selected map into field intent before resolving each live element.
            // Functional controls (including text padding) already resolve live values.
            const grid = typeof updates === 'function' ? undefined : updates.gridConfig;
            const before = displayElement?.gridConfig;
            if (grid && before) {
                const renderedPaths = new Map(selectedElements.map(element => [element.id, element.gridConfig?.traversalPath]));
                const fields = Object.fromEntries(Object.entries(grid).filter(([key, value]) =>
                    key !== 'traversalPath' && (!Object.hasOwn(before, key) || !Object.is(before[key as keyof typeof before], value))));
                incrementalActions.patchElements(selectedElementIds, previous => {
                    const current = previous.gridConfig;
                    if (!current) return {};
                    const next = { ...current, ...fields };
                    if (grid.traversalPath !== before.traversalPath) {
                        const oldPath = before.traversalPath ?? [];
                        const path = grid.traversalPath ?? [];
                        const live = current.traversalPath ?? [];
                        const renderedPath = renderedPaths.get(previous.id) ?? oldPath;
                        const token = traversalSequences.current.get(renderedPath) ?? {};
                        traversalSequences.current.set(renderedPath, token);
                        if (live !== renderedPath && current.traversalPath && traversalSequences.current.get(live) !== token) return {};
                        if (path.length === oldPath.length) {
                            // A step editor changes named fields, not neighboring steps.
                            next.traversalPath = live.map((step, index) => path[index] && oldPath[index] !== path[index]
                                ? { ...step, ...Object.fromEntries(Object.entries(path[index]).filter(([key, value]) =>
                                    !Object.hasOwn(oldPath[index], key) || !Object.is(oldPath[index][key as keyof typeof step], value))) }
                                : step);
                        } else if (path.length > oldPath.length) {
                            next.traversalPath = [...live, ...path.slice(oldPath.length)];
                        } else {
                            const removed = new Set(oldPath.flatMap((step, index) => path.includes(step) ? [] : [index]));
                            next.traversalPath = live.filter((_, index) => !removed.has(index));
                        }
                        traversalSequences.current.set(next.traversalPath, path.length === oldPath.length ? token : {});
                    }
                    return { ...updates, gridConfig: next };
                }, saveHistory);
            } else incrementalActions.patchElements(selectedElementIds, previous => {
                const patch = typeof updates === 'function' ? updates(previous) : updates;
                // Padding controls resolve known sides; opaque extension fields are
                // not instructions to delete when those controls omit them.
                return patch.textPadding ? { ...patch, textPadding: { ...previous.textPadding, ...patch.textPadding } } : patch;
            }, saveHistory);
            return;
        }
        if (selectedElements.length > 0 && template) {
            // Apply updates to ALL selected elements
            const newElements = template.elements.map(el => {
                if (selectedElementIds.includes(el.id)) {
                    // Resolve updates if it's a function
                    const appliedUpdates = typeof updates === 'function' ? updates(el) : updates;

                    // Log for Z-Index debugging
                    if ('zIndex' in appliedUpdates) {
                        console.log(`DEBUG: Updating zIndex for ${el.id}. Prev: ${el.zIndex} (${typeof el.zIndex}). New: ${appliedUpdates.zIndex}`);
                    }

                    return { ...el, ...appliedUpdates };
                }
                return el;
            });
            onUpdateElements(newElements, saveHistory);
        }
    }, [onUpdateElements, selectedElements, template, selectedElementIds, incrementalActions, displayElement]);

    const handleOpenNodeSelector = useCallback((mode: 'grid_source' | 'link_element') => {
        if (selectedElements.length > 0) {
            onOpenNodeSelector(mode, selectedElements[0].id);
        }
    }, [onOpenNodeSelector, selectedElements]);

    if (!template) return <div className="p-4 text-slate-400">Select a template</div>;

    const elementSection = (
    <div className={narrowElementFirst ? 'p-4' : 'p-4 flex-1'}>
        <h3 className="font-bold text-slate-700 mb-4 flex justify-between items-center">
            Element Properties
            {selectedElements.length > 0 && (
                <button onClick={() => onDeleteElements(state.selectedElementIds)} className="text-red-500 hover:bg-red-50 p-1 rounded">
                    <Trash size={16} />
                </button>
            )}
        </h3>

        {selectedElements.length > 0 && displayElement ? (
            <>
                {selectedElements.length > 1 && (
                    <div className="bg-blue-50 text-blue-700 px-3 py-2 text-xs font-medium border-b border-blue-100 flex items-center justify-between mb-4 rounded">
                        <span>{selectedElements.length} items selected</span>
                        <span className="text-[10px] opacity-75">Editing all</span>
                    </div>
                )}
                <SingleElementEditor
                    key={incrementalActions ? JSON.stringify([activeVariantId, effectiveTemplateId, selectedElementIds, incrementalActions.contextEpoch]) : selectedElements[0].id}
                    // (this also remounts SvgSourceSection on selection change, resetting its draft + pending debounce timer)
                    element={displayElement}
                    onUpdate={handleUpdate}
                    onOpenNodeSelector={handleOpenNodeSelector}
                    state={state}
                    selectionIsTextOnly={selectionIsTextOnly}
                    autoWidthSelection={autoWidthSelection}
                    textPaddingSelection={textPaddingSelection}
                    textPaddingSelectionKey={textPaddingSelectionKey}
                    sectionExpanded={elementPropertySections}
                    onToggleSection={toggleElementPropertySection}
                    activeNode={activePreviewNode}
                />
            </>
        ) : (
            <div className="text-sm text-slate-400 italic text-center mt-10">Select an element</div>
        )}
    </div>
    );

    return (
        <div className="flex flex-col h-full overflow-y-auto bg-white border-l" data-prevent-finish-edit="true">
            {narrowElementFirst && elementSection}
            <CollapsibleSection
                title={isHierarchyMode ? 'Node Properties' : 'Template Settings'}
                icon={Settings2}
                testId="template-settings-section"
                expanded={narrowElementFirst ? narrowSettingsExpanded : settingsExpanded}
                onToggle={narrowElementFirst ? () => setNarrowSettingsExpanded(v => !v) : () => incrementalActions ? incrementalActions.setPanelExpanded('template-settings', !settingsExpanded) : setSettingsExpanded(v => !v)}
            >
                <div className="px-4 pb-4">

                {isHierarchyMode ? (
                    state.selectedNodeIds?.length > 1 ? (
                        <div className="mt-3 space-y-3 px-4">
                            <div className="bg-indigo-50 p-3 rounded border border-indigo-100 text-sm">
                                <div className="text-indigo-700 font-bold mb-1">
                                    {state.selectedNodeIds.length} Nodes Selected
                                </div>
                                <p className="text-slate-600 mb-2">
                                    Change template for all selected nodes.
                                </p>
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-slate-500 uppercase">Assigned Template</label>
                                <select className="w-full border rounded px-2 py-1 text-sm mt-1 bg-white"
                                    defaultValue=""
                                    onChange={(e) => {
                                        if (incrementalActions) incrementalActions.patchNodes(state.selectedNodeIds, { type: e.target.value });
                                        else state.selectedNodeIds.forEach(id => onUpdateNode(id, { type: e.target.value }));
                                    }}>
                                    <option value="" disabled>Select Template...</option>
                                    {Object.values(state.variants[state.activeVariantId]?.templates || {}).map((t: any) => (
                                        <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    ) : node ? (
                        <NodeProperties node={node} state={state} onUpdateNode={onUpdateNode} />
                    ) : null
                ) : (
                    <div className="mt-3 space-y-3">
                        <div className="border-b pb-3 mb-2 border-slate-200">
                            <label className="text-[10px] text-slate-400 block mb-1">Page Presets</label>
                            <select onChange={(e) => applyPreset(e.target.value)} className="w-full border rounded px-1 text-xs py-1.5 mb-2 bg-white" defaultValue="">
                                <option value="" disabled>Select Size...</option>
                                <optgroup label="Standard Paper">
                                    <option value="a4">A4</option>
                                    <option value="letter">Letter</option>
                                    <option value="legal">Legal</option>
                                    <option value="a5">A5</option>
                                </optgroup>
                                <optgroup label="11.8&quot; Devices">
                                    <option value="rm_pp">reMarkable Paper Pro</option>
                                </optgroup>
                                <optgroup label="10.3&quot; Devices">
                                    <option value="rm2">reMarkable 2</option>
                                    <option value="boox_note_air">Boox Note Air 3 / 3C</option>
                                    <option value="boox_go_10">Boox Go 10.3</option>
                                    <option value="supernote_a5x">Supernote A5 X / Manta</option>
                                    <option value="kindle_scribe">Kindle Scribe</option>
                                    <option value="note_10_3">Generic 10.3"</option>
                                </optgroup>
                                <optgroup label="13.3&quot; Devices">
                                    <option value="boox_tab_x">Boox Tab X</option>
                                    <option value="boox_note_max">Boox Note Max</option>
                                    <option value="note_13_3">Generic 13.3"</option>
                                </optgroup>
                                <optgroup label="7.8&quot; Devices">
                                    <option value="supernote_nomad">Supernote Nomad</option>
                                    <option value="boox_nova_air">Boox Nova Air</option>
                                    <option value="note_7_8">Generic 7.8"</option>
                                </optgroup>
                                <optgroup label="7&quot; Devices">
                                    <option value="rm_pp_move">reMarkable Paper Pro Move</option>
                                </optgroup>
                            </select>

                            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 mb-2 items-end">
                                <div><label className="text-[10px] text-slate-400">Width</label><input type="number" step="0.1" value={getDim('width')} onChange={(e) => updateDim('width', parseFloat(e.target.value))} className="w-full border rounded px-1 text-sm" /></div>
                                <div><label className="text-[10px] text-slate-400">Height</label><input type="number" step="0.1" value={getDim('height')} onChange={(e) => updateDim('height', parseFloat(e.target.value))} className="w-full border rounded px-1 text-sm" /></div>
                                <div>
                                    <label className="text-[10px] text-slate-400">Unit</label>
                                    <select value={dimUnit} onChange={(e) => setDimUnit(e.target.value as any)} title="Dimension unit"
                                        className="block w-full border rounded px-0.5 py-[3px] text-xs bg-white text-slate-600 cursor-pointer">
                                        <option value="pt">pt</option>
                                        <option value="px">px</option>
                                        <option value="in">in</option>
                                        <option value="mm">mm</option>
                                    </select>
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <button onClick={() => toggleOrientation('portrait')} className="flex-1 text-[10px] bg-white border rounded py-1 hover:bg-slate-50 flex items-center justify-center gap-1"><RectangleVertical size={12} /> Portrait</button>
                                <button onClick={() => toggleOrientation('landscape')} className="flex-1 text-[10px] bg-white border rounded py-1 hover:bg-slate-50 flex items-center justify-center gap-1"><RectangleHorizontal size={12} /> Landscape</button>
                            </div>

                            <div className="mt-3 flex flex-col gap-1 p-2 bg-slate-50 rounded border border-slate-100">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-[10px] font-medium text-slate-700">Auto-Reflow Elements</div>
                                        <div className="text-[9px] text-slate-500 leading-tight mt-0.5 max-w-[140px]">
                                            {autoReflow ? 'Scale to fit new dimensions' : 'Keep original size/position'}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setAutoReflow(!autoReflow)}
                                        className="flex-shrink-0 text-indigo-600 focus:outline-none"
                                    >
                                        {autoReflow ? <ToggleRight size={22} /> : <ToggleLeft size={22} className="text-slate-400" />}
                                    </button>
                                </div>
                                
                                {autoReflow && (
                                    <div className="flex items-center justify-between pt-1 mt-1 border-t border-slate-200">
                                        <div>
                                            <div className="text-[10px] font-medium text-slate-700">Scale Typography</div>
                                            <div className="text-[9px] text-slate-500 leading-tight mt-0.5 max-w-[140px]">
                                                {scaleFontSize ? 'Fonts/strokes scale with page' : 'Keep original styling'}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => setScaleFontSize(!scaleFontSize)}
                                            className="flex-shrink-0 text-indigo-600 focus:outline-none"
                                        >
                                            {scaleFontSize ? <ToggleRight size={22} /> : <ToggleLeft size={22} className="text-slate-400" />}
                                        </button>
                                    </div>
                                )}
                            </div>

                        </div>

                        {/* Redundant editor block removed from here; element deletion lives
                            in the Element Properties header (trash icon) only. */}
                    </div>
                )}
                {!isHierarchyMode && state.selectedTemplateIds?.length > 1 && (
                    <div className="mt-3 px-4 space-y-3">
                        <div className="bg-slate-50 p-3 rounded border border-slate-200 text-sm">
                            <div className="text-slate-700 font-bold mb-1">
                                {state.selectedTemplateIds.length} Templates Selected
                            </div>
                            <p className="text-slate-500 mb-2 text-xs">
                                Individual template settings are unavailable during bulk selection.
                            </p>
                        </div>
                    </div>
                )}
                </div>
            </CollapsibleSection>

            {layersSlot}

            {!narrowElementFirst && elementSection}
        </div >
    );
};

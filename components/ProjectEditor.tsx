import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useReducer } from 'react';
import { AppState, AppNode, TemplateElement, PageTemplate, Variant, RM_PP_WIDTH, RM_PP_HEIGHT } from '../types';
import { Sidebar } from './Sidebar';
import { Canvas } from './Canvas';
import { useCanvasTextLayoutSession } from './canvas/useCanvasTextLayoutSession';
import { PropertiesPanel, type IncrementalPropertyActions } from './PropertiesPanel';
import { LayersPanel, type LayerPanelActions } from './LayersPanel';
import { CollapsibleSection } from './CollapsibleSection';
import { JsonModal } from './JsonModal';
import { NodeSelectorModal } from './NodeSelectorModal';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { HierarchyGeneratorModal } from './HierarchyGeneratorModal';
import { generatePDF } from '../services/pdfService';
import { CURRENT_SCHEMA_VERSION } from '../services/migration';
import { Download, Code, Undo2, Redo2, Loader2, Contrast, Layers, Tablet } from 'lucide-react';
import { EditorToolbar, type ToolbarActions } from './EditorToolbar';
import { EditorLayout } from './editor-layout/EditorLayout';
import { useFormFactor } from './editor-layout/FormFactorContext';
import { useTouchViewport } from './editor-layout/useTouchViewport';
import { SavePresetModal } from './SavePresetModal';
import { DeviceExportDialog } from './export/DeviceExportDialog';
import { NewVariantModal, NewVariantConfig } from './NewVariantModal';
import { reflowTemplates } from '../services/reflow';
import clsx from 'clsx';
import { trackEvent } from '../services/analytics';
import { resolveActiveLayerId, nextZIndexInLayer, createDefaultLayer, moveElementsToLayer, getElementLabel } from '../services/layers';
import { listPreviewNodes } from '../services/previewNodes';
import type { TouchEditorActions } from './editor-layout/touchActions';
import { useTouchMultiSelect } from './editor-layout/useTouchMultiSelect';
import { alignSelectedElements, type AlignType } from '../services/alignElements';
import { PLACEHOLDER_SVG, createPlacedSvgElement } from '../services/svgEditing';
import { DocumentSnapshot, restoreDocument, snapshotDocument } from '../services/projectDocumentSnapshot';
import type { GeneratedProject } from '../services/validateGeneratedProject';
import type { GeneratorSourceDraft } from '../services/generatorVisualPreview';
import { useDocumentEditor, type EditorSessionState, type EditorEditContext, type PreparedEditorEdit } from '../hooks/useDocumentEditor';
import type { EditorEffect, EditorSourceBinding, IncrementalEditorCallbacks, EditorScalarPreferencePatch } from '../services/document/contracts';
import { createEditOperations, createStructuralEditorOperations, prepareLayerEdit, type StructuralEditorEdit } from '../services/document/editOperations';
import type { DocumentChange, EditorElementIntent } from '../services/document/contracts';
import type { HistorySelection } from '../services/document/history';

interface HistoryState {
    past: DocumentSnapshot[];
    future: DocumentSnapshot[];
}

interface CommonProjectEditorProps {
    projectId: string;
    projectName: string;
    initialState: AppState;
    isActive: boolean;
    onNameChange: (name: string) => void;
    onStateChange?: (state: AppState) => void;
    onCreateGeneratedProject: (name: string, project: GeneratedProject, source: GeneratorSourceDraft) => Promise<boolean>;
    onSaveCustomPreset: (title: string, description: string, initialState: AppState) => Promise<boolean>;
}

type ProjectEditorProps = CommonProjectEditorProps & (
    | ({ incremental: EditorSourceBinding } & IncrementalEditorCallbacks)
    | { incremental?: undefined; onDocumentEdit?: never; onPreferencesChange?: never }
);

function useLegacyEditor({ projectId, projectName, initialState, isActive, onNameChange, onStateChange, onCreateGeneratedProject, onSaveCustomPreset }: CommonProjectEditorProps) {
    const [state, setState] = useState<AppState>(initialState);

    const [deleteConfirmState, setDeleteConfirmState] = useState<{ isOpen: boolean, nodeIds: string[] }>({ isOpen: false, nodeIds: [] });
    const [showScriptGenModal, setShowScriptGenModal] = useState(false);
    // Session-local: the Layers section always starts collapsed on load.
    const [layersExpanded, setLayersExpanded] = useState(false);
    const [showSavePresetModal, setShowSavePresetModal] = useState(false);
    const [showNewVariantModal, setShowNewVariantModal] = useState(false);
    // Owned here (not in the view) so the shortcut handler below can bail out while the dialog is open.
    const [showDeviceExport, setShowDeviceExport] = useState(false);
    const [resizingPanel, setResizingPanel] = useState<'sidebar' | 'properties' | null>(null);

    const [isExporting, setIsExporting] = useState(false);

    // History Management
    const historyRef = useRef<HistoryState>({ past: [], future: [] });

    const onNameChangeRef = useRef(onNameChange);
    const onStateChangeRef = useRef(onStateChange);
    const previousRootTitleRef = useRef(state.nodes[state.rootId]?.title);
    const lastReportedStateRef = useRef(state);

    useEffect(() => {
        onNameChangeRef.current = onNameChange;
        onStateChangeRef.current = onStateChange;
    }, [onNameChange, onStateChange]);

    // Update parent name when root title changes
    useEffect(() => {
        const rootNode = state.nodes[state.rootId];
        if (!rootNode || rootNode.title === previousRootTitleRef.current) return;
        previousRootTitleRef.current = rootNode.title;
        onNameChangeRef.current(rootNode.title);
    }, [state.nodes[state.rootId]?.title]);

    useEffect(() => {
        if (lastReportedStateRef.current === state) return;
        lastReportedStateRef.current = state;
        onStateChangeRef.current?.(state);
    }, [state]);

    const saveToHistory = useCallback(() => {
        historyRef.current.past.push(snapshotDocument(state));
        // Limit history size to 50
        if (historyRef.current.past.length > 50) historyRef.current.past.shift();
        historyRef.current.future = [];
    }, [state]);

    const undo = useCallback(() => {
        if (historyRef.current.past.length === 0) return;

        const previous = historyRef.current.past.pop();
        if (previous) {
            historyRef.current.future.push(snapshotDocument(state));
            setState(s => restoreDocument(s, previous));
        }
    }, [state]);

    const redo = useCallback(() => {
        if (historyRef.current.future.length === 0) return;

        const next = historyRef.current.future.pop();
        if (next) {
            historyRef.current.past.push(snapshotDocument(state));
            setState(s => restoreDocument(s, next));
        }
    }, [state]);

    // Panel Resizing Logic
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!resizingPanel) return;
            // Only prevent default if we are actively resizing
            e.preventDefault();
            if (resizingPanel === 'sidebar') {
                const newWidth = Math.max(200, Math.min(600, e.clientX));
                setState(s => ({ ...s, sidebarWidth: newWidth }));
            } else if (resizingPanel === 'properties') {
                const newWidth = Math.max(250, Math.min(600, window.innerWidth - e.clientX));
                setState(s => ({ ...s, propertiesPanelWidth: newWidth }));
            }
        };
        const handleMouseUp = () => setResizingPanel(null);

        if (resizingPanel) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'col-resize';
        } else {
            document.body.style.cursor = 'default';
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [resizingPanel]);

    // Global Keyboard Shortcuts
    useEffect(() => {
        if (!isActive) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (state.showJsonModal || state.showNodeSelector || deleteConfirmState.isOpen || showScriptGenModal || showSavePresetModal || showDeviceExport) return;
            const activeTag = document.activeElement?.tagName.toLowerCase();
            if (activeTag === 'input' || activeTag === 'textarea') return;

            // Undo: Ctrl+Z
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) redo();
                else undo();
                return;
            }

            // Redo: Ctrl+Y
            if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                e.preventDefault();
                redo();
                return;
            }

            // Delete
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (state.selectedElementIds.length > 0) {
                    saveToHistory();
                    handleDeleteElements(state.selectedElementIds);
                } else if (state.viewMode === 'hierarchy' && state.selectedNodeIds?.length > 0) {
                    requestDeleteNodes(state.selectedNodeIds);
                } else if (state.viewMode === 'templates' && state.selectedTemplateIds?.length > 0) {
                    handleDeleteTemplates(state.selectedTemplateIds);
                }
            }

            // --- Clipboard Operations ---

            // Copy: Ctrl+C
            if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
                if (state.selectedElementIds.length > 0) {
                    e.preventDefault();
                    const template = getCurrentTemplate();
                    if (template) {
                        const elementsToCopy = template.elements.filter(el => state.selectedElementIds.includes(el.id));
                        setState(s => ({ ...s, clipboard: elementsToCopy }));
                    }
                }
            }

            // Cut: Ctrl+X
            if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
                if (state.selectedElementIds.length > 0) {
                    e.preventDefault();
                    saveToHistory();
                    const template = getCurrentTemplate();
                    if (template) {
                        const elementsToCopy = template.elements.filter(el => state.selectedElementIds.includes(el.id));
                        setState(s => ({ ...s, clipboard: elementsToCopy }));
                        handleDeleteElements(state.selectedElementIds);
                    }
                }
            }

            // Paste: Ctrl+V or Ctrl+P
            if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'p')) {
                if (state.clipboard.length > 0) {
                    e.preventDefault();
                    saveToHistory();
                    handlePaste();
                }
            }

            // Duplicate: Ctrl+D
            if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
                e.preventDefault();
                if (state.selectedElementIds.length > 0) {
                    saveToHistory();
                    handleDuplicate();
                } else if (state.viewMode === 'hierarchy' && state.selectedNodeIds?.length > 0) {
                    handleDuplicateNodes(state.selectedNodeIds);
                } else if (state.viewMode === 'templates' && state.selectedTemplateIds?.length > 0) {
                    handleDuplicateTemplates(state.selectedTemplateIds);
                }
            }

            // --- Tool Switching Shortcuts ---
            if (!e.ctrlKey && !e.metaKey && !e.altKey) {
                switch (e.key.toLowerCase()) {
                    case 'v': setState(s => ({ ...s, tool: 'select' })); break;
                    case 'h': setState(s => ({ ...s, tool: 'hand' })); break;
                    case 't': setState(s => ({ ...s, tool: 'text' })); break;
                    case 'r': setState(s => ({ ...s, tool: 'rect' })); break;
                    case 'e': setState(s => ({ ...s, tool: 'ellipse' })); break;
                    case 'y': setState(s => ({ ...s, tool: 'triangle' })); break;
                    case 'l': setState(s => ({ ...s, tool: 'line' })); break;
                    case 'g': setState(s => ({ ...s, tool: 'grid' })); break;
                }
            }

            // --- Arrow Key Movement ---
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                if (state.selectedElementIds.length > 0) {
                    e.preventDefault();
                    saveToHistory();

                    const delta = e.shiftKey ? 10 : (state.snapToGrid ? 10 : 1);
                    const dx = e.key === 'ArrowLeft' ? -delta : e.key === 'ArrowRight' ? delta : 0;
                    const dy = e.key === 'ArrowUp' ? -delta : e.key === 'ArrowDown' ? delta : 0;

                    const template = getCurrentTemplate();
                    if (template) {
                        const newElements = template.elements.map(el => {
                            if (state.selectedElementIds.includes(el.id)) {
                                return { ...el, x: el.x + dx, y: el.y + dy };
                            }
                            return el;
                        });
                        handleUpdateTemplateElements(newElements, false); // false = don't double save history
                    }
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [state, undo, redo, saveToHistory, isActive, showScriptGenModal, showSavePresetModal, showDeviceExport]);


    // Helper: Get templates from active variant
    const getActiveTemplates = useCallback((): Record<string, PageTemplate> => {
        return state.variants[state.activeVariantId]?.templates || {};
    }, [state.variants, state.activeVariantId]);

    const getCurrentTemplate = (): PageTemplate | null => {
        let targetTemplateId = state.selectedTemplateId;
        if (state.viewMode === 'hierarchy') targetTemplateId = state.nodes[state.selectedNodeId]?.type;
        if (!targetTemplateId) return null;
        return getActiveTemplates()[targetTemplateId];
    };

    const handleDuplicateNodes = (ids: string[]) => {
        saveToHistory();
        setState(prev => {
            const nextNodes = { ...prev.nodes };
            const newSelectedIds: string[] = [];

            // Helper to deep copy node + children
            const duplicateSubtree = (nodeId: string, parentId: string | null): string => {
                const node = nextNodes[nodeId];
                if (!node) return nodeId;
                
                const newId = `node_${Math.random().toString(36).substr(2, 6)}`;
                const newNode: AppNode = { 
                    ...JSON.parse(JSON.stringify(node)), 
                    id: newId, 
                    parentId, 
                    title: `${node.title} (Copy)`, 
                    children: [] 
                };
                
                if (parentId) {
                    const parent = nextNodes[parentId];
                    if (parent) {
                        const insertIdx = parent.children.indexOf(nodeId);
                        if (insertIdx !== -1) {
                            parent.children.splice(insertIdx + 1, 0, newId);
                        } else {
                            parent.children.push(newId);
                        }
                    }
                }
                
                nextNodes[newId] = newNode;
                
                node.children.forEach(childId => {
                    const newChildId = duplicateSubtree(childId, newId);
                    if (newChildId !== childId) {
                        newNode.children.push(newChildId);
                    }
                });
                return newId;
            };

            const rootDuplicated = ids.includes(prev.rootId);
            if (rootDuplicated) {
                alert("Cannot duplicate the root node.");
                return prev;
            }

            ids.forEach(id => {
                const node = prev.nodes[id];
                if (node && node.parentId) {
                    const newId = duplicateSubtree(id, node.parentId);
                    newSelectedIds.push(newId);
                }
            });

            return { 
                ...prev, 
                nodes: nextNodes, 
                selectedNodeIds: newSelectedIds, 
                selectedNodeId: newSelectedIds[0] || prev.selectedNodeId 
            };
        });
    };

    const handleDuplicateTemplates = (ids: string[]) => {
        saveToHistory();
        setState(prev => {
            const activeVariant = prev.variants[prev.activeVariantId];
            const nextTemplates = { ...activeVariant.templates };
            const newSelectedIds: string[] = [];

            ids.forEach(id => {
                const tpl = nextTemplates[id];
                if (tpl) {
                    const newId = `tpl_${Math.random().toString(36).substr(2, 6)}`;
                    nextTemplates[newId] = {
                        ...JSON.parse(JSON.stringify(tpl)),
                        id: newId,
                        name: `${tpl.name} (Copy)`
                    };
                    newSelectedIds.push(newId);
                }
            });

            return { 
                ...prev, 
                variants: { ...prev.variants, [prev.activeVariantId]: { ...activeVariant, templates: nextTemplates } },
                selectedTemplateIds: newSelectedIds,
                selectedTemplateId: newSelectedIds[0] || prev.selectedTemplateId
            };
        });
    };

    const handleSelectNode = (id: string, ctrlKey: boolean, shiftKey: boolean) => {
        setState(s => {
            let newIds = s.selectedNodeIds || [];
            if (shiftKey && newIds.length > 0) {
                const nodes = Array.from(document.querySelectorAll('[data-node-id]')).map(el => el.getAttribute('data-node-id') as string);
                const lastId = newIds[newIds.length - 1];
                const startIdx = nodes.indexOf(lastId);
                const endIdx = nodes.indexOf(id);
                if (startIdx !== -1 && endIdx !== -1) {
                    const min = Math.min(startIdx, endIdx);
                    const max = Math.max(startIdx, endIdx);
                    // range includes exactly what's visible
                    const range = nodes.slice(min, max + 1);
                    newIds = Array.from(new Set([...newIds, ...range]));
                }
            } else if (ctrlKey) {
                if (newIds.includes(id)) {
                    newIds = newIds.filter(i => i !== id);
                } else {
                    newIds = [...newIds, id];
                }
            } else {
                newIds = [id];
            }
            
            const activeId = newIds.length > 0 ? (ctrlKey && !newIds.includes(id) ? newIds[newIds.length - 1] : id) : s.rootId;
            return { 
                ...s, 
                selectedNodeId: activeId, 
                selectedNodeIds: newIds, 
                selectedElementIds: [] 
            };
        });
    };

    const handleSelectTemplate = (id: string, ctrlKey: boolean, shiftKey: boolean) => {
        setState(s => {
            let newIds = s.selectedTemplateIds || [];
            if (shiftKey && newIds.length > 0) {
                const templates = Array.from(document.querySelectorAll('[data-template-id]')).map(el => el.getAttribute('data-template-id') as string);
                const lastId = newIds[newIds.length - 1];
                const startIdx = templates.indexOf(lastId);
                const endIdx = templates.indexOf(id);
                if (startIdx !== -1 && endIdx !== -1) {
                    const min = Math.min(startIdx, endIdx);
                    const max = Math.max(startIdx, endIdx);
                    const range = templates.slice(min, max + 1);
                    newIds = Array.from(new Set([...newIds, ...range]));
                }
            } else if (ctrlKey) {
                if (newIds.includes(id)) {
                    newIds = newIds.filter(i => i !== id);
                } else {
                    newIds = [...newIds, id];
                }
            } else {
                newIds = [id];
            }
            
            const activeId = newIds.length > 0 ? (ctrlKey && !newIds.includes(id) ? newIds[newIds.length - 1] : id) : s.selectedTemplateId;
            return { 
                ...s, 
                selectedTemplateId: activeId, 
                selectedTemplateIds: newIds, 
                selectedElementIds: [] 
            };
        });
    };

    const handleDuplicate = () => {
        const template = getCurrentTemplate();
        if (!template) return;

        const newElements: TemplateElement[] = [];
        const newIds: string[] = [];

        state.selectedElementIds.forEach(id => {
            const original = template.elements.find(e => e.id === id);
            if (original) {
                const newId = Math.random().toString(36).substr(2, 9);
                const layerId = (original.layerId && template.layers?.some(l => l.id === original.layerId))
                    ? original.layerId
                    : resolveActiveLayerId(template, state.activeLayerId);
                newIds.push(newId);
                newElements.push({
                    ...JSON.parse(JSON.stringify(original)),
                    id: newId,
                    x: original.x + 20,
                    y: original.y + 20,
                    layerId,
                    zIndex: nextZIndexInLayer([...template.elements, ...newElements], layerId)
                });
            }
        });

        if (newElements.length > 0) {
            handleUpdateTemplateElements([...template.elements, ...newElements], false);
            setState(s => ({ ...s, selectedElementIds: newIds }));
        }
    };

    const handlePaste = () => {
        const template = getCurrentTemplate();
        if (!template || state.clipboard.length === 0) return;

        const newElements: TemplateElement[] = [];
        const newIds: string[] = [];
        const offset = 20;

        state.clipboard.forEach(item => {
            const newId = Math.random().toString(36).substr(2, 9);
            const layerId = (item.layerId && template.layers?.some(l => l.id === item.layerId))
                ? item.layerId
                : resolveActiveLayerId(template, state.activeLayerId);
            newIds.push(newId);
            newElements.push({
                ...JSON.parse(JSON.stringify(item)),
                id: newId,
                x: item.x + offset,
                y: item.y + offset,
                layerId,
                zIndex: nextZIndexInLayer([...template.elements, ...newElements], layerId)
            });
        });

        handleUpdateTemplateElements([...template.elements, ...newElements], false);
        setState(s => ({ ...s, selectedElementIds: newIds }));
    };

    const handleUpdateNode = (id: string, updates: Partial<AppNode>) => {
        saveToHistory();
        setState(prev => ({ ...prev, nodes: { ...prev.nodes, [id]: { ...prev.nodes[id], ...updates } } }));
    };

    const handleAddNode = (parentId: string | null) => {
        saveToHistory();
        const newId = Math.random().toString(36).substr(2, 9);
        const parentNode = parentId ? state.nodes[parentId] : null;
        const activeTemplates = getActiveTemplates();
        let newType = 'day_view';
        if (activeTemplates['day_view']) {
            if (parentNode?.type === 'year_view') newType = 'month_view';
            if (!parentNode) newType = 'year_view';
        } else {
            newType = Object.keys(activeTemplates)[0];
        }

        const newNode: AppNode = { id: newId, parentId, type: newType, title: 'New Page', data: {}, children: [] };
        setState(prev => {
            const nextNodes = { ...prev.nodes, [newId]: newNode };
            if (parentId) nextNodes[parentId] = { ...nextNodes[parentId], children: [...nextNodes[parentId].children, newId] };
            return { ...prev, nodes: nextNodes };
        });
    };

    const handleAddReference = (parentId: string) => {
        setState(prev => ({ ...prev, showNodeSelector: true, nodeSelectorMode: 'create_reference', selectedNodeId: parentId }));
    };

    const requestDeleteNodes = (ids: string[]) => {
        if (ids.includes(state.rootId)) {
            alert("Cannot delete root node.");
            return;
        }
        setDeleteConfirmState({ isOpen: true, nodeIds: ids });
    };

    const executeDeleteNode = () => {
        const ids = deleteConfirmState.nodeIds;
        if (!ids || ids.length === 0) return;
        saveToHistory();

        setState(prev => {
            const nextNodes = { ...prev.nodes };
            const idsToDelete = new Set<string>();
            const queue = [...ids];

            while (queue.length > 0) {
                const currentId = queue.shift()!;
                if (idsToDelete.has(currentId)) continue;
                idsToDelete.add(currentId);
                const node = nextNodes[currentId];
                if (!node) continue;
                if (node.children) queue.push(...node.children);
                Object.values(nextNodes).forEach(n => {
                    if (n.referenceId === currentId && !idsToDelete.has(n.id)) queue.push(n.id);
                });
            }

            // Remove deleted children from their parents
            idsToDelete.forEach(deletedId => {
                const node = nextNodes[deletedId];
                if (node && node.parentId) {
                    const parent = nextNodes[node.parentId];
                    if (parent && !idsToDelete.has(node.parentId)) {
                        nextNodes[node.parentId] = {
                            ...parent,
                            children: parent.children.filter(childId => childId !== deletedId)
                        };
                    }
                }
            });

            idsToDelete.forEach(nodeId => { delete nextNodes[nodeId]; });

            // Clean up templates in all variants when nodes are deleted
            const nextVariants = { ...prev.variants };
            Object.keys(nextVariants).forEach(variantId => {
                const variant = nextVariants[variantId];
                const nextTemplates = { ...variant.templates };
                let variantChanged = false;
                Object.keys(nextTemplates).forEach(tplId => {
                    const tpl = nextTemplates[tplId];
                    let tplChanged = false;
                    const newElements = tpl.elements.map(el => {
                        let elChanged = false;
                        let newEl = { ...el };
                        if (newEl.type === 'grid' && newEl.gridConfig?.sourceType === 'specific' && newEl.gridConfig.sourceId && idsToDelete.has(newEl.gridConfig.sourceId)) {
                            newEl.gridConfig = { ...newEl.gridConfig, sourceType: 'current', sourceId: undefined };
                            elChanged = true;
                        }
                        if (newEl.linkTarget === 'specific_node' && newEl.linkValue && idsToDelete.has(newEl.linkValue)) {
                            newEl.linkTarget = 'none';
                            newEl.linkValue = undefined;
                            elChanged = true;
                        }
                        if (elChanged) tplChanged = true;
                        return newEl;
                    });
                    if (tplChanged) {
                        nextTemplates[tplId] = { ...tpl, elements: newElements };
                        variantChanged = true;
                    }
                });
                if (variantChanged) {
                    nextVariants[variantId] = { ...variant, templates: nextTemplates };
                }
            });

            let newSelectedId = prev.selectedNodeId;
            if (idsToDelete.has(newSelectedId) || !nextNodes[newSelectedId]) newSelectedId = prev.rootId;

            return { 
                ...prev, 
                nodes: nextNodes, 
                variants: nextVariants, 
                selectedNodeId: newSelectedId, 
                selectedNodeIds: [newSelectedId],
                selectedElementIds: [] 
            };
        });

        setDeleteConfirmState({ isOpen: false, nodeIds: [] });
    };

    const handleCreateReference = (targetId: string) => {
        const parentId = state.selectedNodeId;
        const targetNode = state.nodes[targetId];
        if (!parentId || !targetNode) return;
        saveToHistory();

        const newId = `ref_${Math.random().toString(36).substr(2, 9)}`;
        const newNode: AppNode = { id: newId, parentId, type: targetNode.type, title: targetNode.title, data: {}, children: [], referenceId: targetId };

        setState(prev => {
            const nextNodes = { ...prev.nodes, [newId]: newNode };
            nextNodes[parentId] = { ...nextNodes[parentId], children: [...nextNodes[parentId].children, newId] };
            return { ...prev, nodes: nextNodes };
        });
    };

    const handleAddTemplate = () => {
        saveToHistory();
        const newId = `tpl_${Math.random().toString(36).substr(2, 6)}`;
        const newTemplate: PageTemplate = { id: newId, name: 'New Template', width: RM_PP_WIDTH, height: RM_PP_HEIGHT, elements: [], layers: [createDefaultLayer()] };
        setState(prev => {
            const activeVariant = prev.variants[prev.activeVariantId];
            const updatedVariant = { ...activeVariant, templates: { ...activeVariant.templates, [newId]: newTemplate } };
            return { ...prev, variants: { ...prev.variants, [prev.activeVariantId]: updatedVariant }, selectedTemplateId: newId };
        });
    };

    const handleAddVariant = () => {
        setShowNewVariantModal(true);
    };

    const handleCreateVariant = (config: NewVariantConfig) => {
        saveToHistory();
        const newId = `variant_${Math.random().toString(36).substr(2, 6)}`;
        const activeTemplates = getActiveTemplates();
        // Deep-copy all templates, optionally reflowing to new dimensions
        const newTemplates = reflowTemplates(
            activeTemplates,
            config.targetWidth,
            config.targetHeight,
            config.reflow,
            config.scaleFontSize
        );
        const newVariant: Variant = {
            id: newId,
            name: config.name,
            templates: newTemplates
        };
        setState(prev => ({
            ...prev,
            variants: { ...prev.variants, [newId]: newVariant },
            activeVariantId: newId,
            selectedTemplateId: Object.keys(newVariant.templates)[0] || prev.selectedTemplateId
        }));
        setShowNewVariantModal(false);
    };

    const handleImportSvg = (file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const svgText = e.target?.result as string;
            if (!svgText) return;

            // Warn on large SVGs
            if (svgText.length > 100000) {
                const proceed = window.confirm(
                    `This SVG is ${(svgText.length / 1024).toFixed(0)}KB. Large SVGs will significantly increase your project file size. Continue?`
                );
                if (!proceed) return;
            }

            // Parse SVG to extract dimensions
            const parser = new DOMParser();
            const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
            const svgEl = svgDoc.documentElement;

            let svgW = 100, svgH = 100; // defaults
            const viewBox = svgEl.getAttribute('viewBox');
            if (viewBox) {
                const parts = viewBox.split(/[\s,]+/).map(Number);
                if (parts.length === 4 && !parts.some(isNaN)) {
                    svgW = parts[2];
                    svgH = parts[3];
                }
            } else {
                const wAttr = parseFloat(svgEl.getAttribute('width') || '');
                const hAttr = parseFloat(svgEl.getAttribute('height') || '');
                if (!isNaN(wAttr) && wAttr > 0) svgW = wAttr;
                if (!isNaN(hAttr) && hAttr > 0) svgH = hAttr;
            }

            // Scale down to fit within the destination template (hierarchy-aware) if necessary
            const template = getCurrentTemplate();
            const maxW = template ? template.width * 0.8 : 400;
            const maxH = template ? template.height * 0.8 : 400;
            const scale = Math.min(1, maxW / svgW, maxH / svgH);
            const finalW = Math.round(svgW * scale);
            const finalH = Math.round(svgH * scale);

            insertSvgElement(svgText, finalW, finalH);
        };
        reader.readAsText(file);
    };

    // Shared tail of every svg-adding path (file import, placeholder insert):
    // one history entry, placement via createPlacedSvgElement, select the new
    // element, switch to the select tool.
    const insertSvgElement = (svgText: string, w: number, h: number) => {
        saveToHistory();
        setState(prev => {
            const activeVariant = prev.variants[prev.activeVariantId];
            // Add to the template currently shown on the canvas. In hierarchy view that's
            // the selected node's template, not the Templates-tab selection — same
            // reconciliation the other element-mutating handlers already use.
            const tplId = prev.viewMode === 'hierarchy'
                ? prev.nodes[prev.selectedNodeId]?.type
                : prev.selectedTemplateId;
            const tpl = tplId ? activeVariant.templates[tplId] : undefined;
            if (!tpl) return prev;
            const placedElement = createPlacedSvgElement(svgText, w, h, tpl, prev.activeLayerId);
            const updatedTemplate = { ...tpl, elements: [...tpl.elements, placedElement] };
            const updatedVariant = { ...activeVariant, templates: { ...activeVariant.templates, [tplId]: updatedTemplate } };
            return {
                ...prev,
                variants: { ...prev.variants, [prev.activeVariantId]: updatedVariant },
                selectedElementIds: [placedElement.id],
                tool: 'select',
            };
        });
    };

    const handleInsertSvgPlaceholder = () => {
        insertSvgElement(PLACEHOLDER_SVG, 100, 100);
    };

    const handleSelectVariant = (variantId: string) => {
        if (!state.variants[variantId]) return;
        const firstTemplateId = Object.keys(state.variants[variantId].templates)[0];
        setState(prev => ({
            ...prev,
            activeVariantId: variantId,
            selectedTemplateId: firstTemplateId || prev.selectedTemplateId,
            selectedElementIds: []
        }));
    };

    const handleRenameVariant = (variantId: string, name: string) => {
        if (!state.variants[variantId]) return;
        saveToHistory();
        setState(prev => ({
            ...prev,
            variants: {
                ...prev.variants,
                [variantId]: { ...prev.variants[variantId], name }
            }
        }));
    };

    const handleDeleteVariant = (variantId: string) => {
        if (Object.keys(state.variants).length <= 1) {
            alert("Cannot delete the last variant.");
            return;
        }
        saveToHistory();
        const remainingVariants = { ...state.variants };
        delete remainingVariants[variantId];
        const newActiveId = Object.keys(remainingVariants)[0];
        const firstTemplateId = Object.keys(remainingVariants[newActiveId].templates)[0];
        setState(prev => ({
            ...prev,
            variants: remainingVariants,
            activeVariantId: newActiveId,
            selectedTemplateId: firstTemplateId || prev.selectedTemplateId,
            selectedElementIds: []
        }));
    };

    const handleDuplicateVariant = (variantId: string) => {
        if (!state.variants[variantId]) return;
        saveToHistory();
        const sourceVariant = state.variants[variantId];
        const newId = `variant_${Math.random().toString(36).substr(2, 6)}`;
        const newVariant: Variant = {
            id: newId,
            name: `${sourceVariant.name} (Copy)`,
            templates: JSON.parse(JSON.stringify(sourceVariant.templates)) // Deep copy templates
        };
        setState(prev => ({
            ...prev,
            variants: { ...prev.variants, [newId]: newVariant },
            activeVariantId: newId,
            selectedTemplateId: Object.keys(newVariant.templates)[0] || prev.selectedTemplateId
        }));
    };
    const handleDeleteTemplates = (ids: string[]) => {
        const activeTemplates = getActiveTemplates();
        const templatesCount = Object.keys(activeTemplates).length;
        if (templatesCount - ids.length <= 0) return alert("Cannot delete all templates. Leave at least one.");
        
        saveToHistory();
        setState(prev => {
            const activeVariant = prev.variants[prev.activeVariantId];
            const nextTemplates = { ...activeVariant.templates }; 
            ids.forEach(id => delete nextTemplates[id]);
            const updatedVariant = { ...activeVariant, templates: nextTemplates };
            
            const firstRemaining = Object.keys(nextTemplates)[0];
            const newSelectedId = nextTemplates[prev.selectedTemplateId] ? prev.selectedTemplateId : firstRemaining;

            return { 
                ...prev, 
                variants: { ...prev.variants, [prev.activeVariantId]: updatedVariant }, 
                selectedTemplateId: newSelectedId,
                selectedTemplateIds: [newSelectedId]
            };
        });
    };
    const handleUpdateTemplateName = (id: string, name: string) => {
        saveToHistory();
        setState(prev => {
            const activeVariant = prev.variants[prev.activeVariantId];
            const updatedVariant = { ...activeVariant, templates: { ...activeVariant.templates, [id]: { ...activeVariant.templates[id], name } } };
            return { ...prev, variants: { ...prev.variants, [prev.activeVariantId]: updatedVariant } };
        });
    };
    const handleUpdateTemplate = (id: string, updates: Partial<PageTemplate>, autoReflow: boolean = false, scaleFontSize: boolean = true) => {
        saveToHistory();
        setState(prev => {
            const activeVariant = prev.variants[prev.activeVariantId];
            const currentTemplate = activeVariant.templates[id];
            
            let newTemplateData = { ...currentTemplate, ...updates };

            // If autoReflow is enabled and dimensions are actually changing
            if (autoReflow && (updates.width !== undefined || updates.height !== undefined)) {
                const targetWidth = updates.width ?? currentTemplate.width;
                const targetHeight = updates.height ?? currentTemplate.height;
                
                // Reflow just this one template by passing a mock single-item record
                const reflowedMap = reflowTemplates(
                    { [id]: currentTemplate },
                    targetWidth,
                    targetHeight,
                    true,
                    scaleFontSize
                );
                
                // Merge everything cleanly: start with reflowed result, apply any additional incoming updates (e.g. name change)
                newTemplateData = { ...reflowedMap[id], ...updates };
            }

            const updatedVariant = { ...activeVariant, templates: { ...activeVariant.templates, [id]: newTemplateData } };
            return { ...prev, variants: { ...prev.variants, [prev.activeVariantId]: updatedVariant } };
        });
    };

    const handleUpdateTemplateElements = (newElements: TemplateElement[], shouldSaveHistory = true) => {
        let targetTemplateId = state.selectedTemplateId;
        if (state.viewMode === 'hierarchy') {
            const currentNode = state.nodes[state.selectedNodeId];
            if (!currentNode) return;
            targetTemplateId = currentNode.type;
        }
        if (shouldSaveHistory) saveToHistory();
        setState(prev => {
            const activeVariant = prev.variants[prev.activeVariantId];
            const updatedVariant = { ...activeVariant, templates: { ...activeVariant.templates, [targetTemplateId]: { ...activeVariant.templates[targetTemplateId], elements: newElements } } };
            return { ...prev, variants: { ...prev.variants, [prev.activeVariantId]: updatedVariant } };
        });
    };

    const handleDeleteElements = (ids: string[]) => {
        let targetTemplateId = state.selectedTemplateId;
        if (state.viewMode === 'hierarchy') targetTemplateId = state.nodes[state.selectedNodeId]?.type;
        if (!targetTemplateId) return;
        const activeTemplates = getActiveTemplates();
        const currentTemplate = activeTemplates[targetTemplateId];
        const newElements = currentTemplate.elements.filter(el => !ids.includes(el.id));
        handleUpdateTemplateElements(newElements, false);
        setState(prev => ({ ...prev, selectedElementIds: [] }));
    };

    const handleUpdateElement = (id: string, updates: Partial<TemplateElement>) => {
        let targetTemplateId = state.selectedTemplateId;
        if (state.viewMode === 'hierarchy') targetTemplateId = state.nodes[state.selectedNodeId]?.type;
        if (!targetTemplateId) return;
        saveToHistory();
        const activeTemplates = getActiveTemplates();
        const tpl = activeTemplates[targetTemplateId];
        const newElements = tpl.elements.map(el => el.id === id ? { ...el, ...updates } : el);
        handleUpdateTemplateElements(newElements, false);
    };

    const handleApplyGenerated = (
        project: GeneratedProject,
        source: GeneratorSourceDraft,
    ) => {
        saveToHistory();
        const generatedAt = new Date().toISOString();
        const rootTemplateId = project.nodes[project.rootId]?.type;
        const rootTemplate = project.variants[project.activeVariantId]?.templates[rootTemplateId];
        setState(current => ({
            ...current,
            nodes: project.nodes,
            rootId: project.rootId,
            variants: project.variants,
            activeVariantId: project.activeVariantId,
            schemaVersion: CURRENT_SCHEMA_VERSION,
            generator: { ...source, generatedAt },
            selectedNodeId: project.rootId,
            selectedNodeIds: [project.rootId],
            selectedTemplateId: '',
            selectedTemplateIds: [],
            selectedElementIds: [],
            activeLayerId: rootTemplate ? resolveActiveLayerId(rootTemplate) : '',
        }));
        trackEvent('generator_run', { rootId: project.rootId, nodeCount: Object.keys(project.nodes).length });
        return true;
    };

    const handleSavePreset = async (title: string, desc: string): Promise<boolean> => {
        const stateToSave = structuredClone({
            ...state,
            selectedElementIds: [],
            selectedNodeId: state.rootId,
            clipboard: [],
        });

        const success = await onSaveCustomPreset(title, desc, stateToSave);
        if (success) {
            trackEvent('preset_saved', { title });
        }
        return success;
    };

    const [exportGreyscale, setExportGreyscale] = useState(false);

    const handleExportPDF = async (options: { exportAllVariants?: boolean } = {}) => {
        setIsExporting(true);
        setTimeout(async () => {
            try {
                const variantsToExport = options.exportAllVariants ? Object.keys(state.variants) : [state.activeVariantId];
                for (const vid of variantsToExport) {
                    await generatePDF(state, {
                        isGreyscale: exportGreyscale,
                        variantId: vid,
                        projectName: projectId.split('-')[0]
                    });
                }
                trackEvent('pdf_exported', { 
                    projectId: projectId, 
                    pageCount: Object.keys(getActiveTemplates()).length, 
                    isGreyscale: exportGreyscale,
                    exportAllVariants: options.exportAllVariants
                });
            } catch (e) {
                console.error(e);
                alert("Failed to export PDF");
            } finally {
                setIsExporting(false);
            }
        }, 50);
    };

    const currentTemplateId = state.viewMode === 'hierarchy' ? state.nodes[state.selectedNodeId]?.type : state.selectedTemplateId;
    const activeTemplateMap = getActiveTemplates();
    const currentTemplate = activeTemplateMap[currentTemplateId] || Object.values(activeTemplateMap)[0];

    // Compute the effective node ID for preview/context
    // In hierarchy mode: use the selected node
    // In template mode: use templatePreviewNodeId if valid, or first matching node, or root
    const effectivePreviewNodeId = useMemo(() => {
        if (state.viewMode === 'hierarchy') {
            return state.selectedNodeId;
        }

        // Template mode - find a suitable node for preview
        const templateId = state.selectedTemplateId;

        // If a preview node is explicitly set and it matches the template, use it
        if (state.templatePreviewNodeId) {
            const node = state.nodes[state.templatePreviewNodeId];
            if (node && node.type === templateId) {
                return state.templatePreviewNodeId;
            }
        }

        // Otherwise find first node using this template
        const matchingNode = Object.values(state.nodes).find(n => n.type === templateId);
        if (matchingNode) {
            return matchingNode.id;
        }

        // Fallback to root
        return state.rootId;
    }, [state.viewMode, state.selectedNodeId, state.selectedTemplateId, state.templatePreviewNodeId, state.nodes, state.rootId]);

    const selectNodeTarget = (nodeId: string) => {
        saveToHistory();
        if (state.nodeSelectorMode === 'create_reference') {
            handleCreateReference(nodeId);
        } else if (state.editingElementId) {
            const templateToUpdate = getCurrentTemplate();
            if (!templateToUpdate) return;
            const newElements = templateToUpdate.elements.map(el => {
                if (el.id === state.editingElementId) {
                    if (state.nodeSelectorMode === 'grid_source' && el.gridConfig) {
                        return { ...el, gridConfig: { ...el.gridConfig, sourceType: 'specific' as const, sourceId: nodeId } };
                    }
                    if (state.nodeSelectorMode === 'link_element') {
                        return { ...el, linkTarget: 'specific_node' as const, linkValue: nodeId };
                    }
                }
                return el;
            });
            handleUpdateTemplateElements(newElements, false);
        }
    };
    return {
        state, projectId, projectName, undo, redo,
        canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0,
        setSession: (patch: Partial<EditorSessionState>) => setState(s => ({ ...s, ...patch })),
        setPreferences: (patch: EditorScalarPreferencePatch) => setState(s => ({ ...s, ...patch })),
        changeViewMode: (viewMode: AppState['viewMode']) => setState(s => ({ ...s, viewMode, selectedElementIds: [] })),
        replace: (next: AppState) => { saveToHistory(); setState(next); },
        jsonState: state, toolbarStateSetter: setState,
        exportSnapshot: () => state, showDeviceExport, setShowDeviceExport,
        exportGreyscale, setExportGreyscale, handleExportPDF, isExporting,
        handleSelectNode, handleAddNode, handleAddReference, requestDeleteNodes, handleDuplicateNodes, handleUpdateNode,
        handleSelectTemplate, handleAddTemplate, handleDeleteTemplates, handleDuplicateTemplates, handleUpdateTemplateName,
        handleSelectVariant, handleAddVariant, handleRenameVariant, handleDeleteVariant, handleDuplicateVariant,
        setResizingPanel, setShowScriptGenModal, setShowSavePresetModal, handleImportSvg, handleInsertSvgPlaceholder,
        currentTemplate, effectivePreviewNodeId, saveToHistory, handleUpdateTemplateElements,
        deleteElements: (ids: string[]) => { saveToHistory(); handleDeleteElements(ids); },
        duplicateElements: () => { saveToHistory(); handleDuplicate(); },
        // The touch Arrange menu's align: the desktop toolbar's legacy computation, recorded as one
        // undo step like every other touch edit (the toolbar's own legacy branch is unchanged).
        alignElements: (type: AlignType) => {
            const next = alignSelectedElements(state, type);
            if (next === state) return;
            saveToHistory();
            setState(next);
        },
        handleUpdateTemplate, layersExpanded, toggleLayers: () => setLayersExpanded(v => !v),
        showScriptGenModal, handleApplyGenerated, onCreateGeneratedProject, showSavePresetModal, handleSavePreset,
        showNewVariantModal, setShowNewVariantModal, handleCreateVariant, getActiveTemplates, selectNodeTarget,
        deleteConfirmState, setDeleteConfirmState, executeDeleteNode,
    };
}

type EditorViewModel = Omit<ReturnType<typeof useLegacyEditor>, 'toolbarStateSetter' | 'currentTemplate'> & (
    { toolbarStateSetter: React.Dispatch<React.SetStateAction<AppState>>; toolbarActions?: never }
    | { toolbarActions: ToolbarActions; toolbarStateSetter?: never }
) & {
    propertyActions?: IncrementalPropertyActions;
    layerActions?: LayerPanelActions;
    currentTemplate?: PageTemplate;
    contextKey?: string;
    onEditElements?: (intent: EditorElementIntent) => void;
    onInteractionEnd?: () => void;
    onInteractionCancel?: () => void;
    captureInteraction?: () => import('./Canvas').CanvasInteraction | undefined;
};

function LegacyProjectEditor(props: CommonProjectEditorProps) {
    return <ProjectEditorView {...useLegacyEditor(props)} />;
}

const selectionFrom = (context: EditorEditContext, patch: Partial<HistorySelection> = {}): HistorySelection => {
    const source = { ...context.preferences, ...context.session };
    const keys = ['activeVariantId', 'selectedNodeId', 'selectedTemplateId', 'selectedNodeIds', 'selectedTemplateIds', 'selectedElementIds', 'activeLayerId'];
    return { ...Object.fromEntries(keys.filter(key => Object.hasOwn(source, key)).map(key => [key, source[key as keyof typeof source]])), ...patch } as HistorySelection;
};
const templateIdFor = (state: AppState) => state.viewMode === 'hierarchy' ? state.nodes[state.selectedNodeId]?.type : state.selectedTemplateId;

function IncrementalProjectEditor(props: CommonProjectEditorProps & { incremental: EditorSourceBinding } & IncrementalEditorCallbacks) {
    const editor = useDocumentEditor(props.initialState, props.incremental);
    const state = editor.renderState;
    const committed = useRef<{ active: boolean; callbacks: IncrementalEditorCallbacks } | null>(null);
    useLayoutEffect(() => {
        committed.current = { active: true, callbacks: { onDocumentEdit: props.onDocumentEdit, onPreferencesChange: props.onPreferencesChange } };
        return () => { if (committed.current) committed.current.active = false; };
    }, [props.onDocumentEdit, props.onPreferencesChange]);
    const { source, capturePersistenceCut, registerPersistenceDrain } = props.incremental;
    const { drainEffects, getCurrent, isBusy } = editor;
    const deliver = useCallback((effect: EditorEffect) => {
        if (!committed.current?.active || effect.event.source !== source) return;
        if (effect.type === 'document') committed.current.callbacks.onDocumentEdit(effect.event);
        else {
            const { patch, ...metadata } = effect.event;
            committed.current.callbacks.onPreferencesChange(patch, metadata);
        }
    }, [source]);
    useLayoutEffect(() => {
        if (!registerPersistenceDrain || !capturePersistenceCut) return;
        let active = true;
        const unregister = registerPersistenceDrain({ generation: () => getCurrent().editorGeneration, isBusy,
            drainThrough(throughGeneration) {
                if (!active || !committed.current?.active) return Promise.resolve(false);
                try {
                    drainEffects(deliver, throughGeneration);
                    return Promise.resolve(capturePersistenceCut(throughGeneration))
                        .then(success => active && !!committed.current?.active && success === true, () => false);
                } catch { return Promise.resolve(false); }
            } });
        return () => { active = false; unregister(); };
    }, [source, registerPersistenceDrain, capturePersistenceCut, drainEffects, getCurrent, isBusy, deliver]);
    const run = <T,>(action: () => T): T | undefined => {
        if (!committed.current?.active) return;
        const result = action();
        drainEffects(deliver);
        return result;
    };
    const read = () => editor.getCurrent().renderState;
    const contextEpoch = useRef(0);
    const selectionEpoch = useRef(0);
    const group = useRef<string | undefined>(undefined);
    const propertyGroup = useRef<string | undefined>(undefined);
    const gestureStart = useRef<PageTemplate | undefined>(undefined);
    const canvasInteraction = useRef<{ selectionEpoch: number; groupId?: string } | undefined>(undefined);
    const finishGroups = () => {
        if (group.current) editor.finishGroup(group.current);
        if (propertyGroup.current) editor.finishGroup(propertyGroup.current);
        group.current = undefined; propertyGroup.current = undefined;
        gestureStart.current = undefined;
    };
    const invalidateContext = () => {
        canvasInteraction.current = undefined;
        finishGroups(); contextEpoch.current++;
        editor.updateSession({ showNodeSelector: false, editingElementId: null });
    };
    const renderedEpoch = contextEpoch.current;
    const renderedSelectionEpoch = selectionEpoch.current;
    const address = { variantId: state.activeVariantId, templateId: templateIdFor(state) };
    const targetIsCurrent = () => committed.current?.active && renderedEpoch === contextEpoch.current
        && read().activeVariantId === address.variantId && templateIdFor(read()) === address.templateId;
    const operations = (context: EditorEditContext) => createEditOperations(context.document, { ...context.preferences, ...context.session }, context.references);
    const edit = (prepare: (context: EditorEditContext) => PreparedEditorEdit, groupId?: string, canvasOwner?: { selectionEpoch: number }) => run(() => {
        if (!groupId) finishGroups();
        const before = read().selectedElementIds;
        const result = editor.edit(prepare, groupId ? { groupId } : undefined);
        const after = read().selectedElementIds;
        if (before.length !== after.length || before.some((id, index) => id !== after[index])) selectionEpoch.current++;
        if (canvasOwner && canvasInteraction.current === canvasOwner) canvasOwner.selectionEpoch = selectionEpoch.current;
        return result;
    });
    const command = (prepare: (ops: ReturnType<typeof createEditOperations>, context: EditorEditContext) => readonly DocumentChange[]) =>
        edit(context => ({ changes: prepare(operations(context), context), mappings: [] }));
    const structural = (prepare: (ops: ReturnType<typeof createStructuralEditorOperations>) => StructuralEditorEdit) => edit(context => {
        const result = prepare(createStructuralEditorOperations(context.document, { ...context.preferences, ...context.session }, context.references));
        return { ...result, selection: selectionFrom(context, result.selectionPatch) };
    });
    const [deleteConfirmState, setDeleteConfirmState] = useState({ isOpen: false, nodeIds: [] as string[] });
    const [showScriptGenModal, setShowScriptGenModal] = useState(false);
    const [showSavePresetModal, setShowSavePresetModal] = useState(false);
    const [showNewVariantModal, setShowNewVariantModal] = useState(false);
    // Owned here (not in the view) so the shortcut handler below can bail out while the dialog is open.
    const [showDeviceExport, setShowDeviceExport] = useState(false);
    const [resizingPanel, setResizingPanel] = useState<'sidebar' | 'properties' | null>(null);
    const [exportGreyscale, setExportGreyscale] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [jsonState, setJsonState] = useState(props.initialState);
    const setSession = (patch: Partial<EditorSessionState>) => run(() => {
        if (patch.showJsonModal) setJsonState(editor.exportState());
        if (patch.selectedElementIds || patch.tool) { canvasInteraction.current = undefined; finishGroups(); }
        if (patch.selectedElementIds) {
            const current = read().selectedElementIds;
            if (current.length !== patch.selectedElementIds.length || current.some((id, index) => id !== patch.selectedElementIds![index])) selectionEpoch.current++;
            editor.updateSession({ showNodeSelector: false, editingElementId: null });
        }
        editor.updateSession(patch);
    });
    const setPreferences = (patch: EditorScalarPreferencePatch) => run(() => editor.updatePreferences(patch));
    const setPanelExpanded = (key: string, expanded: boolean) => setPreferences({ panelsExpanded: { ...editor.getCurrent().preferences.panelsExpanded, [key]: expanded } });
    const changeViewMode = (viewMode: AppState['viewMode']) => run(() => {
        invalidateContext(); editor.updateSession({ selectedElementIds: [] }); editor.updatePreferences({ viewMode });
    });
    const select = (kind: 'node' | 'template', id: string, ctrl: boolean, shift: boolean) => run(() => {
        const current = read();
        let ids = (kind === 'node' ? current.selectedNodeIds : current.selectedTemplateIds) ?? [];
        if (shift && ids.length) {
            const visible = Array.from(document.querySelectorAll(`[data-${kind}-id]`)).map(el => el.getAttribute(`data-${kind}-id`)!);
            const start = visible.indexOf(ids[ids.length - 1]), end = visible.indexOf(id);
            if (start >= 0 && end >= 0) ids = [...new Set([...ids, ...visible.slice(Math.min(start, end), Math.max(start, end) + 1)])];
        } else if (ctrl) ids = ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id];
        else ids = [id];
        const active = ids.length ? (ctrl && !ids.includes(id) ? ids[ids.length - 1] : id) : kind === 'node' ? current.rootId : current.selectedTemplateId;
        invalidateContext();
        editor.updateSession({ ...(kind === 'node' ? { selectedNodeIds: ids } : { selectedTemplateIds: ids }), selectedElementIds: [] });
        editor.updatePreferences(kind === 'node' ? { selectedNodeId: active } : { selectedTemplateId: active });
    });
    const handleSelectVariant = (activeVariantId: string) => run(() => {
        const variant = read().variants[activeVariantId]; if (!variant) return;
        invalidateContext(); const selectedTemplateId = Object.keys(variant.templates)[0] ?? '';
        editor.updateSession({ selectedTemplateIds: selectedTemplateId ? [selectedTemplateId] : [], selectedElementIds: [] });
        editor.updatePreferences({ activeVariantId, selectedTemplateId });
    });
    const patchNodes: IncrementalPropertyActions['patchNodes'] = (ids, updates) => {
        if (!targetIsCurrent()) return;
        command((ops, context) => ids.flatMap(id => {
            const current = context.document.nodes[id];
            if (!current) return [];
            if (!updates.data) return ops.updateNode(id, updates);
            // Legacy child emits a complete node-data map. Extract only its field
            // intent against that render's map, then merge into the current record.
            const before = state.nodes[id]?.data ?? {};
            const data = { ...current.data };
            for (const key of Object.keys(before)) if (!Object.hasOwn(updates.data, key)) delete data[key];
            for (const [key, value] of Object.entries(updates.data))
                if (!Object.hasOwn(before, key) || !Object.is(before[key], value))
                    Object.defineProperty(data, key, { value, enumerable: true, writable: true, configurable: true });
            return ops.updateNode(id, { ...updates, data });
        }));
    };
    const requestDeleteNodes = (ids: string[]) => {
        if (ids.includes(read().rootId)) { alert('Cannot delete root node.'); return; }
        setDeleteConfirmState({ isOpen: true, nodeIds: [...ids] });
    };
    const executeDeleteNode = () => {
        edit(context => {
            const changes = operations(context).deleteNodes(deleteConfirmState.nodeIds);
            const removed = new Set(changes.flatMap(change => change.type === 'delete-node' ? [change.nodeId] : []));
            const selectedNodeId = removed.has(context.preferences.selectedNodeId) ? context.document.rootId : context.preferences.selectedNodeId;
            return { changes, mappings: [], selection: selectionFrom(context, { selectedNodeId, selectedNodeIds: [selectedNodeId], selectedElementIds: [] }) };
        });
        setDeleteConfirmState({ isOpen: false, nodeIds: [] });
    };
    const handleDuplicateNodes = (ids: string[]) => {
        if (ids.includes(read().rootId)) { alert('Cannot duplicate the root node.'); return; }
        edit(context => {
            const changes = operations(context).duplicateNodes(ids);
            const newIds = changes.flatMap(change => change.type === 'put-node' && !Object.hasOwn(context.document.nodes, change.node.id)
                && change.node.parentId && Object.hasOwn(context.document.nodes, change.node.parentId) ? [change.node.id] : []);
            return { changes, mappings: [], selection: selectionFrom(context, newIds.length ? { selectedNodeIds: newIds, selectedNodeId: newIds[0], selectedElementIds: [] } : {}) };
        });
    };
    const rawTemplate = editor.document.variants[address.variantId]?.templates[address.templateId];
    const onEditElements = (intent: EditorElementIntent, canvasOwner?: { selectionEpoch: number; groupId?: string }) => {
        if (!targetIsCurrent() || !canvasOwner || canvasInteraction.current !== canvasOwner || canvasOwner.selectionEpoch !== selectionEpoch.current) return;
        if (!group.current) { finishGroups(); gestureStart.current = editor.getCurrent().document.variants[address.variantId]?.templates[address.templateId]; group.current = editor.beginGroup(); }
        canvasOwner.groupId = group.current;
        edit(context => {
            const template = context.document.variants[address.variantId]?.templates[address.templateId];
            if (!template) return { changes: [], mappings: [] };
            let elements: TemplateElement[];
            if (intent.type === 'append') elements = [...template.elements, ...intent.elements];
            else {
                const patches = new Map(intent.updates.map(update => [update.id, update.patch]));
                elements = template.elements.map((element, i) => {
                    const patch = patches.get(element.id); if (!patch) return element;
                    if (Object.entries(patch).every(([key, value]) => Object.hasOwn(element, key) && Object.is(element[key as keyof TemplateElement], value))) return element;
                    const next = { ...element, ...patch };
                    const start = gestureStart.current?.elements[i];
                    if (patch.transformOrigin && start?.id === element.id) {
                        next.transformOrigin = { ...element.transformOrigin, ...patch.transformOrigin };
                        const origin = start.transformOrigin;
                        if (next.transformOrigin.x === (origin?.x ?? .5) && next.transformOrigin.y === (origin?.y ?? .5)
                            && Object.entries(next.transformOrigin).every(([key, value]) => key === 'x' || key === 'y'
                                || Object.is(origin?.[key as keyof typeof origin], value))) {
                            if (Object.hasOwn(start, 'transformOrigin')) next.transformOrigin = origin;
                            else delete next.transformOrigin;
                        }
                    }
                    // Selected record only: immutable field/reference equality permits
                    // the accepted history core to recognize a net-zero gesture.
                    if (start?.id === next.id && Object.keys(next).length === Object.keys(start).length
                        && Object.entries(next).every(([key, value]) => Object.hasOwn(start, key) && Object.is(start[key as keyof TemplateElement], value))) return start;
                    return next;
                });
            }
            let next = { ...template, elements };
            const start = gestureStart.current;
            if (start && elements.length === start.elements.length && elements.every((element, i) => element === start.elements[i])
                && Object.entries(template).every(([key, value]) => key === 'elements' || Object.is(start[key as keyof PageTemplate], value))) next = start;
            const unchanged = next === template || elements.length === template.elements.length && elements.every((element, i) => element === template.elements[i]);
            return { changes: unchanged ? [] : [{ type: 'put-template', variantId: address.variantId, template: next }], mappings: [],
                ...(intent.type === 'append' && intent.selectedElementIds ? { selection: selectionFrom(context, { selectedElementIds: [...intent.selectedElementIds] }) } : {}) };
        }, group.current, canvasOwner);
    };
    const createInteraction = (): import('./Canvas').CanvasInteraction => {
        finishGroups();
        const owner: { selectionEpoch: number; groupId?: string } = { selectionEpoch: selectionEpoch.current };
        canvasInteraction.current = owner;
        const isCurrent = () => !!targetIsCurrent() && canvasInteraction.current === owner && owner.selectionEpoch === selectionEpoch.current;
        return {
            isCurrent,
            start() {
                if (!isCurrent() || group.current) return;
                finishGroups();
                gestureStart.current = editor.getCurrent().document.variants[address.variantId]?.templates[address.templateId];
                group.current = editor.beginGroup();
                owner.groupId = group.current;
            },
            edit(intent) { if (isCurrent()) onEditElements(intent, owner); },
            select(ids) {
                if (!isCurrent()) return;
                const current = read().selectedElementIds;
                if (current.length !== ids.length || current.some((id, index) => id !== ids[index])) selectionEpoch.current++;
                owner.selectionEpoch = selectionEpoch.current;
                run(() => editor.updateSession({ selectedElementIds: ids, showNodeSelector: false, editingElementId: null }));
            },
            handoffToInline() {
                // An append advances this owner's selection epoch before delivery.
                // Only its still-current continuation may close creation history and
                // transfer authority; a consumer-invalidated owner cannot restart it.
                if (!isCurrent()) return;
                return createInteraction();
            },
            end() {
                if (!isCurrent()) return;
                run(() => { if (owner.groupId && group.current === owner.groupId) finishGroups(); canvasInteraction.current = undefined; });
            },
            cancel() {
                if (!isCurrent()) return;
                run(() => {
                    if (owner.groupId && group.current === owner.groupId) { editor.cancelGroup(owner.groupId); finishGroups(); }
                    canvasInteraction.current = undefined;
                });
            },
        };
    };
    const captureInteraction: EditorViewModel['captureInteraction'] = () => {
        if (!targetIsCurrent() || renderedSelectionEpoch !== selectionEpoch.current) return;
        return createInteraction();
    };
    const patchElements: IncrementalPropertyActions['patchElements'] = (ids, updates, saveHistory) => {
        if (!targetIsCurrent() || renderedSelectionEpoch !== selectionEpoch.current) return;
        // Existing SVG true/false callbacks denote one contiguous focus burst.
        if (saveHistory || !propertyGroup.current) {
            finishGroups(); propertyGroup.current = editor.beginGroup();
        }
        edit(context => {
            const template = context.document.variants[address.variantId]?.templates[address.templateId];
            if (!template) return { changes: [], mappings: [] };
            const selected = new Set(ids);
            const elements = template.elements.map(element => {
                if (!selected.has(element.id)) return element;
                const patch = typeof updates === 'function' ? updates(element) : updates;
                return Object.entries(patch).every(([key, value]) => Object.hasOwn(element, key) && Object.is(element[key as keyof TemplateElement], value)) ? element : { ...element, ...patch };
            });
            return { changes: elements.every((element, i) => element === template.elements[i]) ? [] : operations(context).updateTemplateElements(elements), mappings: [] };
        }, propertyGroup.current);
    };
    const handleUpdateTemplateElements = (elements: TemplateElement[], _save = true) => {
        if (!targetIsCurrent()) return;
        edit(context => {
            const current = context.document.variants[address.variantId]?.templates[address.templateId];
            // Complete-array child callbacks are synchronous and source-record fenced.
            if (!current || current.elements !== rawTemplate?.elements || elements.every((el, i) => el === current.elements[i]) && elements.length === current.elements.length)
                return { changes: [], mappings: [] };
            return { changes: operations(context).updateTemplateElements(elements), mappings: [] };
        }, group.current);
    };
    const deleteCurrentElements = (ids: string[]) => edit(context => ({ changes: operations(context).deleteElements(ids), mappings: [],
        selection: selectionFrom(context, { selectedElementIds: [] }) }));
    const deleteElements = (ids: string[]) => {
        if (!targetIsCurrent() || renderedSelectionEpoch !== selectionEpoch.current) return;
        deleteCurrentElements(ids);
    };
    const copyElements = (cut: boolean) => {
        const current = read(); const template = editor.getCurrent().document.variants[current.activeVariantId]?.templates[templateIdFor(current)];
        if (!template) return;
        const clipboard = template.elements.filter(element => current.selectedElementIds.includes(element.id));
        if (cut) edit(context => ({ changes: operations(context).deleteElements(current.selectedElementIds), mappings: [],
            sessionPatch: { clipboard: [...clipboard] }, selection: selectionFrom(context, { selectedElementIds: [] }) }));
        else setSession({ clipboard: [...clipboard] });
    };
    const paste = (duplicate: boolean) => edit(context => {
        const current = context.document.variants[context.preferences.activeVariantId]?.templates[context.preferences.viewMode === 'hierarchy'
            ? context.document.nodes[context.preferences.selectedNodeId]?.type : context.preferences.selectedTemplateId];
        const changes = duplicate ? operations(context).duplicate() : operations(context).paste();
        const next = changes.find(change => change.type === 'put-template');
        const ids = next?.type === 'put-template' ? next.template.elements.slice(current?.elements.length ?? 0).map(element => element.id) : [];
        return { changes, mappings: [], selection: selectionFrom(context, { selectedElementIds: ids }) };
    });
    const insertSvg = (svg: string, width: number, height: number, fit = false) => {
        if (!targetIsCurrent()) return;
        edit(context => {
            const template = context.document.variants[address.variantId]?.templates[address.templateId];
            if (!template) return { changes: [], mappings: [] };
            const scale = fit ? Math.min(1, template.width * .8 / width, template.height * .8 / height) : 1;
            const placement = { ...template, layers: template.layers?.filter(layer => layer && typeof layer === 'object' && !Array.isArray(layer) && typeof layer.id === 'string') };
            const placed = createPlacedSvgElement(svg, Math.round(width * scale), Math.round(height * scale), placement, context.session.activeLayerId);
            return { changes: operations(context).updateTemplateElements([...template.elements, placed]), mappings: [],
                sessionPatch: { tool: 'select' }, selection: selectionFrom(context, { selectedElementIds: [placed.id] }) };
        });
    };
    const handleImportSvg = (file: File) => {
        const importSelectionEpoch = selectionEpoch.current;
        const importIsCurrent = () => targetIsCurrent() && importSelectionEpoch === selectionEpoch.current;
        const reader = new FileReader();
        reader.onload = event => {
            if (!importIsCurrent()) return;
            const svg = event.target?.result; if (typeof svg !== 'string' || !svg) return;
            if (svg.length > 100000 && !window.confirm(`This SVG is ${(svg.length / 1024).toFixed(0)}KB. Large SVGs will significantly increase your project file size. Continue?`)) return;
            if (!importIsCurrent()) return;
            const element = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
            const box = element.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
            const width = box?.length === 4 ? box[2] : parseFloat(element.getAttribute('width') ?? '');
            const height = box?.length === 4 ? box[3] : parseFloat(element.getAttribute('height') ?? '');
            insertSvg(svg, width > 0 && Number.isFinite(width) ? width : 100, height > 0 && Number.isFinite(height) ? height : 100, true);
        };
        reader.readAsText(file);
    };
    const handleUpdateTemplate: EditorViewModel['handleUpdateTemplate'] = (id, updates, reflow, scaleFonts) => {
        if (!targetIsCurrent()) return;
        command(ops => ops.updateTemplate(id, updates, reflow, scaleFonts));
    };
    const layerActions: LayerPanelActions = {
        sequence: rawTemplate?.layers,
        moveElements(ids, position) {
            if (!targetIsCurrent()) return;
            edit(context => {
                const template = context.document.variants[address.variantId]?.templates[address.templateId];
                const layer = template?.layers?.[position];
                if (!template || template.layers !== rawTemplate?.layers || !layer || typeof layer.id !== 'string') return { changes: [], mappings: [] };
                return { changes: operations(context).updateTemplateElements(moveElementsToLayer(template.elements, [...ids], layer.id)), mappings: [] };
            });
        },
        setCollapsed(position, value) {
            if (!targetIsCurrent() || editor.getCurrent().document.variants[address.variantId]?.templates[address.templateId]?.layers !== rawTemplate?.layers) return;
            run(() => editor.setLayerCollapsed({ ...address, position }, value));
        },
        edit(action) {
            if (!targetIsCurrent()) return;
            edit(context => {
                if (context.document.variants[address.variantId]?.templates[address.templateId]?.layers !== rawTemplate?.layers) return { changes: [], mappings: [] };
                const result = prepareLayerEdit(context.document, address, action);
                return { ...result, ...(result.activeLayerId ? { selection: selectionFrom(context, { activeLayerId: result.activeLayerId }) } : {}) };
            });
        },
    };
    const align: ToolbarActions['onAlign'] = type => {
        const current = read(); const template = editor.getCurrent().document.variants[current.activeVariantId]?.templates[templateIdFor(current)];
        const selected = template?.elements.filter(element => current.selectedElementIds.includes(element.id)) ?? [];
        if (selected.length < 2) return;
        const horizontal = ['left', 'center', 'right', 'dist-h'].includes(type);
        const axis = horizontal ? 'x' : 'y', extent = horizontal ? 'w' : 'h';
        const min = Math.min(...selected.map(element => element[axis]));
        const max = Math.max(...selected.map(element => element[axis] + element[extent]));
        const positions = new Map<string, number>();
        if (type === 'dist-h' || type === 'dist-v') {
            const sorted = [...selected].sort((a, b) => a[axis] - b[axis]);
            const end = sorted[sorted.length - 1];
            const gap = (end[axis] + end[extent] - min - sorted.reduce((sum, element) => sum + element[extent], 0)) / (sorted.length - 1);
            let cursor = min;
            sorted.forEach(element => { positions.set(element.id, element === end ? end[axis] : cursor); cursor += element[extent] + gap; });
        } else selected.forEach(element => positions.set(element.id,
            type === 'left' || type === 'top' ? min : type === 'right' || type === 'bottom' ? max - element[extent] : (min + max - element[extent]) / 2));
        patchElements(current.selectedElementIds, element => ({ [axis]: positions.get(element.id) ?? element[axis] }), true);
        run(finishGroups);
    };
    const replace = (next: AppState) => run(() => { invalidateContext(); editor.replace(next); });
    const workingReplacement = useRef(replace);
    useLayoutEffect(() => { workingReplacement.current = replace; });
    useLayoutEffect(() => props.incremental.registerWorkingState?.({ exportState: editor.exportState,
        generation: () => editor.getCurrent().editorGeneration, replace: next => { workingReplacement.current(next); } }),
    [props.incremental.source, props.incremental.registerWorkingState, editor.exportState, editor.getCurrent]);
    const undo = () => run(() => { invalidateContext(); editor.undo(); });
    const redo = () => run(() => { invalidateContext(); editor.redo(); });
    const handleApplyGenerated: EditorViewModel['handleApplyGenerated'] = (project, source) => {
        const rootTemplate = project.variants[project.activeVariantId]?.templates[project.nodes[project.rootId]?.type];
        replace({ ...editor.exportState(), ...project, schemaVersion: CURRENT_SCHEMA_VERSION,
            generator: { ...source, generatedAt: new Date().toISOString() }, selectedNodeId: project.rootId, selectedNodeIds: [project.rootId],
            selectedTemplateId: '', selectedTemplateIds: [], selectedElementIds: [], activeLayerId: rootTemplate ? resolveActiveLayerId(rootTemplate) : '' });
        trackEvent('generator_run', { rootId: project.rootId, nodeCount: Object.keys(project.nodes).length }); return true;
    };
    const handleSavePreset: EditorViewModel['handleSavePreset'] = async (title, desc) => {
        const raw = editor.exportState();
        const success = await props.onSaveCustomPreset(title, desc, structuredClone({ ...raw, selectedElementIds: [], selectedNodeId: raw.rootId, clipboard: [] }));
        if (success) trackEvent('preset_saved', { title }); return success;
    };
    const handleExportPDF: EditorViewModel['handleExportPDF'] = async (options = {}) => {
        const raw = editor.exportState(); setIsExporting(true);
        try {
            for (const variantId of options.exportAllVariants ? Object.keys(raw.variants) : [read().activeVariantId])
                await generatePDF(raw, { variantId, isGreyscale: exportGreyscale, projectName: props.projectId.split('-')[0] });
            trackEvent('pdf_exported', { projectId: props.projectId, exportAllVariants: options.exportAllVariants, isGreyscale: exportGreyscale });
        } catch (error) { console.error(error); alert('Failed to export PDF'); }
        finally { if (committed.current?.active) setIsExporting(false); }
    };
    const selectNodeTarget = (nodeId: string) => {
        if (!targetIsCurrent()) return;
        const current = read();
        if (!current.showNodeSelector) return;
        if (current.nodeSelectorMode === 'create_reference') command(ops => ops.createReference(nodeId));
        else if (current.editingElementId) patchElements([current.editingElementId], element =>
            current.nodeSelectorMode === 'grid_source' && element.gridConfig ? { gridConfig: { ...element.gridConfig, sourceType: 'specific', sourceId: nodeId } }
                : current.nodeSelectorMode === 'link_element' ? { linkTarget: 'specific_node', linkValue: nodeId } : {}, true);
    };
    useEffect(() => {
        if (!resizingPanel) return;
        const move = (event: MouseEvent) => {
            event.preventDefault();
            setPreferences(resizingPanel === 'sidebar' ? { sidebarWidth: Math.max(200, Math.min(600, event.clientX)) }
                : { propertiesPanelWidth: Math.max(250, Math.min(600, window.innerWidth - event.clientX)) });
        };
        const end = () => setResizingPanel(null);
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', end); document.body.style.cursor = 'col-resize';
        return () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', end); document.body.style.cursor = 'default'; };
    }, [resizingPanel]);
    useEffect(() => {
        if (!props.isActive) return;
        const key = (event: KeyboardEvent) => {
            const current = read();
            if (current.showJsonModal || current.showNodeSelector || deleteConfirmState.isOpen || showScriptGenModal || showSavePresetModal || showNewVariantModal || showDeviceExport) return;
            if (['input', 'textarea'].includes(document.activeElement?.tagName.toLowerCase() ?? '')) return;
            const modifier = event.ctrlKey || event.metaKey;
            if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
            if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
            if (event.key === 'Delete' || event.key === 'Backspace') {
                if (current.selectedElementIds.length) deleteCurrentElements(current.selectedElementIds);
                else if (current.viewMode === 'hierarchy') requestDeleteNodes(current.selectedNodeIds);
                else if (current.selectedTemplateIds.length) structural(ops => ops.deleteTemplates(current.selectedTemplateIds));
            }
            if (modifier && ['c', 'x', 'v', 'p', 'd'].includes(event.key.toLowerCase())) {
                event.preventDefault(); const letter = event.key.toLowerCase();
                if (letter === 'c' || letter === 'x') copyElements(letter === 'x');
                else if (letter === 'd' && !current.selectedElementIds.length) {
                    if (current.viewMode === 'hierarchy') handleDuplicateNodes(current.selectedNodeIds);
                    else structural(ops => ops.duplicateTemplates(current.selectedTemplateIds));
                } else paste(letter === 'd');
            }
            if (!modifier && !event.altKey) {
                const tools: Record<string, AppState['tool']> = { v: 'select', h: 'hand', t: 'text', r: 'rect', e: 'ellipse', y: 'triangle', l: 'line', g: 'grid' };
                if (tools[event.key.toLowerCase()]) setSession({ tool: tools[event.key.toLowerCase()] });
            }
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && current.selectedElementIds.length) {
                event.preventDefault(); const delta = event.shiftKey || current.snapToGrid ? 10 : 1;
                const dx = event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0;
                const dy = event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0;
                patchElements(current.selectedElementIds, element => ({ x: element.x + dx, y: element.y + dy }), true); run(finishGroups);
            }
        };
        window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
    });
    const getActiveTemplates = () => read().variants[read().activeVariantId]?.templates ?? {};
    const effectivePreviewNodeId = state.viewMode === 'hierarchy' ? state.selectedNodeId
        : state.templatePreviewNodeId && state.nodes[state.templatePreviewNodeId]?.type === state.selectedTemplateId ? state.templatePreviewNodeId
            : Object.values(state.nodes).find(node => node.type === state.selectedTemplateId)?.id ?? state.rootId;
    const model: EditorViewModel = {
        state, projectId: props.projectId, projectName: props.projectName, undo, redo,
        canUndo: editor.historyStatus.canUndo, canRedo: editor.historyStatus.canRedo,
        setSession, setPreferences, changeViewMode, replace, jsonState,
        toolbarActions: { onToolChange: tool => setSession({ tool }), onPreferencesChange: setPreferences,
            onPreviewNodeChange: templatePreviewNodeId => setSession({ templatePreviewNodeId }), onAlign: align },
        propertyActions: { contextEpoch: `${renderedEpoch}:${renderedSelectionEpoch}`, patchElements, patchNodes, setPanelExpanded, panelsExpanded: editor.preferences.panelsExpanded }, layerActions,
        exportSnapshot: editor.exportState, showDeviceExport, setShowDeviceExport,
        exportGreyscale, setExportGreyscale, handleExportPDF, isExporting,
        handleSelectNode: (id, ctrl, shift) => select('node', id, ctrl, shift),
        handleSelectTemplate: (id, ctrl, shift) => select('template', id, ctrl, shift),
        handleAddNode: parentId => { command(ops => ops.addNode(parentId)); },
        handleAddReference: selectedNodeId => run(() => { invalidateContext(); editor.updateSession({ showNodeSelector: true, nodeSelectorMode: 'create_reference' }); editor.updatePreferences({ selectedNodeId }); }),
        requestDeleteNodes, handleDuplicateNodes, handleUpdateNode: (id, updates) => patchNodes([id], updates),
        handleAddTemplate: () => { structural(ops => ops.addTemplate()); },
        handleDeleteTemplates: ids => { if (Object.keys(getActiveTemplates()).length <= new Set(ids).size) { alert('Cannot delete all templates. Leave at least one.'); return; } structural(ops => ops.deleteTemplates(ids)); },
        handleDuplicateTemplates: ids => { structural(ops => ops.duplicateTemplates(ids)); },
        handleUpdateTemplateName: (id, name) => { command(ops => ops.updateTemplateName(id, name)); },
        handleSelectVariant, handleAddVariant: () => setShowNewVariantModal(true),
        handleRenameVariant: (id, name) => { command(ops => ops.renameVariant(id, name)); },
        handleDeleteVariant: id => { if (Object.keys(read().variants).length <= 1) { alert('Cannot delete the last variant.'); return; } structural(ops => ops.deleteVariant(id)); },
        handleDuplicateVariant: id => { structural(ops => ops.duplicateVariant(id)); },
        setResizingPanel, setShowScriptGenModal, setShowSavePresetModal, handleImportSvg,
        handleInsertSvgPlaceholder: () => insertSvg(PLACEHOLDER_SVG, 100, 100),
        currentTemplate: editor.currentTemplate, effectivePreviewNodeId, contextKey: JSON.stringify([state.activeVariantId, address.templateId, renderedEpoch]),
        saveToHistory: () => run(() => { finishGroups(); gestureStart.current = editor.getCurrent().document.variants[address.variantId]?.templates[address.templateId]; group.current = editor.beginGroup(); }),
        onEditElements, captureInteraction,
        onInteractionEnd: () => run(finishGroups),
        onInteractionCancel: () => run(() => { const id = group.current; if (id) editor.cancelGroup(id); finishGroups(); }),
        handleUpdateTemplateElements, deleteElements, duplicateElements: () => { paste(true); }, alignElements: align, handleUpdateTemplate,
        layersExpanded: editor.preferences.panelsExpanded.layers ?? false, toggleLayers: () => setPanelExpanded('layers', !(editor.getCurrent().preferences.panelsExpanded.layers ?? false)),
        showScriptGenModal, handleApplyGenerated, onCreateGeneratedProject: props.onCreateGeneratedProject,
        showSavePresetModal, handleSavePreset, showNewVariantModal, setShowNewVariantModal,
        handleCreateVariant: config => { structural(ops => ops.createVariant(config)); setShowNewVariantModal(false); },
        getActiveTemplates, selectNodeTarget, deleteConfirmState, setDeleteConfirmState, executeDeleteNode,
    };
    return <ProjectEditorView {...model} />;
}

function EditorCanvas({ contextKey, ...props }: React.ComponentProps<typeof Canvas> & { contextKey?: string }) {
    // Gesture ownership must remount on context changes; bounded font metrics do
    // not. Keep their existing invalidation/cleanup owner outside that reset key.
    const textLayoutSession = useCanvasTextLayoutSession();
    return <Canvas key={contextKey} {...props} textLayoutSession={textLayoutSession} />;
}

function ProjectEditorView({
    state, projectId, projectName, undo, redo, canUndo, canRedo, setSession, setPreferences, changeViewMode, replace,
    jsonState, toolbarStateSetter, toolbarActions, propertyActions, layerActions, contextKey, exportGreyscale, setExportGreyscale, handleExportPDF, isExporting,
    exportSnapshot, showDeviceExport, setShowDeviceExport,
    handleSelectNode, handleAddNode, handleAddReference, requestDeleteNodes, handleDuplicateNodes, handleUpdateNode,
    handleSelectTemplate, handleAddTemplate, handleDeleteTemplates, handleDuplicateTemplates, handleUpdateTemplateName,
    handleSelectVariant, handleAddVariant, handleRenameVariant, handleDeleteVariant, handleDuplicateVariant,
    setResizingPanel, setShowScriptGenModal, setShowSavePresetModal, handleImportSvg, handleInsertSvgPlaceholder,
    currentTemplate, effectivePreviewNodeId, saveToHistory, handleUpdateTemplateElements, deleteElements, duplicateElements, alignElements,
    handleUpdateTemplate, layersExpanded, toggleLayers, showScriptGenModal, handleApplyGenerated, onCreateGeneratedProject,
    showSavePresetModal, handleSavePreset, showNewVariantModal, setShowNewVariantModal, handleCreateVariant,
    getActiveTemplates, selectNodeTarget, deleteConfirmState, setDeleteConfirmState, executeDeleteNode,
    onEditElements, onInteractionEnd, onInteractionCancel, captureInteraction,
}: EditorViewModel) {
    const formFactor = useFormFactor();
    const isTouch = formFactor !== 'desktop';
    // Touch: every page/template pick in the drawer closes it, including a pick of the one already
    // selected, which changes no state; the pick count is folded into the layout's navigation key.
    const [pickCount, countPick] = useReducer((count: number) => count + 1, 0);
    // Touch zoom is session-local: it never reaches the persisted scale preference.
    const touchViewport = useTouchViewport();
    // "Select multiple" is session-only too, held here above the canvas (which remounts on context changes).
    const { multiSelect, toggleMultiSelect } = useTouchMultiSelect({ tool: state.tool, enabled: isTouch, setTool: tool => setSession({ tool }) });
    const editorBar = (
        <div className="min-h-[40px] py-1 bg-white border-b flex flex-wrap items-center justify-between px-4 z-20 flex-shrink-0">
            <div className="text-xs text-slate-400 font-mono">
                {projectId.split('-')[0]}
            </div>

            <div className="flex gap-2">
                <div className="flex items-center bg-slate-100 rounded p-0.5 mr-2">
                    <button onClick={undo} disabled={!canUndo} className="p-1 text-slate-600 hover:bg-white hover:shadow-sm rounded disabled:opacity-30 transition-all" title="Undo (Ctrl+Z)">
                        <Undo2 size={14} />
                    </button>
                    <button onClick={redo} disabled={!canRedo} className="p-1 text-slate-600 hover:bg-white hover:shadow-sm rounded disabled:opacity-30 transition-all" title="Redo (Ctrl+Y)">
                        <Redo2 size={14} />
                    </button>
                </div>
                <button onClick={() => setSession({ showJsonModal: true })} className="p-1 px-2 text-slate-600 hover:bg-slate-100 rounded flex items-center gap-2 text-xs font-medium"><Code size={14} /> JSON</button>
                <div className="h-4 w-px bg-slate-300 mx-1 self-center"></div>

                <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-md p-1 pl-1">
                    <button
                        onClick={() => setExportGreyscale(!exportGreyscale)}
                        className={clsx(
                            "p-1.5 rounded transition-all mr-1 focus:outline-none focus:ring-1 focus:ring-blue-500",
                            exportGreyscale ? "bg-blue-100 text-blue-600" : "text-slate-400 hover:text-slate-600 hover:bg-slate-200"
                        )}
                        title={exportGreyscale ? "Greyscale Export: ON" : "Greyscale Export: OFF"}
                    >
                        <Contrast size={14} />
                    </button>

                    <div className="flex items-stretch ml-2 shadow-sm rounded">
                        <button
                            onClick={() => handleExportPDF()}
                            disabled={isExporting}
                            className={clsx(
                                "text-white bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded-l flex items-center gap-2 text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-wait",
                                isExporting && "opacity-75"
                            )}
                        >
                            {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                            {isExporting ? "Generating..." : "Export PDF"}
                        </button>
                        <button
                            onClick={() => handleExportPDF({ exportAllVariants: true })}
                            disabled={isExporting || Object.keys(state.variants).length <= 1}
                            className={clsx(
                                "text-white bg-blue-600 hover:bg-blue-700 px-2 py-1 border-l border-blue-500/50 flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed",
                                isExporting && "opacity-75 bg-blue-700"
                            )}
                            title="Export All Variants (one PDF per variant)"
                        >
                            <Layers size={14} /> All
                        </button>
                        <button
                            onClick={() => setShowDeviceExport(true)}
                            disabled={isExporting}
                            className={clsx(
                                "text-white bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded-r border-l border-blue-500/50 flex items-center justify-center gap-1 text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed",
                                isExporting && "opacity-75 bg-blue-700"
                            )}
                            title="Export templates for e-ink devices"
                        >
                            <Tablet size={14} /> Devices
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
    const sidebarElement = (
        <Sidebar
            state={state}
            onSelectNode={(id, ctrl, shift) => { handleSelectNode(id, ctrl, shift); if (isTouch) countPick(); }}
            onAddNode={handleAddNode}
            onAddReference={handleAddReference}
            onDeleteNode={(id) => requestDeleteNodes(state.selectedNodeIds.includes(id) ? state.selectedNodeIds : [id])}
            onDuplicateNode={(id) => handleDuplicateNodes(state.selectedNodeIds.includes(id) ? state.selectedNodeIds : [id])}
            onUpdateNode={handleUpdateNode}
            onChangeViewMode={changeViewMode}
            onSelectTemplate={(id, ctrl, shift) => { handleSelectTemplate(id, ctrl, shift); if (isTouch) countPick(); }}
            onAddTemplate={handleAddTemplate}
            onDeleteTemplate={(id) => handleDeleteTemplates(state.selectedTemplateIds.includes(id) ? state.selectedTemplateIds : [id])}
            onDuplicateTemplate={(id) => handleDuplicateTemplates(state.selectedTemplateIds.includes(id) ? state.selectedTemplateIds : [id])}
            onUpdateTemplateName={handleUpdateTemplateName}
            onSelectVariant={handleSelectVariant}
            onAddVariant={handleAddVariant}
            onRenameVariant={handleRenameVariant}
            onDeleteVariant={handleDeleteVariant}
            onDuplicateVariant={handleDuplicateVariant}
        />
    );
    const toolbarElement = (
        <EditorToolbar
            state={state}
            {...(toolbarActions ? { actions: toolbarActions } : { setState: toolbarStateSetter })}
            onOpenScriptGen={() => setShowScriptGenModal(true)}
            onSavePreset={() => setShowSavePresetModal(true)}
            onImportSvg={handleImportSvg}
            onInsertSvgPlaceholder={handleInsertSvgPlaceholder}
        />
    );
    const canvasElement = (
        currentTemplate && <EditorCanvas
            contextKey={contextKey}
            template={currentTemplate}
            elements={currentTemplate?.elements || []}
            selectedElementIds={state.selectedElementIds}
            scale={isTouch ? touchViewport.scale : state.scale}
            tool={state.tool}
            nodes={state.nodes}
            currentNodeId={effectivePreviewNodeId}
            snapToGrid={state.snapToGrid}
            showGrid={state.showGrid}
            activeLayerId={state.activeLayerId}
            greyscalePreview={exportGreyscale}
            onInteractionStart={saveToHistory}
            captureInteraction={captureInteraction}
            onInteractionEnd={onInteractionEnd}
            onInteractionCancel={onInteractionCancel}
            onEditElements={onEditElements}
            onUpdateElements={(els, save) => handleUpdateTemplateElements(els, save)}
            onSelectElements={(ids) => setSession({ selectedElementIds: ids })}
            onZoom={isTouch ? touchViewport.setScale : (scale) => setPreferences({ scale })}
            onSwitchToSelect={() => setSession({ tool: 'select' })}
            inputMode={isTouch ? 'touch' : 'mouse'}
            fitSignal={isTouch ? touchViewport.fitSignal : undefined}
            multiSelect={multiSelect}
        />
    );
    const propertiesElement = (
        <PropertiesPanel
            incrementalActions={propertyActions}
            state={state}
            activePreviewNode={state.nodes[effectivePreviewNodeId]}
            onUpdateElements={(els, save) => handleUpdateTemplateElements(els, save)}
            onUpdateNode={handleUpdateNode}
            onDeleteElements={deleteElements}
            onOpenNodeSelector={(mode, elId) => setSession({ showNodeSelector: true, nodeSelectorMode: mode, editingElementId: elId })}
            onUpdateTemplate={handleUpdateTemplate}
            layersSlot={currentTemplate ? (
                <CollapsibleSection
                    title="Layers"
                    icon={Layers}
                    testId="layers-section"
                    expanded={layersExpanded}
                    onToggle={toggleLayers}
                >
                    <LayersPanel
                        layerActions={layerActions}
                        template={currentTemplate}
                        selectedElementIds={state.selectedElementIds}
                        activeLayerId={state.activeLayerId}
                        onUpdateTemplate={(updates) => handleUpdateTemplate(currentTemplate.id, updates)}
                        onUpdateElements={(els, save) => handleUpdateTemplateElements(els, save)}
                        onSelectElements={(ids) => setSession({ selectedElementIds: ids })}
                        onSetActiveLayer={(layerId) => setSession({ activeLayerId: layerId })}
                        multiSelect={multiSelect}
                    />
                </CollapsibleSection>
            ) : null}
        />
    );
    // Touch chrome (phone top bar / tablet toolbar / overflow sheet) drives the same handlers the
    // desktop bars use. Built only on touch: desktop never reads them (its DOM is unchanged) and
    // listPreviewNodes walks every node.
    const previewChoice = isTouch ? listPreviewNodes(state, effectivePreviewNodeId) : null;
    const touchActions: TouchEditorActions | undefined = !isTouch ? undefined : {
        undo, redo, canUndo, canRedo,
        exportPdf: () => { void handleExportPDF(); },
        exportAllVariants: () => { void handleExportPDF({ exportAllVariants: true }); },
        exportForDevice: () => setShowDeviceExport(true),
        canExportAllVariants: Object.keys(state.variants).length > 1,
        isExporting,
        greyscale: exportGreyscale,
        toggleGreyscale: () => setExportGreyscale(!exportGreyscale),
        openJson: () => setSession({ showJsonModal: true }),
        openGenerator: () => setShowScriptGenModal(true),
        savePreset: () => setShowSavePresetModal(true),
        importSvg: handleImportSvg,
        insertSvgPlaceholder: handleInsertSvgPlaceholder,
        snapToGrid: state.snapToGrid,
        // Same as EditorToolbar's magnet button: turning snap on also reveals the grid.
        toggleSnap: () => setPreferences({ snapToGrid: !state.snapToGrid, showGrid: !state.snapToGrid ? true : state.showGrid }),
        showGrid: state.showGrid,
        toggleGrid: () => setPreferences({ showGrid: !state.showGrid }),
        tool: state.tool,
        setTool: tool => setSession({ tool: tool as AppState['tool'] }),
        fitToWidth: touchViewport.requestFit,
        hasSelection: state.selectedElementIds.length > 0,
        duplicateSelection: duplicateElements,
        deleteSelection: () => deleteElements(state.selectedElementIds),
        clearSelection: () => setSession({ selectedElementIds: [] }),
        multiSelect, toggleMultiSelect,
        canAlign: state.selectedElementIds.length > 1,
        align: alignElements,
        preview: previewChoice && { ...previewChoice, onSelect: id => setSession({ templatePreviewNodeId: id }) },
    };
    const selectedElements = (currentTemplate?.elements ?? []).filter(el => state.selectedElementIds.includes(el.id));
    const selectionLabel = selectedElements.length === 1
        ? getElementLabel(selectedElements[0])
        : selectedElements.length > 1
            ? `${selectedElements.length} elements`
            : `Page · ${state.nodes[effectivePreviewNodeId]?.title ?? ''}`;
    const navigationKey = `${state.viewMode}:${state.selectedNodeId}:${state.selectedTemplateId}:${state.activeVariantId}:${pickCount}`;
    return (
        <div className="flex h-full w-full flex-col bg-slate-100 text-slate-900 overflow-hidden">
            <EditorLayout
                formFactor={formFactor}
                editorBar={editorBar}
                toolbar={toolbarElement}
                sidebar={sidebarElement}
                canvas={canvasElement}
                properties={propertiesElement}
                sidebarWidth={state.sidebarWidth}
                propertiesPanelWidth={state.propertiesPanelWidth}
                onStartResize={setResizingPanel}
                touchActions={touchActions}
                selectionLabel={selectionLabel}
                navigationKey={navigationKey}
            />

            <JsonModal
                isOpen={state.showJsonModal}
                onClose={() => setSession({ showJsonModal: false })}
                currentState={jsonState}
                onSave={replace}
            />

            <HierarchyGeneratorModal
                isOpen={showScriptGenModal}
                projectName={projectName}
                savedGenerator={state.generator}
                onClose={() => setShowScriptGenModal(false)}
                onApplyGenerated={handleApplyGenerated}
                onCreateGeneratedProject={onCreateGeneratedProject}
            />

            <SavePresetModal
                isOpen={showSavePresetModal}
                onClose={() => setShowSavePresetModal(false)}
                onSave={handleSavePreset}
                defaultTitle={state.nodes[state.rootId]?.title}
            />

            <DeviceExportDialog
                isOpen={showDeviceExport}
                onClose={() => setShowDeviceExport(false)}
                getState={exportSnapshot}
                projectName={projectName}
                initialForceGreyscale={exportGreyscale}
            />

            <NewVariantModal
                isOpen={showNewVariantModal}
                onClose={() => setShowNewVariantModal(false)}
                onCreate={handleCreateVariant}
                currentVariantName={state.variants[state.activeVariantId]?.name || 'Variant'}
                currentWidth={Object.values(getActiveTemplates())[0]?.width || 509}
                currentHeight={Object.values(getActiveTemplates())[0]?.height || 679}
            />

            <NodeSelectorModal
                isOpen={state.showNodeSelector}
                onClose={() => setSession({ showNodeSelector: false, editingElementId: null })}
                state={state}
                title={state.nodeSelectorMode === 'create_reference' ? 'Select Reference Target' : 'Select Source Node'}
                onSelect={selectNodeTarget}
            />

            <DeleteConfirmModal 
                isOpen={deleteConfirmState.isOpen}
                onClose={() => setDeleteConfirmState({ isOpen: false, nodeIds: [] })}
                onConfirm={executeDeleteNode}
                nodeTitle={deleteConfirmState.nodeIds.length > 1 ? `${deleteConfirmState.nodeIds.length} Nodes` : (state.nodes[deleteConfirmState.nodeIds[0] || '']?.title || 'Node')}
            />
        </div>
    );
}

export function ProjectEditor(props: CommonProjectEditorProps & { incremental: EditorSourceBinding } & IncrementalEditorCallbacks): React.ReactElement;
// Keep ComponentProps-based legacy factories source-compatible. JSX still checks
// the explicit incremental overload and requires both admission callbacks.
export function ProjectEditor(props: CommonProjectEditorProps & { incremental?: undefined; onDocumentEdit?: never; onPreferencesChange?: never }): React.ReactElement;
export function ProjectEditor(props: ProjectEditorProps): React.ReactElement {
    return props.incremental
        ? <IncrementalProjectEditor {...props} incremental={props.incremental} onDocumentEdit={props.onDocumentEdit!} onPreferencesChange={props.onPreferencesChange!} />
        : <LegacyProjectEditor {...props} />;
}

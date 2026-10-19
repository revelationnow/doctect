
import React, { useState } from 'react';
import { AppState, AppNode } from '../../types';
import { ChevronRight, ChevronDown, Plus, Trash2, Edit2, Link, Copy, MoreHorizontal } from 'lucide-react';
import clsx from 'clsx';
import { useFormFactor } from '../editor-layout/FormFactorContext';
import { RowActionSheet, type RowAction } from './RowActionSheet';

interface NodeItemProps {
  nodeId: string;
  state: AppState;
  depth: number;
  onSelect: (id: string, ctrlKey: boolean, shiftKey: boolean) => void;
  onAdd: (parentId: string) => void;
  onAddRef: (parentId: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onUpdate: (id: string, updates: Partial<AppNode>) => void;
}

export const NodeItem: React.FC<NodeItemProps> = ({ nodeId, state, depth, onSelect, onAdd, onAddRef, onDelete, onDuplicate, onUpdate }) => {
  const node = state.nodes[nodeId];
  const [expanded, setExpanded] = useState(depth < 1);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(node?.title || "");
  // Touch: the row's actions sit behind one ⋯ button, so the page name keeps the row's width.
  const touch = useFormFactor() !== 'desktop';
  const [actionsOpen, setActionsOpen] = useState(false);

  if (!node) return null;

  // selectedNodeIds might be undefined in older state versions loaded before migration completes
  const isSelected = state.viewMode === 'hierarchy' && (state.selectedNodeIds?.includes(nodeId) || state.selectedNodeId === nodeId);
  const hasChildren = node.children.length > 0;
  const isReference = !!node.referenceId;

  const handleSubmitTitle = () => {
    if (editTitle.trim()) onUpdate(nodeId, { title: editTitle });
    setIsEditing(false);
  };

  const touchActions: RowAction[] = [
    ...(!isReference ? [
      { label: 'Rename', onSelect: () => { setEditTitle(node.title); setIsEditing(true); } },
      { label: 'Add child page', onSelect: () => { onAdd(nodeId); setExpanded(true); } },
      { label: 'Link existing page', onSelect: () => { onAddRef(nodeId); setExpanded(true); } },
    ] : []),
    ...(node.parentId ? [
      { label: 'Duplicate', onSelect: () => onDuplicate(nodeId) },
      { label: 'Delete', onSelect: () => onDelete(nodeId), destructive: true },
    ] : []),
  ];

  return (
    <div>
      <div 
        data-node-id={nodeId}
        className={clsx(
          `flex items-center group ${touch ? 'min-h-11 py-0' : 'py-1'} px-2 cursor-pointer select-none text-sm hover:bg-slate-100`,
          isSelected && "bg-blue-50 text-blue-700 font-medium",
          isReference && "italic text-slate-600"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={(e) => onSelect(nodeId, e.ctrlKey || e.metaKey, e.shiftKey)}
      >
        {touch ? (
          hasChildren ? (
            <button type="button" aria-expanded={expanded}
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.title}`}
              className="-ml-2 flex flex-none items-center justify-center rounded text-slate-400"
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          ) : <div className="-ml-2 w-11 flex-none" />
        ) : (
        <div 
          className="mr-1 p-0.5 rounded hover:bg-slate-200 text-slate-400"
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        >
          {hasChildren ? (
            expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : <div className="w-[14px]" />}
        </div>
        )}
        
        {isReference && <Link size={12} className="mr-1 text-indigo-500" />}

        {isEditing ? (
            <input 
                autoFocus
                className="flex-1 bg-white border border-blue-300 rounded px-1 min-w-0"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onBlur={handleSubmitTitle}
                onKeyDown={e => e.key === 'Enter' && handleSubmitTitle()}
                onClick={e => e.stopPropagation()}
            />
        ) : (
            <span className="truncate flex-1">{node.title}</span>
        )}

        {touch ? (
          !isEditing && touchActions.length > 0 && (
            <button type="button" aria-haspopup="dialog" aria-label={`Actions for ${node.title}`}
              className="-mr-2 flex flex-none items-center justify-center rounded text-slate-500"
              onClick={(e) => { e.stopPropagation(); setActionsOpen(true); }}>
              <MoreHorizontal size={18} className="pointer-events-none" />
            </button>
          )
        ) : (
        <div className="hidden group-hover:flex items-center gap-1 ml-2">
            {!isReference && (
              <>
                <button type="button" className="p-1 hover:bg-slate-200 rounded text-slate-500" title="Edit Title"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditTitle(node.title); setIsEditing(true); }}>
                    <Edit2 size={12} className="pointer-events-none" />
                </button>
                <button type="button" className="p-1 hover:bg-green-100 hover:text-green-600 rounded text-slate-500" title="Add New Page"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAdd(nodeId); setExpanded(true); }}>
                    <Plus size={12} className="pointer-events-none" />
                </button>
                <button type="button" className="p-1 hover:bg-indigo-100 hover:text-indigo-600 rounded text-slate-500" title="Link Existing Page (Reference)"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAddRef(nodeId); setExpanded(true); }}>
                    <Link size={12} className="pointer-events-none" />
                </button>
              </>
            )}
            {node.parentId && (
              <>
                <button type="button" className="p-1 hover:bg-slate-200 hover:text-slate-700 rounded text-slate-500" title="Duplicate"
                  onClick={(e) => { 
                      e.preventDefault(); 
                      e.stopPropagation(); 
                      onDuplicate(nodeId); 
                  }}>
                  <Copy size={12} className="pointer-events-none" />
                </button>
                <button type="button" className="p-1 hover:bg-red-100 hover:text-red-600 rounded text-slate-500" title="Delete"
                  onClick={(e) => { 
                      e.preventDefault(); 
                      e.stopPropagation(); 
                      onDelete(nodeId); 
                  }}>
                  <Trash2 size={12} className="pointer-events-none" />
                </button>
              </>
            )}
        </div>
        )}
      </div>
      {touch && (
        <RowActionSheet open={actionsOpen} title={node.title} actions={touchActions} onClose={() => setActionsOpen(false)} />
      )}
      
      {expanded && node.children.map(childId => (
        <NodeItem 
          key={childId} 
          nodeId={childId} 
          state={state} 
          depth={depth + 1}
          onSelect={onSelect}
          onAdd={onAdd}
          onAddRef={onAddRef}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onUpdate={onUpdate}
        />
      ))}
    </div>
  );
};

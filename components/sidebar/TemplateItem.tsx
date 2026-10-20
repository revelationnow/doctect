
import React, { useState } from 'react';
import { PageTemplate } from '../../types';
import { LayoutTemplate, Edit2, Trash2, Copy, MoreHorizontal } from 'lucide-react';
import clsx from 'clsx';
import { useInputMode } from '../editor-layout/FormFactorContext';
import { RowActionSheet, type RowAction } from './RowActionSheet';

interface TemplateItemProps {
    template: PageTemplate;
    isSelected: boolean;
    onSelect: (ctrlKey: boolean, shiftKey: boolean) => void;
    onDelete: () => void;
    onDuplicate: () => void;
    onUpdateName: (name: string) => void;
}

export const TemplateItem: React.FC<TemplateItemProps> = ({ template, isSelected, onSelect, onDelete, onDuplicate, onUpdateName }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(template.name);
    // Touch: the row's actions sit behind one ⋯ button, so the template name keeps the row's width.
    const touch = useInputMode() === 'touch';
    const [actionsOpen, setActionsOpen] = useState(false);
    const touchActions: RowAction[] = [
        { label: 'Rename', onSelect: () => { setEditName(template.name); setIsEditing(true); } },
        { label: 'Duplicate', onSelect: onDuplicate },
        { label: 'Delete', onSelect: onDelete, destructive: true },
    ];

    const handleSubmit = () => {
        if (editName.trim()) onUpdateName(editName);
        else setEditName(template.name);
        setIsEditing(false);
    };

    return (
        <>
        <div 
            data-template-id={template.id}
            onClick={(e) => onSelect(e.ctrlKey || e.metaKey, e.shiftKey)}
            className={clsx(
                `flex items-center justify-between ${touch ? 'min-h-11 py-0 pl-2 pr-0' : 'p-2'} cursor-pointer select-none text-sm hover:bg-slate-100 group`,
                isSelected && "bg-blue-50 text-blue-700 font-medium"
            )}
        >
             <div className="flex items-center gap-2 flex-1 min-w-0">
                <LayoutTemplate size={14} className={isSelected ? "text-blue-500" : "text-slate-400"} />
                {isEditing ? (
                    <input 
                        autoFocus
                        className="flex-1 bg-white border border-blue-300 rounded px-1 min-w-0"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onBlur={handleSubmit}
                        onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                        onClick={e => e.stopPropagation()}
                    />
                ) : (
                    <div className="flex flex-col min-w-0">
                        <span className="truncate">{template.name}</span>
                    </div>
                )}
             </div>

             {touch ? (
                !isEditing && (
                    <button type="button" aria-haspopup="dialog" aria-label={`Actions for ${template.name}`}
                        className="flex flex-none items-center justify-center rounded text-slate-500"
                        onClick={(e) => { e.stopPropagation(); setActionsOpen(true); }}>
                        <MoreHorizontal size={18} className="pointer-events-none" />
                    </button>
                )
             ) : (
             <div className="hidden group-hover:flex items-center gap-1">
                <button type="button"
                    className="p-1 hover:bg-slate-200 rounded text-slate-500" 
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditName(template.name); setIsEditing(true); }}
                >
                    <Edit2 size={12} className="pointer-events-none" />
                </button>
                <button type="button"
                    className="p-1 hover:bg-slate-200 hover:text-slate-700 rounded text-slate-500" title="Duplicate"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDuplicate(); }}
                >
                    <Copy size={12} className="pointer-events-none" />
                </button>
                <button type="button"
                    className="p-1 hover:bg-red-100 hover:text-red-600 rounded text-slate-500" title="Delete"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
                >
                    <Trash2 size={12} className="pointer-events-none" />
                </button>
             </div>
             )}
        </div>
        {touch && (
            <RowActionSheet open={actionsOpen} title={template.name} actions={touchActions} onClose={() => setActionsOpen(false)} />
        )}
        </>
    );
};

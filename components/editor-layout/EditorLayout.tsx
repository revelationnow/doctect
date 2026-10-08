import React from 'react';
import type { FormFactor } from '../../hooks/useEditorFormFactor';
import type { TouchEditorActions } from './touchActions';

export interface EditorLayoutProps {
    formFactor: FormFactor;
    editorBar: React.ReactNode;
    toolbar: React.ReactNode;
    sidebar: React.ReactNode;
    canvas: React.ReactNode;
    properties: React.ReactNode;
    sidebarWidth: number;
    propertiesPanelWidth: number;
    onStartResize: (panel: 'sidebar' | 'properties') => void;
    touchActions?: TouchEditorActions;
    selectionLabel?: string;
    navigationKey?: string;
}

export function DesktopEditorLayout(props: EditorLayoutProps) {
    const { editorBar, toolbar, sidebar, canvas, properties, sidebarWidth, propertiesPanelWidth, onStartResize } = props;
    return (
        <>
            {editorBar}
            <div className="flex flex-1 overflow-hidden">
                <div style={{ width: sidebarWidth }} className="flex-shrink-0 relative flex flex-col">
                    {sidebar}
                    <div
                        className="absolute right-0 top-0 bottom-0 w-1 hover:bg-blue-400 cursor-col-resize z-30 transition-colors"
                        onMouseDown={() => onStartResize('sidebar')}
                    />
                </div>
                <div className="flex-1 flex flex-col relative min-w-0">
                    {toolbar}
                    <div className="flex-1 bg-slate-200 overflow-hidden relative flex flex-col">
                        {canvas}
                    </div>
                </div>
                <div style={{ width: propertiesPanelWidth }} className="flex-shrink-0 relative flex flex-col">
                    <div
                        className="absolute left-0 top-0 bottom-0 w-1 hover:bg-blue-400 cursor-col-resize z-30 transition-colors"
                        onMouseDown={() => onStartResize('properties')}
                    />
                    {properties}
                </div>
            </div>
        </>
    );
}

export function EditorLayout(props: EditorLayoutProps) {
    // Tablet and phone branches are added in Task 12.
    return <DesktopEditorLayout {...props} />;
}

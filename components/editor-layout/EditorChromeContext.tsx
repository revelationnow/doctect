import React, { createContext, useContext } from 'react';

/**
 * Page-level chrome the phone top bar needs from EditorPage: the open projects (for the
 * project switcher that replaces the tab strip), the save status, and the cloud/account
 * menus the overflow sheet surfaces. Absent (`null`) when the editor is rendered without
 * the page shell, e.g. in unit tests; the touch chrome then simply omits those slots.
 */
export interface EditorChrome {
    projects: { id: string; name: string }[];
    activeProjectId: string | null;
    onSelectProject: (id: string) => void;
    onCloseProject: (id: string) => void;
    onNewProject: () => void;
    saveStatus: React.ReactNode;
    cloudMenu: React.ReactNode;
    accountMenu: React.ReactNode;
}

export const EditorChromeContext = createContext<EditorChrome | null>(null);
export const useEditorChrome = () => useContext(EditorChromeContext);

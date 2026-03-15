# ProjectEditor Component (`components/ProjectEditor.tsx`)

The `ProjectEditor` is the central brain and context provider for an open project. It receives the `initialState` payload of the project when mounted by the router and assumes full control of the interaction lifecycle.

## Architectural Responsibilities

1. **Root State Container**: 
   Maintains the active `AppState` in a single large React hook. This ensures deterministic rendering cascades downwards to the Canvas and Sidebars. It implements the "lifting state up" pattern cleanly.

2. **History Management (Undo/Redo)**:
   * **`historyRef`**: Holds two array stacks (`past`, `future`) capturing deep serialized snapshots of the `nodes` and `variants` objects. 
   * **`saveToHistory()`**: Invoked right before any direct mutation. Crucially, this only captures document structure, actively excluding UI volatile states (like `scale`, `pan`, selected elements) from the stack queue to keep memory overhead manageable.
   * **Keyboard Shortcuts**: Implements a global `window` event listener catching CMD+Z and CMD+Shift+Z to cycle array stacks.

3. **Core Mutation Engines**:
   * **`onUpdateElements`**: Central bus intercepting multiple elements simultaneously. When dragged, the `Canvas` fires this with arrays of updated element objects.
   * **`handleDeleteElements`**: Trashes the actively selected array of element IDs.
   * **`handleCopyElements` / `handlePasteElements`**: Implements specialized local clipboard behavior. Instead of the browser's `navigator.clipboard`, the editor clones object strings directly into `sessionStorage` under `hype_clipboard_v2`, regenerating internal `id` strings on paste.
   * **Duplicate (`handleDuplicateElements`)**: Synthesizes a copy-paste action combined with an instantaneous visual offset offset (`x + 10`, `y + 10`).

4. **Component Orchestration**:
   As a pure "wrapper layout", it controls pane-resizing limits using explicit CSS Math mappings for its children `<Sidebar />`, `<Canvas />`, and `<PropertiesPanel />`.

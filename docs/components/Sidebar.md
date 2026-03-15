# Sidebar Component (`components/Sidebar.tsx`)

The `Sidebar` is the primary navigation and structure-editing panel on the left side of the PDF Architect interface.

## Core Responsibilities

1. **View Mode Switching**: 
   The sidebar toggles the global `viewMode` between two states:
   * **Hierarchy**: Displays the `AppNode` tree (the actual data structure of the document).
   * **Templates**: Displays the available `PageTemplate` layouts for the current `Variant`.

2. **Variant Management (Templates Mode)**:
   When in 'Templates' mode, it displays a dropdown selector to switch the `activeVariantId` (e.g., switching from iPad to reMarkable layouts). It also provides controls to Rename, Duplicate, Delete, or Add new variants.

3. **Node Tree Rendering (Hierarchy Mode)**:
   It delegates the actual recursive rendering of the node tree to the `<NodeItem>` component (`sidebar/NodeItem.tsx`), starting from the `rootId`. It passes down callbacks for selecting, adding, deleting, and updating nodes, as well as adding Reference nodes (`onAddReference`).

4. **Template List (Templates Mode)**:
   It maps over the templates associated with the currently active variant and renders a `<TemplateItem>` (`sidebar/TemplateItem.tsx`) for each, allowing users to rename, select, or delete them.

## Key State Interactions
The `Sidebar` does not manage complex internal state (except for a small piece of local state `isEditingVariantName` for inline renaming). It relies heavily on the central `AppState` passed from `ProjectEditor`, triggering state cascades via prop callbacks like `onSelectNode` or `onSelectVariant`.

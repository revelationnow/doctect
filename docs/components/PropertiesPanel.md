# PropertiesPanel Component (`components/PropertiesPanel.tsx`)

The `PropertiesPanel` resides on the right side of the editor interface. It dynamically changes its contents based on the current selection and global viewing mode.

## 1. Contextual Rendering
*   **Hierarchy Mode**: If the user is viewing the document hierarchy and has an `AppNode` selected, the panel delegates to the `<NodeProperties>` component. This allows the user to edit the node's title, type (which Template it uses), and custom `data` key-value pairs (which feed into text bindings).
*   **Templates Mode (No Element Selected)**: If no specific shape/text is selected on the canvas, it displays "Template Settings." This includes page dimensions (width/height), orientation toggles, and a "Page Presets" dropdown (A4, Letter, reMarkable, etc.).
*   **Templates Mode (Element Selected)**: If one or more elements are selected on the canvas, it renders the `<SingleElementEditor>` to modify colors, borders, typography, grid settings, and interactive links.

## 2. Synthetic Multi-Edit Logic
A complex requirement of vector editors is allowing users to edit multiple selected elements simultaneously (e.g., selecting 3 text boxes and changing them all to "Bold").

To achieve this without duplicating editor UI logic:
1.  The panel uses a `useMemo` block to generate a "Synthetic" or "Mixed" `displayElement`.
2.  It iterates over all keys (like `fontSize` or `fill`).
3.  If all selected elements have the *exact same value* for a key, the `displayElement` takes that value.
4.  If they differ, the value is set to the string `"Mixed"`.
5.  This `displayElement` is passed to `<SingleElementEditor>`. When the user changes a value in the editor, the `handleUpdate` callback iterates over *all* `selectedElementIds` and applies the update locally to each before pushing the new array to `ProjectEditor`.

## 3. Delegation
It heavily delegates to sub-components located in the `components/properties/` directory:
*   `SingleElementEditor.tsx`: The massive form containing specialized sections for text, borders, links, and grid configs.
*   `NodeProperties.tsx`: The form for managing node metadata.
*   `ChildIndexSelector.tsx`: An internal helper component for configuring complex contextual links (like `child_referrer`).

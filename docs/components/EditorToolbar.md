# EditorToolbar Component (`components/EditorToolbar.tsx`)

The `EditorToolbar` sits pinned to the top of the canvas area within the `ProjectEditor`. It is a dense, high-frequency interaction zone for tool switching and alignment.

## Core Features

1. **Tool Selection**:
   Maintains buttons to switch the active `state.tool` (`select`, `hand`, `text`, `rect`, `ellipse`, `triangle`, `line`, `grid`). Selecting a shape tool puts the canvas into "draw mode" where the next click-and-drag creates the specific element.

2. **Canvas Controls**:
   * **Zoom**: Controls `state.scale` with zoom-in and zoom-out buttons.
   * **Grid Snapping**: Toggles `snapToGrid`.
   * **Grid Visibility**: Toggles `showGrid` rendering on the canvas background.

3. **Alignment Engine (Multi-Selection)**:
   When `state.selectedElementIds.length > 1`, the toolbar conditionally reveals an alignment toolset.
   * **Basic Alignments** (Left, Center, Right, Top, Middle, Bottom): `handleAlign` mathematically calculates the minimum, maximum, or center point of the entire selected bounding box and forces all selected elements to match that coordinate.
   * **Distribution** (`dist-h`, `dist-v`): Horizontally or vertically spaces elements equally. It sorts elements by their current coordinate, calculates the total empty space between the outermost elements, and assigns new coordinates by incrementing the calculated exact `gap`.

4. **Template Preview Selector**:
   When editing a layout in "Templates" mode, text variables (like `{{dayName}}`) need a real `AppNode` to provide the data context, otherwise they just display raw bracket strings. 
   The toolbar includes a "Preview" dropdown. It finds all nodes in the hierarchy that use the current template and allows the user to temporarily select one to populate the canvas variables during design time. This updates `templatePreviewNodeId`.

5. **Advanced Actions**:
   Provides entry points (buttons) for opening the Hierarchy Generator Script modal (`onOpenScriptGen`) or saving the current layout as a custom preset (`onSavePreset`).

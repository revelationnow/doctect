# 4. Canvas Render Engine

The `Canvas` component (`components/Canvas.tsx`) is the visual heart of PDF Architect. It handles rendering the layout for a given `PageTemplate` and managing all user interactions (selection, dragging, resizing, rotating).

## Overview

The Canvas operates essentially as a large interactive SVG/HTML surface. 
*   It receives `elements` array, the `currentTemplate`, and the UI state (`tool`, `scale`, `selectedElementIds`).
*   It renders a grid of `CanvasElement` components.
*   It overlays an interactive layer (`SelectionHandles.tsx`) for bounding boxes, resize points, and rotation dots.

## Key Mechanisms

### 1. Zoom and Pan
Zooming is primarily handled via CSS `transform: scale()`.

*   **Panning**: When the user middle-clicks or holds the Spacebar, standard mouse movement simply adjusts the `scrollLeft` and `scrollTop` of the outer container.
*   **Zooming**: Ctrl + Scroll calculates the mouse's relative position on the screen, adjusts the `scale` state variable, and then re-adjusts the scroll offsets (using layout effects) to keep the mouse anchored over the same visual point on the canvas.

### 2. The Interaction Loop
Every transformation (move, rotate, scale) follows a strict event loop:

1.  **Selection (`mousedown`)**: Identifies if the user clicked an empty space (marquee selection), a shape (select and start drag), a resize handle, or a rotation handle.
2.  **Snapshot (`onInteractionStart`)**: Captures the exact state (position, rotation, dimensions) of the element(s) at click time via `saveToHistory` inside `ProjectEditor`.
3.  **Update (`mousemove`)**: Calculates the mathematical delta between the start coordinates and current mouse coordinates.
4.  **Application (`onUpdateElements`)**: Re-applies the delta to the *snapshot state*, not the previous frame's state. This prevents float-accumulation errors common in vector editors.
5.  **Commit (`mouseup`)**: Ends interaction modes (e.g., `setIsDragging(false)`).

### 3. Group Transformations
Math gets complicated when multiple elements are selected, especially if they have independent transforms.
*   When a group is selected, `Canvas.tsx` calculates a "Virtual Group Bounding Box".
*   **Moving**: Simple translation `(dx, dy)` applied to all elements in the group.
*   **Rotation**: Requires an anchor point (pivot). The system finds the center of the virtual bounding box, calculates the mouse angle delta, and then uses a `rotatePoint` matrix function to orbit every individual element's anchor around the group center.

### 4. Dynamic Grid Rendering
A `Grid` is essentially an auto-populating repeater. 
The algorithm for rendering it visually in `Canvas.ts` (specifically `getElementBounds`) mirrors how it will export:

1.  **Resolve Source**: Are we looking at `current` node children or a `specific` node ID?
2.  **Traverse**: If `traversalPath` is set, walk the tree (e.g., Year node -> look for Quarter children -> look for Month children).
3.  **Slice**: Apply `dataSliceStart` and `dataSliceCount` (e.g., only show elements 0 to 6 as "Week 1").
4.  **Offset**: If `offsetMode` is "dynamic", inspect the first child to find the string value of `offsetField` (e.g., "startWeekday = 3" means Wednesday). Add 3 blank cells before rendering the first child data.
5.  **Size Calculation**: Given `cols` and `gapX/Y`, calculate the final `row` count required. Calculate the overall rendered `totalW` and `totalH` for the virtual bounding box so selection and resizing appear accurate.

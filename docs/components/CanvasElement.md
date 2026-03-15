# CanvasElement Component (`components/canvas/CanvasElement.tsx`)

`CanvasElement` is the direct rendering component for the internal structure of a single visual item. It does not handle interactions like dragging or selecting; it purely converts data to pixels.

It is wrapped by `Canvas` via positional absolute positioning.

## Rendering Strategies

1.  **Rectangles and Ellipses**:
    *   Simply renders an absolute, rounded `div`.
    *   Fills, borders, and complex patterns (stripes/dots using CSS radial/linear gradients) are calculated dynamically via a helper `getBackgroundStyle`.
    *   Text bindings within a shape are resolved and overlaid in a flex container for alignment mapping.

2.  **Lines and Triangles**:
    *   Because these have complex bounds, they render as an inline `<svg>` node taking up 100% of their logical bounding box, with `<line>` or `<polygon>` children.
    *   Triangle labels still render in an HTML DOM node inside the SVG bounding container to utilize native `fontWeight` and `textDecoration` bindings cleanly from Tailwind CSS.

3.  **Grids (`gridConfig`)**:
    *   Grids are essentially complex repeaters rendering an internal map of child `divs`.
    *   **Retrieval**: Resolves its data source via array slicing (`dataSliceStart`/`dataSliceCount`) and `traversalPath` using recursive depth-first descent over the global `nodes`.
    *   **Offset Engine**: Reads the first child. If `offsetMode` is active and configured (e.g., "startWeekday = 3" on Day 1), it pushes `3` blank array elements onto the start of its rendering map so day blocks start perfectly aligned on a calendar layout.
    *   **Layout Math**: For an index `N`, its internal row/col position is mapped mathematically (e.g. `cx = col * w`, `cy = row * h`). Variables in grid items use recursive interpolation just like single shapes.

4.  **Data Binding Resolution System (`resolveText`)**:
    *   Because components display the context of a "Preview" node (simulating an export), text like `{{title}}` or `{{dayIndex}}` needs to query the `nodes` object graph dynamically.
    *   The recursive `getContextNodes` function maps upwards from the preview node through the hierarchy, tracking `referenceId` sources alongside regular parents, and replacing template literals in rendering order.

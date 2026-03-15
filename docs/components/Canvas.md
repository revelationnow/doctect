# Canvas Component (`components/Canvas.tsx`)

The `Canvas` handles interactive physics and direct DOM manipulation. It manages a massive SVG/HTML layer cake and intercepts low-level pointer device commands on its parent frame.

## The Interaction Flow Engine

### The Infinite Surface
The component operates as a bounded absolute `div` rendered inside a relative scrolling parent container (`overflow-hidden`).
Instead of recalculating native DOM offsets continually, elements are pushed using `transform: translate(x, y)` relative to `(0,0)`, and the entire inner block uses `transform: scale(s)` to achieve arbitrary zoom without reflow drops. 

### Panning Mechanics
When a user begins panning (`middle click` or holding `space`), the `Canvas` listens to pure `Math.movementX` events and adjusts the outer frame's scroll coordinates linearly while suppressing component click selections.

### State Interception (`handleMouseDown`)
1.  Is the user using a shape tool? If yes, `startCreatingElement` is fired immediately mapping initial coordinates (converted from global client space to scaled canvas grid space via `windowToCanvas`).
2.  Is the user clicking a node? Fire `selectElement`.
3.  Is the click empty? Initiate Marquee selection box drag coordinate tracking.

### Move and Transform Loop (`handleMouseMove`)
Rather than relying natively on HTML5 Drag and Drop events (which introduce cursor latency), `mousemove` tracks continuous delta arrays. 
*   **Rotation**: Tracks relative angle gradients using `Math.atan2` delta calculations compared against the initial starting centroid.
*   **Group Moves**: If multiple elements are selected, the engine builds a virtual "Axis-Aligned Bounding Box (AABB)" containing all origins. Any translation shift applies linearly mapped deltas to all underlying elements simultaneously without pushing intermediate arrays to `ProjectEditor` (uses an internal transient `interactionState` hook until `mouseup`).

## Sub-Components

*   **`SelectionHandles.tsx`**: Exists purely in the interactive overlay hierarchy. It renders tiny 8-point interactive "dots" around an active element's border. Each dot registers targeted `mousedown` events specifying a distinct interaction type (e.g., "resize-top-left", "rotate").
*   **`OverlayTextEditor.tsx`**: When a text box enters inline-edit mode (double-click), the `Canvas` suspends rendering of the SVG node and instead mounts an absolute-positioned `textarea` mapped identically over the scaled text bounding box, allowing native DOM browser spell-check and cursor tracking logic. On blur, it re-commits the raw string back to the `TemplateElement`.

# 7. Developer Guide

This section outlines how to extend the PDF Architect system with new capabilities.

## 1. Adding a New Element Type

Elements are the core visual building blocks (Rectangles, Text, etc.). To add a new element (e.g., an "Image" or "Polygon"):

1.  **Update Data Models:**
    *   In `types.ts`, add the new type string to the `ElementType` union.
    *   Add any specific properties required for that element to the `TemplateElement` interface (e.g., `imageUrl?: string`).

2.  **Update UI Controls (`SingleElementEditor.tsx`):**
    *   Add a new section in the properties panel that conditionally renders when `element.type === 'new_type'`.
    *   Bind input fields to update the new properties via `onUpdate({ imageUrl: newUrl })`.

3.  **Update Canvas Rendering (`CanvasElement.tsx`):**
    *   Add a new `switch` case or `if` block for the new type.
    *   Render the appropriate SVG or HTML representation using the element's properties (`x`, `y`, `w`, `h`, `fill`, etc.). Ensures it responds to global state like `scale`.

4.  **Update PDF Generation (`pdfService.ts`):**
    *   In the rendering loop, add logic for drawing the new element using `jsPDF` primitives.
    *   *Important*: If the element can be rotated, you must handle the rotation explicitly (e.g., by converting an image bounds into a rotated clipping path or using `jsPDF`'s advanced transformation matrices before drawing).

## 2. Adding a New Link Target Type

Link targets define what happens when a user clicks an element in the exported PDF.

1.  **Update Models:**
    *   Add the new literal to `linkTarget` in `types.ts`.
    *   If it requires a parameter (like the ID for `specific_node`), ensure `linkValue` is documented for that use case.

2.  **Update UI:**
    *   Add the option to the `Select` dropdown in `NodeProperties.tsx` (or wherever link targets are configured).
    *   Add input fields for `linkValue` if needed.

3.  **Update Resolution Logic (`pdfService.ts`):**
    *   In the linking pass at the end of page generation, add your new `linkTarget` case.
    *   Implement the logic to resolve the target *relative to the current node*.
    *   You must ultimately resolve it to an absolute `AppNode` ID in the tree so PDF generation can map it to a final page number via `pageMap.get(targetId)`.

## 3. Modifying Application State

If you need to change the core shape of `AppState` (e.g., adding a global "Theme" configuration):

1.  **Update TypeScript Definitions:**
    *   Modify `AppState` in `types.ts`.
    *   Increment `schemaVersion` in `types.ts`.

2.  **Write a Migration:**
    *   Open `services/migration.ts`.
    *   Write a new function (e.g., `v4_to_v5(state)`).
    *   Handle cases where the new fields don't exist in older localized saves. Give them sensible defaults.
    *   Add your function to the main `migrateState` pipeline.

3.  **Update Initializers:**
    *   Update `services/presets.ts` (e.g., `createBlankProject`) to include the new fields in fresh instances.

## 4. Debugging Tips

*   **PDF Bounding Boxes**: If links are misaligned after rotation, set `DEBUG_PDF = true` in `pdfService.ts`. This usually renders the hidden link rectangles with a visible stroke so you can verify the `getRotatedAABB` math against the visual element.
*   **State Inspection**: The built-in `{JSON}` button in the toolbar opens `JsonModal.tsx`. Use this to inspect the live `AppState` object tree. It is invaluable for verifying that hierarchy scripts executed correctly or that `Canvas` interactions are saving the right numeric data.

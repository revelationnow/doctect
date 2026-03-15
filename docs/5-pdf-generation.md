# 5. PDF Generation Engine

PDF Architect uses `jsPDF` for client-side rendering. This means the server never sees the user's data; generation happens entirely in the browser memory via `services/pdfService.ts`.

## Execution Flow

When a user clicks "Export PDF", the `generatePDF()` service runs asynchronously.

### 1. Structure Linearization
PDFs are sequential documents (Page 1, 2, 3), but PDF Architect data is a tree (`Root -> Q1 -> Jan -> Day 1`).
The first step is `traverse(state.rootId)` which walks the tree depth-first and creates a flat array `pageNodes: string[]`. 
*   This array becomes the actual page order of the PDF.
*   A mapping (`pageMap`) of Node ID to PDF Page Number (1-indexed) is created.

### 2. Document Initialization
It creates a new `jsPDF` instance, setting the default orientation and page size based on the dimensions of the initial Template (from the `activeVariant`).

### 3. Font Loading Lifecycle
`jsPDF` natively supports basic fonts (Helvetica, Times, Courier). To support custom handwriting or serif fonts (like Caveat or Merriweather):
1.  **Parse**: The service scans all `TemplateElement`s across all templates used in the `activeVariant` to build a unique set of `usedFamilies`.
2.  **Fetch**: It maps the family to TTF URLs via the `FONT_URLS` dictionary and dispatches parallel `fetch` requests to CDNs (e.g., Fontsource or GitHub Raw).
3.  **Registering**: For each downloaded TTF, the `ArrayBuffer` is converted to a binary string and added to `jsPDF`'s internal virtual file system (`doc.addFileToVFS()`).
4.  **Mapping**: `doc.addFont()` registers the file to a family name and style (normal/bold/italic).

### 4. Page Rendering Loop
For every node ID in the `pageNodes` array:
1.  **New Page**: If it's not the first iteration, `doc.addPage()` is called, setting the dimensions of the *current* node's template (allowing mixed-size documents, though rare).
2.  **Template Retrieval**: The engine looks up the Template matched to `node.type`.
3.  **Layer Traversal**: The elements list is sorted by `zIndex` (or implicit array order) and rendered back-to-front.

### 5. Drawing Primitives
The engine maps visual shapes to `jsPDF` drawing commands.
*   **Colors**: Hex codes are parsed to RGB and applied via `setFillColor` or `setDrawColor`.
*   **Transforms**: While DOM SVG handles `rotation` natively, `jsPDF` must use affine transformation matrices. However, `pdfService.ts` implements rotation manually. When a rectangle is rotated, `jsPDF` is told to build an explicit path (`doc.lines(...)` or a custom curve sequence) to draw the exact vertices of the rotated box, rather than using the basic `doc.rect()`.

### 6. Link Decoration
After all visual elements for a page are drawn, the service iterates again to find hyperlinks (`linkTarget !== "none"`).
1.  **Resolution**: Determines the target `AppNode` (e.g., Sibling resolving to ID "node_456").
2.  **Calculation**: Looks up "node_456" in the `pageMap` to get the target PDF page number (e.g., Page 42).
3.  **Application**: Calls `doc.link()` passing a transparent interactive rectangle over the element's actual visual bounds mapping to `{ pageNumber: 42 }`.

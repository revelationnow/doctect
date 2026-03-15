# 1. High-Level Architecture

PDF Architect is built as a pure client-side web application. It relies heavily on the user's browser for processing, rendering, and exporting, eliminating the need for a complex backend infrastructure. This architecture ensures privacy (data never leaves the device) and responsiveness.

## Tech Stack Deep Dive

*   **React (Frontend Framework)**: Powers the entire UI component tree and reactivity.
*   **TypeScript (Language)**: Provides strict typing for the complex data models (`AppNode`, `TemplateElement`), reducing runtime errors.
*   **Tailwind CSS (Styling)**: Used for rapid UI development and ensuring a consistent design system.
*   **React Router (Routing)**: Manages navigation between the landing page, editor workspace, and documentation.
*   **lucide-react (Icons)**: Provides the consistent icon set used throughout the UI.
*   **jsPDF (PDF Generation)**: The core engine for exporting the visual canvas into a real PDF document. (See [PDF Generation](5-pdf-generation.md) for more details).
*   **LocalStorage (Persistence)**: Projects are serialized to JSON and saved directly in the browser's `localStorage`. (See [State Management](3-state-management.md)).

## Application Entry Points and Routing

The core of the application routing is defined in `App.tsx`.

It uses `react-router-dom`'s `<BrowserRouter>` to manage the following routes:

1.  **`/` (LandingPage.tsx)**: The marketing page.
2.  **`/app` (EditorPage.tsx)**: The main workspace. This is where users spend most of their time building planners. It initializes the `ProjectEditor` components.
3.  **`/docs` (DocsPage.tsx)**: The inline documentation and tutorial section.
4.  **`/login` (LoginPage.tsx)**: Handles user authentication using `better-auth`.
5.  **`/analytics` (AnalyticsDashboard.tsx)**: A protected route (wrapped in `<AuthGuard>`) showing usage statistics, accessible only to authenticated users.

## Project Workspace (`EditorPage.tsx`)

When navigating to `/app`, the `EditorPage` component mounts. Its primary responsibility is project management, not editing itself.

*   **Initialization**: It reads all saved projects from `localStorage` under the key `hype_projects`.
*   **Migration**: Before loading a project into memory, it passes the raw JSON through `migrateState()` (from `services/migration.ts`). This ensures backward compatibility if the data models have changed (e.g., migrating from old global templates to the new "Variants" system).
*   **Tab Management**: It manages the `<TabBar>`, allowing users to switch between multiple open projects. It keeps the `activeProjectId` in sync with `localStorage` (`hype_active_project`).
*   **Delegation**: For the currently active project, it renders a `<ProjectEditor>` component, passing the `initialState` down. Hidden projects are kept mounted but hidden via CSS (`opacity-0 pointer-events-none`) to preserve their undo/redo history and state without unmounting and remounting.

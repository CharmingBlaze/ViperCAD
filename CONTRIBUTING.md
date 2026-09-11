# Contributing

This document is the on-ramp for anyone changing ViperCAD. Architecture rules live in [ARCHITECTURE.md](./ARCHITECTURE.md). File locations live in [docs/CODEMAP.md](./docs/CODEMAP.md). Step-by-step recipes live in [docs/RECIPES.md](./docs/RECIPES.md).

## Setup

Requires **Node.js 20+** (22 LTS recommended).

```bash
npm install
npm run dev      # http://localhost:5173
npm test
npm run lint
```

Import paths use the `@/` alias for `src/`. Prefer that over long relative paths.

```ts
import { EditorSession } from '@/core/editor/EditorSession';
```

## Where work belongs

| Change | Primary folders |
| :--- | :--- |
| Topology, mesh ops, IDs | `src/core/mesh/` |
| Undo, commands | `src/core/history/` |
| Selection | `src/core/selection/` |
| Tools (knife, sculpt, primitives) | `src/core/tools/` |
| Viewport cameras / pointer / nav | `src/app/viewportEngine.ts`, `src/app/viewport/` |
| Workspaces (Model, Sculpt, Terrain, Animate, UV, Tileset) | `src/workspace/`, `src/App.tsx` |
| UV / pixel canvas | `src/app/UvPixelEditor.tsx`, `src/app/uvEditor/` |
| Tileset / 3D tile draw | `src/app/tilesetWorkspace.ts`, `src/core/tools/TileDrawTool.ts` |
| Icons | `src/assets/icons/`, `src/components/BlenderIcon.tsx` |
| Persistence | `src/core/persistence/` |

Do not treat Three.js meshes, GPU buffers, or ray-hit objects as project data. `EditableMesh` and `ModelDocument` are the source of truth; the renderer is derived.

## Geometry edits

User-facing topology changes go through `runMeshTransaction` in `src/core/history/Transaction.ts`:

1. Snapshot mesh and selection.
2. Run a shared operation that returns structured results (not “whatever the array looks like now”).
3. Remap selection by stable IDs.
4. Validate.
5. Commit one undo command, or roll back on failure.

A tool is not done until it preserves IDs/attributes, validates, remaps selection, supports undo/redo, and has a focused test next to the code.

## Tests

Vitest, Node environment, files named `*.test.ts` under `src/`.

```bash
npm test                                           # all
npx vitest run src/core/mesh/ops/__tests__/bevel.test.ts
npm run test:watch
```

Put new tests beside the module they cover (`src/core/mesh/ops/__tests__/`, `src/app/viewport/__tests__/`, …). Prefer small cases that pin IDs, undo, and failure rollback over screenshot-style checks.

## UI and input

- Modelling, sculpt, terrain, animate, UV/Paint, and Tileset 3D views share camera chords in `src/app/viewport/ViewportInputEngine.ts`.
- LightWave-style on-canvas tools are `ViewportNavToolbar` (pan / orbit / zoom / frame / maximize).
- The UV/Paint 2D canvas uses the same toolbar plus `canvasNavKind` (Alt pan, Ctrl+Alt zoom).
- Keep `currentColor` on icons so they follow the dark UI.

## Pull requests

CI runs `npm test`, `npm run lint`, and `npm run build` on every pull request.

- Keep the change set to one concern (one op, one tool, one workspace fix).
- Name the *why* in the title; list test commands in the body.
- Do not commit `node_modules`, `dist`, `.env`, or binaries.
- Match existing naming: `camelCase` for values, `PascalCase` for types and React components.

Use the pull request template under `.github/` when opening a GitHub PR.

# ViperCAD

Low-poly CAD modelling kernel. Editable half-edge topology is the source of truth; Three.js buffers are derived.

## Quick start

Requires Node.js 20+.

```bash
npm install
npm run dev      # modeller → http://localhost:5173
npm test
npm run lint
```

| Script | Purpose |
| :--- | :--- |
| `npm run dev` | Main app |
| `npm run dev:rig` | Companion rig/animation app |
| `npm test` | Vitest |
| `npm run lint` | oxlint |
| `npm run build` | Typecheck + production bundle |
| `npm run build:exe` | Windows desktop binary (needs Go) |

New to the tree? Read **[CONTRIBUTING.md](./CONTRIBUTING.md)** then **[docs/CODEMAP.md](./docs/CODEMAP.md)**.

## Docs

- [Contributing](./CONTRIBUTING.md) — setup, conventions, PRs
- [Code map](./docs/CODEMAP.md) — which file owns which behaviour
- [Recipes](./docs/RECIPES.md) — add an op, tool, hotkey, or icon
- [Architecture](./ARCHITECTURE.md) — kernel contracts and roadmap
- [Icons](./docs/ICONS.md) — Blender UI SVGs
- [Ship freeze](./docs/SHIP.md) — 0.1.0 supported slice
- [Implementation plan](./IMPLEMENTATION_PLAN.md) — documents / groups / instances
- [Open reference projects](./docs/README.md#open-projects-worth-reading) — Blender, Godot, three.js, SolveSpace, …

## Kernel layout

```text
src/core/
  ids/            Stable element IDs
  document/       ModelDocument, scene objects, material assets
  mesh/           EditableMesh (half-edge), validation, triangulation, builders, ops
  selection/      SelectionManager (stable IDs)
  history/        CommandHistory + mesh transactions
  snap/           Shared SnapEngine
  tools/          Tool API + create/sculpt/cut tools
  editor/         EditorSession wiring
  uv/             UV layers, seams, islands, projection and packing
  image/          Shared pixel image and texture editing
  io/             Import/export adapters
  persistence/    Versioned native project serialization
  spatial/        Logical-face BVH
src/renderer/     EditableMesh → BufferGeometry + logical face pick maps
src/app/          Shell, viewports, inspectors, UV editor, animation
src/workspace/    Layout, cameras, UV/Paint window state
```

Heavy topology evaluation and UV packing use version-checked Web Workers. The UV workspace and
glTF import/export paths are loaded on demand, while stable-topology edits use partial GPU buffer
updates and BVH refitting.

## Current status

**0.1.0 closed alpha.** Model, Sculpt, Terrain, Blockout, Rig, Animate, UV/Paint, and Tileset are in the product, with save/open and OBJ/glTF export. See [docs/SHIP.md](./docs/SHIP.md).

The modelling kernel includes document assets, half-edge topology, builders, render/pick mapping, component selection, transactions, extrusion, inset, bevel, solidify, dissolve, fill holes, knife, loop cut, UV islands/packing, pixel paint, native serialization, and a mesh BVH. CI runs tests, lint, and production build on pull requests.

## Snapping

ViperCAD uses one shared resolver for creation, drawing, and transforms. The stable target order is
vertex → edge midpoint → edge → mesh surface → face centre → origin → grid/increment. This keeps
precise topology targets from losing to a nearby fallback grid point.

- Snapping follows the project toggle; hold `Ctrl` to temporarily invert it.
- Move snaps the active pivot to geometry, then falls back to the configured linear increment.
- Rotate uses the project angle increment; `Shift` gives a finer step.
- Primitive and poly drawing show the winning snap target beside the pointer and in the status text.
- Selected components and transformed objects are excluded from self-snapping.

Linear and angle increments are editable under **Edit → Level Building**.

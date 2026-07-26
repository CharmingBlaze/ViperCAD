# ViperCAD

Low-poly CAD modelling kernel. Editable half-edge topology is the source of truth; Three.js buffers are derived.

## Scripts

```bash
npm install
npm run dev
npm test
npm run build
```

## Kernel layout

```text
src/core/
  ids/            Stable element IDs
  document/       ModelDocument, scene objects, material assets
  mesh/           EditableMesh (half-edge), validation, triangulation, builders, ops
  selection/      SelectionManager (stable IDs)
  history/        CommandHistory + mesh transactions
  snap/           Shared SnapEngine
  tools/          Tool API + CreateBoxTool (3-stage CAD draw)
  editor/         EditorSession wiring
  uv/             UV layers, seams, islands, projection and packing
  image/          Shared pixel image and texture editing
  io/             Import/export adapters
  persistence/    Versioned native project serialization
  spatial/        Logical-face BVH
src/renderer/     EditableMesh → BufferGeometry + logical face pick maps
src/app/viewport/ Viewport scene synchronization and interaction overlays
src/app/uvEditor/ UV canvas rendering and focused editor subsystems
```

Heavy topology evaluation and UV packing use version-checked Web Workers. The UV workspace and
glTF import/export paths are loaded on demand, while stable-topology edits use partial GPU buffer
updates and BVH refitting.

## Current status

The coherent modelling foundation includes document assets, half-edge topology, builders, render/pick mapping, component selection, transactions, extrusion, inset, knife/loop cut, basic topology edits, UV islands/packing, pixel assets, OBJ interchange, native serialization and a mesh BVH. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the audited contracts and the explicit remaining roadmap; unfinished advanced tools are not presented as complete.

## Snapping

ViperCAD uses one shared resolver for creation, drawing, and transforms. The stable target order is
vertex → edge midpoint → edge → mesh surface → face centre → origin → grid/increment. This keeps
precise topology targets from losing to a nearby fallback grid point.

- Snapping follows the project toggle; hold `Ctrl` to temporarily invert it.
- Move snaps the active pivot to geometry, then falls back to the configured linear increment.
- Rotate uses the project angle increment; `Shift` gives a finer step.
- Primitive and poly drawing show the winning snap target beside the pointer and in status text.
- Selected components and transformed objects are excluded from self-snapping.

Linear and angle increments are editable under **Edit → Level Building**.

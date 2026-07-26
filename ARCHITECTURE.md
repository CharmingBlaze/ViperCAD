# ViperCAD modelling architecture

## Source-of-truth rule

`ModelDocument` owns scene objects and asset repositories. Every mesh asset is an `EditableMesh` with stable IDs for vertices, edges, half-edges, faces, face corners and UV layers. Logical polygons remain triangles, quads or n-gons; render triangles are derived by `MeshRenderAdapter` and carry mappings back to logical face/corner/vertex IDs.

Three.js geometry, material groups, texture objects and ray hits are disposable representations. They are never edited as topology and are never serialized as the project source.

## Current system audit

- Scene: hierarchical `SceneObject` records keep transforms separate from mesh-local positions. Meshes may be instanced by multiple objects.
- Topology: shared half-edge adjacency, open boundaries, face-corner UV/split-normal/colour attributes, stable element IDs and non-manifold rejection.
- Primitive generation: box, plane, cylinder, cone, sphere, pyramid and ramp share `MeshBuilder`; the box is eight vertices, twelve shared edges and six outward quad faces.
- Rendering: stable triangulation hints, logical triangle pick maps, material-slot groups, smooth/hard corner normals, revision-aware pixel textures and partial GPU attribute uploads for position/UV edits.
- Selection: one manager for object/vertex/edge/face IDs, conversion, grow, connected selection, remapping and stale-ID pruning.
- Editing: vertex translation, edge split/collapse, merge, face split/flip/delete, region extrusion, inset, knife chord and quad-ring cut all return structured topology changes.
- Transactions: geometry edits snapshot, validate and atomically commit or roll back. Mesh and selection state are both restored by undo/redo.
- UV and images: per-corner UV layers, seam-derived islands, planar projection, deterministic packing and exact RGBA pixel pencil/line/fill/UV-hit operations.
- Persistence and interchange: checksum-protected versioned native JSON plus polygon/UV/material-slot preserving OBJ import/export.
- Spatial data: renderer-independent per-mesh triangle BVH maps ray hits back to logical face IDs and refits after position-only changes; dirty flags and dependency rules separate topology, position, UV and material invalidation.
- Viewport: persistent perspective/top/front/right workspaces resolve object, logical face, vertex and edge picks against the topology model.

## Transaction contract

Every user-facing geometry command must run through `runMeshTransaction`:

1. Snapshot mesh and selection.
2. Execute a shared geometry operation.
3. Apply its stable-ID selection remap.
4. Run fast or full validation.
5. Store before/after states as one command.
6. Restore both states exactly on failure, cancel, undo or redo.

Operations must return `GeometryOpResult` and `TopologyChangeResult`; callers must not infer changes from array positions.

## Validation gates

Fast validation checks IDs, references, reciprocal loop links, twins, corners, UV layers and finite coordinates. Full validation adds duplicate edges/faces, zero-length edges, isolated vertices, zero-area polygons, manifold/twin consistency and closed-mesh signed winding. Builders, complex tools, imports and pre-export paths use full validation.

## Growth and performance boundaries

- `ViewportEngine` coordinates cameras and input. Scene-handle lifecycle and asynchronous evaluation live in `app/viewport/ViewportSceneSynchronizer`; transient DOM chrome lives in `ViewportInteractionOverlay`.
- The UV editor owns interaction state. Canvas rendering lives in `app/uvEditor/drawUvPixelCanvas`, and packing executes through `UvPackingWorkerClient`.
- Topology-changing render evaluation runs through `MeshEvaluationWorkerClient`. Results carry source geometry/topology versions and are discarded when stale.
- Worker clients provide deterministic synchronous fallbacks for tests and environments without Web Workers.
- The UV/pixel workspace, GLB exporter/validator and glTF importer are dynamic chunks. Lightweight export profiles and readiness diagnostics remain startup-safe.
- Position/UV-only render updates retain BufferGeometry allocations, declare narrow GPU update ranges, and refit the logical BVH instead of rebuilding it.

## Remaining staged work

The foundation is intentionally ready for the remaining high-complexity tools; these are not represented as completed merely by placeholder APIs.

1. Robust bevel with overlap limiting and hardened normals; region inset with shared internal boundaries.
2. Multi-face arbitrary knife paths, branching loop-cut policy, bridge, hole fill, dissolve and triangle-to-quad heuristics.
3. Extend construction planes with named/user-defined planes and add persistent post-operation parameter editing.
4. Angle-based smoothing, tangents, UV relax/stitch/straighten and production-quality chart packing.
5. Layered indexed-colour pixel documents, palettes, selection masks and brush transaction merging.
6. Native save/open UI, autosave recovery, migrations beyond format v1, glTF/GLB/STL/PLY adapters and evaluated non-destructive export.
7. Modifier stack (mirror/array/subdivision/solidify/bevel/triangulate/boolean) and evaluated-cache invalidation.
8. Scene broad phase, worker-pool scheduling and stress/performance suites.

Correctness gates stay ahead of tool count: a new topology tool is complete only when it preserves IDs/attributes, validates, remaps selection, supports undo/redo and has focused automated tests.

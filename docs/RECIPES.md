# Recipes

Short checklists for common changes. Follow [ARCHITECTURE.md](../ARCHITECTURE.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

## Add a mesh operation

1. Implement a pure function in `src/core/mesh/ops/` that takes `EditableMesh` and returns `GeometryOpResult` / `TopologyChangeResult` (see `ops/types.ts`).
2. Do not mutate selection inside the op; return ID remaps.
3. Call it from `runMeshTransaction` in the tool or editor command.
4. Add `src/core/mesh/ops/__tests__/<name>.test.ts`: happy path, invalid input, undo restores IDs.
5. Export from `src/core/mesh/ops/index.ts` if other modules need it.

Copy `src/core/mesh/ops/extrude.ts` and its test as a template.

## Add a viewport tool

1. Add an id to `ToolId` in `src/core/tools/Tool.ts`.
2. Implement `Tool` (`activate` / `begin` / `update` / `confirm` / `cancel`).
3. Register it on `ToolController` / `EditorSession`.
4. Wire a button in `LeftToolbar.tsx` or the relevant panel; use `BlenderIcon` names that exist in `src/assets/icons/`.
5. If the tool owns LMB, decide whether Alt+LMB should still orbit (`primaryBlocksCameraNav` in `viewportEngine.ts`).
6. Add `src/core/tools/__tests__/<name>.test.ts`.

## Add a hotkey

1. Handle the key in `src/app/blender/BlenderControlEngine.ts` (or the editor that owns focus, e.g. `UvPixelEditor`). Start operators with `beginBlenderOperator`.
2. Ignore the shortcut when the event target is an input or textarea.
3. Document it in `src/app/HotkeyHelpOverlay.tsx`.
4. Add a case to `src/app/__tests__/TransformHotkeys.test.ts` when it is a modelling key.

## Add viewport navigation

Shared mapping lives in `src/app/viewport/ViewportInputEngine.ts`:

- `modifierNavKind` — 3D LightWave / laptop chords
- `canvasNavKind` — UV/Paint 2D canvas
- `classifyWheel` — wheel zoom vs trackpad pan

`ViewportEngine.tryBeginModifierNav` applies 3D chords. The UV canvas applies `canvasNavKind` in `UvPixelEditor`. Keep both in sync when you change a chord.

On-screen pan/orbit/zoom is `ViewportNavToolbar`. For a new 2D view, copy the UV canvas wiring (local nav mode + `onDrag` that pans/zooms that view’s camera).

## Add an inspector control

1. Read/write document or tool state, not Three.js objects.
2. Put the control in `AppInspectorPanel.tsx` (model) or the shell panel (`SculptPanel`, `TerrainPanel`, `UvEditorSidePanel`).
3. Call `session.requestRedraw()` / `onRefresh()` after mutating.
4. Prefer existing CSS classes (`.uv-field`, `.inspector-segmented`) over new layout systems.

## Add or refresh icons

1. Drop an SVG into `src/assets/icons/` **or** run `node scripts/sync-blender-icons.mjs`.
2. Use `<BlenderIcon name="mesh_cube" />`. Unknown names render a fallback square.
3. Keep fills as `currentColor` (the sync script and `BlenderIcon` both rewrite `#fff`).
4. Toolbar tools `tool_move`, `tool_select`, and similar are local; do not overwrite them in the sync script’s keep list.

## Add a persistence field

1. Extend the versioned type in `src/core/persistence/` (or workspace types in `src/workspace/`).
2. Bump the format version and migrate old files on load.
3. Round-trip in `src/core/persistence/__tests__/ProjectSerializer.test.ts` or the matching workspace test.

Never serialize renderer meshes or GPU resources.

## Run a focused check before a pull request

```bash
npx vitest run src/path/to/__tests__/your.test.ts
npm run lint
```

If you touched UI, click the affected workspace (Model, Sculpt, Terrain, Animate, UV/Paint) and confirm the other workspaces still orbit/pan/zoom.

# Code map

Start here when you need the file that owns a behaviour. Kernel contracts stay in [ARCHITECTURE.md](../ARCHITECTURE.md).

## Boot and shell

| Need | Look at |
| :--- | :--- |
| App chrome, workspace chips, menus | `src/App.tsx` |
| Global CSS tokens | `src/App.css` |
| Workspace themes (chrome + viewport + gizmos) | `src/app/theme/themeTokens.ts` |
| Workspace mode (`model` / `sculpt` / `terrain` / `animate` / `texture`) | `src/workspace/WorkspaceController.ts`, `src/workspace/types.ts` |
| Quad layout, maximize, camera snapshots | `src/workspace/SplitLayoutManager.ts`, `src/workspace/WorkspacePersistence.ts` |
| UV/Paint split windows | `src/workspace/TextureWorkspace.ts`, `src/app/TexturePanelWindow.tsx` |
| Input ownership (`none` / `nav` / `tool` / `transform` / `divider`) | `src/workspace/InputRouter.ts` |
| Confirm / rename prompts | `src/app/platform/appDialogs.ts`, `src/app/AppDialogHost.tsx` |

## Document and session

| Need | Look at |
| :--- | :--- |
| Project, model vs level documents | `src/core/document/` |
| Live editor wiring (tools, selection, snap, history) | `src/core/editor/EditorSession.ts`, `src/core/editor/ProjectEditor.ts` |
| Groups, focus, instances | `src/core/editor/GroupFocus.ts`, `src/core/editor/ModelInstances.ts` |
| Undo stack | `src/core/history/CommandHistory.ts` |
| Mesh transactions | `src/core/history/Transaction.ts` |

## Mesh kernel

| Need | Look at |
| :--- | :--- |
| Half-edge types and IDs | `src/core/mesh/types.ts`, `src/core/ids/` |
| Adjacency helpers | `src/core/mesh/EditableMesh.ts` |
| Builders (box, sphere, doodle, …) | `src/core/mesh/builders/` |
| Shared ops (extrude, inset, bevel, knife, solidify) | `src/core/mesh/ops/` |
| Validation | `src/core/mesh/Validation.ts` |
| Selection | `src/core/selection/SelectionManager.ts` |
| Snap order | `src/core/snap/SnapEngine.ts` |
| G/R/S transforms | `src/core/transform/` |
| Logical-face BVH | `src/core/spatial/MeshBvh.ts` |

## Tools and panels

| Need | Look at |
| :--- | :--- |
| Tool interface and IDs | `src/core/tools/Tool.ts` |
| Tool registry | `src/core/tools/ToolController.ts` |
| Primitives, doodle, poly, knife, loop cut | `src/core/tools/CreatePrimitiveTool.ts` and siblings |
| Mesh / terrain sculpt | `src/core/tools/MeshSculptTool.ts`, `src/core/terrain/` |
| Left modelling toolbar | `src/app/LeftToolbar.tsx` |
| Inspector | `src/app/AppInspectorPanel.tsx`, `src/app/RightSidebar.tsx` |
| Terrain / sculpt side panels | `src/app/TerrainPanel.tsx`, `src/app/SculptPanel.tsx` |
| Hotkeys | `src/app/blender/BlenderControlEngine.ts`, `src/app/TransformHotkeys.ts`, `src/app/HotkeyHelpOverlay.tsx` |

## Viewport and cameras

| Need | Look at |
| :--- | :--- |
| WebGL host, panes, picking, painting | `src/app/viewportEngine.ts` |
| Pointer → orbit / pan / zoom mapping | `src/app/viewport/ViewportInputEngine.ts` |
| LightWave nav cluster | `src/app/ViewportNavToolbar.tsx` |
| Quad chrome, UV split | `src/app/Viewport.tsx` |
| Scene sync from document | `src/app/viewport/ViewportSceneSynchronizer.ts` |
| Derived GPU meshes | `src/renderer/MeshRenderAdapter.ts` |

Camera chords (all 3D workspaces):

- LMB drag: orbit (perspective) or pan (ortho)
- RMB drag: pan
- Wheel: zoom; Shift+wheel: pan
- MMB / Alt+LMB: orbit (Shift pan, Ctrl zoom) when a tool owns LMB
- UV 2D canvas: Alt or MMB pan, Ctrl+Alt zoom (`canvasNavKind`)

## UV, paint, animation

| Need | Look at |
| :--- | :--- |
| UV + pixel canvas | `src/app/UvPixelEditor.tsx` |
| Tileset / 3D tile draw | `src/app/tilesetWorkspace.ts`, `src/core/tools/TileDrawTool.ts`, `src/app/TileDrawHud.tsx`, `src/app/FloatingAtlasTilePanel.tsx` |
| Canvas draw | `src/app/uvEditor/drawUvPixelCanvas.ts` |
| UV ops / packing | `src/core/uv/` |
| Pixel images | `src/core/image/` |
| Animation session, dope sheet | `src/app/animation/` |
| Rig data | `src/core/rig/` |

## Persistence and IO

| Need | Look at |
| :--- | :--- |
| Native `.viper` project | `src/core/persistence/` |
| Open/save health gates | `src/core/persistence/projectHealth.ts` |
| OBJ / glTF | `src/core/io/` |
| Workspace cameras / UV layout (localStorage) | `src/workspace/WorkspacePersistence.ts`, `src/workspace/TextureWorkspace.ts` |

## Icons

Official Blender UI SVGs live in `src/assets/icons/`. Render with `BlenderIcon`. Refresh from upstream with `node scripts/sync-blender-icons.mjs`. Details: [ICONS.md](./ICONS.md).

## Standalone apps

| App | Path |
| :--- | :--- |
| Main modeller | `index.html` → `src/App.tsx` |
| Rig / animation companion | `rig/` (`npm run dev:rig`) |
| Desktop wrapper | `desktop/` (`npm run build:exe`) |

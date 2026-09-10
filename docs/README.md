# Docs

| Doc | Use when |
| :--- | :--- |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Setup, conventions, definition of done |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Source-of-truth rules, transactions, roadmap |
| [CODEMAP.md](./CODEMAP.md) | “Which file owns this?” |
| [RECIPES.md](./RECIPES.md) | Add an op, tool, hotkey, icon, or field |
| [ICONS.md](./ICONS.md) | Blender icon component and theme |
| [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md) | Document / group / instance rollout |

## Open projects worth reading

These are independent codebases with similar problems (viewports, undo, mesh IO). Use them as references; do not copy large files verbatim.

| Project | Why it is useful here |
| :--- | :--- |
| [Blender](https://github.com/blender/blender) | Mesh kernel, UI icons (`release/datafiles/icons_svg`), operator/undo model |
| [Godot](https://github.com/godotengine/godot) | Editor layout, contributing guide, issue/PR templates |
| [three.js](https://github.com/mrdoob/three.js) | WebGL renderer, examples, OrbitControls behaviour |
| [SolveSpace](https://github.com/solvespace/solvespace) | Parametric CAD, small C++ kernel |
| [OpenSCAD](https://github.com/openscad/openscad) | CSG modelling, tests around geometry |
| [Dust3D](https://github.com/huxingyi/dust3d) | Compact 3D modelling app with a readable tool loop |

Blender UI icons used by ViperCAD come from `blender/blender` (`release/datafiles/icons_svg`). Refresh with `node scripts/sync-blender-icons.mjs`.

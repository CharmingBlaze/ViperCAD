# ViperCAD 0.1.0 — ship freeze

This is a **closed alpha**, not a store release. All workspaces below are in the product.

## In scope (use this)

1. **Model** — primitives, G/R/S, extrude, inset, bevel, knife, loop cut.
2. **Sculpt** — brushes, mask, symmetry, remesh / subdivide / decimate.
3. **Terrain** — height sculpt, water/paths, prop scatter, game colliders.
4. **Blockout** — Flat / Square / Round extrudes with reference images.
5. **Rig** — skeleton presets, bind, weight paint, vertex weights, test pose.
6. **Animate** — clips, dope sheet, keys, events, procedural bake, skinned GLB.
7. **UV / Pixel** — unwrap and paint the active object.
8. Save a `.viper` project (format v4) and reopen it.
9. Export OBJ or glTF/GLB for a game engine.
10. Recover from a crash via the autosave dialog.

## Release gates

- CI on `main` / PRs: `npm test`, `npm run lint`, `npm run build`
- Application version `0.1.0` written into saved files
- Unhandled errors and page hide flush an emergency autosave
- A React error boundary offers Reload instead of a blank screen
- Dirty documents warn on tab close
- Save refuses documents that fail mesh validation
- Open and autosave restore refuse checksum failures, broken meshes, and dangling scene refs
- OBJ / glTF import validates topology before adding objects
- GLB export already round-trips before writing the file
- Animation clips keep events, loop, root motion, and interpolation across save
- `npm run ci` is the local gate (`test` + `lint` + `build`)

## Out of scope for 0.1

Signed installers, auto-update, Mac/Linux desktop, booleans, linked instances, production UV packing, crash telemetry to a server, and paying-user support.

## How to cut a build

```bash
npm run ci          # test + lint + build
npm run build:exe   # Windows, needs Go + WebView2
```

# ViperCAD Icon System & Developer Guide

ViperCAD includes Blender's official **UI icon SVGs** from [`blender/blender` `release/datafiles/icons_svg`](https://github.com/blender/blender/tree/main/release/datafiles/icons_svg) (the current per-icon vectors, not the old 16×16 sprite sheet). Refresh them with `node scripts/sync-blender-icons.mjs`. Custom toolbar glyphs (`tool_move`, `tool_select`, …) are kept locally because those tools use Blender's separate geometry-icon set, not the UI sheet.

This guide explains how to use, style, and extend Blender icons throughout ViperCAD.

---

## 1. Quick Start

ViperCAD provides a unified React component: [`BlenderIcon`](file:///c:/Users/Snow/Documents/Projects/ViperCAD%20-%20New/src/components/BlenderIcon.tsx).

```tsx
import { BlenderIcon } from '@/components/BlenderIcon';

// Simple icon with default size (16px)
<BlenderIcon name="cube" />

// Custom size and title for accessibility
<BlenderIcon name="vertex_select" size={18} title="Select Vertices" />

// Custom styling or custom color override
<BlenderIcon name="mod_bevel" size={20} className="my-tool-icon" />
```

### Component Props

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `name` | `BlenderIconName` | *(required)* | Name of the icon file in `src/assets/icons/` (without `.svg`). Full TypeScript autocomplete included! |
| `size` | `number \| string` | `16` | Size in pixels (e.g. `16`, `20`) or CSS units (`'1.2rem'`). Renders equal width & height. |
| `className` | `string` | `''` | Optional CSS class name attached to the icon span. |
| `style` | `CSSProperties` | `undefined` | Optional inline styles. |
| `title` | `string` | `undefined` | Accessible tooltip title. If omitted, `aria-hidden="true"` is set automatically. |
| `color` | `string` | `undefined` | Explicit color override. Defaults to CSS `currentColor`. |

---

## 2. Photoshop Dark Theme & Color Integration

All 666 Blender icons are pre-processed to use `fill="currentColor"`. This means icons **automatically adapt** to whichever text color their parent container uses:

```css
/* Standard muted icon state */
.tool-btn {
  color: var(--muted); /* #9e9e9e */
}

/* Hover state: crisp white */
.tool-btn:hover {
  color: var(--text); /* #ffffff */
}

/* Active / selected tool: Adobe Photoshop signature blue */
.tool-btn.is-active {
  color: #ffffff;
  background: var(--accent); /* #1473e6 */
}
```

### Key Photoshop Color Tokens (`src/App.css`):
* `--bg: #1e1e1e;` &mdash; Artboard / canvas base neutral dark gray
* `--bar: #282828;` &mdash; Menu and status bar neutral tone
* `--panel: #323232;` &mdash; Primary inspector / outliner panel surface
* `--panel-secondary: #282828;` &mdash; Section headers and nested panels
* `--line: #3f3f3f;` &mdash; Crisp 1px hairline divider borders
* `--accent: #1473e6;` &mdash; Photoshop signature blue
* `--accent-hover: #2680eb;` &mdash; Vibrant interaction blue
* `--muted: #9e9e9e;` &mdash; Inactive icons and secondary text
* `--text: #e6e6e6;` &mdash; Active icons and primary text

---

## 3. Categorized Icon Cheat Sheet

Below is a reference of the most frequently used Blender icons in 3D CAD and DCC workflows.

### 3D Component Modes (The Core Quartet)
| Icon Name | Preview / Meaning | Common Usage |
| :--- | :--- | :--- |
| `object_datamode` | Object mode (solid box with bounding brackets) | Object mode switch in toolbar and top header |
| `vertex_select` | Vertex mode (cube with active corner vertex) | Vertex select mode |
| `edge_select` | Edge mode (cube with active front edge line) | Edge select mode |
| `face_select` | Face mode (cube with filled active surface face) | Face select mode |

### Primary 3D Transforms (Left Toolbar)
| Icon Name | Preview / Meaning | Common Usage |
| :--- | :--- | :--- |
| `tool_select` | Dashed selection rectangle | Select Box tool (Q) |
| `tool_move` | 4-way translation cross with arrowheads | Move / Translate tool (G / W) |
| `tool_rotate` | Orbit ring with circular rotation arrows | Rotate tool (R / E) |
| `tool_scale` | Corner expansion arrow with origin box | Scale tool (S) |
| `gizmo` | 3D axis triad | Gizmo visibility toggle |
| `pivot_median` | Median pivot dot | Pivot point: Median center |
| `pivot_cursor` | Cursor pivot cross | Pivot point: 3D cursor |
| `pivot_individual` | Individual origins | Pivot point: Individual origins |
| `orientation_global` | Global coordinate globe | Global orientation |
| `orientation_local` | Local coordinate box | Local orientation |

### Mesh Modeling Operations (Left Toolbar)
| Icon Name | Preview / Meaning | Common Usage |
| :--- | :--- | :--- |
| `tool_extrude` | 3D box base with extruding face & arrow | Extrude Region (E) |
| `tool_inset` | Quad boundary with inner inset face | Inset Faces (I) |
| `mod_bevel` | Rounded chamfer corner | Bevel operation (Ctrl+B) |
| `tool_loopcut` | Mesh block with slicing loop cut band | Loop Cut & Slide (Ctrl+R) |
| `tool_knife` | Scalpel blade slicing across geometry | Knife Topology Tool (K) |
| `mod_subsurf` | Subdivided cube | Subdivision Surface modifier |
| `mod_mirror` | Mirrored halves | Mirror modifier |
| `mod_boolean` | Intersecting shapes | Boolean union/difference/intersect |
| `mod_remesh` | Remesh grid | Voxel / Quad remesh |
| `mod_wireframe` | Wireframe lattice | Wireframe modifier |
| `mod_smooth` | Smooth curve | Smooth geometry |

### 3D Primitives
| Icon Name | Preview / Meaning | Common Usage |
| :--- | :--- | :--- |
| `cube` or `mesh_cube` | Box primitive | Add Box |
| `sphere` or `mesh_uvsphere` | Sphere primitive | Add UV Sphere |
| `mesh_cylinder` | Cylinder primitive | Add Cylinder |
| `cone` or `mesh_cone` | Cone primitive | Add Cone |
| `mesh_torus` | Torus ring primitive | Add Torus / Donut |
| `mesh_plane` | Plane surface | Add Plane ground |
| `mesh_monkey` | Suzanne mascot | Test geometry |

### Scene Hierarchy & Outliner
| Icon Name | Preview / Meaning | Common Usage |
| :--- | :--- | :--- |
| `outliner` | Outliner tree symbol | Outliner tab and dock |
| `properties` | Properties sliders | Inspector panel tab |
| `scene` | Clapperboard / scene stage | Scene root collection |
| `group` | Folder / collection | Object groups |
| `mesh_data` | Triangle mesh node | Mesh object row |
| `material_data` | Material sphere | Material slot |
| `light_data` | Light bulb / point | Light sources |
| `camera_data` | Camera body | Viewport cameras |
| `hide_off` | Open eye | Visible object |
| `hide_on` | Closed eye | Hidden object |
| `locked` | Padlock closed | Transform locked |
| `unlocked` | Padlock open | Transform editable |
| `trash` | Trash can | Delete object / modifier |

### Viewport Overlays & Shading
| Icon Name | Preview / Meaning | Common Usage |
| :--- | :--- | :--- |
| `shading_wire` | Wireframe cube | Wireframe shading mode |
| `shading_solid` | Solid shaded sphere | Solid shading mode |
| `shading_texture` | Checkerboard sphere | Material / Texture preview |
| `shading_rendered` | Raytraced sphere | Rendered mode |
| `x_ray` | Translucent overlapping boxes | X-Ray mode (Alt+Z) |
| `grid` | Coordinate grid | Viewport grid toggle |
| `view_perspective` | Perspective frustum | Perspective camera view |
| `view_ortho` | Parallel orthographic view | Orthographic quad views |
| `view_pan` | Hand pan | Pan navigation |
| `view_zoom` | Magnifier | Zoom navigation |
| `fullscreen_enter` | Expand arrows | Maximize viewport |
| `fullscreen_exit` | Collapse arrows | Restore quad view |

---

## 4. How to Check Available Icons Programmatically

You can check if an icon name is present or inspect the total count:

```tsx
import { hasBlenderIcon, TOTAL_BLENDER_ICONS } from '@/components/BlenderIcon';

console.log(TOTAL_BLENDER_ICONS); // official Blender UI set + local tool glyphs
console.log(hasBlenderIcon('mod_mirror')); // true
console.log(hasBlenderIcon('unknown_name')); // false
```

---

## 5. Adding New SVG Icons

1. Drop the `.svg` file into [`src/assets/icons/`](file:///c:/Users/Snow/Documents/Projects/ViperCAD%20-%20New/src/assets/icons/).
2. The file is automatically discovered and bundled by Vite's `import.meta.glob`.
3. Optionally add the new name to `KnownBlenderIcon` union in [`BlenderIcon.tsx`](file:///c:/Users/Snow/Documents/Projects/ViperCAD%20-%20New/src/components/BlenderIcon.tsx) for IDE autocomplete.

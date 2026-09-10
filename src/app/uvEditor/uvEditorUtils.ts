import type { EditorSession } from '@/core/editor/EditorSession';
import type { EditableMesh, FaceCornerId, FaceId } from '@/core/mesh/types';
import { cornersForFaces } from '@/core/uv/UvEdit';
import { islandForFace } from '@/core/uv/UvOperations';
import type { TextureWorkspaceState } from '@/workspace/TextureWorkspace';

export const UV_ZOOM_STEPS = [0.01, 0.025, 0.05, 0.0625, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
export const UV_ZOOM_MIN = UV_ZOOM_STEPS[0]!;
export const UV_ZOOM_MAX = UV_ZOOM_STEPS[UV_ZOOM_STEPS.length - 1]!;

export type UvCanvasCamera = { panX: number; panY: number; zoom: number };

export const PIXEL_TOOLS = ['pencil', 'eraser', 'eyedropper', 'fill', 'line', 'rectangle', 'ellipse', 'replace'] as const;
export type PixelToolId = (typeof PIXEL_TOOLS)[number];
export const PIXEL_TOOL_LABELS: Record<PixelToolId, string> = {
  pencil: 'Pencil',
  eraser: 'Eraser',
  eyedropper: 'Eyedropper',
  fill: 'Fill',
  line: 'Line',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  replace: 'Replace',
};
export const PIXEL_TOOL_HOTKEYS: Record<PixelToolId, string> = {
  pencil: 'B',
  eraser: 'E',
  eyedropper: 'I',
  fill: 'F',
  line: 'L',
  rectangle: 'R',
  ellipse: 'O',
  replace: 'Shift+R',
};
export const UV_EDIT_MODE_ICONS = {
  face: 'uv_face_select',
  point: 'uv_vertex_select',
  island: 'uv_islands_select',
} as const;

export const UV_TRANSFORM_ICONS = {
  move: 'tool_move',
  scale: 'tool_scale',
  rotate: 'tool_rotate',
} as const;

export const UNWRAP_MODE_ICONS = {
  smart: 'mod_uvproject',
  auto: 'auto',
  angle: 'normals_face',
  box: 'mesh_cube',
  cubic: 'cube',
  cylinder: 'mesh_cylinder',
  sphere: 'mesh_uvsphere',
  view: 'view3d',
  planar: 'mesh_plane',
} as const;

export const PIXEL_TOOL_ICONS: Record<PixelToolId, string> = {
  pencil: 'greasepencil',
  eraser: 'x',
  eyedropper: 'eyedropper',
  fill: 'gp_draw_fill',
  line: 'snap_edge',
  rectangle: 'mesh_plane',
  ellipse: 'mesh_circle',
  replace: 'color',
};

/** Zoom toward a canvas point without snapping to the 1:1 ladder. */
export function zoomCameraAt(
  cam: UvCanvasCamera,
  mx: number,
  my: number,
  factor: number,
  minZoom = UV_ZOOM_MIN,
  maxZoom = UV_ZOOM_MAX,
): UvCanvasCamera {
  const nextZoom = Math.max(minZoom, Math.min(maxZoom, cam.zoom * factor));
  const worldX = (mx - cam.panX) / cam.zoom;
  const worldY = (my - cam.panY) / cam.zoom;
  return {
    zoom: nextZoom,
    panX: mx - worldX * nextZoom,
    panY: my - worldY * nextZoom,
  };
}

export function uniqueFacesForCorners(
  mesh: { faceCorners: Map<FaceCornerId, { faceId: FaceId }> },
  cornerIds: FaceCornerId[],
): FaceId[] {
  const faces = new Set<FaceId>();
  for (const id of cornerIds) {
    const corner = mesh.faceCorners.get(id);
    if (corner) faces.add(corner.faceId);
  }
  return [...faces];
}

/** Prefer 3D face selection when sync is on so stale UV corners cannot win. */
export function resolveSelectedCorners(
  mesh: EditableMesh,
  session: EditorSession,
  tex: TextureWorkspaceState,
): FaceCornerId[] {
  const faces = session.selection.state.selectedFaceIds;
  if (tex.uvSelectionSync !== 'off' && tex.uvEditMode !== 'point' && faces.size) {
    let faceIds = [...faces];
    if (tex.uvSelectionSync === 'island') {
      const expanded = new Set<FaceId>();
      for (const f of faceIds) {
        const island = islandForFace(mesh, f);
        for (const id of island?.faceIds ?? [f]) expanded.add(id);
      }
      faceIds = [...expanded];
    }
    return cornersForFaces(mesh, faceIds);
  }
  let corners = [...session.uvSelection.state.selectedCornerIds];
  if (!corners.length && faces.size) {
    corners = cornersForFaces(mesh, faces);
  }
  return corners;
}

export function nearestZoomIndex(zoom: number, steps: number[] = UV_ZOOM_STEPS): number {
  let best = 0;
  let dist = Infinity;
  for (let i = 0; i < steps.length; i++) {
    const d = Math.abs(steps[i]! - zoom);
    if (d < dist) {
      dist = d;
      best = i;
    }
  }
  return best;
}

export function rgbaToHex(c: readonly [number, number, number, number]): string {
  return '#' + [c[0], c[1], c[2]].map((n) => n.toString(16).padStart(2, '0')).join('');
}

export function hexToRgba(hex: string, alpha: number): [number, number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    alpha,
  ];
}

/** Shift colour for shading (Aseprite style: shadow cooler/darker, highlight warmer/lighter). */
export function shiftShadeColor(
  c: readonly [number, number, number, number],
  direction: 'darker' | 'lighter',
): [number, number, number, number] {
  const [r, g, b, a] = c;
  const factor = direction === 'darker' ? 0.82 : 1.22;
  const shiftR = direction === 'darker' ? -4 : 6;
  const shiftG = direction === 'darker' ? -2 : 4;
  const shiftB = direction === 'darker' ? 5 : -4;

  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return [
    clamp(r * factor + shiftR),
    clamp(g * factor + shiftG),
    clamp(b * factor + shiftB),
    a,
  ];
}

/** Paint tool from a key. UV mode keeps L (island) and R (rotate). */
export function paintToolFromHotkey(
  key: string,
  shiftKey: boolean,
  uvPointerActive: boolean,
): PixelToolId | null {
  const k = key.toLowerCase();
  if (k === 'b') return 'pencil';
  if (k === 'e') return 'eraser';
  if (k === 'i') return 'eyedropper';
  if (k === 'f') return 'fill';
  if (k === 'o') return 'ellipse';
  if (uvPointerActive && (k === 'l' || k === 'r')) return null;
  if (k === 'l') return 'line';
  if (k === 'r') return shiftKey ? 'replace' : 'rectangle';
  return null;
}

export const DITHER_MODES = ['none', 'checker', 'bayer4'] as const;
export type DitherMode = (typeof DITHER_MODES)[number];

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

export function evaluateDither(x: number, y: number, mode: DitherMode): boolean {
  if (mode === 'none') return true;
  const px = Math.abs(Math.floor(x));
  const py = Math.abs(Math.floor(y));
  if (mode === 'checker') {
    return (px + py) % 2 === 0;
  }
  if (mode === 'bayer4') {
    return (BAYER_4X4[py % 4]![px % 4]! / 16) >= 0.5;
  }
  return true;
}


import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  OrthographicCamera,
  PerspectiveCamera,
  Vector3,
  type Camera,
} from 'three';
import type { ViewId } from '@/workspace/types';

/** Number of cells used to choose the adaptive minor-line spacing. */
export const GRID_BASE_SIZE = 20;
export const GRID_BASE_DIVISIONS = 20;
// Viper CAD viewport palette: blue-black field, cool structural lines, and
// restrained conventional axis colours. Orange selection and lime UI accents
// remain visually dominant.
const GRID_MINOR = new Color(0x1a222c);
const GRID_MAJOR = new Color(0x303b49);
const AXIS_X = new Color(0x783b42);
const AXIS_Y = new Color(0x477552);
const AXIS_Z = new Color(0x3c567f);
const PLANE_EPS = -0.0005;
const MAJOR_EVERY = 10;
/** Covers the largest supported ortho/perspective framing without losing float precision. */
export const GRID_MAX_SIZE = 1_048_576;

const _target = new Vector3();

export class ViewportGrid extends Group {
  private readonly geometry = new BufferGeometry();
  private readonly lines: LineSegments;
  private signature = '';

  constructor() {
    super();
    const material = new LineBasicMaterial({ vertexColors: true, depthTest: true, depthWrite: false });
    this.lines = new LineSegments(this.geometry, material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = -10;
    this.add(this.lines);
    this.visible = false;
  }

  update(viewId: ViewId, size: number, target: Vector3): void {
    const spacing = size / GRID_BASE_DIVISIONS;
    const [targetU, targetV] =
      viewId === 'top' || viewId === 'persp'
        ? [target.x, target.z]
        : viewId === 'front'
          ? [target.x, target.y]
          : [target.y, target.z];
    const anchorU = snappedGridAnchor(targetU, spacing);
    const anchorV = snappedGridAnchor(targetV, spacing);
    const signature = `${viewId}:${size}:${anchorU}:${anchorV}`;
    if (signature === this.signature) return;
    this.signature = signature;

    // Rebuild a large patch around the view target. Snapping the anchor to a
    // whole cell makes it read as Blender's infinite grid without shimmer.
    const halfExtent = size / 2;
    const uMin = anchorU - halfExtent;
    const uMax = anchorU + halfExtent;
    const vMin = anchorV - halfExtent;
    const vMax = anchorV + halfExtent;
    const positions: number[] = [];
    const colours: number[] = [];

    const pushVertex = (u: number, v: number, colour: Color) => {
      if (viewId === 'top' || viewId === 'persp') positions.push(u, PLANE_EPS, v);
      else if (viewId === 'front') positions.push(u, v, PLANE_EPS);
      else positions.push(PLANE_EPS, u, v);
      colours.push(colour.r, colour.g, colour.b);
    };
    const lineColour = (coordinate: number, axisColour: Color) => {
      if (Math.abs(coordinate) < spacing * 1e-5) return axisColour;
      const index = Math.round(coordinate / spacing);
      return index % MAJOR_EVERY === 0 ? GRID_MAJOR : GRID_MINOR;
    };

    const firstU = Math.ceil(uMin / spacing);
    const lastU = Math.floor(uMax / spacing);
    const firstV = Math.ceil(vMin / spacing);
    const lastV = Math.floor(vMax / spacing);
    for (let i = firstU; i <= lastU; i++) {
      const u = i * spacing;
      // A constant-U line runs along V, so the origin line uses V's axis colour.
      const vAxisColour = viewId === 'top' || viewId === 'right' ? AXIS_Z : AXIS_Y;
      const uColour = lineColour(u, vAxisColour);
      pushVertex(u, vMin, uColour);
      pushVertex(u, vMax, uColour);
    }
    for (let i = firstV; i <= lastV; i++) {
      const v = i * spacing;
      const uAxisColour = viewId === 'right' ? AXIS_Y : AXIS_X;
      const vColour = lineColour(v, uAxisColour);
      pushVertex(uMin, v, vColour);
      pushVertex(uMax, v, vColour);
    }

    this.geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
    this.geometry.computeBoundingSphere();
  }
}

export function createViewportGrid(_viewId: ViewId): ViewportGrid {
  return new ViewportGrid();
}

/** World-space span of the camera's visible frustum (largest axis). */
export function visibleWorldSpan(camera: Camera, target: Vector3): number {
  if (camera instanceof OrthographicCamera) {
    const h = (camera.top - camera.bottom) / Math.max(1e-6, camera.zoom);
    const w = (camera.right - camera.left) / Math.max(1e-6, camera.zoom);
    return Math.max(h, w, 1);
  }
  if (camera instanceof PerspectiveCamera) {
    const dist = Math.max(0.5, camera.position.distanceTo(target));
    const halfH = dist * Math.tan((camera.fov * Math.PI) / 360);
    const halfW = halfH * Math.max(0.1, camera.aspect);
    return Math.max(halfH, halfW) * 2;
  }
  return 20;
}

/** Snap grid density to powers of two so zooming changes it in stable steps. */
export function niceGridSize(span: number): number {
  const cover = Math.max(GRID_BASE_SIZE, span * 2.5);
  const pow = Math.pow(2, Math.ceil(Math.log2(cover)));
  return Math.min(Math.max(pow, GRID_BASE_SIZE), GRID_MAX_SIZE);
}

/** Re-anchor only on whole cells, preserving visible sub-cell camera movement. */
export function snappedGridAnchor(value: number, spacing: number): number {
  return Math.round(value / Math.max(spacing, 1e-6)) * spacing;
}

export function syncViewportGrid(
  grid: ViewportGrid,
  viewId: ViewId,
  camera: Camera,
  target: Vector3,
): void {
  _target.copy(target);
  grid.update(viewId, niceGridSize(visibleWorldSpan(camera, _target)), _target);
}

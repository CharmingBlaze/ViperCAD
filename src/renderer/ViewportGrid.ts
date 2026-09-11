import {
  Color,
  DoubleSide,
  Group,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Camera,
} from 'three';
import type { ViewportTheme } from '@/app/theme/themeTokens';
import { applyThemeHex } from '@/renderer/themeColor';
import type { ViewId, ViewPreset } from '@/workspace/types';

/** Number of cells used when a caller only supplies a patch size. */
export const GRID_BASE_SIZE = 20;
export const GRID_BASE_DIVISIONS = 20;
/** Aim for this many cells across the visible span (Blender/Maya density). */
export const GRID_TARGET_CELLS = 18;
export const GRID_ORTHO_CELLS = 36;
export const GRID_PERSP_CELLS = 160;
export const GRID_MAX_SIZE = 1_048_576;

const GRID_MINOR = new Color(0x2a2e33);
const GRID_MAJOR = new Color(0x4a5058);
const AXIS_X = new Color(0xc06a5a);
const AXIS_Y = new Color(0x4cae75);
const AXIS_Z = new Color(0x3d7eb8);
const FLOOR = new Color(0x1b1d20);
const PLANE_EPS = -0.0004;
const MAJOR_EVERY = 10;

const _target = new Vector3();

function planeModeFor(viewId: ViewId | ViewPreset): number {
  if (viewId === 'front' || viewId === 'back') return 1;
  if (viewId === 'left' || viewId === 'right') return 2;
  return 0;
}

export class ViewportGrid extends Group {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  private signature = '';

  constructor() {
    super();
    const material = new ShaderMaterial({
      name: 'ViewportGrid',
      transparent: true,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      uniforms: {
        cellSize: { value: 1 },
        majorEvery: { value: MAJOR_EVERY },
        planeMode: { value: 0 },
        minorColor: { value: GRID_MINOR.clone() },
        majorColor: { value: GRID_MAJOR.clone() },
        axisX: { value: AXIS_X.clone() },
        axisY: { value: AXIS_Y.clone() },
        axisZ: { value: AXIS_Z.clone() },
        floorColor: { value: FLOOR.clone() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec2 vLocal;
        void main() {
          vLocal = position.xy;
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorldPos = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float cellSize;
        uniform float majorEvery;
        uniform int planeMode;
        uniform vec3 minorColor;
        uniform vec3 majorColor;
        uniform vec3 axisX;
        uniform vec3 axisY;
        uniform vec3 axisZ;
        uniform vec3 floorColor;
        varying vec3 vWorldPos;
        varying vec2 vLocal;

        vec2 planeUv(vec3 p) {
          if (planeMode == 1) return p.xy;
          if (planeMode == 2) return p.yz;
          return p.xz;
        }

        vec3 planeNormal() {
          if (planeMode == 1) return vec3(0.0, 0.0, 1.0);
          if (planeMode == 2) return vec3(1.0, 0.0, 0.0);
          return vec3(0.0, 1.0, 0.0);
        }

        float gridLine(vec2 uv, float cell, float widthPx) {
          vec2 coord = uv / max(cell, 1e-6);
          vec2 deriv = fwidth(coord);
          vec2 grid = abs(fract(coord - 0.5) - 0.5) / max(deriv, vec2(1e-8));
          float line = min(grid.x, grid.y);
          return 1.0 - smoothstep(0.0, widthPx, line);
        }

        float axisLine(float coord, float deriv, float widthPx) {
          return 1.0 - smoothstep(0.0, widthPx, abs(coord) / max(deriv, 1e-8));
        }

        void main() {
          vec2 uv = planeUv(vWorldPos);
          vec3 viewDir = normalize(vWorldPos - cameraPosition);
          float ndv = abs(dot(planeNormal(), viewDir));
          float graze = smoothstep(0.018, 0.14, ndv);
          float edge = 1.0 - smoothstep(0.36, 0.5, max(abs(vLocal.x), abs(vLocal.y)));
          float dist = length(vWorldPos - cameraPosition);
          float distFade = 1.0 - smoothstep(cellSize * 18.0, cellSize * 72.0, dist);
          float originBoost = 1.0 - smoothstep(cellSize * 2.0, cellSize * 14.0, length(uv));

          vec2 derivUv = fwidth(uv);
          float minorPixel = length(fwidth(uv / max(cellSize, 1e-6)));
          float minorFade = 1.0 - smoothstep(0.07, 0.38, minorPixel);
          float majorCell = cellSize * max(majorEvery, 1.0);
          float major = gridLine(uv, majorCell, 1.75);
          float minor = gridLine(uv, cellSize, 0.85) * minorFade;

          vec3 axisU = planeMode == 2 ? axisY : axisX;
          vec3 axisV = planeMode == 0 || planeMode == 2 ? axisZ : axisY;
          float axU = axisLine(uv.x, derivUv.x, 1.7);
          float axV = axisLine(uv.y, derivUv.y, 1.7);

          float coverage = max(max(minor, major), max(axU, axV));
          vec3 col = mix(minorColor, majorColor, major);
          col = mix(col, axisV, axU);
          col = mix(col, axisU, axV);

          float floorA = 0.01 * graze * edge * distFade;
          float lineA = coverage * graze * edge * mix(0.07, 0.52, distFade) * mix(1.0, 1.35, originBoost);
          vec3 outCol = mix(floorColor, col, clamp(coverage, 0.0, 1.0));
          float alpha = max(floorA, lineA);
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(outCol, alpha);
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new Mesh(new PlaneGeometry(1, 1, 1, 1), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.matrixAutoUpdate = true;
    this.mesh.raycast = () => undefined;
    this.add(this.mesh);
    this.visible = false;
  }

  applyPalette(palette: ViewportTheme): void {
    const uniforms = this.mesh.material.uniforms;
    applyThemeHex(uniforms.minorColor.value, palette.gridMinor);
    applyThemeHex(uniforms.majorColor.value, palette.gridMajor);
    applyThemeHex(uniforms.axisX.value, palette.gizmoX);
    applyThemeHex(uniforms.axisY.value, palette.gizmoY);
    applyThemeHex(uniforms.axisZ.value, palette.gizmoZ);
    applyThemeHex(uniforms.floorColor.value, palette.gridFloor);
    this.mesh.material.uniformsNeedUpdate = true;
  }

  update(viewId: ViewId | ViewPreset, size: number, target: Vector3, spacing = size / GRID_BASE_DIVISIONS): void {
    const cell = Math.max(spacing, 1e-6);
    const mode = planeModeFor(viewId);
    const [targetU, targetV] =
      mode === 0 ? [target.x, target.z] : mode === 1 ? [target.x, target.y] : [target.y, target.z];
    const anchorU = snappedGridAnchor(targetU, cell);
    const anchorV = snappedGridAnchor(targetV, cell);
    const signature = `${viewId}:${size}:${cell}:${anchorU}:${anchorV}`;
    if (signature === this.signature) return;
    this.signature = signature;

    const uniforms = this.mesh.material.uniforms;
    uniforms.cellSize.value = cell;
    uniforms.planeMode.value = mode;
    this.mesh.scale.set(size, size, 1);
    if (mode === 0) {
      this.mesh.rotation.set(-Math.PI / 2, 0, 0);
      this.mesh.position.set(anchorU, PLANE_EPS, anchorV);
    } else if (mode === 1) {
      this.mesh.rotation.set(0, 0, 0);
      this.mesh.position.set(anchorU, anchorV, PLANE_EPS);
    } else {
      this.mesh.rotation.set(0, Math.PI / 2, 0);
      this.mesh.position.set(PLANE_EPS, anchorU, anchorV);
    }
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

/** 1-2-5 spacing so zooming changes density in stable CAD steps. */
export function niceGridSpacing(span: number): number {
  const raw = Math.max(span, 0.5) / GRID_TARGET_CELLS;
  const exp = Math.floor(Math.log10(raw));
  const pow = Math.pow(10, exp);
  const fraction = raw / pow;
  const nice = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  return nice * pow;
}

export function niceGridSize(span: number, perspective = false): number {
  const spacing = niceGridSpacing(span);
  const cells = perspective ? GRID_PERSP_CELLS : GRID_ORTHO_CELLS;
  return Math.min(Math.max(spacing * cells, GRID_BASE_SIZE), GRID_MAX_SIZE);
}

export function snappedGridAnchor(value: number, spacing: number): number {
  return Math.round(value / Math.max(spacing, 1e-6)) * spacing;
}

export function syncViewportGrid(
  grid: ViewportGrid,
  viewId: ViewId | ViewPreset,
  camera: Camera,
  target: Vector3,
): void {
  _target.copy(target);
  const span = visibleWorldSpan(camera, _target);
  const perspective = camera instanceof PerspectiveCamera;
  const spacing = niceGridSpacing(span);
  grid.update(viewId, niceGridSize(span, perspective), _target, spacing);
}

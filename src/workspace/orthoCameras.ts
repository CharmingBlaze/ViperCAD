import type { CameraSnapshot, ViewId } from './types';

/** Canonical orthographic view axes (camera looks toward −axis through target). */
const ORTHO_AXIS: Record<
  Exclude<ViewId, 'persp'>,
  { axis: 0 | 1 | 2; up: [number, number, number]; defaultDistance: number }
> = {
  top: { axis: 1, up: [0, 0, -1], defaultDistance: 12 },
  front: { axis: 2, up: [0, 1, 0], defaultDistance: 12 },
  right: { axis: 0, up: [0, 1, 0], defaultDistance: 12 },
};

/** Keep the camera far enough that the near plane cannot slice through the scene. */
export const ORTHO_MIN_DISTANCE = 8;

const ALIGN_DOT = 0.999; // ~2.5°

function length3(x: number, y: number, z: number): number {
  return Math.hypot(x, y, z);
}

function minOrthoDistance(orthoHeight: number | undefined): number {
  const height = Number.isFinite(orthoHeight) && (orthoHeight as number) > 0 ? (orthoHeight as number) : 10;
  return Math.max(ORTHO_MIN_DISTANCE, height * 0.5);
}

function resolveOrthoDistance(
  cam: CameraSnapshot,
  def: (typeof ORTHO_AXIS)[Exclude<ViewId, 'persp'>],
): number {
  const dist = length3(
    cam.position[0] - cam.target[0],
    cam.position[1] - cam.target[1],
    cam.position[2] - cam.target[2],
  );
  const floor = minOrthoDistance(cam.orthoHeight);
  if (!Number.isFinite(dist) || dist < floor) {
    return Math.max(def.defaultDistance, floor);
  }
  return dist;
}

/** True when the camera already looks along the canonical ortho axis with the right up. */
export function isOrthoCameraAligned(viewId: ViewId, cam: CameraSnapshot): boolean {
  if (viewId === 'persp') return true;
  const def = ORTHO_AXIS[viewId];
  const [tx, ty, tz] = cam.target;
  const [px, py, pz] = cam.position;
  const dx = px - tx;
  const dy = py - ty;
  const dz = pz - tz;
  const len = length3(dx, dy, dz);
  if (len < minOrthoDistance(cam.orthoHeight) - 1e-6) return false;

  const forward = [dx / len, dy / len, dz / len];
  const expected = [0, 0, 0];
  expected[def.axis] = 1;
  const axisDot = forward[0]! * expected[0]! + forward[1]! * expected[1]! + forward[2]! * expected[2]!;
  if (axisDot < ALIGN_DOT) return false;

  for (let i = 0; i < 3; i++) {
    if (i === def.axis) continue;
    const delta = (cam.position[i]! - cam.target[i]!) / len;
    if (Math.abs(delta) > 1e-3) return false;
  }

  const [ux, uy, uz] = cam.up;
  const ul = length3(ux, uy, uz) || 1;
  const upDot =
    (ux / ul) * def.up[0] + (uy / ul) * def.up[1] + (uz / ul) * def.up[2];
  return upDot > ALIGN_DOT;
}

/**
 * Force an orthographic camera onto its canonical view axis at a safe distance.
 * Preserves target (pan); repairs orbit drift, bad saves, and near-plane slicing.
 */
export function sanitizeOrthoCamera(viewId: ViewId, cam: CameraSnapshot): CameraSnapshot {
  if (viewId === 'persp') return cam;

  const def = ORTHO_AXIS[viewId];
  const target: [number, number, number] = [
    Number.isFinite(cam.target[0]) ? cam.target[0] : 0,
    Number.isFinite(cam.target[1]) ? cam.target[1] : 0,
    Number.isFinite(cam.target[2]) ? cam.target[2] : 0,
  ];

  const dist = resolveOrthoDistance(
    { ...cam, target },
    def,
  );

  const position: [number, number, number] = [...target];
  position[def.axis] += dist;

  return {
    ...cam,
    position,
    target,
    up: [...def.up] as [number, number, number],
  };
}

export function sanitizeViewportCameras(
  viewports: Record<ViewId, { camera: CameraSnapshot }>,
): void {
  for (const id of ['top', 'front', 'right'] as const) {
    viewports[id].camera = sanitizeOrthoCamera(id, viewports[id].camera);
  }
}

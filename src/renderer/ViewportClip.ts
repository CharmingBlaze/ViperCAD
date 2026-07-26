import { OrthographicCamera, PerspectiveCamera, Vector3, type Camera } from 'three';
import { ORTHO_MIN_DISTANCE } from '@/workspace/orthoCameras';

/** Perspective defaults — wide far plane for CAD framing. */
export const PERSP_NEAR = 0.05;
export const PERSP_FAR = 50_000;

/** Ortho uses a symmetric depth range so geometry around the focus plane always draws. */
export const ORTHO_DEPTH_MIN = 200;

/** Ortho framing limits (world units of vertical span). */
export const ORTHO_HEIGHT_MIN = 0.05;
/** Keeps the 128-unit construction area readable while still allowing a 50× overview. */
export const ORTHO_HEIGHT_MAX = 512;

const _target = new Vector3();

/**
 * Update near/far from current framing. Call after frustum left/right/top/bottom (ortho)
 * or aspect (persp) changes, then rely on this to finish updateProjectionMatrix.
 */
export function syncCameraClipPlanes(camera: Camera, target: Vector3): void {
  _target.copy(target);

  if (camera instanceof PerspectiveCamera) {
    const dist = Math.max(0.5, camera.position.distanceTo(_target));
    // Keep relative depth precision reasonable across zoom levels.
    camera.near = Math.min(Math.max(PERSP_NEAR, dist / 500), dist / 20);
    camera.far = Math.max(PERSP_FAR, dist * 250);
    camera.updateProjectionMatrix();
    return;
  }

  if (camera instanceof OrthographicCamera) {
    const viewH = (camera.top - camera.bottom) / Math.max(1e-6, camera.zoom);
    const viewW = (camera.right - camera.left) / Math.max(1e-6, camera.zoom);
    const span = Math.max(viewH, viewW, 1);
    const focusDist = Math.max(ORTHO_MIN_DISTANCE, camera.position.distanceTo(_target));
    // Working volume around the focus plane must stay inside the frustum.
    camera.near = Math.max(0.01, focusDist * 0.001);
    camera.far = focusDist + Math.max(span * 50, ORTHO_DEPTH_MIN * 2, 2000);
    camera.updateProjectionMatrix();
  }
}

export const ORBIT_MIN_DISTANCE = 0.35;
/** Perspective dolly-out ceiling (world units from orbit target). */
export const ORBIT_MAX_DISTANCE = 512;

/** Fold OrbitControls ortho zoom into a persistent frustum height, then reset zoom to 1. */
export function absorbOrthoZoom(orthoHeight: number, zoom: number): {
  orthoHeight: number;
  zoom: number;
} {
  if (!Number.isFinite(zoom) || Math.abs(zoom - 1) < 1e-9) {
    return {
      orthoHeight: clampOrthoHeight(orthoHeight),
      zoom: 1,
    };
  }
  return {
    orthoHeight: clampOrthoHeight(orthoHeight / zoom),
    zoom: 1,
  };
}

export function clampOrthoHeight(height: number): number {
  if (!Number.isFinite(height) || height <= 0) return 10;
  return Math.min(ORTHO_HEIGHT_MAX, Math.max(ORTHO_HEIGHT_MIN, height));
}

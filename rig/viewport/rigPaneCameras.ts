import { sanitizeOrthoCamera } from '@/workspace/orthoCameras';
import { DEFAULT_CAMERAS } from '@/workspace/WorkspacePersistence';
import type { ViewId, ViewPreset } from '@/workspace/types';
import {
  OrthographicCamera,
  PerspectiveCamera,
  Vector3,
  type Camera,
} from 'three';

const PERSP_NEAR = 0.01;
const PERSP_FAR = 500;

export type RigPaneCameraState = {
  camera: Camera;
  view: ViewPreset;
  target: Vector3;
  orthoHeight: number;
};

export function createRigPaneCameraState(viewId: ViewId): RigPaneCameraState {
  const target = new Vector3(0, 0.95, 0);
  const view = viewId === 'persp' ? 'perspective' : viewId;
  if (viewId === 'persp') {
    const camera = new PerspectiveCamera(45, 1, PERSP_NEAR, PERSP_FAR);
    camera.position.set(2.4, 1.8, 2.6);
    return { camera, view: 'perspective', target, orthoHeight: 8 };
  }
  const snap = sanitizeOrthoCamera(view as Exclude<ViewPreset, 'perspective'>, DEFAULT_CAMERAS[viewId]);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 500);
  camera.position.fromArray(snap.position);
  camera.up.fromArray(snap.up);
  camera.lookAt(target);
  return { camera, view: view as ViewPreset, target, orthoHeight: snap.orthoHeight };
}

export function syncOrthoProjection(camera: OrthographicCamera, aspect: number, orthoHeight: number): void {
  const half = orthoHeight / 2;
  camera.left = -half * aspect;
  camera.right = half * aspect;
  camera.top = half;
  camera.bottom = -half;
  camera.updateProjectionMatrix();
}

export function setRigPaneView(state: RigPaneCameraState, view: ViewPreset): void {
  if (state.view === view) return;
  const currentTarget = state.target.clone();
  const previousFov =
    state.camera instanceof PerspectiveCamera ? state.camera.fov : DEFAULT_CAMERAS.persp.fov;

  state.view = view;
  if (view === 'perspective') {
    const camera = new PerspectiveCamera(previousFov, 1, PERSP_NEAR, PERSP_FAR);
    const offset = new Vector3().fromArray(DEFAULT_CAMERAS.persp.position);
    camera.position.copy(currentTarget).add(offset);
    camera.up.fromArray(DEFAULT_CAMERAS.persp.up);
    camera.lookAt(currentTarget);
    state.camera = camera;
    return;
  }

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 500);
  const snap = sanitizeOrthoCamera(view, {
    ...DEFAULT_CAMERAS.top,
    position: state.camera.position.toArray() as [number, number, number],
    target: currentTarget.toArray() as [number, number, number],
    up: state.camera.up.toArray() as [number, number, number],
    orthoHeight: state.orthoHeight,
    zoom: 1,
  });
  camera.position.fromArray(snap.position);
  camera.up.fromArray(snap.up);
  camera.lookAt(currentTarget);
  state.camera = camera;
  state.orthoHeight = snap.orthoHeight;
}

export function paneViewLabel(view: ViewPreset, lookThroughName: string | null): { name: string; projection: string } {
  if (lookThroughName) {
    return { name: lookThroughName, projection: 'Camera View' };
  }
  const names: Record<ViewPreset, string> = {
    perspective: 'Perspective',
    top: 'Top',
    bottom: 'Bottom',
    left: 'Left',
    right: 'Right',
    front: 'Front',
    back: 'Back',
  };
  return {
    name: names[view],
    projection: view === 'perspective' ? 'Perspective' : 'Orthographic',
  };
}

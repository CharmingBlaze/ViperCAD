import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type Camera,
  type Object3D,
  Raycaster,
  Color,
  OrthographicCamera,
} from 'three';
import type { AxisConstraint, GizmoMode, OrientationBasis, TransformType } from '@/core/transform/types';

export type GizmoHandleId =
  | 'move-x'
  | 'move-y'
  | 'move-z'
  | 'move-xy'
  | 'move-xz'
  | 'move-yz'
  | 'move-view'
  | 'rotate-x'
  | 'rotate-y'
  | 'rotate-z'
  | 'rotate-view'
  | 'scale-x'
  | 'scale-y'
  | 'scale-z'
  | 'scale-xy'
  | 'scale-xz'
  | 'scale-yz'
  | 'scale-uniform';

const AXIS = {
  x: new Color(0xe74c3c),
  y: new Color(0x2ecc71),
  z: new Color(0x3498db),
  view: new Color(0xf0c040),
  centre: new Color(0xe8ebf0),
};

const HANDLE_TO_CONSTRAINT: Record<GizmoHandleId, { type: TransformType; constraint: AxisConstraint }> = {
  'move-x': { type: 'translate', constraint: 'x' },
  'move-y': { type: 'translate', constraint: 'y' },
  'move-z': { type: 'translate', constraint: 'z' },
  'move-xy': { type: 'translate', constraint: 'xy' },
  'move-xz': { type: 'translate', constraint: 'xz' },
  'move-yz': { type: 'translate', constraint: 'yz' },
  'move-view': { type: 'translate', constraint: 'none' },
  'rotate-x': { type: 'rotate', constraint: 'x' },
  'rotate-y': { type: 'rotate', constraint: 'y' },
  'rotate-z': { type: 'rotate', constraint: 'z' },
  'rotate-view': { type: 'rotate', constraint: 'none' },
  'scale-x': { type: 'scale', constraint: 'x' },
  'scale-y': { type: 'scale', constraint: 'y' },
  'scale-z': { type: 'scale', constraint: 'z' },
  'scale-xy': { type: 'scale', constraint: 'xy' },
  'scale-xz': { type: 'scale', constraint: 'xz' },
  'scale-yz': { type: 'scale', constraint: 'yz' },
  'scale-uniform': { type: 'scale', constraint: 'none' },
};

const GIZMO_LOCAL_RADIUS = 0.95;

type HandleEntry = {
  id: GizmoHandleId;
  visual: Object3D;
  hit: Object3D;
  material: MeshBasicMaterial;
  baseOpacity: number;
};

/**
 * Screen-stable transform gizmo. Overlay only — does not replace object materials.
 */
export class TransformGizmo {
  readonly root = new Group();
  private handles = new Map<GizmoHandleId, HandleEntry>();
  private hovered: GizmoHandleId | null = null;
  private active: GizmoHandleId | null = null;
  private mode: GizmoMode = 'move';
  private visible = false;

  constructor() {
    this.root.name = 'TransformGizmo';
    this.root.renderOrder = 999;
    this.build();
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.visible = v;
  }

  setMode(mode: GizmoMode): void {
    this.mode = mode;
    this.updateVisibility();
  }

  setHovered(id: GizmoHandleId | null): void {
    this.hovered = id;
    this.refreshStyles();
  }

  setActiveHandle(id: GizmoHandleId | null): void {
    this.active = id;
    this.refreshStyles();
  }

  setConstraintHighlight(constraint: AxisConstraint | null, type?: TransformType | null): void {
    if (!constraint || !type) {
      if (!this.active) this.refreshStyles();
      return;
    }
    for (const [id, meta] of Object.entries(HANDLE_TO_CONSTRAINT) as [
      GizmoHandleId,
      { type: TransformType; constraint: AxisConstraint },
    ][]) {
      if (meta.type === type && meta.constraint === constraint) {
        this.active = id;
        this.refreshStyles();
        return;
      }
    }
  }

  sync(
    pivot: { x: number; y: number; z: number },
    basis: OrientationBasis,
    camera: Camera,
    mode: GizmoMode,
    show: boolean,
    viewportHeight?: number,
  ): void {
    this.mode = mode;
    this.setVisible(show && mode !== 'select');
    if (!this.visible) return;

    this.root.position.set(pivot.x, pivot.y, pivot.z);
    const bx = new Vector3(basis.x.x, basis.x.y, basis.x.z).normalize();
    const by = new Vector3(basis.y.x, basis.y.y, basis.y.z).normalize();
    const bz = new Vector3(basis.z.x, basis.z.y, basis.z.z).normalize();
    this.root.matrix.makeBasis(bx, by, bz);
    this.root.quaternion.setFromRotationMatrix(this.root.matrix);
    this.root.matrixAutoUpdate = true;

    // Calculate vertical world frustum height spanning the viewport
    let hWorld: number;
    if (camera instanceof OrthographicCamera) {
      hWorld = (camera.top - camera.bottom) / (camera.zoom || 1);
    } else {
      camera.updateMatrixWorld(true);
      const camDir = new Vector3();
      camera.getWorldDirection(camDir);
      const toPivot = new Vector3(pivot.x, pivot.y, pivot.z).sub(camera.position);
      const dist = Math.max(0.01, Math.abs(toPivot.dot(camDir)));
      const persp = camera as { fov?: number };
      hWorld = 2 * dist * Math.tan(((persp.fov || 45) * Math.PI) / 360);
    }

    let scale: number;
    if (viewportHeight && viewportHeight > 10) {
      const targetPx = Math.min(95, Math.max(75, viewportHeight * 0.18));
      const worldUnitsPerPixel = hWorld / viewportHeight;
      scale = (targetPx / GIZMO_LOCAL_RADIUS) * worldUnitsPerPixel;
    } else {
      scale = hWorld * 0.16;
    }
    scale = Math.max(1e-4, scale);
    this.root.scale.setScalar(scale);

    // Keep rotate-view ring facing the camera
    const rotateViewEntry = this.handles.get('rotate-view');
    if (rotateViewEntry) {
      const camDir = new Vector3();
      camera.getWorldDirection(camDir);
      const invQuat = this.root.quaternion.clone().invert();
      const localCamDir = camDir.clone().applyQuaternion(invQuat).normalize();
      alignZ(rotateViewEntry.visual, localCamDir);
      alignZ(rotateViewEntry.hit, localCamDir);
    }

    this.updateVisibility(camera, bx, by, bz);
    this.refreshStyles();
  }

  pick(
    raycaster: Raycaster,
    ndc: Vector2,
    camera: Camera,
    screen?: { x: number; y: number; width: number; height: number; thresholdPx?: number },
  ): { handleId: GizmoHandleId; type: TransformType; constraint: AxisConstraint } | null {
    if (!this.visible || this.mode === 'select') return null;

    raycaster.setFromCamera(ndc, camera);
    const objects: Object3D[] = [];
    this.root.traverse((obj) => {
      if (obj.userData.role === 'hit' && obj.visible) objects.push(obj);
    });
    const intersects = raycaster.intersectObjects(objects, false);
    if (intersects.length) {
      let bestHit = intersects[0]!;
      let bestPriority = handlePickPriority(bestHit.object.userData.handleId as GizmoHandleId);
      for (let i = 1; i < intersects.length; i++) {
        const hit = intersects[i]!;
        const priority = handlePickPriority(hit.object.userData.handleId as GizmoHandleId);
        // Overlapping volumes at the origin: prioritize centre and plane handles
        if (Math.abs(hit.distance - bestHit.distance) < 0.3 * this.root.scale.x && priority > bestPriority) {
          bestHit = hit;
          bestPriority = priority;
        }
      }
      const id = bestHit.object.userData.handleId as GizmoHandleId;
      const meta = HANDLE_TO_CONSTRAINT[id];
      if (meta) return { handleId: id, type: meta.type, constraint: meta.constraint };
    }

    // Screen-space fallback: forgiving snapping to nearest handle.
    if (!screen || screen.width < 1 || screen.height < 1) return null;
    const threshold = screen.thresholdPx ?? 24;
    let bestId: GizmoHandleId | null = null;
    let bestDist = threshold;
    let bestPriority = -1;
    const tmp = new Vector3();
    for (const [id, entry] of this.handles) {
      if (!entry.hit.visible) continue;
      const meta = HANDLE_TO_CONSTRAINT[id];
      if (!meta) continue;
      const priority = handlePickPriority(id);
      for (const world of handleSamplePoints(entry, tmp)) {
        const projected = world.clone().project(camera);
        if (projected.z < -1 || projected.z > 1) continue;
        const sx = ((projected.x + 1) * 0.5) * screen.width;
        const sy = ((1 - projected.y) * 0.5) * screen.height;
        const dist = Math.hypot(sx - screen.x, sy - screen.y);
        if (dist < bestDist - 0.25 || (Math.abs(dist - bestDist) <= 0.25 && priority > bestPriority)) {
          bestDist = dist;
          bestId = id;
          bestPriority = priority;
        }
      }
    }
    if (!bestId) return null;
    const meta = HANDLE_TO_CONSTRAINT[bestId];
    return { handleId: bestId, type: meta.type, constraint: meta.constraint };
  }

  dispose(): void {
    this.root.traverse((obj) => {
      const mesh = obj as Mesh;
      mesh.geometry?.dispose?.();
      const mat = mesh.material as MeshBasicMaterial | undefined;
      if (mat && !Array.isArray(mat)) mat.dispose();
    });
  }

  private build(): void {
    this.addAxisArrow('move-x', AXIS.x, new Vector3(1, 0, 0));
    this.addAxisArrow('move-y', AXIS.y, new Vector3(0, 1, 0));
    this.addAxisArrow('move-z', AXIS.z, new Vector3(0, 0, 1));
    this.addPlane('move-xy', AXIS.z, new Vector3(0.38, 0.38, 0), 'xy');
    this.addPlane('move-xz', AXIS.y, new Vector3(0.38, 0, 0.38), 'xz');
    this.addPlane('move-yz', AXIS.x, new Vector3(0, 0.38, 0.38), 'yz');
    this.addCentre('move-view', AXIS.centre);

    this.addRing('rotate-x', AXIS.x, new Vector3(1, 0, 0));
    this.addRing('rotate-y', AXIS.y, new Vector3(0, 1, 0));
    this.addRing('rotate-z', AXIS.z, new Vector3(0, 0, 1));
    this.addRing('rotate-view', AXIS.view, new Vector3(0, 0, 1));

    this.addScaleHandle('scale-x', AXIS.x, new Vector3(1, 0, 0));
    this.addScaleHandle('scale-y', AXIS.y, new Vector3(0, 1, 0));
    this.addScaleHandle('scale-z', AXIS.z, new Vector3(0, 0, 1));
    this.addPlane('scale-xy', AXIS.z, new Vector3(0.32, 0.32, 0), 'xy', true);
    this.addPlane('scale-xz', AXIS.y, new Vector3(0.32, 0, 0.32), 'xz', true);
    this.addPlane('scale-yz', AXIS.x, new Vector3(0, 0.32, 0.32), 'yz', true);
    this.addCentre('scale-uniform', AXIS.centre, true);

    this.updateVisibility();
    this.root.traverse((obj) => {
      obj.renderOrder = 999;
    });
  }

  private addAxisArrow(id: GizmoHandleId, color: Color, dir: Vector3): void {
    const mat = new MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
    const shaft = new Mesh(new CylinderGeometry(0.012, 0.012, 0.74, 10), mat);
    shaft.position.copy(dir.clone().multiplyScalar(0.41));
    alignY(shaft, dir);
    const head = new Mesh(new ConeGeometry(0.036, 0.14, 12), mat);
    head.position.copy(dir.clone().multiplyScalar(0.87));
    alignY(head, dir);
    const visual = new Group();
    visual.add(shaft, head);
    visual.userData.handleId = id;

    const hit = new Mesh(new CylinderGeometry(0.22, 0.22, 0.95, 8), new MeshBasicMaterial({ visible: false }));
    hit.position.copy(dir.clone().multiplyScalar(0.58));
    alignY(hit, dir);
    hit.userData.role = 'hit';
    hit.userData.handleId = id;

    this.root.add(visual, hit);
    this.handles.set(id, { id, visual, hit, material: mat, baseOpacity: 0.95 });
  }

  private addScaleHandle(id: GizmoHandleId, color: Color, dir: Vector3): void {
    const mat = new MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
    const shaft = new Mesh(new CylinderGeometry(0.011, 0.011, 0.70, 10), mat);
    shaft.position.copy(dir.clone().multiplyScalar(0.39));
    alignY(shaft, dir);
    const box = new Mesh(new BoxGeometry(0.08, 0.08, 0.08), mat);
    box.position.copy(dir.clone().multiplyScalar(0.82));
    const visual = new Group();
    visual.add(shaft, box);
    visual.userData.handleId = id;

    const hit = new Mesh(new CylinderGeometry(0.22, 0.22, 0.90, 8), new MeshBasicMaterial({ visible: false }));
    hit.position.copy(dir.clone().multiplyScalar(0.56));
    alignY(hit, dir);
    hit.userData.role = 'hit';
    hit.userData.handleId = id;

    this.root.add(visual, hit);
    this.handles.set(id, { id, visual, hit, material: mat, baseOpacity: 0.95 });
  }

  private addPlane(
    id: GizmoHandleId,
    color: Color,
    pos: Vector3,
    plane: 'xy' | 'xz' | 'yz',
    scaleMode = false,
  ): void {
    const mat = new MeshBasicMaterial({
      color,
      depthTest: false,
      transparent: true,
      opacity: 0.40,
      side: DoubleSide,
    });
    const size = scaleMode ? 0.16 : 0.18;
    const geo = new BoxGeometry(
      plane === 'yz' ? 0.008 : size,
      plane === 'xz' ? 0.008 : size,
      plane === 'xy' ? 0.008 : size,
    );
    const visual = new Mesh(geo, mat);
    visual.position.copy(pos);
    visual.userData.handleId = id;

    const hitSize = scaleMode ? 0.28 : 0.32;
    const hitGeo = new BoxGeometry(
      plane === 'yz' ? 0.12 : hitSize,
      plane === 'xz' ? 0.12 : hitSize,
      plane === 'xy' ? 0.12 : hitSize,
    );
    const hit = new Mesh(hitGeo, new MeshBasicMaterial({ visible: false, side: DoubleSide }));
    hit.position.copy(pos);
    hit.userData.role = 'hit';
    hit.userData.handleId = id;

    this.root.add(visual, hit);
    this.handles.set(id, { id, visual, hit, material: mat, baseOpacity: 0.40 });
  }

  private addRing(id: GizmoHandleId, color: Color, axis: Vector3): void {
    const opacity = id === 'rotate-view' ? 0.45 : 0.88;
    const mat = new MeshBasicMaterial({
      color,
      depthTest: false,
      transparent: true,
      opacity,
      side: DoubleSide,
    });
    const torus = new Mesh(new TorusGeometry(0.58, 0.011, 8, 64), mat);
    alignZ(torus, axis);
    torus.userData.handleId = id;

    const hit = new Mesh(
      new TorusGeometry(0.58, 0.12, 8, 36),
      new MeshBasicMaterial({ visible: false, side: DoubleSide }),
    );
    alignZ(hit, axis);
    hit.userData.role = 'hit';
    hit.userData.handleId = id;

    this.root.add(torus, hit);
    this.handles.set(id, { id, visual: torus, hit, material: mat, baseOpacity: opacity });
  }

  private addCentre(id: GizmoHandleId, color: Color, cube = false): void {
    const mat = new MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.92 });
    const visual = new Mesh(
      cube ? new BoxGeometry(0.09, 0.09, 0.09) : new SphereGeometry(0.055, 16, 16),
      mat,
    );
    visual.userData.handleId = id;
    const hit = new Mesh(
      cube ? new BoxGeometry(0.36, 0.36, 0.36) : new SphereGeometry(0.26, 12, 12),
      new MeshBasicMaterial({ visible: false }),
    );
    hit.userData.role = 'hit';
    hit.userData.handleId = id;
    this.root.add(visual, hit);
    this.handles.set(id, { id, visual, hit, material: mat, baseOpacity: 0.92 });
  }

  private updateVisibility(camera?: Camera, bx?: Vector3, by?: Vector3, bz?: Vector3): void {
    let camForward: Vector3 | null = null;
    const isOrtho = camera instanceof OrthographicCamera;
    if (camera) {
      camForward = new Vector3();
      camera.getWorldDirection(camForward);
    }

    for (const [id, entry] of this.handles) {
      const meta = HANDLE_TO_CONSTRAINT[id];
      let show = false;
      if (this.mode === 'move' || this.mode === 'origin') show = meta.type === 'translate';
      else if (this.mode === 'rotate') show = meta.type === 'rotate';
      else if (this.mode === 'scale') show = meta.type === 'scale';
      else if (this.mode === 'combined') {
        show =
          id === 'move-x' ||
          id === 'move-y' ||
          id === 'move-z' ||
          id === 'move-view' ||
          id === 'rotate-x' ||
          id === 'rotate-y' ||
          id === 'rotate-z' ||
          id === 'scale-uniform';
      }

      // In orthographic views, hide axes viewed end-on (pointing into camera)
      // and edge-on planes/rings to eliminate degenerate selection clutter.
      if (show && isOrtho && camForward && bx && by && bz) {
        if (id === 'move-x' || id === 'scale-x') {
          if (Math.abs(bx.dot(camForward)) > 0.96) show = false;
        } else if (id === 'move-y' || id === 'scale-y') {
          if (Math.abs(by.dot(camForward)) > 0.96) show = false;
        } else if (id === 'move-z' || id === 'scale-z') {
          if (Math.abs(bz.dot(camForward)) > 0.96) show = false;
        } else if (id === 'move-xy' || id === 'scale-xy') {
          if (Math.abs(bz.dot(camForward)) < 0.08) show = false;
        } else if (id === 'move-xz' || id === 'scale-xz') {
          if (Math.abs(by.dot(camForward)) < 0.08) show = false;
        } else if (id === 'move-yz' || id === 'scale-yz') {
          if (Math.abs(bx.dot(camForward)) < 0.08) show = false;
        } else if (id === 'rotate-x') {
          if (Math.abs(bx.dot(camForward)) < 0.08) show = false;
        } else if (id === 'rotate-y') {
          if (Math.abs(by.dot(camForward)) < 0.08) show = false;
        } else if (id === 'rotate-z') {
          if (Math.abs(bz.dot(camForward)) < 0.08) show = false;
        }
      }

      entry.visual.visible = show;
      entry.hit.visible = show;
    }
  }

  private refreshStyles(): void {
    for (const [id, entry] of this.handles) {
      const isHot = this.active === id || this.hovered === id;
      const isDim = this.active != null && this.active !== id;
      entry.material.opacity = isHot ? 1 : isDim ? 0.2 : entry.baseOpacity;
      entry.visual.scale.setScalar(isHot ? 1.08 : 1);
    }
  }
}

function alignY(obj: Object3D, dir: Vector3): void {
  obj.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize());
}

function alignZ(obj: Object3D, dir: Vector3): void {
  obj.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), dir.clone().normalize());
}

/** Prefer centre view and planes when clicking inside quadrants, and arrows along shafts. */
function handlePickPriority(id: GizmoHandleId): number {
  if (id === 'move-view' || id === 'scale-uniform') return 4;
  if (id.includes('-xy') || id.includes('-xz') || id.includes('-yz')) return 3;
  if (id.endsWith('-x') || id.endsWith('-y') || id.endsWith('-z')) return 2;
  if (id === 'rotate-view') return 1;
  return 0;
}

function handleSamplePoints(entry: HandleEntry, tmp: Vector3): Vector3[] {
  entry.hit.updateWorldMatrix(true, false);
  const points: Vector3[] = [];
  // Centre of the hit volume
  points.push(entry.hit.getWorldPosition(tmp.clone()));

  // For rotation rings: sample around the torus circle
  if (entry.id.startsWith('rotate-')) {
    const ringRadius = 0.58;
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      tmp.set(Math.cos(angle) * ringRadius, Math.sin(angle) * ringRadius, 0);
      points.push(entry.hit.localToWorld(tmp.clone()));
    }
    return points;
  }

  // Sample along local Y for axis arrows and scale shafts
  for (const t of [0.15, 0.35, 0.55, 0.75, 0.92]) {
    tmp.set(0, (t - 0.5) * 1.1, 0);
    points.push(entry.hit.localToWorld(tmp.clone()));
  }

  // Plane quads: sample corners and centre
  if (entry.id.includes('-xy') || entry.id.includes('-xz') || entry.id.includes('-yz')) {
    for (const sx of [-0.12, 0, 0.12]) {
      for (const sy of [-0.12, 0, 0.12]) {
        tmp.set(sx, sy, 0);
        points.push(entry.hit.localToWorld(tmp.clone()));
      }
    }
  }

  return points;
}

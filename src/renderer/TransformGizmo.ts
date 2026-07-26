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
    this.root.renderOrder = 20;
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

    let scale: number;
    if (camera instanceof OrthographicCamera) {
      scale = Math.max(0.2, (camera.top - camera.bottom) / camera.zoom * 0.12);
    } else {
      const dist = camera.position.distanceTo(this.root.position);
      scale = Math.max(0.15, Math.min(8, dist * 0.12));
    }
    this.root.scale.setScalar(scale);
    this.updateVisibility();
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
      const id = intersects[0]!.object.userData.handleId as GizmoHandleId;
      const meta = HANDLE_TO_CONSTRAINT[id];
      if (meta) return { handleId: id, type: meta.type, constraint: meta.constraint };
    }

    // Screen-space fallback: thin 3D hit volumes are easy to miss; snap to nearest handle.
    if (!screen || screen.width < 1 || screen.height < 1) return null;
    const threshold = screen.thresholdPx ?? 14;
    let bestId: GizmoHandleId | null = null;
    let bestDist = threshold;
    let bestPriority = -1;
    const tmp = new Vector3();
    for (const [id, entry] of this.handles) {
      if (!entry.hit.visible) continue;
      const meta = HANDLE_TO_CONSTRAINT[id];
      if (!meta) continue;
      const priority = handlePickPriority(id);
      for (const world of handleSamplePoints(entry, this.root, tmp)) {
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
    this.addPlane('move-xy', AXIS.z, new Vector3(0.35, 0.35, 0), 'xy');
    this.addPlane('move-xz', AXIS.y, new Vector3(0.35, 0, 0.35), 'xz');
    this.addPlane('move-yz', AXIS.x, new Vector3(0, 0.35, 0.35), 'yz');
    this.addCentre('move-view', AXIS.centre);

    this.addRing('rotate-x', AXIS.x, new Vector3(1, 0, 0));
    this.addRing('rotate-y', AXIS.y, new Vector3(0, 1, 0));
    this.addRing('rotate-z', AXIS.z, new Vector3(0, 0, 1));
    this.addRing('rotate-view', AXIS.view, new Vector3(0, 0, 1));

    this.addScaleHandle('scale-x', AXIS.x, new Vector3(1, 0, 0));
    this.addScaleHandle('scale-y', AXIS.y, new Vector3(0, 1, 0));
    this.addScaleHandle('scale-z', AXIS.z, new Vector3(0, 0, 1));
    this.addPlane('scale-xy', AXIS.z, new Vector3(0.28, 0.28, 0), 'xy', true);
    this.addPlane('scale-xz', AXIS.y, new Vector3(0.28, 0, 0.28), 'xz', true);
    this.addPlane('scale-yz', AXIS.x, new Vector3(0, 0.28, 0.28), 'yz', true);
    this.addCentre('scale-uniform', AXIS.centre, true);

    this.updateVisibility();
  }

  private addAxisArrow(id: GizmoHandleId, color: Color, dir: Vector3): void {
    const mat = new MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
    const shaft = new Mesh(new CylinderGeometry(0.02, 0.02, 0.7, 8), mat);
    shaft.position.copy(dir.clone().multiplyScalar(0.4));
    alignY(shaft, dir);
    const head = new Mesh(new ConeGeometry(0.055, 0.14, 10), mat);
    head.position.copy(dir.clone().multiplyScalar(0.82));
    alignY(head, dir);
    const visual = new Group();
    visual.add(shaft, head);
    visual.userData.handleId = id;

    const hit = new Mesh(new CylinderGeometry(0.14, 0.14, 1.05, 8), new MeshBasicMaterial({ visible: false }));
    hit.position.copy(dir.clone().multiplyScalar(0.5));
    alignY(hit, dir);
    hit.userData.role = 'hit';
    hit.userData.handleId = id;

    this.root.add(visual, hit);
    this.handles.set(id, { id, visual, hit, material: mat, baseOpacity: 0.95 });
  }

  private addScaleHandle(id: GizmoHandleId, color: Color, dir: Vector3): void {
    const mat = new MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
    const shaft = new Mesh(new CylinderGeometry(0.018, 0.018, 0.65, 8), mat);
    shaft.position.copy(dir.clone().multiplyScalar(0.38));
    alignY(shaft, dir);
    const box = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), mat);
    box.position.copy(dir.clone().multiplyScalar(0.78));
    const visual = new Group();
    visual.add(shaft, box);
    visual.userData.handleId = id;

    const hit = new Mesh(new CylinderGeometry(0.14, 0.14, 1, 8), new MeshBasicMaterial({ visible: false }));
    hit.position.copy(dir.clone().multiplyScalar(0.48));
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
      opacity: 0.35,
      side: DoubleSide,
    });
    const size = scaleMode ? 0.18 : 0.22;
    const geo = new BoxGeometry(
      plane === 'yz' ? 0.02 : size,
      plane === 'xz' ? 0.02 : size,
      plane === 'xy' ? 0.02 : size,
    );
    const visual = new Mesh(geo, mat);
    visual.position.copy(pos);
    visual.userData.handleId = id;

    const hit = new Mesh(geo.clone(), new MeshBasicMaterial({ visible: false, side: DoubleSide }));
    hit.position.copy(pos);
    hit.scale.setScalar(1.4);
    hit.userData.role = 'hit';
    hit.userData.handleId = id;

    this.root.add(visual, hit);
    this.handles.set(id, { id, visual, hit, material: mat, baseOpacity: 0.35 });
  }

  private addRing(id: GizmoHandleId, color: Color, axis: Vector3): void {
    const mat = new MeshBasicMaterial({
      color,
      depthTest: false,
      transparent: true,
      opacity: 0.85,
      side: DoubleSide,
    });
    const torus = new Mesh(new TorusGeometry(0.75, 0.018, 8, 48), mat);
    alignZ(torus, axis);
    torus.userData.handleId = id;

    const hit = new Mesh(
      new TorusGeometry(0.75, 0.07, 8, 48),
      new MeshBasicMaterial({ visible: false, side: DoubleSide }),
    );
    alignZ(hit, axis);
    hit.userData.role = 'hit';
    hit.userData.handleId = id;

    this.root.add(torus, hit);
    this.handles.set(id, { id, visual: torus, hit, material: mat, baseOpacity: 0.85 });
  }

  private addCentre(id: GizmoHandleId, color: Color, cube = false): void {
    const mat = new MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });
    // Larger free-move centre so view-plane drag is easy to grab.
    const visual = new Mesh(
      cube ? new BoxGeometry(0.16, 0.16, 0.16) : new SphereGeometry(0.1, 14, 14),
      mat,
    );
    visual.userData.handleId = id;
    const hit = new Mesh(
      cube ? new BoxGeometry(0.32, 0.32, 0.32) : new SphereGeometry(0.22, 12, 12),
      new MeshBasicMaterial({ visible: false }),
    );
    hit.userData.role = 'hit';
    hit.userData.handleId = id;
    this.root.add(visual, hit);
    this.handles.set(id, { id, visual, hit, material: mat, baseOpacity: 0.9 });
  }

  private updateVisibility(): void {
    for (const [id, entry] of this.handles) {
      const meta = HANDLE_TO_CONSTRAINT[id];
      let show = false;
      if (this.mode === 'move') show = meta.type === 'translate';
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
      entry.visual.visible = show;
      entry.hit.visible = show;
    }
  }

  private refreshStyles(): void {
    for (const [id, entry] of this.handles) {
      const isHot = this.active === id || this.hovered === id;
      const isDim = this.active != null && this.active !== id;
      entry.material.opacity = isHot ? 1 : isDim ? 0.2 : entry.baseOpacity;
      entry.visual.scale.setScalar(isHot ? 1.12 : 1);
    }
  }
}

function alignY(obj: Object3D, dir: Vector3): void {
  obj.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize());
}

function alignZ(obj: Object3D, dir: Vector3): void {
  obj.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), dir.clone().normalize());
}

/** Prefer axis arrows over planes/centre when distances are similar. */
function handlePickPriority(id: GizmoHandleId): number {
  if (id.endsWith('-x') || id.endsWith('-y') || id.endsWith('-z')) return 3;
  if (id.includes('-xy') || id.includes('-xz') || id.includes('-yz')) return 2;
  if (id === 'move-view' || id === 'scale-uniform' || id === 'rotate-view') return 1;
  return 0;
}

function handleSamplePoints(entry: HandleEntry, root: Group, tmp: Vector3): Vector3[] {
  entry.hit.updateWorldMatrix(true, false);
  const points: Vector3[] = [];
  // Centre of the hit volume.
  points.push(entry.hit.getWorldPosition(tmp.clone()));
  // Sample along local Y (axis arrows / scale shafts are aligned to Y).
  for (const t of [0.15, 0.4, 0.65, 0.9]) {
    tmp.set(0, (t - 0.5) * 1.0, 0);
    points.push(entry.hit.localToWorld(tmp.clone()));
  }
  // Root-local samples for rings / planes around the gizmo origin.
  for (const t of [0.25, 0.55, 0.85]) {
    tmp.copy(entry.hit.position).multiplyScalar(t);
    root.localToWorld(tmp);
    points.push(tmp.clone());
  }
  return points;
}

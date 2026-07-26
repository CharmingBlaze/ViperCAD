import type { CommandHistory } from '@/core/history/CommandHistory';
import type { ModelDocument } from '@/core/document/types';
import { topmostObjectIds } from '@/core/editor/Hierarchy';
import {
  addVec3,
  crossVec3,
  dotVec3,
  lengthVec3,
  normalizeVec3,
  scaleVec3,
  subVec3,
  v3,
  type Vec3,
} from '@/core/math/Vec3';
import type { SelectionManager } from '@/core/selection/SelectionManager';
import type { ViewId } from '@/workspace/types';
import {
  SNAP_TARGET_LABELS,
  resolveSnap,
  snapAngleRadians,
  stabilizeSnap,
  type SnapQuery,
  type SnapResult,
} from '@/core/snap/SnapEngine';
import {
  applyDeltaFromSnapshot,
  constrainScale,
  constrainTranslation,
} from './ApplyTransform';
import { applyAxisKey, constraintLabel } from './Constraints';
import { parseTransformNumber } from './NumericParser';
import {
  buildOrientationBasis,
  freeMovePlaneNormal,
  axisVector,
  type CameraAxes,
} from './Orientation';
import { computePivot } from './Pivot';
import { captureAfterSnapshot, captureSnapshot, restoreSnapshot } from './Snapshot';
import { gatherTargetVertexIds, selectionHasTransformTarget } from './Targets';
import {
  emptyDelta,
  identityBasis,
  type AxisConstraint,
  type GizmoMode,
  type OrientationBasis,
  type TransformOrientation,
  type TransformPivotMode,
  type TransformPrefs,
  type TransformSession,
  type TransformSource,
  type TransformType,
} from './types';

const PRECISION_FACTOR = 0.1;

export type PointerSample = {
  screenX: number;
  screenY: number;
  rayOrigin: Vec3;
  rayDirection: Vec3;
  viewportId: ViewId;
  shiftKey: boolean;
  ctrlKey: boolean;
  camera: CameraAxes;
};

export class TransformSystem {
  prefs: TransformPrefs = {
    gizmoMode: 'move',
    orientation: 'local',
    pivotMode: 'object-origin',
  };

  session: TransformSession | null = null;
  lastCompleted: { type: TransformType; label: string } | null = null;

  private doc: ModelDocument;
  private selection: SelectionManager;
  private history: CommandHistory;
  private requestRedraw: () => void;
  private resolveSnapQuery: (query: SnapQuery) => SnapResult;

  constructor(
    doc: ModelDocument,
    selection: SelectionManager,
    history: CommandHistory,
    requestRedraw: () => void,
    resolveSnapQuery: (query: SnapQuery) => SnapResult = (query) => resolveSnap(query),
  ) {
    this.doc = doc;
    this.selection = selection;
    this.history = history;
    this.requestRedraw = requestRedraw;
    this.resolveSnapQuery = resolveSnapQuery;
  }

  get active(): boolean {
    return this.session?.status === 'active';
  }

  setGizmoMode(mode: GizmoMode): void {
    this.prefs.gizmoMode = mode;
    // Rotate tool prefers object axes so rings line up with the selection.
    if (mode === 'rotate' && this.prefs.orientation === 'global') {
      this.prefs.orientation = 'local';
    }
  }

  setOrientation(orientation: TransformOrientation): void {
    this.prefs.orientation = orientation;
    if (this.session) {
      this.session.orientation = orientation;
      // Allow basis rebuild when the user changes space mid-gesture.
      this.session.orientationBasisLocked = false;
      this.refreshOrientation(null);
      this.session.orientationBasisLocked = true;
      this.session.dragPlaneNormal = null;
      this.session.initialWorldPoint = null;
      this.reapply();
    }
    this.requestRedraw();
  }

  setPivotMode(mode: TransformPivotMode): void {
    this.prefs.pivotMode = mode;
    if (this.session?.status === 'active') {
      this.session.pivotPosition = computePivot(this.doc, this.selection.state, mode);
      this.session.dragPlaneNormal = null;
      this.session.initialWorldPoint = null;
      this.reapply();
    }
    this.requestRedraw();
  }

  canBegin(): boolean {
    return selectionHasTransformTarget(this.selection.state) && !this.active;
  }

  begin(options: {
    type: TransformType;
    source: TransformSource;
    viewportId: ViewId;
    pointer?: PointerSample | null;
    constraint?: AxisConstraint;
    camera?: CameraAxes | null;
    /** Override session orientation (e.g. normal for Extrude). */
    orientation?: TransformOrientation;
    /** Optional fixed basis (e.g. extrude direction as Z). */
    orientationBasis?: OrientationBasis;
    /** Esc also undoes the prior history entry (Extrude topology). */
    undoHistoryOnCancel?: boolean;
    statusLabel?: string | null;
  }): boolean {
    if (!selectionHasTransformTarget(this.selection.state)) return false;
    if (this.session?.status === 'active') this.cancel();

    const sel = this.selection.state;
    const camera = options.camera ?? options.pointer?.camera ?? null;
    const pivot = computePivot(this.doc, sel, this.prefs.pivotMode);
    const orientation = options.orientation ?? this.prefs.orientation;
    const basis =
      options.orientationBasis ??
      buildOrientationBasis(this.doc, sel, orientation, camera, false);

    const target = gatherTargetVertexIds(this.doc, sel);

    this.session = {
      type: options.type,
      targetObjectIds: new Set(
        sel.mode === 'object' ? topmostObjectIds(this.doc, sel.selectedObjectIds) : sel.selectedObjectIds,
      ),
      targetVertexIds: target ? new Set(target.vertexIds) : new Set(),
      targetEdgeIds: new Set(sel.selectedEdgeIds),
      targetFaceIds: new Set(sel.selectedFaceIds),
      pivotPosition: pivot,
      orientation,
      orientationBasis: basis,
      constraintUsesLocal: false,
      axisConstraint: options.constraint ?? 'none',
      initialPointer: options.pointer
        ? { x: options.pointer.screenX, y: options.pointer.screenY }
        : null,
      currentPointer: options.pointer
        ? { x: options.pointer.screenX, y: options.pointer.screenY }
        : null,
      initialWorldPoint: null,
      currentWorldPoint: null,
      initialState: captureSnapshot(this.doc, sel),
      currentDelta: emptyDelta(),
      numericInput: null,
      snappingEnabled: false,
      snapTargetType: 'none',
      snapLock: null,
      precisionMode: false,
      source: options.source,
      activeViewportId: options.viewportId,
      status: 'active',
      lastAxisKey: null,
      undoHistoryOnCancel: options.undoHistoryOnCancel ?? false,
      statusLabel: options.statusLabel ?? null,
      // Lock axes for the whole gesture (Blender-style) so Normal/Local don't wobble mid-drag.
      orientationBasisLocked: true,
      dragPlaneNormal: null,
    };

    if (options.pointer) {
      const planeN = this.lockDragPlane(options.pointer);
      this.session.initialWorldPoint = rayPlaneHit(
        options.pointer.rayOrigin,
        options.pointer.rayDirection,
        pivot,
        planeN,
      );
      this.session.currentWorldPoint = this.session.initialWorldPoint;
    }

    this.requestRedraw();
    return true;
  }

  updatePointer(pointer: PointerSample): void {
    const s = this.session;
    if (!s || s.status !== 'active') return;
    if (s.numericInput != null && s.numericInput.length > 0) {
      // Numeric mode locks pointer deltas unless cleared
      return;
    }

    s.activeViewportId = pointer.viewportId;
    s.currentPointer = { x: pointer.screenX, y: pointer.screenY };
    s.precisionMode = pointer.shiftKey;
    // Gizmos should remain responsive to tiny drags. Match Blender's direct
    // manipulation: free movement by default, Ctrl temporarily enables snap.
    // Keyboard/modal transforms retain the project-wide snap preference.
    s.snappingEnabled =
      s.source === 'gizmo'
        ? pointer.ctrlKey
        : this.doc.settings.snapEnabled !== pointer.ctrlKey;
    s.snapTargetType = 'none';
    // Orientation is locked for the gesture — do not rebuild from moving selection.

    if (!s.initialPointer) {
      s.initialPointer = { x: pointer.screenX, y: pointer.screenY };
    }
    if (!s.dragPlaneNormal) {
      this.lockDragPlane(pointer);
    }
    if (!s.initialWorldPoint) {
      s.initialWorldPoint = rayPlaneHit(
        pointer.rayOrigin,
        pointer.rayDirection,
        s.pivotPosition,
        s.dragPlaneNormal ?? pointer.camera.forward,
      );
    }

    const planeN = s.dragPlaneNormal ?? this.computeDragPlaneNormal(pointer);
    const hit = rayPlaneHit(
      pointer.rayOrigin,
      pointer.rayDirection,
      s.pivotPosition,
      planeN,
    );
    s.currentWorldPoint = hit;

    if (s.type === 'translate') {
      let delta = subVec3(hit, s.initialWorldPoint ?? hit);
      if (s.precisionMode) delta = scaleVec3(delta, PRECISION_FACTOR);
      delta = constrainTranslation(
        delta,
        s.axisConstraint,
        s.orientationBasis.x,
        s.orientationBasis.y,
        s.orientationBasis.z,
      );
      if (s.snappingEnabled) {
        const target = addVec3(s.pivotPosition, delta);
        const acquireRadius = this.doc.settings.snapIncrement * 0.4;
        const geometrySnap = stabilizeSnap(s.snapLock, this.resolveSnapQuery({
          rawPosition: target,
          pointerRayOrigin: pointer.rayOrigin,
          pointerRayDirection: pointer.rayDirection,
          allowed: ['vertex', 'edgeMid', 'edge', 'face', 'faceCentre', 'origin'],
          excludedObjectIds:
            s.initialState.mode === 'object' ? [...s.targetObjectIds] : undefined,
          excludedElementIds: [
            ...s.targetVertexIds,
            ...s.targetEdgeIds,
            ...s.targetFaceIds,
          ],
        }), target, acquireRadius);
        if (geometrySnap.targetType !== 'none' && geometrySnap.targetType !== 'grid') {
          s.snapLock = geometrySnap;
          delta = constrainTranslation(
            subVec3(geometrySnap.position, s.pivotPosition),
            s.axisConstraint,
            s.orientationBasis.x,
            s.orientationBasis.y,
            s.orientationBasis.z,
          );
          s.snapTargetType = geometrySnap.targetType;
        } else {
          s.snapLock = null;
          const step = pointer.shiftKey
            ? this.doc.settings.snapIncrement * 0.1
            : this.doc.settings.snapIncrement;
          delta = snapVec(delta, step, s.axisConstraint, s.orientationBasis);
          s.snapTargetType = 'increment';
        }
      }
      s.currentDelta = { ...emptyDelta(), translation: delta };
    } else if (s.type === 'rotate') {
      const axis = this.rotationAxis(s, pointer.camera);
      const angle = this.computeRotationAngle(s, pointer, hit, axis);
      let a = angle;
      if (s.precisionMode) a *= PRECISION_FACTOR;
      if (s.snappingEnabled) {
        const degrees = pointer.shiftKey
          ? Math.max(0.1, this.doc.settings.angleSnapDegrees * 0.2)
          : this.doc.settings.angleSnapDegrees;
        a = snapAngleRadians(a, degrees);
        s.snapTargetType = 'angle';
      }
      s.currentDelta = {
        ...emptyDelta(),
        rotationAngle: a,
        rotationAxis: axis,
      };
    } else {
      // scale from screen distance or world distance ratio
      const factor = this.computeScaleFactor(s, pointer, hit);
      let f = factor;
      if (s.precisionMode) f = 1 + (f - 1) * PRECISION_FACTOR;
      if (s.snappingEnabled) {
        const step = pointer.shiftKey ? 0.1 : 0.25;
        f = Math.round(f / step) * step;
        s.snapTargetType = 'increment';
      }
      s.currentDelta = {
        ...emptyDelta(),
        scale: constrainScale(f, s.axisConstraint),
      };
    }

    this.reapply();
  }

  setAxisKey(key: 'x' | 'y' | 'z', shift: boolean, camera?: CameraAxes | null): void {
    const s = this.session;
    if (!s || s.status !== 'active') return;
    // Shift+axis not used for rotation plane constraints
    if (s.type === 'rotate' && shift) return;

    const next = applyAxisKey(
      key,
      shift,
      s.axisConstraint,
      s.lastAxisKey,
      s.orientation,
      s.constraintUsesLocal,
    );
    s.axisConstraint = next.constraint;
    s.lastAxisKey = next.lastAxisKey;
    s.constraintUsesLocal = next.constraintUsesLocal;
    // Axis change needs a fresh stable drag plane (still keep orientation basis).
    s.dragPlaneNormal = null;
    s.initialWorldPoint = null;
    if (camera) {
      const sample = {
        screenX: s.currentPointer?.x ?? 0,
        screenY: s.currentPointer?.y ?? 0,
        rayOrigin: s.pivotPosition,
        rayDirection: camera.forward,
        viewportId: s.activeViewportId,
        shiftKey: false,
        ctrlKey: false,
        camera,
      } satisfies PointerSample;
      // Only refresh local-toggle basis when Global double-taps local.
      if (next.constraintUsesLocal && !s.orientationBasisLocked) {
        this.refreshOrientation(camera);
      } else if (next.constraintUsesLocal) {
        s.orientationBasis = buildOrientationBasis(
          this.doc,
          this.selection.state,
          'local',
          camera,
          true,
        );
      }
      this.lockDragPlane(sample);
    }
    if (s.numericInput) this.applyNumeric();
    else this.reapplyFromLastPointer();
    this.requestRedraw();
  }

  appendNumeric(char: string): void {
    const s = this.session;
    if (!s || s.status !== 'active') return;
    if (char === 'Backspace') {
      if (!s.numericInput) return;
      s.numericInput = s.numericInput.slice(0, -1) || null;
      if (!s.numericInput) {
        s.currentDelta = emptyDelta();
        this.reapply();
        return;
      }
    } else {
      s.numericInput = (s.numericInput ?? '') + char;
    }
    this.applyNumeric();
  }

  clearNumeric(): void {
    const s = this.session;
    if (!s) return;
    s.numericInput = null;
    this.requestRedraw();
  }

  confirm(): boolean {
    const s = this.session;
    if (!s || s.status !== 'active') return false;

    const before = s.initialState;
    const after = captureAfterSnapshot(this.doc, before);
    const name =
      s.statusLabel ??
      (s.type === 'translate' ? 'Move' : s.type === 'rotate' ? 'Rotate' : 'Scale');

    let applied = true;
    this.history.execute({
      name,
      execute: () => {
        if (applied) return;
        restoreSnapshot(this.doc, after);
        applied = true;
      },
      undo: () => {
        restoreSnapshot(this.doc, before);
        applied = false;
      },
    });

    s.status = 'confirmed';
    this.lastCompleted = { type: s.type, label: name };
    this.session = null;
    this.requestRedraw();
    return true;
  }

  cancel(): boolean {
    const s = this.session;
    if (!s || s.status !== 'active') return false;
    const undoHistory = s.undoHistoryOnCancel;
    restoreSnapshot(this.doc, s.initialState);
    s.status = 'cancelled';
    this.session = null;
    if (undoHistory) this.history.undo();
    this.requestRedraw();
    return true;
  }

  statusLine(): string {
    const s = this.session;
    if (!s) return '';
    const label = s.statusLabel ?? (s.type === 'translate' ? 'Move' : s.type === 'rotate' ? 'Rotate' : 'Scale');
    const orient = s.constraintUsesLocal ? 'Local' : s.orientation[0]!.toUpperCase() + s.orientation.slice(1);
    const c = constraintLabel(s.axisConstraint);
    const snap = s.snapTargetType === 'none' ? '' : ` · snap ${SNAP_TARGET_LABELS[s.snapTargetType]}`;
    if (s.type === 'translate') {
      const t = s.currentDelta.translation;
      const num = s.numericInput != null ? ` · ${s.numericInput}` : '';
      return `${label} — ${c} · ${fmt(t.x)}, ${fmt(t.y)}, ${fmt(t.z)}${num} · ${orient}${snap}`;
    }
    if (s.type === 'rotate') {
      const deg = (s.currentDelta.rotationAngle * 180) / Math.PI;
      const num = s.numericInput != null ? ` · ${s.numericInput}` : '';
      return `${label} — ${c} · ${fmt(deg)}°${num} · ${orient}${snap}`;
    }
    const sc = s.currentDelta.scale;
    const num = s.numericInput != null ? ` · ${s.numericInput}` : '';
    return `${label} — ${c} · ${fmt(sc.x)}, ${fmt(sc.y)}, ${fmt(sc.z)}${num} · ${orient}${snap}`;
  }

  private applyNumeric(): void {
    const s = this.session;
    if (!s || s.numericInput == null) return;
    const parsed = parseTransformNumber(s.numericInput);
    if (!parsed.ok) {
      this.requestRedraw();
      return;
    }
    const value = parsed.value;
    if (s.type === 'translate') {
      const axis =
        s.axisConstraint === 'x' || s.axisConstraint === 'y' || s.axisConstraint === 'z'
          ? s.axisConstraint
          : 'x';
      const dir = axisVector(s.orientationBasis, axis);
      s.currentDelta = {
        ...emptyDelta(),
        translation: scaleVec3(dir, value),
      };
      if (s.axisConstraint === 'none') {
        s.currentDelta.translation = scaleVec3(dir, value);
      } else if (s.axisConstraint === 'xy' || s.axisConstraint === 'xz' || s.axisConstraint === 'yz') {
        // Plane numeric: apply along first free axis of plane as distance
        s.currentDelta.translation = constrainTranslation(
          scaleVec3(s.orientationBasis.x, value),
          s.axisConstraint,
          s.orientationBasis.x,
          s.orientationBasis.y,
          s.orientationBasis.z,
        );
      }
    } else if (s.type === 'rotate') {
      const deg = parsed.unit === 'deg' || parsed.unit === 'none' ? value : value;
      const axis = this.rotationAxis(s, null);
      s.currentDelta = {
        ...emptyDelta(),
        rotationAngle: (deg * Math.PI) / 180,
        rotationAxis: axis,
      };
    } else {
      s.currentDelta = {
        ...emptyDelta(),
        scale: constrainScale(value, s.axisConstraint),
      };
    }
    this.reapply();
  }

  private reapply(): void {
    const s = this.session;
    if (!s) return;
    applyDeltaFromSnapshot(this.doc, s.initialState, s.currentDelta, s.pivotPosition);
    // Live preview: viewport syncs from pointer/hotkey paths. Avoid requestRedraw
    // here — it re-renders React every mousemove and feels choppy.
  }

  /** Call after live preview updates when the UI status line should refresh. */
  notifyUi(): void {
    this.requestRedraw();
  }

  private reapplyFromLastPointer(): void {
    // Force recompute if we still have world points
    const s = this.session;
    if (!s?.currentWorldPoint || !s.initialWorldPoint) {
      this.reapply();
      return;
    }
    if (s.type === 'translate') {
      let delta = subVec3(s.currentWorldPoint, s.initialWorldPoint);
      if (s.precisionMode) delta = scaleVec3(delta, PRECISION_FACTOR);
      delta = constrainTranslation(
        delta,
        s.axisConstraint,
        s.orientationBasis.x,
        s.orientationBasis.y,
        s.orientationBasis.z,
      );
      s.currentDelta = { ...emptyDelta(), translation: delta };
    }
    this.reapply();
  }

  private refreshOrientation(camera: CameraAxes | null): void {
    const s = this.session;
    if (!s || s.orientationBasisLocked) return;
    s.orientationBasis = buildOrientationBasis(
      this.doc,
      this.selection.state,
      s.orientation,
      camera,
      s.constraintUsesLocal,
    );
  }

  private lockDragPlane(pointer: PointerSample): Vec3 {
    const s = this.session!;
    const n = this.computeDragPlaneNormal(pointer);
    s.dragPlaneNormal = n;
    return n;
  }

  private computeDragPlaneNormal(pointer: PointerSample): Vec3 {
    const s = this.session!;
    // Rotation: intersect the plane of the gizmo ring (normal = rotation axis).
    // Using cross(axis, camera) makes a plane that *contains* the axis, which
    // collapses ring drags to a line after reject() and yields ~0° deltas.
    if (s.type === 'rotate') {
      let n = normalizeVec3(this.rotationAxis(s, pointer.camera));
      if (lengthVec3(n) < 1e-8) n = normalizeVec3(pointer.camera.forward);
      if (dotVec3(n, pointer.camera.forward) > 0) n = scaleVec3(n, -1);
      return n;
    }
    const cam = pointer.camera.forward;
    const axisPlane = (axis: Vec3): Vec3 => {
      const a = normalizeVec3(axis);
      // The drag plane must contain the selected axis while facing the camera
      // as directly as possible. cross(axis, camera) creates an edge-on plane
      // containing the view ray, which makes perspective intersections
      // parallel/unstable. Rejecting the camera direction from the axis gives
      // the plane normal we actually need.
      let n = subVec3(cam, scaleVec3(a, dotVec3(cam, a)));
      if (lengthVec3(n) < 1e-6) {
        n = subVec3(
          pointer.camera.up,
          scaleVec3(a, dotVec3(pointer.camera.up, a)),
        );
      }
      if (lengthVec3(n) < 1e-6) {
        n = crossVec3(
          a,
          Math.abs(a.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0),
        );
      }
      n = normalizeVec3(n);
      // Keep the plane facing the camera so the intersection stays continuous.
      if (dotVec3(n, cam) > 0) n = scaleVec3(n, -1);
      return n;
    };
    if (s.axisConstraint === 'x') return axisPlane(s.orientationBasis.x);
    if (s.axisConstraint === 'y') return axisPlane(s.orientationBasis.y);
    if (s.axisConstraint === 'z') return axisPlane(s.orientationBasis.z);
    if (s.axisConstraint === 'xy') return normalizeVec3(s.orientationBasis.z);
    if (s.axisConstraint === 'xz') return normalizeVec3(s.orientationBasis.y);
    if (s.axisConstraint === 'yz') return normalizeVec3(s.orientationBasis.x);
    return freeMovePlaneNormal(pointer.viewportId, pointer.camera);
  }

  private rotationAxis(s: TransformSession, camera: CameraAxes | null): Vec3 {
    if (s.axisConstraint === 'x') return s.orientationBasis.x;
    if (s.axisConstraint === 'y') return s.orientationBasis.y;
    if (s.axisConstraint === 'z') return s.orientationBasis.z;
    if (camera) return normalizeVec3(camera.forward);
    return s.orientationBasis.z;
  }

  private computeRotationAngle(
    s: TransformSession,
    pointer: PointerSample,
    hit: Vec3,
    axis: Vec3,
  ): number {
    const pivot = s.pivotPosition;
    const start = s.initialWorldPoint ?? hit;
    const v0 = normalizeVec3(reject(subVec3(start, pivot), axis));
    const v1 = normalizeVec3(reject(subVec3(hit, pivot), axis));
    if (lengthVec3(v0) < 1e-8 || lengthVec3(v1) < 1e-8) {
      // fallback screen space
      if (!s.initialPointer) return 0;
      const dx = pointer.screenX - s.initialPointer.x;
      return dx * 0.01;
    }
    const cross = crossVec3(v0, v1);
    const ang = Math.atan2(dotVec3(cross, axis), dotVec3(v0, v1));
    return ang;
  }

  private computeScaleFactor(s: TransformSession, pointer: PointerSample, hit: Vec3): number {
    const start = s.initialWorldPoint;
    if (!start || !s.initialPointer) {
      const dx = pointer.screenX - (s.initialPointer?.x ?? pointer.screenX);
      return Math.max(0.01, 1 + dx * 0.01);
    }
    const d0 = lengthVec3(subVec3(start, s.pivotPosition));
    const d1 = lengthVec3(subVec3(hit, s.pivotPosition));
    if (d0 < 1e-6) {
      const dx = pointer.screenX - s.initialPointer.x;
      return Math.max(0.01, 1 + dx * 0.01);
    }
    return Math.max(0.01, d1 / d0);
  }
}

function rayPlaneHit(origin: Vec3, dir: Vec3, point: Vec3, normal: Vec3): Vec3 {
  const n = normalizeVec3(normal);
  const denom = dotVec3(n, dir);
  if (Math.abs(denom) < 1e-10) {
    return addVec3(origin, scaleVec3(dir, 2));
  }
  const t = dotVec3(n, subVec3(point, origin)) / denom;
  return addVec3(origin, scaleVec3(dir, t));
}

function reject(v: Vec3, axis: Vec3): Vec3 {
  const a = normalizeVec3(axis);
  return subVec3(v, scaleVec3(a, dotVec3(v, a)));
}

function snapVec(
  delta: Vec3,
  step: number,
  constraint: AxisConstraint,
  basis: { x: Vec3; y: Vec3; z: Vec3 },
): Vec3 {
  if (step <= 0) return delta;
  const snap = (n: number) => Math.round(n / step) * step;
  if (constraint === 'x' || constraint === 'y' || constraint === 'z') {
    const axis = axisVector(basis, constraint);
    const mag = snap(dotVec3(delta, axis));
    return scaleVec3(axis, mag);
  }
  return v3(snap(delta.x), snap(delta.y), snap(delta.z));
}

function fmt(n: number): string {
  return (Math.round(n * 1000) / 1000).toFixed(3);
}

export { identityBasis };

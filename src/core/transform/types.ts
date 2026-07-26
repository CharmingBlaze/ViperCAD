import type { ObjectId } from '@/core/document/types';
import type { Transform } from '@/core/math/Transform';
import type { Vec3 } from '@/core/math/Vec3';
import type { EdgeId, FaceId, VertexId } from '@/core/mesh/types';
import type { ViewId } from '@/workspace/types';
import type { SnapResult, SnapTargetType } from '@/core/snap/SnapEngine';

export type TransformType = 'translate' | 'rotate' | 'scale';

export type AxisConstraint = 'none' | 'x' | 'y' | 'z' | 'xy' | 'xz' | 'yz';

export type TransformOrientation = 'global' | 'local' | 'normal' | 'view' | 'custom';

export type TransformPivotMode =
  | 'median'
  | 'bounding-box'
  | 'active'
  | 'object-origin';

export type GizmoMode = 'select' | 'move' | 'rotate' | 'scale' | 'combined';

export type TransformSource = 'gizmo' | 'keyboard' | 'numeric-field';

export type TransformStatus = 'active' | 'confirmed' | 'cancelled';

/** 3x3 basis columns as world-space axes (x, y, z). */
export type OrientationBasis = {
  x: Vec3;
  y: Vec3;
  z: Vec3;
};

export type TransformDelta = {
  translation: Vec3;
  /** Radians around constrained / view axis. */
  rotationAngle: number;
  rotationAxis: Vec3;
  scale: Vec3;
};

export type ObjectTransformSnapshot = {
  objectId: ObjectId;
  transform: Transform;
};

export type VertexPositionSnapshot = {
  objectId: ObjectId;
  meshId: string;
  /** Directly selected vertices; positions may also include symmetry partners. */
  primaryVertexIds: Set<VertexId>;
  positions: Map<VertexId, Vec3>;
};

export type TransformSnapshot = {
  mode: 'object' | 'vertex' | 'edge' | 'face';
  objects: ObjectTransformSnapshot[];
  vertices: VertexPositionSnapshot | null;
  selection: {
    objectIds: ObjectId[];
    vertexIds: VertexId[];
    edgeIds: EdgeId[];
    faceIds: FaceId[];
    activeObjectId: ObjectId | null;
    activeVertexId: VertexId | null;
    activeEdgeId: EdgeId | null;
    activeFaceId: FaceId | null;
  };
};

export type TransformSession = {
  type: TransformType;
  targetObjectIds: Set<ObjectId>;
  targetVertexIds: Set<VertexId>;
  targetEdgeIds: Set<EdgeId>;
  targetFaceIds: Set<FaceId>;
  pivotPosition: Vec3;
  orientation: TransformOrientation;
  orientationBasis: OrientationBasis;
  /** When Global + double axis press switches to local axes. */
  constraintUsesLocal: boolean;
  axisConstraint: AxisConstraint;
  initialPointer: { x: number; y: number } | null;
  currentPointer: { x: number; y: number } | null;
  /** World-space point under pointer at start (on transform plane). */
  initialWorldPoint: Vec3 | null;
  currentWorldPoint: Vec3 | null;
  initialState: TransformSnapshot;
  currentDelta: TransformDelta;
  numericInput: string | null;
  snappingEnabled: boolean;
  /** Winning geometry or quantisation target for live UI feedback. */
  snapTargetType: SnapTargetType | 'none';
  /** Sticky geometry target used to prevent flicker between nearby candidates. */
  snapLock: SnapResult | null;
  precisionMode: boolean;
  source: TransformSource;
  activeViewportId: ViewId;
  status: TransformStatus;
  /** Last axis key pressed for double-axis local toggle. */
  lastAxisKey: 'x' | 'y' | 'z' | null;
  /**
   * When true, cancelling also undoes the previous history entry
   * (used by Blender-style Extrude so Esc removes the extruded topology).
   */
  undoHistoryOnCancel: boolean;
  /** Optional status label override (e.g. "Extrude"). */
  statusLabel: string | null;
  /** When true, keep the initial orientation basis (do not rebuild on pointer move). */
  orientationBasisLocked: boolean;
  /**
   * Stable drag plane normal locked when the pointer first establishes a world hit.
   * Prevents axis-constrained moves from jumping when the view-aligned plane flips.
   */
  dragPlaneNormal: Vec3 | null;
};

export type TransformPrefs = {
  gizmoMode: GizmoMode;
  orientation: TransformOrientation;
  pivotMode: TransformPivotMode;
};

export function emptyDelta(): TransformDelta {
  return {
    translation: { x: 0, y: 0, z: 0 },
    rotationAngle: 0,
    rotationAxis: { x: 0, y: 1, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

export function identityBasis(): OrientationBasis {
  return {
    x: { x: 1, y: 0, z: 0 },
    y: { x: 0, y: 1, z: 0 },
    z: { x: 0, y: 0, z: 1 },
  };
}

import type { Vec3 } from '@/core/math/Vec3';
import { almostEqualVec3, lengthVec3, subVec3, v3 } from '@/core/math/Vec3';

export type SnapTargetType =
  | 'grid'
  | 'increment'
  | 'angle'
  | 'vertex'
  | 'edge'
  | 'edgeMid'
  | 'face'
  | 'faceCentre'
  | 'origin'
  | 'custom';

export type ConstructionPlane = {
  origin: Vec3;
  normal: Vec3;
  xAxis: Vec3;
  yAxis: Vec3;
};

export type SnapQuery = {
  rawPosition: Vec3;
  pointerRayOrigin?: Vec3;
  pointerRayDirection?: Vec3;
  plane?: ConstructionPlane;
  allowed: SnapTargetType[];
  excludedObjectIds?: string[];
  /** Component IDs that must not snap back onto themselves during a transform. */
  excludedElementIds?: string[];
  gridSize?: number;
  maxWorldDistance?: number;
};

/** Stable CAD-style priority. Precise topology beats derived and fallback targets. */
export const SNAP_TARGET_PRIORITY: Record<SnapTargetType, number> = {
  vertex: 0,
  edgeMid: 1,
  edge: 2,
  face: 3,
  faceCentre: 4,
  origin: 5,
  custom: 6,
  angle: 7,
  increment: 8,
  grid: 9,
};

export const SNAP_TARGET_LABELS: Record<SnapTargetType | 'none', string> = {
  none: 'none',
  vertex: 'vertex',
  edgeMid: 'midpoint',
  edge: 'edge',
  face: 'surface',
  faceCentre: 'face centre',
  origin: 'origin',
  custom: 'custom',
  angle: 'angle',
  increment: 'increment',
  grid: 'grid',
};

export type SnapResult = {
  snapped: boolean;
  position: Vec3;
  targetType: SnapTargetType | 'none';
  targetObjectId?: string;
  targetElementId?: string;
  worldNormal?: Vec3;
  distance: number;
  confidence: number;
};

/** Keep a geometry snap locked until the pointer clearly leaves its release radius. */
export function stabilizeSnap(
  previous: SnapResult | null,
  next: SnapResult,
  rawPosition: Vec3,
  acquireRadius: number,
  releaseMultiplier = 1.75,
): SnapResult {
  if (!previous || previous.targetType === 'none' || previous.targetType === 'grid') return next;
  const previousDistance = lengthVec3(subVec3(previous.position, rawPosition));
  if (previousDistance > acquireRadius * releaseMultiplier) return next;
  const sameTarget =
    previous.targetType === next.targetType &&
    previous.targetObjectId === next.targetObjectId &&
    previous.targetElementId === next.targetElementId;
  if (sameTarget) return next;
  if (next.targetType === 'none' || next.targetType === 'grid') {
    return { ...previous, distance: previousDistance, confidence: Math.max(0, 1 - previousDistance / (acquireRadius * releaseMultiplier)) };
  }
  const previousPriority = SNAP_TARGET_PRIORITY[previous.targetType as SnapTargetType] ?? 99;
  const nextPriority = SNAP_TARGET_PRIORITY[next.targetType as SnapTargetType] ?? 99;
  const decisivelyBetter = nextPriority < previousPriority || next.distance < previousDistance * 0.55;
  return decisivelyBetter ? next : { ...previous, distance: previousDistance };
}

export const WORLD_XY_PLANE: ConstructionPlane = {
  origin: v3(0, 0, 0),
  normal: v3(0, 0, 1),
  xAxis: v3(1, 0, 0),
  yAxis: v3(0, 1, 0),
};

export const WORLD_XZ_PLANE: ConstructionPlane = {
  origin: v3(0, 0, 0),
  normal: v3(0, 1, 0),
  xAxis: v3(1, 0, 0),
  yAxis: v3(0, 0, 1),
};

export const WORLD_YZ_PLANE: ConstructionPlane = {
  origin: v3(0, 0, 0),
  normal: v3(1, 0, 0),
  xAxis: v3(0, 0, 1),
  yAxis: v3(0, 1, 0),
};

export function snapToGrid(position: Vec3, gridSize: number): Vec3 {
  const g = gridSize > 0 ? gridSize : 1;
  return v3(
    Math.round(position.x / g) * g,
    Math.round(position.y / g) * g,
    Math.round(position.z / g) * g,
  );
}

export function snapScalarToIncrement(value: number, increment: number): number {
  if (!(increment > 0) || !Number.isFinite(value)) return value;
  return Math.round(value / increment) * increment;
}

export function snapAngleRadians(angle: number, degrees: number): number {
  if (!(degrees > 0) || !Number.isFinite(angle)) return angle;
  const step = (degrees * Math.PI) / 180;
  return snapScalarToIncrement(angle, step);
}

export function snapToPlaneGrid(position: Vec3, plane: ConstructionPlane, gridSize: number): Vec3 {
  const p = projectToPlane(position, plane);
  const d = subVec3(p, plane.origin);
  const u = d.x * plane.xAxis.x + d.y * plane.xAxis.y + d.z * plane.xAxis.z;
  const v = d.x * plane.yAxis.x + d.y * plane.yAxis.y + d.z * plane.yAxis.z;
  const g = gridSize > 0 ? gridSize : 1;
  const su = Math.round(u / g) * g; const sv = Math.round(v / g) * g;
  return v3(plane.origin.x + plane.xAxis.x * su + plane.yAxis.x * sv, plane.origin.y + plane.xAxis.y * su + plane.yAxis.y * sv, plane.origin.z + plane.xAxis.z * su + plane.yAxis.z * sv);
}

export function projectToPlane(point: Vec3, plane: ConstructionPlane): Vec3 {
  const toPoint = subVec3(point, plane.origin);
  const dist = toPoint.x * plane.normal.x + toPoint.y * plane.normal.y + toPoint.z * plane.normal.z;
  return v3(
    point.x - plane.normal.x * dist,
    point.y - plane.normal.y * dist,
    point.z - plane.normal.z * dist,
  );
}

export function rayPlaneIntersection(
  origin: Vec3,
  direction: Vec3,
  plane: ConstructionPlane,
): Vec3 | null {
  const denom =
    direction.x * plane.normal.x + direction.y * plane.normal.y + direction.z * plane.normal.z;
  if (Math.abs(denom) < 1e-10) return null;
  const diff = subVec3(plane.origin, origin);
  const t =
    (diff.x * plane.normal.x + diff.y * plane.normal.y + diff.z * plane.normal.z) / denom;
  if (t < 0) return null;
  return v3(origin.x + direction.x * t, origin.y + direction.y * t, origin.z + direction.z * t);
}

/**
 * Shared snap resolver. Tools must not invent their own snap rules.
 */
export function resolveSnap(query: SnapQuery, candidates: SnapResult[] = []): SnapResult {
  const maxDist = query.maxWorldDistance ?? Infinity;
  let best: SnapResult | null = null;

  for (const candidate of candidates) {
    if (!query.allowed.includes(candidate.targetType as SnapTargetType)) continue;
    if (candidate.distance > maxDist) continue;
    if (!best) {
      best = candidate;
      continue;
    }
    const candidatePriority = SNAP_TARGET_PRIORITY[candidate.targetType as SnapTargetType] ?? 99;
    const bestPriority = SNAP_TARGET_PRIORITY[best.targetType as SnapTargetType] ?? 99;
    if (
      candidatePriority < bestPriority ||
      (candidatePriority === bestPriority &&
        (candidate.distance < best.distance ||
          (candidate.distance === best.distance &&
            `${candidate.targetObjectId ?? ''}:${candidate.targetElementId ?? ''}` <
              `${best.targetObjectId ?? ''}:${best.targetElementId ?? ''}`)))
    ) {
      best = candidate;
    }
  }

  if (best) return best;

  let position = query.rawPosition;
  if (query.plane) position = projectToPlane(position, query.plane);

  if (query.allowed.includes('grid') && query.gridSize != null) {
    const snapped = query.plane ? snapToPlaneGrid(position, query.plane, query.gridSize) : snapToGrid(position, query.gridSize);
    const distance = lengthVec3(subVec3(snapped, position));
    return {
      snapped: !almostEqualVec3(snapped, position),
      position: snapped,
      targetType: 'grid',
      distance,
      confidence: 1,
      worldNormal: query.plane?.normal,
    };
  }

  return {
    snapped: false,
    position,
    targetType: 'none',
    distance: 0,
    confidence: 0,
    worldNormal: query.plane?.normal,
  };
}

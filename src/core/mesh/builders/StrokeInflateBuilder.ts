import {
  addVec3,
  lengthSqVec3,
  lengthVec3,
  scaleVec3,
  subVec3,
  v3,
  type Vec3,
} from '@/core/math/Vec3';
import type { EditableMesh } from '@/core/mesh/types';
import { unwrapUvAuto } from '@/core/uv/UvOperations';
import { buildCurveCapsule } from '@/core/mesh/builders/CurveSweepBuilder';
import {
  capBoundaryPoints,
  prepareOutlineBoundary,
  preparePathCenterline,
} from '@/core/mesh/builders/OutlineBoundary';
import {
  buildSilhouetteExtrude,
  fitStrokePlane,
  strokeToFlatOutline,
  toLocalPoint,
} from '@/core/mesh/builders/SilhouetteExtrudeBuilder';
import { buildSoftInflateDome, ringCountForBudget } from '@/core/mesh/builders/SoftInflateBuilder';
import { resampleStrokePoints } from './StrokeTubeBuilder';
import { buildVerticalShapedCapsuleFromStroke } from './VerticalCapsuleBuilder';

export type InflateDoodleOptions = {
  points: Vec3[];
  /** Half-thickness / brush radius (full depth ≈ 2 * thickness). */
  thickness: number;
  /** Soft poly budget hint (low ~16, medium ~28). */
  outlineSegments?: number;
  /** Outline = flat shoulder dome; blob = soft pillow; capsule = vertical silhouette fill. */
  profile?: 'sharp' | 'soft' | 'capsule';
  /** Blob shoulder fullness 0–1 (blocky3D default 0.65). */
  inflation?: number;
  radialSegments?: number;
  closed?: boolean;
  name?: string;
};

/** True when the stroke end returns near the start (Paint 3D “connect”). */
export function isStrokeClosed(points: Vec3[], closeDistance: number): boolean {
  if (points.length < 4) return false;
  const a = points[0]!;
  const b = points[points.length - 1]!;
  if (lengthSqVec3(subVec3(a, b)) > closeDistance * closeDistance) return false;
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += lengthVec3(subVec3(points[i]!, points[i - 1]!));
  }
  return len >= closeDistance * 4;
}

function prepareStrokePath(points: Vec3[], thickness: number, highFidelity: boolean): Vec3[] {
  const minSpacing = highFidelity ? thickness * 0.15 : thickness * 0.35;
  let path = highFidelity ? points : resampleStrokePoints(points, minSpacing);
  if (
    path.length >= 2 &&
    lengthSqVec3(subVec3(path[0]!, path[path.length - 1]!)) < minSpacing * minSpacing
  ) {
    path = path.slice(0, -1);
  }
  if (path.length < 2) {
    path = [v3(0, 0, 0), v3(thickness * 4, 0, 0), v3(thickness * 2, thickness * 4, 0)];
  }
  return path;
}

function boundaryForProfile(
  ring2d: { u: number; v: number }[],
  outlineTarget: number,
  profile: 'sharp' | 'soft',
): { u: number; v: number }[] | null {
  const budgetRings = ringCountForBudget(outlineTarget);
  const vertexRingCount = budgetRings + 1;
  const budgetedBoundary = Math.floor(outlineTarget / vertexRingCount);
  const maxBoundary =
    profile === 'sharp'
      ? Math.max(8, Math.min(28, budgetedBoundary))
      : Math.max(8, Math.min(28, budgetedBoundary));
  const prepared = prepareOutlineBoundary(ring2d, outlineTarget, true);
  if (!prepared) return null;
  return prepared.length <= maxBoundary ? prepared : capBoundaryPoints(prepared, maxBoundary);
}

/**
 * Closed outline/blob dome or open outline ribbon / blob tube.
 * Matches blocky3D: outline = soft inflate @ inflation 0, blob @ ~0.65.
 */
export function buildInflatedDoodle(options: InflateDoodleOptions): EditableMesh {
  const thickness = Math.max(1e-4, options.thickness);
  const outlineTarget = Math.max(8, Math.min(48, Math.floor(options.outlineSegments ?? 16)));
  const name = options.name ?? 'Doodle';
  const profile = options.profile ?? 'sharp';
  const closed = options.closed !== false;
  const highFidelity = profile === 'sharp' || profile === 'soft';
  const path = prepareStrokePath(options.points, thickness, highFidelity);
  const plane = fitStrokePlane(path);

  if (profile === 'capsule') {
    return buildVerticalShapedCapsuleFromStroke(path, {
      radialSegments: options.radialSegments ?? (outlineTarget >= 24 ? 14 : 12),
      profileRings: outlineTarget >= 24 ? 14 : 10,
      minRadius: thickness,
      name,
    });
  }

  const ring2d = path.map((point) => toLocalPoint(point, plane));
  const depth = Math.max(1e-4, thickness * 2);
  const inflation = profile === 'soft' ? (options.inflation ?? 0.65) : 0;

  if (!closed) {
    const centerline = preparePathCenterline(ring2d, outlineTarget);
    if (!centerline || centerline.length < 2) {
      return buildSoftInflateDome({
        boundary: ring2d,
        plane,
        depth,
        rings: ringCountForBudget(outlineTarget),
        inflation,
        name,
      });
    }
    if (profile === 'soft') {
      const spine3d = centerline.map((point) =>
        addVec3(
          plane.origin,
          addVec3(scaleVec3(plane.axisU, point.u), scaleVec3(plane.axisV, point.v)),
        ),
      );
      return buildCurveCapsule({
        points: spine3d,
        radius: thickness,
        radialSegments: Math.max(8, options.radialSegments ?? 8),
        profile: 'round',
        cyclic: false,
        capStart: true,
        capEnd: true,
        pathSpacingScale: 1,
        name: name ?? 'Blob Path',
      });
    }
    const halfWidth = Math.max(thickness * 0.85, thickness);
    const ribbon = strokeToFlatOutline(centerline, halfWidth);
    if (!ribbon || ribbon.length < 3) {
      return buildSilhouetteExtrude({
        boundary: ring2d,
        plane,
        depth,
        name: name ?? 'Outline Path',
      });
    }
    return buildSilhouetteExtrude({
      boundary: ribbon,
      plane,
      depth,
      name: name ?? 'Outline Path',
    });
  }

  const boundary = boundaryForProfile(ring2d, outlineTarget, profile);
  if (!boundary || boundary.length < 3) {
    return buildSoftInflateDome({
      boundary: ring2d,
      plane,
      depth,
      rings: ringCountForBudget(outlineTarget) + (profile === 'soft' ? 2 : 0),
      inflation,
      name,
    });
  }

  return buildSoftInflateDome({
    boundary,
    plane,
    depth,
    rings: ringCountForBudget(outlineTarget) + (profile === 'soft' ? 2 : 0),
    inflation,
    name,
  });
}

function finishDoodleMesh(mesh: EditableMesh): EditableMesh {
  if (
    mesh.defaultUvLayerId &&
    [...mesh.faceCorners.values()].every((corner) => {
      const uv = corner.uvs.get(mesh.defaultUvLayerId!);
      return !uv || (uv.x === 0 && uv.y === 0);
    })
  ) {
    unwrapUvAuto(mesh, [...mesh.faces.keys()], mesh.defaultUvLayerId);
  }
  return mesh;
}

/** Close distance used for connect detection (world units). */
export function doodleCloseDistance(radius: number, pathLength: number): number {
  return Math.max(radius * 2.2, Math.min(pathLength * 0.12, radius * 8));
}

export function strokePathLength(points: Vec3[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += lengthVec3(subVec3(points[i]!, points[i - 1]!));
  }
  return len;
}

export { finishDoodleMesh };

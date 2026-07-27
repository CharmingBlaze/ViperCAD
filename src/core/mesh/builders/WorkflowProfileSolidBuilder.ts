import type { EditableMesh } from '@/core/mesh/types';
import {
  buildLimbBlockoutChain,
  buildOutlineBlockout,
} from '@/core/mesh/builders/WorkflowBlockoutBuilder';
import { resampleStrokePoints } from '@/core/mesh/builders/StrokeTubeBuilder';
import { addVec3, lengthSqVec3, lengthVec3, subVec3, v3, type Vec3 } from '@/core/math/Vec3';

export type WorkflowProfileSolidOptions = {
  points: Vec3[];
  radius: number;
  maxOutlineCorners: number;
  outlineSegments: number;
  cyclic: boolean;
  exactOutline?: boolean;
  widthScale?: number;
  heightScale?: number;
  uniformScale?: number;
  roundness?: number;
  depthSegments?: number;
  name: string;
};

/**
 * Blockout Outline:
 * - Closed outline → exact silhouette solid with soft depth + live scales
 * - Open path → faceted box chain at joints
 */
export function buildWorkflowProfileSolid(options: WorkflowProfileSolidOptions): EditableMesh {
  const depth = Math.max(1e-4, options.radius * 2);
  const path = prepareExactPath(options.points, options.cyclic);

  if (options.cyclic) {
    const depthSegments = Math.max(
      1,
      Math.min(6, options.depthSegments ?? (options.outlineSegments >= 20 ? 4 : 3)),
    );
    return buildOutlineBlockout({
      points: path,
      depth,
      depthSegments,
      roundness: options.roundness ?? 0.24,
      widthScale: options.widthScale ?? 1,
      heightScale: options.heightScale ?? 1,
      uniformScale: options.uniformScale ?? 1,
      maxCorners: options.maxOutlineCorners,
      exactOutline: options.exactOutline === true,
      name: options.name,
    });
  }

  const sides = Math.max(4, Math.min(8, Math.round(options.maxOutlineCorners / 3)));
  return buildLimbBlockoutChain({
    points: path,
    radius: options.radius,
    sides,
    name: options.name,
  });
}

/** Open workflow path → one faceted box chain (pen joints or resampled sections). */
export function buildWorkflowLimbBlockout(options: {
  points: Vec3[];
  radius: number;
  segmentCount: number;
  sides?: number;
  exactEdges?: boolean;
  profileWidth?: number;
  profileHeight?: number;
  startScale?: number;
  endScale?: number;
  name: string;
}): EditableMesh {
  const sides = Math.max(4, Math.min(8, options.sides ?? 6));
  let path = options.points.map((point) => ({ ...point }));
  if (path.length < 2) {
    path.push(addVec3(path[0] ?? v3(), v3(options.radius * 2, 0, 0)));
  }

  if (options.exactEdges) {
    // Pen: keep every click as a joint.
  } else if (path.length > 2) {
    const segmentCount = Math.max(2, Math.min(16, options.segmentCount));
    const total = pathLength(path);
    const spacing = total / segmentCount;
    path = resampleStrokePoints(path, Math.max(1e-4, spacing));
  }

  return buildLimbBlockoutChain({
    points: path,
    radius: options.radius,
    sides,
    profileWidth: options.profileWidth,
    profileHeight: options.profileHeight,
    startScale: options.startScale,
    endScale: options.endScale,
    name: options.name,
  });
}

function pathLength(points: Vec3[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    total += lengthVec3(subVec3(points[index]!, points[index - 1]!));
  }
  return total;
}

function prepareExactPath(points: Vec3[], cyclic: boolean): Vec3[] {
  if (points.length === 0) return [v3(0, 0, 0), v3(0.4, 0, 0)];
  let path = points.map((point) => ({ ...point }));
  if (cyclic && path.length >= 2) {
    const first = path[0]!;
    const last = path[path.length - 1]!;
    if (lengthSqVec3(subVec3(first, last)) < 1e-10) {
      path = path.slice(0, -1);
    }
  }
  return path.length >= (cyclic ? 3 : 2) ? path : points;
}

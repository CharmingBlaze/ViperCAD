import { dotVec3, type Vec3 } from '@/core/math/Vec3';
import type { CameraAxes } from '@/core/transform/Orientation';

export type OrientationAxis = 'x' | 'y' | 'z';

export type OrientationGizmoHandle = {
  axis: OrientationAxis;
  sign: 1 | -1;
  x: number;
  y: number;
  /** Camera-forward dot of the axis tip. Larger = farther from the viewer. */
  depth: number;
  /** 1 = pointing at the camera, -1 = pointing away. */
  facing: number;
};

/** Fallback matching a +X/+Y/+Z isometric view so the widget still draws before cameras exist. */
export const DEFAULT_ORIENTATION_AXES: CameraAxes = {
  right: { x: 0.7071, y: 0, z: -0.7071 },
  up: { x: -0.4082, y: 0.8165, z: -0.4082 },
  forward: { x: -0.5774, y: -0.5774, z: -0.5774 },
};

const AXIS_VEC: Record<OrientationAxis, Vec3> = {
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: 1, z: 0 },
  z: { x: 0, y: 0, z: 1 },
};

export function orientationGizmoHandles(
  axes: CameraAxes | null,
  centre = 41,
  radius = 28,
): OrientationGizmoHandle[] {
  const basis = axes ?? DEFAULT_ORIENTATION_AXES;
  const handles: OrientationGizmoHandle[] = [];
  for (const axis of ['x', 'y', 'z'] as const) {
    for (const sign of [1, -1] as const) {
      const world = {
        x: AXIS_VEC[axis].x * sign,
        y: AXIS_VEC[axis].y * sign,
        z: AXIS_VEC[axis].z * sign,
      };
      const depth = dotVec3(world, basis.forward);
      handles.push({
        axis,
        sign,
        x: centre + dotVec3(world, basis.right) * radius,
        y: centre - dotVec3(world, basis.up) * radius,
        depth,
        facing: -depth,
      });
    }
  }
  return handles.sort((a, b) => b.depth - a.depth);
}

/** Screen-space line from near the centre to just inside the handle disc. */
export function orientationGizmoSpoke(
  handle: OrientationGizmoHandle,
  centre: number,
  inner = 0.18,
  outer = 0.64,
): { x1: number; y1: number; x2: number; y2: number } {
  return {
    x1: centre + (handle.x - centre) * inner,
    y1: centre + (handle.y - centre) * inner,
    x2: centre + (handle.x - centre) * outer,
    y2: centre + (handle.y - centre) * outer,
  };
}

/**
 * Blender: clicking the axis you are already looking along flips to the opposite side.
 * Camera forward ≈ −axis when viewing from +axis.
 */
export function resolveOrientationClick(
  forward: Vec3 | undefined,
  axis: OrientationAxis,
  sign: 1 | -1,
  threshold = 0.92,
): 1 | -1 {
  if (!forward) return sign;
  const axisDot = axis === 'x' ? forward.x : axis === 'y' ? forward.y : forward.z;
  const viewingFrom: 1 | -1 | 0 = axisDot < -threshold ? 1 : axisDot > threshold ? -1 : 0;
  if (viewingFrom === sign) return sign === 1 ? -1 : 1;
  return sign;
}

export function gizmoHandleOpacity(facing: number): number {
  return 0.38 + 0.62 * (facing * 0.5 + 0.5);
}

export function gizmoHandleScale(facing: number): number {
  return 0.84 + 0.16 * (facing * 0.5 + 0.5);
}

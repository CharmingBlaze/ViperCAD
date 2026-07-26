import { BoxBuilder, buildBox, buildBoxFromCorners } from './BoxBuilder';
import { ConeBuilder, buildCone } from './ConeBuilder';
import { CylinderBuilder, buildCylinder } from './CylinderBuilder';
import { PlaneBuilder, buildPlane } from './PlaneBuilder';
import { PyramidBuilder, buildPyramid } from './PyramidBuilder';
import { RampBuilder, buildRamp } from './RampBuilder';
import { SphereBuilder, buildSphere } from './SphereBuilder';
import { buildStrokeTube, resampleStrokePoints } from './StrokeTubeBuilder';
import {
  buildInflatedDoodle,
  doodleCloseDistance,
  isStrokeClosed,
  strokePathLength,
} from './StrokeInflateBuilder';
import type { PrimitiveBuilder, PrimitiveBuilderId } from './types';

export * from './types';
export * from './BoxBuilder';
export * from './PlaneBuilder';
export * from './CylinderBuilder';
export * from './ConeBuilder';
export * from './SphereBuilder';
export * from './PyramidBuilder';
export * from './RampBuilder';
export * from './StrokeTubeBuilder';
export * from './StrokeInflateBuilder';

export const primitiveBuilders: PrimitiveBuilder<unknown>[] = [
  BoxBuilder as PrimitiveBuilder<unknown>,
  PlaneBuilder as PrimitiveBuilder<unknown>,
  CylinderBuilder as PrimitiveBuilder<unknown>,
  ConeBuilder as PrimitiveBuilder<unknown>,
  SphereBuilder as PrimitiveBuilder<unknown>,
  PyramidBuilder as PrimitiveBuilder<unknown>,
  RampBuilder as PrimitiveBuilder<unknown>,
];

export function getPrimitiveBuilder(id: PrimitiveBuilderId): PrimitiveBuilder<unknown> | undefined {
  return primitiveBuilders.find((b) => b.id === id);
}

export {
  buildBox,
  buildBoxFromCorners,
  buildPlane,
  buildCylinder,
  buildCone,
  buildSphere,
  buildPyramid,
  buildRamp,
  buildStrokeTube,
  resampleStrokePoints,
  buildInflatedDoodle,
  doodleCloseDistance,
  isStrokeClosed,
  strokePathLength,
};

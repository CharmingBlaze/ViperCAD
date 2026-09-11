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
import { CircleBuilder, buildCircle } from './CircleBuilder';
import { RingBuilder, buildRing } from './RingBuilder';
import { PolygonBuilder, buildPolygon } from './PolygonBuilder';
import { StarBuilder, buildStar } from './StarBuilder';
import { PrismBuilder, buildPrism } from './PrismBuilder';
import { WedgeBuilder, buildWedge } from './WedgeBuilder';
import { OctahedronBuilder, buildOctahedron } from './OctahedronBuilder';
import type { PrimitiveBuilder, PrimitiveBuilderId } from './types';

export * from './types';
export * from './BoxBuilder';
export * from './PlaneBuilder';
export * from './CylinderBuilder';
export * from './ConeBuilder';
export * from './SphereBuilder';
export * from './PyramidBuilder';
export * from './RampBuilder';
export * from './CircleBuilder';
export * from './RingBuilder';
export * from './PolygonBuilder';
export * from './StarBuilder';
export * from './PrismBuilder';
export * from './WedgeBuilder';
export * from './OctahedronBuilder';
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
  CircleBuilder as PrimitiveBuilder<unknown>,
  RingBuilder as PrimitiveBuilder<unknown>,
  PolygonBuilder as PrimitiveBuilder<unknown>,
  StarBuilder as PrimitiveBuilder<unknown>,
  PrismBuilder as PrimitiveBuilder<unknown>,
  WedgeBuilder as PrimitiveBuilder<unknown>,
  OctahedronBuilder as PrimitiveBuilder<unknown>,
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
  buildCircle,
  buildRing,
  buildPolygon,
  buildStar,
  buildPrism,
  buildWedge,
  buildOctahedron,
  buildStrokeTube,
  resampleStrokePoints,
  buildInflatedDoodle,
  doodleCloseDistance,
  isStrokeClosed,
  strokePathLength,
};

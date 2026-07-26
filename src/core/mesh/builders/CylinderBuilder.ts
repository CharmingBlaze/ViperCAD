import { v2 } from '@/core/math/Vec2';
import { v3 } from '@/core/math/Vec3';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import type { EditableMesh } from '@/core/mesh/types';
import type { PrimitiveBuilder } from './types';

export type CylinderOptions = {
  radius: number;
  height: number;
  radialSegments: number;
  name?: string;
  capped?: boolean;
};

export function buildCylinder(options: CylinderOptions): EditableMesh {
  const {
    radius,
    height,
    radialSegments,
    name = 'Cylinder',
    capped = true,
  } = options;
  const segs = Math.max(3, Math.floor(radialSegments));
  const b = new MeshBuilder(name, false);
  const hy = height / 2;

  const bottom: string[] = [];
  const top: string[] = [];
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    const x = Math.cos(t) * radius;
    const z = Math.sin(t) * radius;
    bottom.push(b.vertex(v3(x, -hy, z)));
    top.push(b.vertex(v3(x, hy, z)));
  }

  for (let i = 0; i < segs; i++) {
    const i1 = (i + 1) % segs;
    const u0 = i / segs;
    const u1 = (i + 1) / segs;
    b.quad(
      bottom[i]!,
      top[i]!,
      top[i1]!,
      bottom[i1]!,
      [v2(u0, 0), v2(u0, 1), v2(u1, 1), v2(u1, 0)],
    );
  }

  if (capped) {
    const capUv = (i: number) => v2(0.5 + 0.5 * Math.cos((i / segs) * Math.PI * 2), 0.5 + 0.5 * Math.sin((i / segs) * Math.PI * 2));
    b.ngon([...bottom], [...Array(segs).keys()].map(capUv));
    b.ngon([...top].reverse(), [...Array(segs).keys()].reverse().map(capUv));
  }

  return b.build();
}

export const CylinderBuilder: PrimitiveBuilder<CylinderOptions> = {
  id: 'cylinder',
  label: 'Cylinder',
  defaultOptions: { radius: 0.5, height: 1, radialSegments: 12, name: 'Cylinder', capped: true },
  build: buildCylinder,
};

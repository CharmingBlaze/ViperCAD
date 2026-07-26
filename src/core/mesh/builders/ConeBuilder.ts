import { v2 } from '@/core/math/Vec2';
import { v3 } from '@/core/math/Vec3';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import type { EditableMesh } from '@/core/mesh/types';
import type { PrimitiveBuilder } from './types';

export type ConeOptions = {
  radius: number;
  height: number;
  radialSegments: number;
  name?: string;
  capped?: boolean;
};

export function buildCone(options: ConeOptions): EditableMesh {
  const { radius, height, radialSegments, name = 'Cone', capped = true } = options;
  const segs = Math.max(3, Math.floor(radialSegments));
  const b = new MeshBuilder(name, false);
  const hy = height / 2;
  const tip = b.vertex(v3(0, hy, 0));
  const ring: string[] = [];
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    ring.push(b.vertex(v3(Math.cos(t) * radius, -hy, Math.sin(t) * radius)));
  }

  for (let i = 0; i < segs; i++) {
    const i1 = (i + 1) % segs;
    const u0 = i / segs;
    const u1 = (i + 1) / segs;
    b.tri(tip, ring[i1]!, ring[i]!, [v2((u0 + u1) / 2, 1), v2(u1, 0), v2(u0, 0)]);
  }

  if (capped) {
    b.ngon([...ring], [...Array(segs).keys()].map((i) => v2(0.5 + 0.5 * Math.cos((i / segs) * Math.PI * 2), 0.5 + 0.5 * Math.sin((i / segs) * Math.PI * 2))));
  }

  return b.build();
}

export const ConeBuilder: PrimitiveBuilder<ConeOptions> = {
  id: 'cone',
  label: 'Cone',
  defaultOptions: { radius: 0.5, height: 1, radialSegments: 12, name: 'Cone', capped: true },
  build: buildCone,
};

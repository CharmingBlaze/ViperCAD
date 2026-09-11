import { v2 } from '@/core/math/Vec2';
import { v3 } from '@/core/math/Vec3';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import type { EditableMesh } from '@/core/mesh/types';
import type { PrimitiveBuilder } from './types';

export type RingOptions = {
  outerRadius?: number;
  innerRadius?: number;
  radialSegments?: number;
  wallThickness?: number;
  name?: string;
};

export function buildRing(options: RingOptions = {}): EditableMesh {
  const {
    outerRadius = 0.5,
    radialSegments = 16,
    wallThickness = 0.25,
    name = 'Ring',
  } = options;
  const segs = Math.max(3, Math.floor(radialSegments));
  const innerRadius = options.innerRadius ?? outerRadius * (1 - Math.min(0.9, Math.max(0.05, wallThickness)));
  const b = new MeshBuilder(name, false);

  const inner: string[] = [];
  const outer: string[] = [];

  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    outer.push(b.vertex(v3(cos * outerRadius, 0, sin * outerRadius)));
    inner.push(b.vertex(v3(cos * innerRadius, 0, sin * innerRadius)));
  }

  const uvRatio = innerRadius / outerRadius;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    const t0 = (i / segs) * Math.PI * 2;
    const t1 = (j / segs) * Math.PI * 2;

    const uvIn0 = v2(0.5 + 0.5 * uvRatio * Math.cos(t0), 0.5 + 0.5 * uvRatio * Math.sin(t0));
    const uvIn1 = v2(0.5 + 0.5 * uvRatio * Math.cos(t1), 0.5 + 0.5 * uvRatio * Math.sin(t1));
    const uvOut1 = v2(0.5 + 0.5 * Math.cos(t1), 0.5 + 0.5 * Math.sin(t1));
    const uvOut0 = v2(0.5 + 0.5 * Math.cos(t0), 0.5 + 0.5 * Math.sin(t0));

    b.quad(inner[i]!, inner[j]!, outer[j]!, outer[i]!, [uvIn0, uvIn1, uvOut1, uvOut0]);
  }

  return b.build();
}

export const RingBuilder: PrimitiveBuilder<RingOptions> = {
  id: 'ring',
  label: 'Ring',
  defaultOptions: { outerRadius: 0.5, radialSegments: 16, wallThickness: 0.25, name: 'Ring' },
  build: buildRing,
};

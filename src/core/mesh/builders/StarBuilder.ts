import { v2 } from '@/core/math/Vec2';
import { v3 } from '@/core/math/Vec3';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import type { EditableMesh } from '@/core/mesh/types';
import type { PrimitiveBuilder } from './types';

export type StarOptions = {
  points?: number;
  outerRadius?: number;
  innerRatio?: number;
  name?: string;
};

export function buildStar(options: StarOptions = {}): EditableMesh {
  const {
    points = 5,
    outerRadius = 0.5,
    innerRatio = 0.4,
    name = 'Star',
  } = options;
  const numPoints = Math.max(3, Math.min(16, Math.floor(points)));
  const ratio = Math.min(0.9, Math.max(0.1, innerRatio));
  const b = new MeshBuilder(name, false);

  const center = b.vertex(v3(0, 0, 0));
  const uvCenter = v2(0.5, 0.5);

  const count = numPoints * 2;
  const perimeter: string[] = [];
  const uvs: ReturnType<typeof v2>[] = [];

  for (let k = 0; k < count; k++) {
    const t = (k / count) * Math.PI * 2 - Math.PI / 2;
    const r = k % 2 === 0 ? outerRadius : outerRadius * ratio;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    perimeter.push(b.vertex(v3(cos * r, 0, sin * r)));
    uvs.push(v2(0.5 + 0.5 * (r / outerRadius) * cos, 0.5 + 0.5 * (r / outerRadius) * sin));
  }

  // Build triangle fan around center vertex with outward normal (+Y)
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    b.tri(center, perimeter[j]!, perimeter[i]!, [uvCenter, uvs[j]!, uvs[i]!]);
  }

  return b.build();
}

export const StarBuilder: PrimitiveBuilder<StarOptions> = {
  id: 'star',
  label: 'Star',
  defaultOptions: { points: 5, outerRadius: 0.5, innerRatio: 0.4, name: 'Star' },
  build: buildStar,
};

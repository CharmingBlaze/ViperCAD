import { v2 } from '@/core/math/Vec2';
import { v3 } from '@/core/math/Vec3';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import type { EditableMesh } from '@/core/mesh/types';
import type { PrimitiveBuilder } from './types';

export type CircleOptions = {
  radius?: number;
  radialSegments?: number;
  name?: string;
};

export function buildCircle(options: CircleOptions = {}): EditableMesh {
  const { radius = 0.5, radialSegments = 16, name = 'Circle' } = options;
  const segs = Math.max(3, Math.floor(radialSegments));
  const b = new MeshBuilder(name, false);

  const verts: string[] = [];
  const uvs: ReturnType<typeof v2>[] = [];

  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    verts.push(b.vertex(v3(cos * radius, 0, sin * radius)));
    uvs.push(v2(0.5 + 0.5 * cos, 0.5 + 0.5 * sin));
  }

  // Reverse so the default face normal points towards +Y (outward on construction plane)
  b.ngon([...verts].reverse(), [...uvs].reverse());
  return b.build();
}

export const CircleBuilder: PrimitiveBuilder<CircleOptions> = {
  id: 'circle',
  label: 'Circle',
  defaultOptions: { radius: 0.5, radialSegments: 16, name: 'Circle' },
  build: buildCircle,
};

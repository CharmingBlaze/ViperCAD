import { v2 } from '@/core/math/Vec2';
import { v3 } from '@/core/math/Vec3';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import type { EditableMesh } from '@/core/mesh/types';
import type { PrimitiveBuilder } from './types';

export type PolygonOptions = {
  radius?: number;
  sides?: number;
  name?: string;
};

export function buildPolygon(options: PolygonOptions = {}): EditableMesh {
  const { radius = 0.5, sides = 6, name = 'Polygon' } = options;
  const segs = Math.max(3, Math.min(32, Math.floor(sides)));
  const b = new MeshBuilder(name, false);

  const verts: string[] = [];
  const uvs: ReturnType<typeof v2>[] = [];

  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2 - Math.PI / 2;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    verts.push(b.vertex(v3(cos * radius, 0, sin * radius)));
    uvs.push(v2(0.5 + 0.5 * cos, 0.5 + 0.5 * sin));
  }

  // Reverse so the default face normal points towards +Y
  b.ngon([...verts].reverse(), [...uvs].reverse());
  return b.build();
}

export const PolygonBuilder: PrimitiveBuilder<PolygonOptions> = {
  id: 'polygon',
  label: 'Polygon',
  defaultOptions: { radius: 0.5, sides: 6, name: 'Polygon' },
  build: buildPolygon,
};

import { v2 } from '@/core/math/Vec2';
import { v3 } from '@/core/math/Vec3';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import type { EditableMesh } from '@/core/mesh/types';
import type { PrimitiveBuilder } from './types';

export type OctahedronOptions = {
  radius?: number;
  height?: number;
  name?: string;
};

export function buildOctahedron(options: OctahedronOptions = {}): EditableMesh {
  const { radius = 0.5, height = 1, name = 'Octahedron' } = options;
  const b = new MeshBuilder(name, false);
  const hh = height / 2;

  const top = b.vertex(v3(0, hh, 0));
  const bottom = b.vertex(v3(0, -hh, 0));

  const equator: string[] = [
    b.vertex(v3(radius, 0, 0)),
    b.vertex(v3(0, 0, radius)),
    b.vertex(v3(-radius, 0, 0)),
    b.vertex(v3(0, 0, -radius)),
  ];

  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const u0 = i / 4;
    const u1 = (i + 1) / 4;

    // Top face
    b.tri(top, equator[j]!, equator[i]!, [v2(0.5, 1), v2(u1, 0.5), v2(u0, 0.5)]);
    // Bottom face
    b.tri(bottom, equator[i]!, equator[j]!, [v2(0.5, 0), v2(u0, 0.5), v2(u1, 0.5)]);
  }

  return b.build();
}

export const OctahedronBuilder: PrimitiveBuilder<OctahedronOptions> = {
  id: 'octahedron',
  label: 'Octahedron',
  defaultOptions: { radius: 0.5, height: 1, name: 'Octahedron' },
  build: buildOctahedron,
};

import { v2 as uv } from '@/core/math/Vec2';
import { v3 } from '@/core/math/Vec3';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import type { EditableMesh } from '@/core/mesh/types';
import type { PrimitiveBuilder } from './types';

export type PlaneOptions = {
  width: number;
  depth: number;
  name?: string;
};

export function buildPlane(options: PlaneOptions): EditableMesh {
  const { width, depth, name = 'Plane' } = options;
  const b = new MeshBuilder(name, true);
  const hw = width / 2;
  const hd = depth / 2;
  const v0 = b.vertex(v3(-hw, 0, -hd));
  const v1 = b.vertex(v3(hw, 0, -hd));
  const v2 = b.vertex(v3(hw, 0, hd));
  const v3v = b.vertex(v3(-hw, 0, hd));
  b.quad(v0, v1, v2, v3v, [uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)]);
  return b.build();
}

export const PlaneBuilder: PrimitiveBuilder<PlaneOptions> = {
  id: 'plane',
  label: 'Plane',
  defaultOptions: { width: 2, depth: 2, name: 'Plane' },
  build: buildPlane,
};

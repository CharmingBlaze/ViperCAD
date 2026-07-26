import { v2 as uv } from '@/core/math/Vec2';
import { v3 } from '@/core/math/Vec3';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import type { EditableMesh } from '@/core/mesh/types';
import { unwrapUvAuto } from '@/core/uv/UvOperations';
import type { PrimitiveBuilder } from './types';

export type PyramidOptions = {
  width: number;
  depth: number;
  height: number;
  name?: string;
};

export function buildPyramid(options: PyramidOptions): EditableMesh {
  const { width, depth, height, name = 'Pyramid' } = options;
  const b = new MeshBuilder(name, false);
  const hw = width / 2;
  const hd = depth / 2;
  const v0 = b.vertex(v3(-hw, 0, -hd));
  const v1 = b.vertex(v3(hw, 0, -hd));
  const v2 = b.vertex(v3(hw, 0, hd));
  const v3v = b.vertex(v3(-hw, 0, hd));
  const tip = b.vertex(v3(0, height, 0));

  b.quad(v0, v3v, v2, v1, [uv(0, 0), uv(0, 1), uv(1, 1), uv(1, 0)]);
  b.tri(tip, v0, v1);
  b.tri(tip, v1, v2);
  b.tri(tip, v2, v3v);
  b.tri(tip, v3v, v0);
  const mesh = b.build();
  if (mesh.defaultUvLayerId) {
    unwrapUvAuto(mesh, [...mesh.faces.keys()], mesh.defaultUvLayerId);
  }
  return mesh;
}

export const PyramidBuilder: PrimitiveBuilder<PyramidOptions> = {
  id: 'pyramid',
  label: 'Pyramid',
  defaultOptions: { width: 1, depth: 1, height: 1, name: 'Pyramid' },
  build: buildPyramid,
};

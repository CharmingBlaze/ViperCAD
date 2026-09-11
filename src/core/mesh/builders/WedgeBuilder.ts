import { v2 } from '@/core/math/Vec2';
import { v3 } from '@/core/math/Vec3';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import type { EditableMesh } from '@/core/mesh/types';
import type { PrimitiveBuilder } from './types';

export type WedgeOptions = {
  width?: number;
  height?: number;
  depth?: number;
  name?: string;
};

export function buildWedge(options: WedgeOptions = {}): EditableMesh {
  const { width = 1, height = 1, depth = 1, name = 'Wedge' } = options;
  const b = new MeshBuilder(name, false);
  const hw = width / 2;
  const hh = height / 2;
  const hd = depth / 2;

  const bbl = b.vertex(v3(-hw, -hh, -hd));
  const bbr = b.vertex(v3(hw, -hh, -hd));
  const fbl = b.vertex(v3(-hw, -hh, hd));
  const fbr = b.vertex(v3(hw, -hh, hd));
  const btl = b.vertex(v3(-hw, hh, -hd));
  const btr = b.vertex(v3(hw, hh, -hd));

  // Bottom (-Y)
  b.quad(bbl, bbr, fbr, fbl, [v2(0, 0), v2(1, 0), v2(1, 1), v2(0, 1)]);
  // Back (-Z)
  b.quad(bbr, bbl, btl, btr, [v2(0, 0), v2(1, 0), v2(1, 1), v2(0, 1)]);
  // Sloped (+Y, +Z)
  b.quad(btl, fbl, fbr, btr, [v2(0, 1), v2(0, 0), v2(1, 0), v2(1, 1)]);
  // Left (-X)
  b.tri(bbl, fbl, btl, [v2(0, 0), v2(1, 0), v2(0, 1)]);
  // Right (+X)
  b.tri(bbr, btr, fbr, [v2(1, 0), v2(1, 1), v2(0, 0)]);

  return b.build();
}

export const WedgeBuilder: PrimitiveBuilder<WedgeOptions> = {
  id: 'wedge',
  label: 'Wedge',
  defaultOptions: { width: 1, height: 1, depth: 1, name: 'Wedge' },
  build: buildWedge,
};

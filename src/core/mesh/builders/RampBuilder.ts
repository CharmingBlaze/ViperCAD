import { v2 as uv } from '@/core/math/Vec2';
import { v3 } from '@/core/math/Vec3';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import type { EditableMesh } from '@/core/mesh/types';
import { unwrapUvAuto } from '@/core/uv/UvOperations';
import type { PrimitiveBuilder } from './types';

export type RampOptions = {
  width: number;
  depth: number;
  height: number;
  name?: string;
};

export function buildRamp(options: RampOptions): EditableMesh {
  const { width, depth, height, name = 'Ramp' } = options;
  const b = new MeshBuilder(name, false);
  const hw = width / 2;
  // Low edge at -Z, high at +Z
  const v0 = b.vertex(v3(-hw, 0, -depth / 2));
  const v1 = b.vertex(v3(hw, 0, -depth / 2));
  const v2 = b.vertex(v3(hw, 0, depth / 2));
  const v3v = b.vertex(v3(-hw, 0, depth / 2));
  const v4 = b.vertex(v3(-hw, height, depth / 2));
  const v5 = b.vertex(v3(hw, height, depth / 2));

  b.quad(v0, v3v, v2, v1); // bottom
  b.quad(v0, v1, v5, v4, [uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)]); // slope
  b.quad(v3v, v4, v5, v2); // back
  b.tri(v0, v4, v3v); // left
  b.tri(v1, v2, v5); // right
  const mesh = b.build();
  if (mesh.defaultUvLayerId) {
    unwrapUvAuto(mesh, [...mesh.faces.keys()], mesh.defaultUvLayerId);
  }
  return mesh;
}

export const RampBuilder: PrimitiveBuilder<RampOptions> = {
  id: 'ramp',
  label: 'Ramp',
  defaultOptions: { width: 1, depth: 2, height: 1, name: 'Ramp' },
  build: buildRamp,
};

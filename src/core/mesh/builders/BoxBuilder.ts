import { v3 } from '@/core/math/Vec3';
import { MeshBuilder, unitQuadUVs } from '@/core/mesh/MeshBuilder';
import type { EditableMesh } from '@/core/mesh/types';
import { unwrapUvBox } from '@/core/uv/UvOperations';
import type { PrimitiveBuilder } from './types';

export type BoxOptions = {
  width: number;
  height: number;
  depth: number;
  name?: string;
  /** If true, origin is box centre; otherwise min corner at origin. */
  centered?: boolean;
};

/**
 * Creates a CAD box: 8 vertices, 12 edges, 6 logical quad faces.
 * Winding is CCW when viewed from outside.
 */
export function buildBox(options: BoxOptions): EditableMesh {
  const { width, height, depth, name = 'Box', centered = true } = options;
  const b = new MeshBuilder(name, true);

  const ox = centered ? -width / 2 : 0;
  const oy = centered ? -height / 2 : 0;
  const oz = centered ? -depth / 2 : 0;

  // Bottom: 0,1,2,3  Top: 4,5,6,7
  //   3----2        7----6
  //   |    |        |    |
  //   0----1        4----5
  const v0 = b.vertex(v3(ox, oy, oz));
  const v1 = b.vertex(v3(ox + width, oy, oz));
  const v2 = b.vertex(v3(ox + width, oy, oz + depth));
  const v3v = b.vertex(v3(ox, oy, oz + depth));
  const v4 = b.vertex(v3(ox, oy + height, oz));
  const v5 = b.vertex(v3(ox + width, oy + height, oz));
  const v6 = b.vertex(v3(ox + width, oy + height, oz + depth));
  const v7 = b.vertex(v3(ox, oy + height, oz + depth));

  const uv = unitQuadUVs();

  // Outward CCW winding (right-hand rule).
  b.quad(v0, v1, v2, v3v, uv); // -Y bottom
  b.quad(v4, v7, v6, v5, uv); // +Y top
  b.quad(v0, v4, v5, v1, uv); // -Z
  b.quad(v3v, v2, v6, v7, uv); // +Z
  b.quad(v0, v3v, v7, v4, uv); // -X
  b.quad(v1, v5, v6, v2, uv); // +X

  const mesh = b.build();
  // Unique Box-UV net so each 3D face maps to its own island (not six stacked unit squares).
  if (mesh.defaultUvLayerId) {
    unwrapUvBox(mesh, [...mesh.faces.keys()], mesh.defaultUvLayerId);
  }
  return mesh;
}

export const BoxBuilder: PrimitiveBuilder<BoxOptions> = {
  id: 'box',
  label: 'Box',
  defaultOptions: { width: 1, height: 1, depth: 1, name: 'Box', centered: true },
  build: buildBox,
};

/** Build a box from two opposite corners (CAD placement). */
export function buildBoxFromCorners(
  min: { x: number; y: number; z: number },
  max: { x: number; y: number; z: number },
  name = 'Box',
): EditableMesh {
  const width = max.x - min.x;
  const height = max.y - min.y;
  const depth = max.z - min.z;
  const mesh = buildBox({
    width: Math.abs(width) || 1e-6,
    height: Math.abs(height) || 1e-6,
    depth: Math.abs(depth) || 1e-6,
    name,
    centered: false,
  });

  // Reposition vertices to actual min corner accounting for sign.
  const sx = width < 0 ? -1 : 1;
  const sy = height < 0 ? -1 : 1;
  const sz = depth < 0 ? -1 : 1;
  const originX = Math.min(min.x, max.x);
  const originY = Math.min(min.y, max.y);
  const originZ = Math.min(min.z, max.z);

  for (const v of mesh.vertices.values()) {
    v.position.x = originX + v.position.x * (sx < 0 ? -1 : 1);
    v.position.y = originY + v.position.y * (sy < 0 ? -1 : 1);
    v.position.z = originZ + v.position.z * (sz < 0 ? -1 : 1);
  }

  // If any axis was negative, winding may flip — rebuild with absolute size instead.
  if (sx < 0 || sy < 0 || sz < 0) {
    return buildBox({
      width: Math.abs(width) || 1e-6,
      height: Math.abs(height) || 1e-6,
      depth: Math.abs(depth) || 1e-6,
      name,
      centered: false,
    });
  }

  return mesh;
}

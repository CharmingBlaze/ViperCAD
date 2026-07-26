import { v2 } from '@/core/math/Vec2';
import { v3 } from '@/core/math/Vec3';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import type { EditableMesh } from '@/core/mesh/types';
import type { PrimitiveBuilder } from './types';

export type SphereOptions = {
  radius: number;
  widthSegments: number;
  heightSegments: number;
  name?: string;
};

export function buildSphere(options: SphereOptions): EditableMesh {
  const { radius, widthSegments, heightSegments, name = 'Sphere' } = options;
  const wSeg = Math.max(3, Math.floor(widthSegments));
  const hSeg = Math.max(2, Math.floor(heightSegments));
  const b = new MeshBuilder(name, true);

  const north = b.vertex(v3(0, radius, 0));
  const south = b.vertex(v3(0, -radius, 0));

  // Rings between poles (exclude poles).
  const rings: string[][] = [];
  for (let y = 1; y < hSeg; y++) {
    const v = y / hSeg;
    const phi = v * Math.PI;
    const row: string[] = [];
    for (let x = 0; x < wSeg; x++) {
      const u = x / wSeg;
      const theta = u * Math.PI * 2;
      row.push(
        b.vertex(
          v3(
            -radius * Math.cos(theta) * Math.sin(phi),
            radius * Math.cos(phi),
            radius * Math.sin(theta) * Math.sin(phi),
          ),
        ),
      );
    }
    rings.push(row);
  }

  // Top cap
  const firstRing = rings[0]!;
  for (let x = 0; x < wSeg; x++) {
    const x1 = (x + 1) % wSeg;
    b.tri(north, firstRing[x]!, firstRing[x1]!, [
      v2((x + 0.5) / wSeg, 0),
      v2(x / wSeg, 1 / hSeg),
      v2(x1 / wSeg, 1 / hSeg),
    ]);
  }

  // Quad belts
  for (let y = 0; y < rings.length - 1; y++) {
    const rowA = rings[y]!;
    const rowB = rings[y + 1]!;
    for (let x = 0; x < wSeg; x++) {
      const x1 = (x + 1) % wSeg;
      const u0 = x / wSeg;
      const u1 = (x + 1) / wSeg;
      const v0 = (y + 1) / hSeg;
      const v1 = (y + 2) / hSeg;
      b.quad(rowA[x]!, rowB[x]!, rowB[x1]!, rowA[x1]!, [
        v2(u0, v0),
        v2(u0, v1),
        v2(u1, v1),
        v2(u1, v0),
      ]);
    }
  }

  // Bottom cap
  const lastRing = rings[rings.length - 1]!;
  for (let x = 0; x < wSeg; x++) {
    const x1 = (x + 1) % wSeg;
    b.tri(south, lastRing[x1]!, lastRing[x]!, [
      v2((x + 0.5) / wSeg, 1),
      v2(x1 / wSeg, (hSeg - 1) / hSeg),
      v2(x / wSeg, (hSeg - 1) / hSeg),
    ]);
  }

  return b.build();
}

export const SphereBuilder: PrimitiveBuilder<SphereOptions> = {
  id: 'sphere',
  label: 'Sphere',
  defaultOptions: { radius: 0.5, widthSegments: 16, heightSegments: 12, name: 'Sphere' },
  build: buildSphere,
};

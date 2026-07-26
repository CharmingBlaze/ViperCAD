import { describe, expect, it } from 'vitest';
import { faceVertexIds } from '@/core/mesh/EditableMesh';
import { computeFaceNormal } from '@/core/mesh/Normals';
import { buildCone } from '@/core/mesh/builders/ConeBuilder';
import { buildCylinder } from '@/core/mesh/builders/CylinderBuilder';
import type { EditableMesh } from '@/core/mesh/types';

describe('round primitive face winding', () => {
  it('points every cone face outward', () => {
    expectOutwardNormals(buildCone({
      radius: 1,
      height: 3,
      radialSegments: 12,
      capped: true,
    }));
  });

  it('points every cylinder face outward', () => {
    expectOutwardNormals(buildCylinder({
      radius: 1,
      height: 3,
      radialSegments: 12,
      capped: true,
    }));
  });
});

function expectOutwardNormals(mesh: EditableMesh): void {
  for (const face of mesh.faces.values()) {
    const ids = faceVertexIds(mesh, face.id);
    const centre = ids.reduce(
      (sum, id) => {
        const point = mesh.vertices.get(id)!.position;
        return {
          x: sum.x + point.x / ids.length,
          y: sum.y + point.y / ids.length,
          z: sum.z + point.z / ids.length,
        };
      },
      { x: 0, y: 0, z: 0 },
    );
    const normal = computeFaceNormal(mesh, face.id);
    expect(
      normal.x * centre.x + normal.y * centre.y + normal.z * centre.z,
      `face ${face.id} should face away from the primitive centre`,
    ).toBeGreaterThan(0);
  }
}

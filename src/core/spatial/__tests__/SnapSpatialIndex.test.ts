import { describe, expect, it } from 'vitest';
import { defaultTransform } from '@/core/math/Transform';
import { v3 } from '@/core/math/Vec3';
import { createEmptyMesh, addVertex } from '@/core/mesh/EditableMesh';
import { buildSnapIndex } from '@/core/spatial/SnapSpatialIndex';

describe('SnapSpatialIndex', () => {
  it('returns only nearby vertices for a sphere query', () => {
    const mesh = createEmptyMesh('Grid');
    for (let x = 0; x < 10; x++) {
      for (let z = 0; z < 10; z++) {
        addVertex(mesh, v3(x, 0, z));
      }
    }
    const index = buildSnapIndex(mesh, defaultTransform(), 1, {
      vertices: true,
      edges: false,
      faceCentres: false,
    });
    const near = index.querySphere(v3(0, 0, 0), 1.1);
    const verts = near.filter((e) => e.kind === 'vertex');
    expect(verts.length).toBeGreaterThan(0);
    expect(verts.length).toBeLessThan(mesh.vertices.size);
  });
});

import { describe, expect, it } from 'vitest';
import { buildPlane } from '@/core/mesh/builders/PlaneBuilder';
import { MeshBvh } from '@/core/spatial/MeshBvh';

describe('MeshBvh refitting', () => {
  it('refits position-only edits while preserving the topology build', () => {
    const mesh = buildPlane({ width: 2, depth: 2 });
    const bvh = new MeshBvh();
    expect(bvh.raycast(mesh, { x: 0, y: 2, z: 0 }, { x: 0, y: -1, z: 0 })?.position.y).toBeCloseTo(0);
    const topologyVersion = bvh.topologyVersion;
    for (const vertex of mesh.vertices.values()) vertex.position.y = 3;
    mesh.geometryVersion += 1;
    expect(bvh.raycast(mesh, { x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 })?.position.y).toBeCloseTo(3);
    expect(bvh.topologyVersion).toBe(topologyVersion);
    expect(bvh.geometryVersion).toBe(mesh.geometryVersion);
  });
});

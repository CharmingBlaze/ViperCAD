import { describe, expect, it } from 'vitest';
import { buildSphere } from '@/core/mesh/builders/SphereBuilder';
import { SculptSpatialIndex } from '@/core/sculpt/SculptSpatialIndex';

describe('SculptSpatialIndex', () => {
  it('accurately finds vertices within sphere radius', () => {
    const mesh = buildSphere({ radius: 1, widthSegments: 32, heightSegments: 24 });
    const index = new SculptSpatialIndex(0.15);
    index.build(mesh);

    const center = { x: 0, y: 1, z: 0 };
    const radius = 0.4;

    const spatialResults = index.querySphere(mesh, center, radius);

    // Compare with ground-truth brute-force distance check
    const bruteForceIds = new Set<string>();
    for (const [id, vertex] of mesh.vertices) {
      const dist = Math.hypot(
        vertex.position.x - center.x,
        vertex.position.y - center.y,
        vertex.position.z - center.z,
      );
      if (dist <= radius) bruteForceIds.add(id);
    }

    expect(spatialResults.length).toBe(bruteForceIds.size);
    for (const item of spatialResults) {
      expect(bruteForceIds.has(item.id)).toBe(true);
      expect(item.distance).toBeLessThanOrEqual(radius + 1e-5);
    }
  });
});

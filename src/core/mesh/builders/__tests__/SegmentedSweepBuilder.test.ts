import { describe, expect, it } from 'vitest';
import { v3 } from '@/core/math/Vec3';
import { faceVertexIds } from '@/core/mesh/EditableMesh';
import { validateMeshFull } from '@/core/mesh/Validation';
import { buildSegmentedCapsuleSweep } from '@/core/mesh/builders/SegmentedSweepBuilder';

describe('SegmentedSweepBuilder', () => {
  it('builds equal capsule sections along an open path', () => {
    const mesh = buildSegmentedCapsuleSweep({
      points: [v3(0, 0, 0), v3(2, 0.2, 0), v3(4, 0, 0), v3(6, -0.1, 0.1)],
      radius: 0.15,
      radialSegments: 10,
      segmentCount: 4,
    });
    expect(mesh.vertices.size).toBeGreaterThan(40);
    expect(mesh.vertices.size).toBeLessThan(420);
    expect(validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('passes end caps through to the overall sweep', () => {
    const mesh = buildSegmentedCapsuleSweep({
      points: [v3(0, 0, 0), v3(2, 0.2, 0), v3(4, 0, 0), v3(6, -0.1, 0.1)],
      radius: 0.15,
      radialSegments: 10,
      segmentCount: 4,
      startCapStyle: 'flat',
      endCapStyle: 'open',
    });
    const ngonFaces = [...mesh.faces.values()].filter(
      (face) => faceVertexIds(mesh, face.id).length > 4,
    );
    expect(ngonFaces.length).toBe(1);
    expect(validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });
});

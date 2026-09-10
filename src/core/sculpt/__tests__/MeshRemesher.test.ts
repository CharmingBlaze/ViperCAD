import { describe, expect, it } from 'vitest';
import { buildSphere } from '@/core/mesh/builders/SphereBuilder';
import { remeshUniform } from '@/core/sculpt/MeshRemesher';
import { decimateMesh } from '@/core/sculpt/MeshDecimate';
import { validateMeshFull } from '@/core/mesh/Validation';

describe('MeshRemesher and Decimate', () => {
  it('remeshes mesh to uniform triangle surface', () => {
    const mesh = buildSphere({ radius: 1, widthSegments: 16, heightSegments: 12 });
    const initialFaces = mesh.faces.size;

    const ok = remeshUniform(mesh, { targetLength: 0.2, iterations: 2 });
    expect(ok).toBe(true);
    expect(mesh.faces.size).toBeGreaterThan(initialFaces);
    expect(validateMeshFull(mesh).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('decimates mesh faces down to target ratio', () => {
    const mesh = buildSphere({ radius: 1, widthSegments: 20, heightSegments: 16 });
    const initialFaces = mesh.faces.size;

    const ok = decimateMesh(mesh, { ratio: 0.5 });
    expect(ok).toBe(true);
    expect(mesh.faces.size).toBeLessThan(initialFaces);
    expect(mesh.faces.size).toBeGreaterThan(10);
    expect(validateMeshFull(mesh).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

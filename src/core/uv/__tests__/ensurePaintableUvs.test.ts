import { describe, expect, it } from 'vitest';
import { addVertex, createEmptyMesh, faceCornerIds } from '@/core/mesh/EditableMesh';
import { makeFaceFromVertices } from '@/core/mesh/ops/draw';
import { v3 } from '@/core/math/Vec3';
import { ensurePaintableUvs } from '@/core/uv/EnsurePaintableUvs';
import { analyseUvs } from '@/core/uv/UvDiagnostics';

describe('ensurePaintableUvs', () => {
  it('automatically gives a newly drawn mesh a non-degenerate paint layout', () => {
    const mesh = createEmptyMesh('Draw');
    const a = addVertex(mesh, v3(0, 0, 0));
    const b = addVertex(mesh, v3(2, 0, 0));
    const c = addVertex(mesh, v3(2, 0, 1));
    const d = addVertex(mesh, v3(0, 0, 1));
    const face = makeFaceFromVertices(mesh, [a, b, c, d]);
    expect(face.ok).toBe(true);

    const before = analyseUvs(mesh, mesh.defaultUvLayerId!, 256, 256);
    expect(before.degenerateFaces).toBe(1);

    const result = ensurePaintableUvs(mesh);
    expect(result.mode).toBe('auto-unwrapped');
    expect(result.changed).toBe(true);
    const after = analyseUvs(mesh, mesh.defaultUvLayerId!, 256, 256);
    expect(after.degenerateFaces).toBe(0);

    const uvs = faceCornerIds(mesh, face.value!.faceId).map(
      (cornerId) => mesh.faceCorners.get(cornerId)!.uvs.get(mesh.defaultUvLayerId!)!,
    );
    expect(new Set(uvs.map((uv) => `${uv.x.toFixed(4)},${uv.y.toFixed(4)}`)).size).toBe(4);
  });

  it('does nothing when the mapping is already paintable', () => {
    const mesh = createEmptyMesh('Draw');
    const a = addVertex(mesh, v3(0, 0, 0));
    const b = addVertex(mesh, v3(1, 0, 0));
    const c = addVertex(mesh, v3(0, 0, 1));
    makeFaceFromVertices(mesh, [a, b, c]);
    ensurePaintableUvs(mesh);
    const version = mesh.geometryVersion;

    expect(ensurePaintableUvs(mesh)).toEqual({
      changed: false,
      repairedFaceIds: [],
      mode: 'none',
    });
    expect(mesh.geometryVersion).toBe(version);
  });
});

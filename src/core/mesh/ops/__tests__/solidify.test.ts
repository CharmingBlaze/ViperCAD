import { beforeEach, describe, expect, it } from 'vitest';
import { resetIdCounter } from '@/core/ids/IdService';
import { buildBox, buildPlane } from '@/core/mesh/builders';
import { getMeshStats } from '@/core/mesh/EditableMesh';
import { solidifyMesh } from '@/core/mesh/ops/solidify';
import { validateMeshFull } from '@/core/mesh/Validation';

beforeEach(() => resetIdCounter(1));

describe('solidifyMesh', () => {
  it('turns an open plane into a watertight shell with rim', () => {
    const mesh = buildPlane({ width: 2, depth: 2 });
    expect(getMeshStats(mesh).boundaryEdges).toBe(4);
    const result = solidifyMesh(mesh, { thickness: 0.25 });
    expect(result.ok).toBe(true);
    // 1 outer + 1 inner + 4 rim
    expect(mesh.faces.size).toBe(6);
    expect(validateMeshFull(mesh).ok).toBe(true);
    expect(getMeshStats(mesh).boundaryEdges).toBe(0);
  });

  it('doubles a closed box without introducing boundaries', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const before = mesh.faces.size;
    const result = solidifyMesh(mesh, { thickness: 0.1 });
    expect(result.ok).toBe(true);
    expect(mesh.faces.size).toBe(before * 2);
    expect(validateMeshFull(mesh).ok).toBe(true);
    expect(getMeshStats(mesh).boundaryEdges).toBe(0);
  });

  it('rejects zero thickness', () => {
    const mesh = buildPlane({ width: 1, depth: 1 });
    const result = solidifyMesh(mesh, { thickness: 0 });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INVALID_THICKNESS');
  });
});

import { describe, expect, it } from 'vitest';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { markUvSeamsByAngle, clearAllUvSeams, unwrapUvSmart, detectUvIslands, islandForFace } from '@/core/uv/UvOperations';

describe('UvSmartUnwrap', () => {
  it('automatically marks seams on sharp 90-degree box edges', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const count = markUvSeamsByAngle(mesh, 45);

    // Box has 12 edges at 90-degree angles
    expect(count).toBeGreaterThan(0);

    // Islands should be separated along sharp seams
    const islands = detectUvIslands(mesh);
    expect(islands.length).toBeGreaterThan(1);
  });

  it('clears all seams from mesh', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    markUvSeamsByAngle(mesh, 45);
    clearAllUvSeams(mesh);

    const seamCount = [...mesh.edges.values()].filter((e) => e.seam).length;
    expect(seamCount).toBe(0);
  });

  it('executes smart conformal unwrap and packs islands', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const faceIds = [...mesh.faces.keys()];

    unwrapUvSmart(mesh, faceIds);

    expect(mesh.geometryVersion).toBeGreaterThan(1);

    // Check that corners have valid non-NaN UV coordinates within 0..1
    const layerId = mesh.defaultUvLayerId!;
    for (const corner of mesh.faceCorners.values()) {
      const uv = corner.uvs.get(layerId);
      expect(uv).toBeDefined();
      expect(Number.isNaN(uv!.x)).toBe(false);
      expect(Number.isNaN(uv!.y)).toBe(false);
      expect(uv!.x).toBeGreaterThanOrEqual(0);
      expect(uv!.x).toBeLessThanOrEqual(1.05);
    }
  });

  it('reuses island lookup until topology or seams change', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const faceId = [...mesh.faces.keys()][0]!;
    const first = islandForFace(mesh, faceId);
    const again = islandForFace(mesh, faceId);
    expect(first).toBe(again);
    expect(first?.faceIds.length).toBeGreaterThan(1);

    mesh.geometryVersion += 1;
    expect(islandForFace(mesh, faceId)).toBe(first);

    markUvSeamsByAngle(mesh, 45);
    const afterSeams = islandForFace(mesh, faceId);
    expect(afterSeams).not.toBe(first);
    expect(afterSeams?.faceIds).toContain(faceId);
  });
});

import { describe, expect, it } from 'vitest';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { faceCornerIds } from '@/core/mesh/EditableMesh';
import { packUvsAsync } from '@/core/uv/workers/UvPackingWorkerClient';

describe('UV packing worker client', () => {
  it('uses the deterministic fallback when workers are unavailable', async () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    const faceIds = [...mesh.faces.keys()];
    const beforeVersion = mesh.geometryVersion;
    await packUvsAsync(mesh, faceIds, 0.02, layerId);
    expect(mesh.geometryVersion).toBe(beforeVersion + 1);
    for (const faceId of faceIds) {
      for (const cornerId of faceCornerIds(mesh, faceId)) {
        const uv = mesh.faceCorners.get(cornerId)!.uvs.get(layerId)!;
        expect(uv.x).toBeGreaterThanOrEqual(0);
        expect(uv.x).toBeLessThanOrEqual(1);
        expect(uv.y).toBeGreaterThanOrEqual(0);
        expect(uv.y).toBeLessThanOrEqual(1);
      }
    }
  });
});

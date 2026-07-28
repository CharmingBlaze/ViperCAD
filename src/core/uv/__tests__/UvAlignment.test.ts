import { describe, expect, it } from 'vitest';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { alignUvs, distributeUvs, snapUvsToPixelGrid, getCornerUv } from '@/core/uv/UvEdit';

describe('UvAlignment', () => {
  it('aligns UV corners to left boundary', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    const cornerIds = [...mesh.faceCorners.keys()].slice(0, 4);

    // Set initial custom UVs
    let i = 0;
    for (const id of cornerIds) {
      mesh.faceCorners.get(id)!.uvs.set(layerId, { x: 0.1 * (i + 1), y: 0.5 });
      i += 1;
    }

    alignUvs(mesh, cornerIds, layerId, 'left');

    for (const id of cornerIds) {
      const uv = getCornerUv(mesh, id, layerId);
      expect(uv.x).toBeCloseTo(0.1);
    }
  });

  it('distributes UV corners evenly', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    const cornerIds = [...mesh.faceCorners.keys()].slice(0, 3);

    mesh.faceCorners.get(cornerIds[0]!)!.uvs.set(layerId, { x: 0, y: 0 });
    mesh.faceCorners.get(cornerIds[1]!)!.uvs.set(layerId, { x: 0.3, y: 0 });
    mesh.faceCorners.get(cornerIds[2]!)!.uvs.set(layerId, { x: 1.0, y: 0 });

    distributeUvs(mesh, cornerIds, layerId, 'u');

    expect(getCornerUv(mesh, cornerIds[0]!, layerId).x).toBeCloseTo(0);
    expect(getCornerUv(mesh, cornerIds[1]!, layerId).x).toBeCloseTo(0.5);
    expect(getCornerUv(mesh, cornerIds[2]!, layerId).x).toBeCloseTo(1.0);
  });

  it('snaps UV corners to pixel grid', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    const cornerId = [...mesh.faceCorners.keys()][0]!;

    mesh.faceCorners.get(cornerId)!.uvs.set(layerId, { x: 0.1234, y: 0.5678 });

    // 16x16 texture resolution
    snapUvsToPixelGrid(mesh, [cornerId], layerId, 16, 16);

    const uv = getCornerUv(mesh, cornerId, layerId);
    expect(uv.x).toBeCloseTo(2 / 16); // 0.125
    expect(uv.y).toBeCloseTo(9 / 16); // 0.5625
  });
});

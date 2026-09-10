import { describe, expect, it } from 'vitest';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { CommandHistory } from '@/core/history/CommandHistory';
import {
  alignUvs,
  boundsOfUvs,
  commitUvEdit,
  distributeUvs,
  getCornerUv,
  snapUvsToPixelGrid,
  snapshotUvs,
  translateUvsToAlign,
} from '@/core/uv/UvEdit';

describe('UvAlignment', () => {
  it('translates the selection bbox to the left of 0–1 without collapsing width', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    const cornerIds = [...mesh.faceCorners.keys()].slice(0, 4);
    mesh.faceCorners.get(cornerIds[0]!)!.uvs.set(layerId, { x: 0.2, y: 0.2 });
    mesh.faceCorners.get(cornerIds[1]!)!.uvs.set(layerId, { x: 0.5, y: 0.2 });
    mesh.faceCorners.get(cornerIds[2]!)!.uvs.set(layerId, { x: 0.5, y: 0.4 });
    mesh.faceCorners.get(cornerIds[3]!)!.uvs.set(layerId, { x: 0.2, y: 0.4 });

    const before = snapshotUvs(mesh, cornerIds, layerId);
    const beforeBounds = boundsOfUvs(before)!;
    translateUvsToAlign(mesh, cornerIds, layerId, 'left');
    const after = snapshotUvs(mesh, cornerIds, layerId);
    const afterBounds = boundsOfUvs(after)!;

    expect(afterBounds.min.x).toBeCloseTo(0);
    expect(afterBounds.size.x).toBeCloseTo(beforeBounds.size.x);
    expect(afterBounds.size.y).toBeCloseTo(beforeBounds.size.y);
    expect(afterBounds.min.y).toBeCloseTo(beforeBounds.min.y);
  });

  it('undoes translate align through commitUvEdit', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    const cornerIds = [...mesh.faceCorners.keys()].slice(0, 4);
    for (const id of cornerIds) {
      mesh.faceCorners.get(id)!.uvs.set(layerId, { x: 0.3, y: 0.3 });
    }
    const before = snapshotUvs(mesh, cornerIds, layerId);
    translateUvsToAlign(mesh, cornerIds, layerId, 'right');
    const after = snapshotUvs(mesh, cornerIds, layerId);
    const history = new CommandHistory();
    commitUvEdit(history, mesh, layerId, before, after, 'Align UVs (right)');
    history.undo();
    expect(getCornerUv(mesh, cornerIds[0]!, layerId).x).toBeCloseTo(0.3);
  });

  it('flattens UV corners to the left selection boundary', () => {
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

import { beforeEach, describe, expect, it } from 'vitest';
import { resetIdCounter } from '@/core/ids/IdService';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { faceCornerIds } from '@/core/mesh/EditableMesh';
import { applyAtlasTileToFaces, buildAtlasTileGrid } from '@/core/uv/AtlasUv';
import { getMeshStats } from '@/core/mesh/EditableMesh';
import { validateMeshFull } from '@/core/mesh/Validation';
import { createDefaultMaterial } from '@/core/document/ModelDocument';
import { materialAssetToThree } from '@/renderer/MeshRenderAdapter';
import { MeshBasicMaterial, MeshStandardMaterial } from 'three';

beforeEach(() => resetIdCounter(1));

describe('sprite atlas UV placement', () => {
  it('maps only selected faces into a pixel-inset tile', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    const [selectedFace, untouchedFace] = [...mesh.faces.keys()];
    const untouchedBefore = faceCornerIds(mesh, untouchedFace!).map((id) => ({
      ...mesh.faceCorners.get(id)!.uvs.get(layerId)!,
    }));

    applyAtlasTileToFaces(mesh, [selectedFace!], layerId, {
      imageWidth: 64,
      imageHeight: 64,
      x: 16,
      y: 32,
      width: 16,
      height: 16,
      padding: 0.5,
    });

    const selectedUvs = faceCornerIds(mesh, selectedFace!).map((id) => mesh.faceCorners.get(id)!.uvs.get(layerId)!);
    expect(Math.min(...selectedUvs.map((uv) => uv.x))).toBeCloseTo(16.5 / 64);
    expect(Math.max(...selectedUvs.map((uv) => uv.x))).toBeCloseTo(31.5 / 64);
    expect(Math.min(...selectedUvs.map((uv) => uv.y))).toBeCloseTo(16.5 / 64);
    expect(Math.max(...selectedUvs.map((uv) => uv.y))).toBeCloseTo(31.5 / 64);
    const untouchedAfter = faceCornerIds(mesh, untouchedFace!).map((id) => mesh.faceCorners.get(id)!.uvs.get(layerId)!);
    expect(untouchedAfter).toEqual(untouchedBefore);
  });

  it('supports quarter-turn rotation and flipping inside the same tile bounds', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    const faceId = [...mesh.faces.keys()][0]!;
    applyAtlasTileToFaces(mesh, [faceId], layerId, {
      imageWidth: 32,
      imageHeight: 16,
      x: 8,
      y: 0,
      width: 8,
      height: 8,
      quarterTurns: 1,
      flipU: true,
    });
    const uvs = faceCornerIds(mesh, faceId).map((id) => mesh.faceCorners.get(id)!.uvs.get(layerId)!);
    expect(uvs.every((uv) => uv.x >= 0.25 && uv.x <= 0.5)).toBe(true);
    expect(uvs.every((uv) => uv.y >= 0.5 && uv.y <= 1)).toBe(true);
  });

  it('builds auto-joined floor grids and cycles a multi-tile stamp', () => {
    const mesh = buildAtlasTileGrid({
      columns: 3,
      rows: 2,
      cellSize: 1,
      orientation: 'floor',
      imageWidth: 64,
      imageHeight: 32,
      tileX: 0,
      tileY: 0,
      tileWidth: 16,
      tileHeight: 16,
      selectionColumns: 2,
      selectionRows: 1,
    });
    const stats = getMeshStats(mesh);
    expect(stats.verts).toBe(12);
    expect(stats.faces).toBe(6);
    expect(stats.edges).toBe(17);
    expect(stats.boundaryEdges).toBe(10);
    expect(validateMeshFull(mesh).issues.some((issue) => issue.severity === 'error')).toBe(false);

    const faces = [...mesh.faces.keys()];
    const minU = (faceId: string) => Math.min(...faceCornerIds(mesh, faceId).map((id) => mesh.faceCorners.get(id)!.uvs.get(mesh.defaultUvLayerId!)!.x));
    expect(minU(faces[0]!)).toBeCloseTo(0);
    expect(minU(faces[1]!)).toBeCloseTo(0.25);
    expect(minU(faces[2]!)).toBeCloseTo(0);
  });

  it('creates deterministic random tile variation from a seed', () => {
    const options = {
      columns: 6,
      rows: 2,
      cellSize: 1,
      orientation: 'wall-x' as const,
      imageWidth: 64,
      imageHeight: 64,
      tileX: 0,
      tileY: 0,
      tileWidth: 16,
      tileHeight: 16,
      selectionColumns: 2,
      selectionRows: 2,
      pattern: 'random' as const,
      randomSeed: 42,
    };
    const first = buildAtlasTileGrid(options);
    const second = buildAtlasTileGrid(options);
    const signature = (mesh: typeof first) => [...mesh.faces.keys()].map((faceId) => {
      const uvs = faceCornerIds(mesh, faceId).map((id) => mesh.faceCorners.get(id)!.uvs.get(mesh.defaultUvLayerId!)!);
      return `${Math.min(...uvs.map((uv) => uv.x))},${Math.min(...uvs.map((uv) => uv.y))}`;
    });
    expect(signature(first)).toEqual(signature(second));
    expect(new Set(signature(first)).size).toBeGreaterThan(1);
  });

  it('renders pixel-art unlit materials with a genuinely shadeless shader', () => {
    const material = createDefaultMaterial();
    expect(materialAssetToThree(material)).toBeInstanceOf(MeshStandardMaterial);
    material.shadingModel = 'unlit';
    material.unlit = true;
    expect(materialAssetToThree(material)).toBeInstanceOf(MeshBasicMaterial);
  });

  it('supports rectangular cells for pixels-per-unit geometry', () => {
    const mesh = buildAtlasTileGrid({
      columns: 2,
      rows: 3,
      cellSize: 1,
      cellWidth: 2,
      cellHeight: 0.5,
      orientation: 'wall-x',
      imageWidth: 32,
      imageHeight: 32,
      tileX: 0,
      tileY: 0,
      tileWidth: 16,
      tileHeight: 8,
    });
    const xs = [...mesh.vertices.values()].map((vertex) => vertex.position.x);
    const ys = [...mesh.vertices.values()].map((vertex) => vertex.position.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(1.5);
  });

  it('repeats one atlas tile across a quad with expanded UVs and wrap metadata', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    const faceId = [...mesh.faces.keys()][0]!;
    const beforeFaces = mesh.faces.size;

    const created = applyAtlasTileToFaces(mesh, [faceId], layerId, {
      imageWidth: 64,
      imageHeight: 64,
      x: 16,
      y: 16,
      width: 16,
      height: 16,
      repeatU: 3,
      repeatV: 2,
    });

    expect(created).toEqual([faceId]);
    expect(mesh.faces.size).toBe(beforeFaces);
    const uvs = faceCornerIds(mesh, faceId).map((cornerId) => mesh.faceCorners.get(cornerId)!.uvs.get(layerId)!);
    expect(Math.min(...uvs.map((uv) => uv.x))).toBeCloseTo(16 / 64);
    expect(Math.max(...uvs.map((uv) => uv.x))).toBeCloseTo(16 / 64 + 3 * (16 / 64));
    expect(Math.min(...uvs.map((uv) => uv.y))).toBeCloseTo(32 / 64);
    expect(Math.max(...uvs.map((uv) => uv.y))).toBeCloseTo(32 / 64 + 2 * (16 / 64));
    const tile = mesh.faceCorners.get(faceCornerIds(mesh, faceId)[0]!)!.atlasTile;
    expect(tile).toEqual({
      minU: 16 / 64,
      minV: 32 / 64,
      maxU: 32 / 64,
      maxV: 48 / 64,
    });
  });
});

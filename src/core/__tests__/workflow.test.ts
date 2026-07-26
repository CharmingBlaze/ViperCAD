import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@/core/document/ModelDocument';
import { createImageAsset, createTextureAsset, floodFill, getPixel, setPixel } from '@/core/image/PixelEditor';
import { resetIdCounter } from '@/core/ids/IdService';
import { exportObj, importObj } from '@/core/io/ObjAdapter';
import { faceCornerIds, faceVertexIds } from '@/core/mesh/EditableMesh';
import { buildBox, buildPlane } from '@/core/mesh/builders';
import { insetFaces } from '@/core/mesh/ops/inset';
import { splitEdge } from '@/core/mesh/ops/basic';
import { knifeFace, loopCut } from '@/core/mesh/ops/cut';
import { validateMeshFull } from '@/core/mesh/Validation';
import { deserializeProject, serializeProject } from '@/core/persistence/ProjectSerializer';
import { commitMeshObject } from '@/core/document/ModelDocument';
import { detectUvIslands, markUvSeams, packUvIslands } from '@/core/uv/UvOperations';
import { MeshBvh } from '@/core/spatial/MeshBvh';

beforeEach(() => resetIdCounter(1));

describe('complete workflow contracts', () => {
  it('splits a shared edge without losing manifold topology or UVs', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const result = splitEdge(mesh, [...mesh.edges.keys()][0]!, 0.25);
    expect(result.ok).toBe(true);
    expect(mesh.vertices.size).toBe(9);
    expect(validateMeshFull(mesh).ok).toBe(true);
    for (const corner of mesh.faceCorners.values()) expect(corner.uvs.get(mesh.defaultUvLayerId!)).toBeDefined();
  });

  it('insets a face as one inner polygon plus a connected ring', () => {
    const mesh = buildPlane({ width: 2, depth: 2 });
    const face = [...mesh.faces.keys()][0]!;
    const result = insetFaces(mesh, [face], { thickness: 0.25 });
    expect(result.ok).toBe(true);
    expect(mesh.faces.size).toBe(5);
    expect(mesh.vertices.size).toBe(8);
    expect(validateMeshFull(mesh).ok).toBe(true);
  });

  it('knifes a quad between opposing edges with shared cut topology', () => {
    const mesh = buildPlane({ width: 2, depth: 2 }); const faceId = [...mesh.faces.keys()][0]!; const edges = [...mesh.edges.keys()];
    const result = knifeFace(mesh, faceId, edges[0]!, edges[2]!);
    expect(result.ok).toBe(true); expect(mesh.faces.size).toBe(2); expect(mesh.vertices.size).toBe(6); expect(validateMeshFull(mesh).ok).toBe(true);
  });

  it('loop-cuts a quad through its opposing boundary edges', () => {
    const mesh = buildPlane({ width: 2, depth: 2 }); const result = loopCut(mesh, [...mesh.edges.keys()][0]!);
    expect(result.ok).toBe(true); expect(mesh.faces.size).toBe(2); expect(validateMeshFull(mesh).ok).toBe(true);
  });

  it('round-trips logical quads and per-corner UVs through OBJ', () => {
    const original = buildBox({ width: 2, height: 3, depth: 4 });
    const imported = importObj(exportObj(original));
    expect(imported.vertices.size).toBe(8);
    expect(imported.faces.size).toBe(6);
    expect([...imported.faces.values()].every((f) => faceVertexIds(imported, f.id).length === 4)).toBe(true);
    expect(faceCornerIds(imported, [...imported.faces.keys()][0]!).length).toBe(4);
    expect(validateMeshFull(imported).ok).toBe(true);
  });

  it('serializes editable topology and image bytes with integrity checking', () => {
    const doc = createEmptyDocument('Round trip');
    commitMeshObject(doc, buildBox({ width: 1, height: 1, depth: 1 }));
    const image = createImageAsset(doc, 'Pixels', 2, 2, [1, 2, 3, 255]);
    createTextureAsset(doc, image);
    setPixel(image, 1, 1, [255, 0, 0, 255]);
    const loaded = deserializeProject(serializeProject(doc, 'test'));
    expect(loaded.meshes.size).toBe(1);
    expect(loaded.images.get(image.id)!.pixels).toEqual(image.pixels);
  });

  it('derives seam-separated UV islands and packs them', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    expect(detectUvIslands(mesh)).toHaveLength(1);
    markUvSeams(mesh, [...mesh.edges.keys()]);
    expect(packUvIslands(mesh, 0.01)).toHaveLength(6);
  });

  it('supports exact pixel editing with revision updates', () => {
    const doc = createEmptyDocument(); const image = createImageAsset(doc, 'Sprite', 4, 4, [0, 0, 0, 255]);
    setPixel(image, 1, 1, [255, 0, 0, 255]);
    expect(getPixel(image, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(floodFill(image, 0, 0, [0, 0, 255, 255])).toBe(15);
    expect(image.revision).toBe(2);
  });

  it('maps BVH triangle hits back to logical faces', () => {
    const mesh = buildBox({ width: 2, height: 2, depth: 2 }); const bvh = new MeshBvh();
    const hit = bvh.raycast(mesh, { x: 0, y: 4, z: 0 }, { x: 0, y: -1, z: 0 });
    expect(hit).not.toBeNull(); expect(mesh.faces.has(hit!.faceId)).toBe(true); expect(hit!.distance).toBeCloseTo(3);
  });
});

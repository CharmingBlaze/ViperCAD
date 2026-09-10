import { describe, expect, it } from 'vitest';
import { createEmptyDocument, createDefaultMaterial } from '@/core/document/ModelDocument';
import { DEFAULT_PLACEHOLDER_IMAGE_NAME } from '@/core/image/DefaultPlaceholderImage';
import { faceCornerIds } from '@/core/mesh/EditableMesh';
import { buildPlane } from '@/core/mesh/builders/PlaneBuilder';
import { createTerrain } from '@/core/terrain/Terrain';
import { EditorSession } from '@/core/editor/EditorSession';
import {
  createObjectRenderHandle,
  disposeOwnedTexture,
  materialAssetToThree,
  updateObjectRenderHandle,
} from '@/renderer/MeshRenderAdapter';
import { evaluateMeshAsync } from '@/renderer/workers/MeshEvaluationWorkerClient';
import { ClampToEdgeWrapping, DataTexture, LinearFilter, type BufferAttribute } from 'three';

describe('MeshRenderAdapter live updates', () => {
  it('updates the Three.js UV buffer when editable UV coordinates change', () => {
    const mesh = buildPlane({ width: 1, depth: 1 });
    const material = createDefaultMaterial();
    const handle = createObjectRenderHandle('object', mesh, [material]);
    const faceId = [...mesh.faces.keys()][0]!;
    const cornerId = faceCornerIds(mesh, faceId)[0]!;
    const renderIndex = handle.renderData.renderCornerIds.indexOf(cornerId);
    expect(renderIndex).toBeGreaterThanOrEqual(0);

    const layerId = mesh.defaultUvLayerId!;
    mesh.faceCorners.get(cornerId)!.uvs.set(layerId, { x: 0.37, y: 0.61 });
    mesh.geometryVersion += 1;
    mesh.dirty.uvs = true;
    updateObjectRenderHandle(handle, mesh, [material]);

    const uv = handle.mesh.geometry.getAttribute('uv') as BufferAttribute;
    expect(uv.getX(renderIndex)).toBeCloseTo(0.37);
    expect(uv.getY(renderIndex)).toBeCloseTo(0.61);
    expect(uv.updateRanges).toEqual([{ start: renderIndex * 2, count: 2 }]);
  });

  it('uploads only the changed position span when topology is stable', () => {
    const mesh = buildPlane({ width: 1, depth: 1 });
    const material = createDefaultMaterial();
    const handle = createObjectRenderHandle('object', mesh, [material]);
    const vertexId = [...mesh.vertices.keys()][0]!;
    const renderIndices = handle.renderData.renderVertexIds
      .map((id, index) => id === vertexId ? index : -1)
      .filter((index) => index >= 0);
    mesh.vertices.get(vertexId)!.position.y = 2;
    mesh.geometryVersion += 1;
    updateObjectRenderHandle(handle, mesh, [material]);
    const position = handle.mesh.geometry.getAttribute('position') as BufferAttribute;
    const range = position.updateRanges[0]!;
    expect(range.start).toBe(Math.min(...renderIndices) * 3);
    expect(range.start + range.count).toBe(Math.max(...renderIndices) * 3 + 3);
  });

  it('uploads default placeholder pixels as Uint8Array so WebGL can sample them', () => {
    const doc = createEmptyDocument();
    const material = [...doc.materials.values()][0]!;
    const image = [...doc.images.values()][0]!;
    expect(image.name).toBe(DEFAULT_PLACEHOLDER_IMAGE_NAME);
    const three = materialAssetToThree(material, {
      textures: doc.textures,
      images: doc.images,
    });
    expect(three.color.b).toBeGreaterThan(three.color.g);
    expect(three.map).toBeInstanceOf(DataTexture);
    const data = (three.map as DataTexture).image.data;
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data).not.toBeInstanceOf(Uint8ClampedArray);
    expect(data![3]).toBe(255);
    expect(three.toneMapped).toBe(false);
  });

  it('uploads painted placeholder pixels instead of the shared clay PNG', () => {
    const doc = createEmptyDocument();
    const material = [...doc.materials.values()][0]!;
    const image = [...doc.images.values()][0]!;
    image.width = 2;
    image.height = 2;
    image.pixels = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]);
    image.revision += 1;
    image.userEdited = true;
    const three = materialAssetToThree(material, {
      textures: doc.textures,
      images: doc.images,
    });
    expect(three.map).toBeInstanceOf(DataTexture);
    const data = (three.map as DataTexture).image.data;
    expect(data![0]).toBe(255);
    expect(data![1]).toBe(0);
    expect(data![2]).toBe(0);
  });

  it('avoids WebGL1-incomplete settings on non-power-of-two maps', () => {
    const doc = createEmptyDocument();
    const material = [...doc.materials.values()][0]!;
    material.presetId = 'custom-paint';
    const image = [...doc.images.values()][0]!;
    image.name = 'Paint';
    image.width = 3;
    image.height = 3;
    image.pixels = new Uint8ClampedArray(3 * 3 * 4).fill(180);
    const three = materialAssetToThree(material, {
      textures: doc.textures,
      images: doc.images,
    });
    expect(three.map).toBeInstanceOf(DataTexture);
    const map = three.map as DataTexture;
    expect(map.generateMipmaps).toBe(false);
    expect(map.wrapS).toBe(ClampToEdgeWrapping);
    expect(map.minFilter).toBe(LinearFilter);
  });

  it('does not dispose the shared viewport placeholder texture', () => {
    const texture = new DataTexture(new Uint8Array([10, 20, 30, 255]), 1, 1);
    texture.userData.viperSharedPlaceholder = true;
    disposeOwnedTexture(texture);
    expect(texture.image.data![0]).toBe(10);
  });

  it('builds a color attribute and splat material for terrain layers', () => {
    const session = new EditorSession();
    const terrain = createTerrain(session, { size: 8, resolution: 2 });
    const object = session.document.objects.get(terrain.objectId)!;
    const mesh = session.document.meshes.get(terrain.meshId)!;
    const material = session.document.materials.get(object.materialSlotIds[0]!)!;
    const handle = createObjectRenderHandle(object.id, mesh, [material], {
      textures: session.document.textures,
      images: session.document.images,
    });
    const color = handle.mesh.geometry.getAttribute('color') as BufferAttribute;
    expect(color).toBeTruthy();
    expect(color.getX(0)).toBeCloseTo(1);
    expect(color.getY(0)).toBeCloseTo(0);
    expect((handle.materials[0] as { vertexColors?: boolean }).vertexColors).toBe(true);
    expect(handle.materials[0]!.userData.terrainSplat).toBeTruthy();
  });

  it('evaluates transferable mesh buffers through the worker fallback', async () => {
    const mesh = buildPlane({ width: 2, depth: 3 });
    const result = await evaluateMeshAsync(mesh);
    expect(result.positions).toBeInstanceOf(Float32Array);
    expect(result.indices).toBeInstanceOf(Uint32Array);
    expect(result.triangleMap).toHaveLength(2);
    expect(result.topologyVersion).toBe(mesh.topologyVersion);
  });
});

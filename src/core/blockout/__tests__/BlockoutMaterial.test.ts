import { describe, expect, it } from 'vitest';
import { commitMeshObject, createEmptyDocument } from '@/core/document/ModelDocument';
import { DEFAULT_PLACEHOLDER_IMAGE_NAME } from '@/core/image/DefaultPlaceholderImage';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { getObjectOrigin, getObjectWorldBounds } from '@/core/editor/OriginTools';
import { applyDefaultBlockoutLook, ensureBlockoutMaterial } from '../BlockoutMaterial';

describe('BlockoutMaterial', () => {
  it('reuses the default placeholder material', () => {
    const doc = createEmptyDocument();
    const first = ensureBlockoutMaterial(doc);
    const second = ensureBlockoutMaterial(doc);
    expect(first).toBe(second);
    const material = doc.materials.get(first)!;
    expect(material.baseColourTextureId).toBeTruthy();
    const texture = doc.textures.get(material.baseColourTextureId!)!;
    expect(doc.images.get(texture.imageAssetId)?.name).toBe(DEFAULT_PLACEHOLDER_IMAGE_NAME);
  });

  it('assigns the default texture and centres the origin', () => {
    const doc = createEmptyDocument();
    const { objectId, meshId } = commitMeshObject(
      doc,
      buildBox({ width: 2, height: 2, depth: 2, centered: false }),
    );
    const object = doc.objects.get(objectId)!;
    object.transform.position.x = 4;

    applyDefaultBlockoutLook(doc, objectId);

    const material = doc.materials.get(object.materialSlotIds[0]!)!;
    expect(material.baseColourTextureId).toBeTruthy();
    const texture = doc.textures.get(material.baseColourTextureId!)!;
    expect(doc.images.get(texture.imageAssetId)?.name).toBe(DEFAULT_PLACEHOLDER_IMAGE_NAME);

    const origin = getObjectOrigin(doc, objectId);
    const bounds = getObjectWorldBounds(doc, objectId)!;
    expect(origin.x).toBeCloseTo(bounds.center.x);
    expect(origin.y).toBeCloseTo(bounds.center.y);
    expect(origin.z).toBeCloseTo(bounds.center.z);
    const mesh = doc.meshes.get(meshId)!;
    const xs = [...mesh.vertices.values()].map((vertex) => vertex.position.x);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(0, 5);
    const layerId = mesh.defaultUvLayerId!;
    const uvs = [...mesh.faceCorners.values()]
      .map((corner) => corner.uvs.get(layerId))
      .filter((uv): uv is { x: number; y: number } => !!uv);
    expect(Math.max(...uvs.map((uv) => uv.x)) - Math.min(...uvs.map((uv) => uv.x))).toBeGreaterThan(0.1);
  });
});

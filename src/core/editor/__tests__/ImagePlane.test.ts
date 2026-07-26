import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@/core/document/ModelDocument';
import { createImagePlane } from '@/core/editor/ImagePlane';
import { createImageAsset, createTextureAsset } from '@/core/image/PixelEditor';
import { faceCornerIds } from '@/core/mesh/EditableMesh';

describe('PNG image planes', () => {
  it('creates an upright aspect-correct plane with one UV layout on both sides', () => {
    const document = createEmptyDocument();
    const image = createImageAsset(document, 'Character', 200, 100, [255, 255, 255, 255]);
    const texture = createTextureAsset(document, image, 'Character');

    const created = createImagePlane(document, {
      textureId: texture.id,
      imageId: image.id,
      imageWidth: 200,
      imageHeight: 100,
      name: 'Character',
    });
    const object = document.objects.get(created.objectId)!;
    const mesh = document.meshes.get(created.meshId)!;
    const material = document.materials.get(created.materialId)!;

    expect(created.width).toBe(4);
    expect(created.height).toBe(2);
    expect(material.baseColourTextureId).toBe(texture.id);
    expect(material.doubleSided).toBe(true);
    expect(material.unlit).toBe(true);
    expect(material.alphaMode).toBe('blend');
    expect(object.metadata.imagePlane).toBe('true');
    expect(mesh.faces.size).toBe(1);
    expect([...mesh.vertices.values()].every((vertex) => vertex.position.z === 0)).toBe(true);

    const faceId = [...mesh.faces.keys()][0]!;
    const uvs = faceCornerIds(mesh, faceId).map(
      (cornerId) => mesh.faceCorners.get(cornerId)!.uvs.get(mesh.defaultUvLayerId!)!,
    );
    expect(uvs).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);
  });
});

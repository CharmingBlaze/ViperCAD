import { describe, expect, it } from 'vitest';
import {
  isBlockoutReferenceObject,
  placeBlockoutReferenceObject,
  shouldPickSceneObject,
  setReferenceWorldHeight,
  referenceWorldHeight,
} from '../BlockoutReferenceObject';
import { createEmptyDocument } from '@/core/document/ModelDocument';
import { createImagePlane } from '@/core/editor/ImagePlane';
import { createImageAsset, createTextureAsset } from '@/core/image/PixelEditor';

function makeReference(view: 'front' | 'side') {
  const document = createEmptyDocument();
  const image = createImageAsset(document, 'Ref', 100, 200, [255, 255, 255, 255]);
  const texture = createTextureAsset(document, image, 'Ref');
  const created = createImagePlane(document, {
    textureId: texture.id,
    imageId: image.id,
    imageWidth: 100,
    imageHeight: 200,
    name: 'Ref',
    maxSize: 2,
  });
  placeBlockoutReferenceObject(document, created, view);
  return { document, created };
}

describe('BlockoutReferenceObject', () => {
  it('commits a locked front plane sitting on the ground', () => {
    const { document, created } = makeReference('front');
    const object = document.objects.get(created.objectId)!;
    expect(isBlockoutReferenceObject(object)).toBe(true);
    expect(object.locked).toBe(true);
    expect(object.transform.position.y).toBeCloseTo(created.height / 2);
    expect(object.transform.rotation.y).toBeCloseTo(0);
    expect(document.rootObjectIds).toContain(object.id);
    const material = document.materials.get(created.materialId)!;
    expect(material.opacity).toBeCloseTo(0.65);
    expect(material.baseColourTextureId).toBe(textureId(document, created.objectId));
  });

  it('faces Side references along world +X', () => {
    const { document, created } = makeReference('side');
    const object = document.objects.get(created.objectId)!;
    expect(object.transform.rotation.y).toBeCloseTo(Math.PI / 2);
  });

  it('ignores locked blueprints and Front refs in the Side pane', () => {
    const { document, created } = makeReference('front');
    expect(
      shouldPickSceneObject(document, created.objectId, { paneId: 'front', blockoutToolActive: true }),
    ).toBe(false);
    expect(shouldPickSceneObject(document, created.objectId, { paneId: 'front' })).toBe(false);
    document.objects.get(created.objectId)!.locked = false;
    expect(shouldPickSceneObject(document, created.objectId, { paneId: 'front' })).toBe(true);
    expect(shouldPickSceneObject(document, created.objectId, { paneId: 'right' })).toBe(false);
  });

  it('scales the world height from the stored plane size', () => {
    const { document, created } = makeReference('front');
    const object = document.objects.get(created.objectId)!;
    setReferenceWorldHeight(document, object, 4);
    expect(referenceWorldHeight(document, object)).toBeCloseTo(4);
  });
});

function textureId(document: ReturnType<typeof createEmptyDocument>, objectId: string): string | null {
  const object = document.objects.get(objectId)!;
  const material = document.materials.get(object.materialSlotIds[0]!)!;
  return material.baseColourTextureId;
}

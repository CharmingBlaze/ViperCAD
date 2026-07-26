import { describe, expect, it } from 'vitest';
import {
  addObjectToDocument,
  createEmptyDocument,
  createSceneObject,
} from '@/core/document/ModelDocument';
import {
  applySimpleTextureToObject,
  defaultSimpleTextureSettings,
  readSimpleTextureSettings,
} from '@/core/curves/SimpleTexture';

describe('SimpleTexture', () => {
  it('applies a reusable curve material and persists the controls', () => {
    const doc = createEmptyDocument();
    const object = createSceneObject('Ribbon');
    addObjectToDocument(doc, object);
    const settings = {
      ...defaultSimpleTextureSettings(),
      color: '#804020',
      brightness: 1.5,
      opacity: 0.65,
      shadowDetail: 0.75,
      tipStyle: 'square' as const,
    };

    applySimpleTextureToObject(doc, object, settings);
    const materialId = object.metadata.simpleTextureMaterialId!;
    const material = doc.materials.get(materialId)!;
    expect(object.materialSlotIds).toContain(materialId);
    expect(material.baseColour).toEqual({
      x: (128 / 255) * 1.5,
      y: (64 / 255) * 1.5,
      z: (32 / 255) * 1.5,
    });
    expect(material.opacity).toBe(0.65);
    expect(material.alphaMode).toBe('blend');
    expect(readSimpleTextureSettings(object.metadata.simpleTexture)).toEqual(settings);

    applySimpleTextureToObject(doc, object, { ...settings, color: '#ffffff' });
    expect(object.metadata.simpleTextureMaterialId).toBe(materialId);
  });

  it('creates and updates a real gradient texture with curve-aware repeat values', () => {
    const doc = createEmptyDocument();
    const object = createSceneObject('Hair');
    addObjectToDocument(doc, object);
    const settings = {
      ...defaultSimpleTextureSettings(),
      mode: 'gradient' as const,
      gradientStart: '#000000',
      gradientEnd: '#ffffff',
      gradientAngle: 0,
      repeatAcross: 2,
      repeatAlong: 6,
      offsetAcross: 0.25,
      offsetAlong: -0.4,
      rotation: 35,
      flipAcross: true,
    };

    applySimpleTextureToObject(doc, object, settings);
    const material = doc.materials.get(object.metadata.simpleTextureMaterialId!)!;
    const texture = doc.textures.get(material.baseColourTextureId!)!;
    const image = doc.images.get(texture.imageAssetId)!;
    expect(texture.repeatU).toBe(-2);
    expect(texture.repeatV).toBe(6);
    expect(texture.offsetU).toBe(1.25);
    expect(texture.offsetV).toBe(-0.4);
    expect(texture.rotationDegrees).toBe(35);
    expect(image.width).toBe(64);
    expect(image.pixels[0]).toBeLessThan(image.pixels[(63 * 4)]);

    const textureId = texture.id;
    applySimpleTextureToObject(doc, object, { ...settings, gradientAngle: 90 });
    expect(doc.materials.get(material.id)!.baseColourTextureId).toBe(textureId);
  });

  it('repairs malformed stored settings with safe defaults', () => {
    expect(readSimpleTextureSettings('not-json')).toEqual(defaultSimpleTextureSettings());
    expect(readSimpleTextureSettings(JSON.stringify({
      mode: 'image',
      brightness: 99,
      repeatAlong: 0,
      opacity: -4,
    }))).toMatchObject({
      mode: 'image',
      brightness: 2,
      repeatAlong: 0.1,
      opacity: 0,
      tipStyle: 'pointed',
    });
  });
});

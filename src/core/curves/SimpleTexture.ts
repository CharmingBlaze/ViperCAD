import {
  assignMaterialToObject,
  createMaterial,
} from '@/core/document/ModelDocument';
import type {
  ModelDocument,
  SceneObject,
  TextureAsset,
  TextureId,
} from '@/core/document/types';
import {
  createImageAsset,
  createTextureAsset,
} from '@/core/image/PixelEditor';
import { generateGradientPixels } from '@/core/image/GradientGenerator';
import { v3 } from '@/core/math/Vec3';

export type CurveTipStyle = 'pointed' | 'square';
export type SimpleTextureMode = 'color' | 'gradient' | 'image';

export type SimpleTextureSettings = {
  version: 1;
  mode: SimpleTextureMode;
  color: string;
  gradientStart: string;
  gradientEnd: string;
  gradientAngle: number;
  textureId: TextureId | null;
  wrapping: 'repeat' | 'clamp';
  repeatAlong: number;
  repeatAcross: number;
  offsetAlong: number;
  offsetAcross: number;
  rotation: number;
  flipAlong: boolean;
  flipAcross: boolean;
  brightness: number;
  shadowDetail: number;
  opacity: number;
  tipStyle: CurveTipStyle;
};

export function defaultSimpleTextureSettings(): SimpleTextureSettings {
  return {
    version: 1,
    mode: 'color',
    color: '#e6a85c',
    gradientStart: '#8f4d24',
    gradientEnd: '#f4cf8c',
    gradientAngle: 90,
    textureId: null,
    wrapping: 'repeat',
    repeatAlong: 1,
    repeatAcross: 1,
    offsetAlong: 0,
    offsetAcross: 0,
    rotation: 0,
    flipAlong: false,
    flipAcross: false,
    brightness: 1,
    shadowDetail: 0.4,
    opacity: 1,
    tipStyle: 'pointed',
  };
}

export function readSimpleTextureSettings(raw: string | undefined): SimpleTextureSettings {
  const defaults = defaultSimpleTextureSettings();
  if (!raw) return defaults;
  try {
    const value = JSON.parse(raw) as Partial<SimpleTextureSettings>;
    return {
      version: 1,
      mode: value.mode === 'gradient' || value.mode === 'image' ? value.mode : 'color',
      color: validHex(value.color) ? value.color : defaults.color,
      gradientStart: validHex(value.gradientStart) ? value.gradientStart : defaults.gradientStart,
      gradientEnd: validHex(value.gradientEnd) ? value.gradientEnd : defaults.gradientEnd,
      gradientAngle: clamp(value.gradientAngle, -360, 360, defaults.gradientAngle),
      textureId: typeof value.textureId === 'string' ? value.textureId : null,
      wrapping: value.wrapping === 'clamp' ? 'clamp' : 'repeat',
      repeatAlong: clamp(value.repeatAlong, 0.1, 32, 1),
      repeatAcross: clamp(value.repeatAcross, 0.1, 32, 1),
      offsetAlong: clamp(value.offsetAlong, -8, 8, 0),
      offsetAcross: clamp(value.offsetAcross, -8, 8, 0),
      rotation: clamp(value.rotation, -180, 180, 0),
      flipAlong: value.flipAlong === true,
      flipAcross: value.flipAcross === true,
      brightness: clamp(value.brightness, 0.1, 2, 1),
      shadowDetail: clamp(value.shadowDetail, 0, 1, 0.4),
      opacity: clamp(value.opacity, 0, 1, 1),
      tipStyle: value.tipStyle === 'square' ? 'square' : 'pointed',
    };
  } catch {
    return defaults;
  }
}

export function serializeSimpleTextureSettings(settings: SimpleTextureSettings): string {
  return JSON.stringify(settings);
}

/** Apply settings through Viper's real material and texture assets. */
export function applySimpleTextureToObject(
  doc: ModelDocument,
  object: SceneObject,
  settings: SimpleTextureSettings,
): void {
  const materialId = object.metadata.simpleTextureMaterialId;
  let material = materialId ? doc.materials.get(materialId) : null;
  if (!material) {
    material = createMaterial(doc, {
      name: `${object.name} Simple Texture`,
      assignToObjectId: object.id,
    });
    object.metadata.simpleTextureMaterialId = material.id;
  } else {
    assignMaterialToObject(doc, object.id, material.id);
  }

  const brightness = settings.brightness;
  if (settings.mode === 'color') {
    const colour = hexToRgb(settings.color);
    material.baseColour = v3(
      colour[0] * brightness,
      colour[1] * brightness,
      colour[2] * brightness,
    );
    material.baseColourTextureId = null;
  } else if (settings.mode === 'gradient') {
    material.baseColour = v3(brightness, brightness, brightness);
    material.baseColourTextureId = ensureGradientTexture(doc, object, settings);
  } else {
    material.baseColour = v3(brightness, brightness, brightness);
    material.baseColourTextureId =
      settings.textureId && doc.textures.has(settings.textureId) ? settings.textureId : null;
  }
  material.opacity = settings.opacity;
  material.alphaMode = settings.opacity < 0.999 ? 'blend' : 'opaque';
  material.doubleSided = true;
  material.flatShaded = false;
  material.roughness = 1 - settings.shadowDetail * 0.72;
  material.metallic = 0;
  material.textureWrapping = settings.wrapping;
  if (material.baseColourTextureId) {
    const texture = doc.textures.get(material.baseColourTextureId);
    if (texture) {
      texture.wrapping = settings.wrapping;
      applyTextureTransform(texture, settings);
    }
  }
  object.metadata.simpleTexture = serializeSimpleTextureSettings(settings);
  doc.dirty = true;
}

function ensureGradientTexture(
  doc: ModelDocument,
  object: SceneObject,
  settings: SimpleTextureSettings,
): TextureId {
  const storedImageId = object.metadata.simpleTextureGradientImageId;
  const storedTextureId = object.metadata.simpleTextureGradientTextureId;
  const pixels = generateGradientPixels(
    64,
    64,
    {
      type: 'linear',
      angle: settings.gradientAngle,
      stops: [
        { color: settings.gradientStart, position: 0, opacity: 100 },
        { color: settings.gradientEnd, position: 100, opacity: 100 },
      ],
    },
  );
  const image = storedImageId ? doc.images.get(storedImageId) : null;
  const texture = storedTextureId ? doc.textures.get(storedTextureId) : null;
  if (image && texture) {
    image.pixels = pixels;
    image.revision += 1;
    texture.wrapping = settings.wrapping;
    applyTextureTransform(texture, settings);
    return texture.id;
  }
  const nextImage = createImageAsset(doc, `${object.name} Gradient`, 64, 64, [255, 255, 255, 255]);
  nextImage.pixels = pixels;
  nextImage.revision += 1;
  const nextTexture = createTextureAsset(doc, nextImage, `${object.name} Gradient`);
  nextTexture.filtering = 'linear';
  nextTexture.wrapping = settings.wrapping;
  applyTextureTransform(nextTexture, settings);
  object.metadata.simpleTextureGradientImageId = nextImage.id;
  object.metadata.simpleTextureGradientTextureId = nextTexture.id;
  return nextTexture.id;
}

function applyTextureTransform(
  texture: TextureAsset,
  settings: SimpleTextureSettings,
): void {
  texture.repeatU = settings.repeatAcross * (settings.flipAcross ? -1 : 1);
  texture.repeatV = settings.repeatAlong * (settings.flipAlong ? -1 : 1);
  texture.offsetU = settings.offsetAcross + (settings.flipAcross ? 1 : 0);
  texture.offsetV = settings.offsetAlong + (settings.flipAlong ? 1 : 0);
  texture.rotationDegrees = settings.rotation;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  ];
}

function validHex(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

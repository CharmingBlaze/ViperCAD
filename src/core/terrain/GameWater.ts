import {
  CanvasTexture,
  Color,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
  type Material,
} from 'three';
import type { ModelDocument } from '@/core/document/types';
import { createMaterial } from '@/core/document/ModelDocument';
import { createImageAsset, createTextureAsset } from '@/core/image/PixelEditor';

export type GameWaterSpec = {
  shallowColor: string;
  deepColor: string;
  foamColor: string;
  opacity: number;
  waveScale: number;
  flowSpeed: number;
  roughness: number;
  metalness: number;
  animated: boolean;
};

export const DEFAULT_WATER_SPEC: GameWaterSpec = {
  shallowColor: '#1ac2cf',
  deepColor: '#07325f',
  foamColor: '#e0f7fa',
  opacity: 0.85,
  waveScale: 4,
  flowSpeed: 0.15,
  roughness: 0.08,
  metalness: 0.1,
  animated: true,
};

/** Generate procedural normal map texture for water ripple animation */
function createProceduralWaterNormalCanvas(size = 256): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 8;
      const v = (y / size) * Math.PI * 8;
      
      const nx = Math.sin(u + Math.cos(v * 0.7)) * 0.5 + Math.cos(v * 1.3) * 0.3;
      const ny = Math.cos(v + Math.sin(u * 0.8)) * 0.5 + Math.sin(u * 1.2) * 0.3;
      const nz = 1.0;

      const len = Math.hypot(nx, ny, nz) || 1;
      const r = Math.floor(((nx / len) * 0.5 + 0.5) * 255);
      const g = Math.floor(((ny / len) * 0.5 + 0.5) * 255);
      const b = Math.floor(((nz / len) * 0.5 + 0.5) * 255);

      const idx = (y * size + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

let cachedWaterNormalTexture: CanvasTexture | null = null;

export function getProceduralWaterNormalTexture(): CanvasTexture {
  if (cachedWaterNormalTexture) return cachedWaterNormalTexture;
  const canvas = createProceduralWaterNormalCanvas(256);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(4, 4);
  texture.colorSpace = SRGBColorSpace;
  cachedWaterNormalTexture = texture;
  return texture;
}

/** Build a high-quality game water material */
export function createGameWaterMaterial(spec: Partial<GameWaterSpec> = {}): MeshStandardMaterial {
  const settings = { ...DEFAULT_WATER_SPEC, ...spec };
  const shallow = new Color(settings.shallowColor);
  const deep = new Color(settings.deepColor);
  
  // Blend shallow and deep colors
  const baseColor = shallow.clone().lerp(deep, 0.55);

  const normalMap = getProceduralWaterNormalTexture();

  const material = new MeshStandardMaterial({
    color: baseColor,
    roughness: settings.roughness,
    metalness: settings.metalness,
    transparent: true,
    opacity: settings.opacity,
    normalMap,
    normalScale: new Vector2(0.6, 0.6),
    depthWrite: false,
  });

  material.userData.gameWater = true;
  material.userData.waterSpec = settings;
  material.userData.waterTime = 0;

  return material;
}

/** Update water ripple animation tick */
export function animateWaterMaterial(material: Material, deltaTime: number): void {
  if (!material.userData.gameWater || !material.userData.waterSpec?.animated) return;
  const spec = material.userData.waterSpec as GameWaterSpec;
  const mat = material as MeshStandardMaterial;
  
  material.userData.waterTime = (material.userData.waterTime ?? 0) + deltaTime * spec.flowSpeed;
  const t = material.userData.waterTime as number;

  if (mat.normalMap) {
    mat.normalMap.offset.set((t * 0.2) % 1, (t * 0.15) % 1);
    mat.normalMap.needsUpdate = true;
  }
}

/** Create document material asset for game water */
export function setupWaterDocumentAsset(
  doc: ModelDocument,
  name = 'Water Material',
  spec: Partial<GameWaterSpec> = {},
) {
  const settings = { ...DEFAULT_WATER_SPEC, ...spec };
  const image = createImageAsset(doc, `${name} Normal`, 256, 256, [128, 128, 255, 255]);
  const texture = createTextureAsset(doc, image, `${name} Water Texture`);
  texture.wrapping = 'repeat';
  texture.filtering = 'linear';

  const material = createMaterial(doc, { name });
  material.roughness = settings.roughness;
  material.metallic = settings.metalness;
  material.baseColour = { x: 0.1, y: 0.7, z: 0.85 };
  material.opacity = settings.opacity;
  material.alphaMode = settings.opacity < 1 ? 'blend' : 'opaque';
  material.normalTextureId = texture.id;

  return { material, texture, image };
}

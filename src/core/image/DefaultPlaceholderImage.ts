import type { ImageAsset, TextureAsset } from '@/core/document/types';
import { decodeImageFile } from '@/core/image/ImageImport';
import { IMAGE_SIZE_LIMITS } from '@/core/image/PixelEditor';

export const DEFAULT_PLACEHOLDER_IMAGE_NAME = 'Low-poly Terrain Placeholder';
export const DEFAULT_PLACEHOLDER_IMAGE_URL = '/placeholders/default-pixel-clay.png';
export const GENERATED_PLACEHOLDER_SIZE = 8;

const GENERATED_PALETTE = [
  [48, 72, 82],
  [69, 99, 84],
  [87, 112, 103],
  [126, 113, 75],
  [151, 132, 91],
] as const;

let cachedPixels: { width: number; height: number; pixels: Uint8ClampedArray } | null = null;
let pendingLoad: Promise<{ width: number; height: number; pixels: Uint8ClampedArray } | null> | null =
  null;

export function fillGeneratedPlaceholderPixels(
  pixels: Uint8ClampedArray,
  size = GENERATED_PLACEHOLDER_SIZE,
): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const facet = (x * 5 + y * 3 + (x ^ y) * 7) % 5;
      const palette = GENERATED_PALETTE[facet]!;
      pixels[i] = palette[0];
      pixels[i + 1] = palette[1];
      pixels[i + 2] = palette[2];
      pixels[i + 3] = 255;
    }
  }
}

export function createGeneratedPlaceholderPixels(
  size = GENERATED_PLACEHOLDER_SIZE,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4);
  fillGeneratedPlaceholderPixels(pixels, size);
  return pixels;
}

/**
 * Shared GPU clay PNG is only safe for the unused 8×8 stub.
 * After hydrate/resize/paint the document pixels are the source of truth.
 */
export function canUseSharedStockPlaceholderMap(image: ImageAsset | null | undefined): boolean {
  if (!image || image.userEdited) return false;
  return isUnhydratedDefaultPlaceholder(image);
}

export function isUnhydratedDefaultPlaceholder(image: ImageAsset): boolean {
  if (
    image.name !== DEFAULT_PLACEHOLDER_IMAGE_NAME ||
    image.width !== GENERATED_PLACEHOLDER_SIZE ||
    image.height !== GENERATED_PLACEHOLDER_SIZE
  ) {
    return false;
  }
  const expected = createGeneratedPlaceholderPixels();
  if (image.pixels.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (image.pixels[i] !== expected[i]) return false;
  }
  return true;
}

export function peekCachedDefaultPlaceholderPixels(): {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
} | null {
  return cachedPixels;
}

export function preloadDefaultPlaceholderImage(): Promise<{
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
} | null> {
  return loadDefaultPlaceholderPixels();
}

/** Apply the already-fetched PNG without waiting. Returns true when an image changed. */
export function syncHydrateDefaultPlaceholderImages(
  images: Map<string, ImageAsset>,
  textures?: Map<string, TextureAsset>,
): boolean {
  if (!cachedPixels) return false;
  return applyDecodedPlaceholderPixels(images, textures, cachedPixels);
}

export async function loadDefaultPlaceholderPixels(): Promise<{
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
} | null> {
  if (cachedPixels) return cachedPixels;
  if (pendingLoad) return pendingLoad;
  pendingLoad = decodeDefaultPlaceholderPixels().then((decoded) => {
    cachedPixels = decoded;
    pendingLoad = null;
    return decoded;
  });
  return pendingLoad;
}

async function decodeDefaultPlaceholderPixels(): Promise<{
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
} | null> {
  if (
    typeof fetch !== 'function' ||
    typeof createImageBitmap !== 'function' ||
    typeof document === 'undefined'
  ) {
    return null;
  }
  try {
    const response = await fetch(DEFAULT_PLACEHOLDER_IMAGE_URL);
    if (!response.ok) return null;
    const blob = await response.blob();
    const file = new File([blob], 'default-pixel-clay.png', { type: blob.type || 'image/png' });
    const decoded = await decodeImageFile(file, IMAGE_SIZE_LIMITS.max);
    return { width: decoded.width, height: decoded.height, pixels: decoded.pixels };
  } catch {
    return null;
  }
}

function applyDecodedPlaceholderPixels(
  images: Map<string, ImageAsset>,
  textures: Map<string, TextureAsset> | undefined,
  decoded: { width: number; height: number; pixels: Uint8ClampedArray },
): boolean {
  let changed = false;
  for (const image of images.values()) {
    if (!isUnhydratedDefaultPlaceholder(image)) continue;
    image.width = decoded.width;
    image.height = decoded.height;
    image.pixels = new Uint8ClampedArray(decoded.pixels);
    image.revision += 1;
    changed = true;
  }
  if (changed && textures) {
    for (const texture of textures.values()) {
      const image = images.get(texture.imageAssetId);
      if (!image || image.name !== DEFAULT_PLACEHOLDER_IMAGE_NAME) continue;
      texture.filtering = 'linear';
      texture.generateMipmaps = true;
    }
  }
  return changed;
}

/** Replace the compact generated default with the bundled object texture. */
export async function hydrateDefaultPlaceholderImages(
  images: Map<string, ImageAsset>,
  textures?: Map<string, TextureAsset>,
  decodedPixels?: { width: number; height: number; pixels: Uint8ClampedArray } | null,
): Promise<boolean> {
  const decoded = decodedPixels === undefined ? await loadDefaultPlaceholderPixels() : decodedPixels;
  if (!decoded) return false;
  cachedPixels = decoded;
  return applyDecodedPlaceholderPixels(images, textures, decoded);
}

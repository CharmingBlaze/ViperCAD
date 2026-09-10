import { createId } from '@/core/ids/IdService';
import type { ImageAsset, ModelDocument, TextureAsset } from '@/core/document/types';
import { compositePaintLayers, getPaintPixel, getPaintTarget, isActivePaintLayerLocked, writePaintPixel } from '@/core/image/PaintLayers';

export type Rgba = readonly [number, number, number, number];

/** Supported texture/image creation sizes (pixels per axis). */
export const IMAGE_SIZE_LIMITS = { min: 1, max: 512 } as const;
/** Common power-of-two presets for the material editor. */
export const IMAGE_SIZE_PRESETS = [16, 32, 64, 128, 256, 512] as const;

export function clampImageSize(n: number): number {
  return Math.max(IMAGE_SIZE_LIMITS.min, Math.min(IMAGE_SIZE_LIMITS.max, Math.floor(Number(n) || 1)));
}

export function createImageAsset(doc: ModelDocument, name: string, width: number, height: number, fill: Rgba = [0, 0, 0, 0]): ImageAsset {
  const w = clampImageSize(width);
  const h = clampImageSize(height);
  const image: ImageAsset = {
    id: createId('img'),
    name,
    width: w,
    height: h,
    colourMode: 'rgba',
    pixels: new Uint8ClampedArray(w * h * 4),
    revision: 0,
  };
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) write(image, x, y, fill);
  doc.images.set(image.id, image);
  doc.dirty = true;
  return image;
}

/** Create an image from an RGBA buffer (length must be width*height*4). Sizes are clamped. */
export function createImageAssetFromPixels(
  doc: ModelDocument,
  name: string,
  width: number,
  height: number,
  pixels: ArrayLike<number>,
): ImageAsset {
  const w = clampImageSize(width);
  const h = clampImageSize(height);
  const expected = w * h * 4;
  const copy = new Uint8ClampedArray(expected);
  if (w === width && h === height && pixels.length >= expected) {
    for (let i = 0; i < expected; i++) copy[i] = pixels[i]!;
  } else {
    // Mismatched size: sample from top-left of source if possible
    const srcW = Math.max(1, Math.floor(width));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = (y * srcW + x) * 4;
        const di = (y * w + x) * 4;
        if (si + 3 < pixels.length) {
          copy[di] = pixels[si]!;
          copy[di + 1] = pixels[si + 1]!;
          copy[di + 2] = pixels[si + 2]!;
          copy[di + 3] = pixels[si + 3]!;
        }
      }
    }
  }
  const image: ImageAsset = {
    id: createId('img'),
    name,
    width: w,
    height: h,
    colourMode: 'rgba',
    pixels: copy,
    revision: 1,
  };
  doc.images.set(image.id, image);
  doc.dirty = true;
  return image;
}

export function createTextureAsset(doc: ModelDocument, image: ImageAsset, name = image.name): TextureAsset {
  const texture: TextureAsset = { id: createId('tex'), name, imageAssetId: image.id, filtering: 'nearest', wrapping: 'repeat', colourSpace: 'srgb', generateMipmaps: false };
  doc.textures.set(texture.id, texture); doc.dirty = true; return texture;
}

/**
 * Fit source dimensions into maxAxis×maxAxis, preserving aspect ratio.
 */
export function fitImageSize(
  width: number,
  height: number,
  maxAxis: number = IMAGE_SIZE_LIMITS.max,
): { width: number; height: number; scaled: boolean } {
  const w0 = Math.max(1, Math.floor(width));
  const h0 = Math.max(1, Math.floor(height));
  if (w0 <= maxAxis && h0 <= maxAxis) {
    return { width: w0, height: h0, scaled: false };
  }
  const scale = Math.min(maxAxis / w0, maxAxis / h0);
  return {
    width: Math.max(1, Math.round(w0 * scale)),
    height: Math.max(1, Math.round(h0 * scale)),
    scaled: true,
  };
}

export function getPixel(image: ImageAsset, x: number, y: number): Rgba | null {
  if (!inside(image, x, y)) return null; const i = (y * image.width + x) * 4; return [image.pixels[i]!, image.pixels[i + 1]!, image.pixels[i + 2]!, image.pixels[i + 3]!];
}

export function setPixel(image: ImageAsset, x: number, y: number, colour: Rgba): boolean {
  if (!inside(image, x, y) || isActivePaintLayerLocked(image)) return false;
  write(image, x, y, colour);
  image.revision += 1;
  image.userEdited = true;
  return true;
}

export function drawPixelLine(image: ImageAsset, x0: number, y0: number, x1: number, y1: number, colour: Rgba): void {
  let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1, err = dx + dy;
  for (;;) { if (inside(image, x0, y0)) write(image, x0, y0, colour); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
  image.revision += 1;
  image.userEdited = true;
}

export type FloodFillOptions = {
  /** 0 is an exact match; 255 includes the complete RGBA range. */
  tolerance?: number;
  /** When false, fill every matching pixel instead of only the connected region. */
  contiguous?: boolean;
};

/**
 * Paint-bucket fill with Photoshop-style tolerance and contiguous matching.
 * A maximum per-channel distance is used so a tolerance value is predictable
 * for pixel art as well as photographic textures.
 */
export function floodFill(
  image: ImageAsset,
  startX: number,
  startY: number,
  colour: Rgba,
  options: FloodFillOptions = {},
): number {
  if (isActivePaintLayerLocked(image)) return 0;
  const target = getPaintPixel(image, startX, startY);
  if (!target || same(target, colour)) return 0;

  const buf = getPaintTarget(image);
  const tolerance = Math.max(0, Math.min(255, Math.round(options.tolerance ?? 0)));
  const contiguous = options.contiguous !== false;
  const matchesTarget = (offset: number) => (
    Math.max(
      Math.abs(buf[offset]! - target[0]),
      Math.abs(buf[offset + 1]! - target[1]),
      Math.abs(buf[offset + 2]! - target[2]),
      Math.abs(buf[offset + 3]! - target[3]),
    ) <= tolerance
  );
  let count = 0;

  if (!contiguous) {
    for (let offset = 0; offset < buf.length; offset += 4) {
      if (!matchesTarget(offset)) continue;
      buf[offset] = colour[0];
      buf[offset + 1] = colour[1];
      buf[offset + 2] = colour[2];
      buf[offset + 3] = colour[3];
      count += 1;
    }
  } else {
    const seen = new Uint8Array(image.width * image.height);
    const queue: number[] = [startY * image.width + startX];
    while (queue.length) {
      const pixel = queue.pop()!;
      if (seen[pixel]) continue;
      seen[pixel] = 1;
      const x = pixel % image.width;
      const y = Math.floor(pixel / image.width);
      const offset = pixel * 4;
      if (!matchesTarget(offset)) continue;
      buf[offset] = colour[0];
      buf[offset + 1] = colour[1];
      buf[offset + 2] = colour[2];
      buf[offset + 3] = colour[3];
      count += 1;
      if (x > 0) queue.push(pixel - 1);
      if (x + 1 < image.width) queue.push(pixel + 1);
      if (y > 0) queue.push(pixel - image.width);
      if (y + 1 < image.height) queue.push(pixel + image.width);
    }
  }
  if (count && image.paintLayers?.length) compositePaintLayers(image);
  if (count) {
    image.revision += 1;
    image.userEdited = true;
  }
  return count;
}

export function paintUvHit(image: ImageAsset, uv: { x: number; y: number }, colour: Rgba): boolean { return setPixel(image, Math.min(image.width - 1, Math.max(0, Math.floor(uv.x * image.width))), Math.min(image.height - 1, Math.max(0, Math.floor((1 - uv.y) * image.height))), colour); }

function inside(image: ImageAsset, x: number, y: number) { return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < image.width && y < image.height; }
function write(image: ImageAsset, x: number, y: number, c: Rgba) { writePaintPixel(image, x, y, c); }
function same(a: Rgba, b: Rgba) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]; }

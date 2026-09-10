import type { ImageAsset, PaintLayer } from '@/core/document/types';
import { createId } from '@/core/ids/IdService';
import type { Rgba } from '@/core/image/PixelEditor';

export function clonePaintLayer(layer: PaintLayer): PaintLayer {
  return {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    locked: layer.locked,
    pixels: new Uint8ClampedArray(layer.pixels),
  };
}

export function clonePaintStack(image: ImageAsset): {
  paintLayers?: PaintLayer[];
  activePaintLayerId?: string;
} {
  return {
    paintLayers: image.paintLayers?.map(clonePaintLayer),
    activePaintLayerId: image.activePaintLayerId,
  };
}

export function applyPaintStack(
  image: ImageAsset,
  stack: { paintLayers?: PaintLayer[]; activePaintLayerId?: string },
): void {
  image.paintLayers = stack.paintLayers?.map(clonePaintLayer);
  image.activePaintLayerId = stack.activePaintLayerId;
  if (image.paintLayers?.length) compositePaintLayers(image);
  image.revision += 1;
  image.userEdited = true;
}

export function getActivePaintLayer(image: ImageAsset): PaintLayer | null {
  const layers = image.paintLayers;
  if (!layers?.length) return null;
  return layers.find((layer) => layer.id === image.activePaintLayerId) ?? layers[layers.length - 1] ?? null;
}

export function getPaintTarget(image: ImageAsset): Uint8ClampedArray {
  return getActivePaintLayer(image)?.pixels ?? image.pixels;
}

export function isActivePaintLayerLocked(image: ImageAsset): boolean {
  return getActivePaintLayer(image)?.locked === true;
}

export function getPaintPixel(image: ImageAsset, x: number, y: number): Rgba | null {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
  const buf = getPaintTarget(image);
  const i = (y * image.width + x) * 4;
  return [buf[i]!, buf[i + 1]!, buf[i + 2]!, buf[i + 3]!];
}

export function clonePaintTarget(image: ImageAsset): Uint8ClampedArray {
  return new Uint8ClampedArray(getPaintTarget(image));
}

export function applyPaintTarget(image: ImageAsset, pixels: Uint8ClampedArray): void {
  getPaintTarget(image).set(pixels);
  if (image.paintLayers?.length) compositePaintLayers(image);
  image.revision += 1;
  image.userEdited = true;
}

export function ensurePaintLayers(image: ImageAsset): PaintLayer[] {
  if (image.paintLayers?.length) return image.paintLayers;
  const background: PaintLayer = {
    id: createId('img'),
    name: 'Background',
    visible: true,
    opacity: 1,
    locked: false,
    pixels: new Uint8ClampedArray(image.pixels),
  };
  image.paintLayers = [background];
  image.activePaintLayerId = background.id;
  return image.paintLayers;
}

export function addPaintLayer(image: ImageAsset, name?: string): PaintLayer {
  const layers = ensurePaintLayers(image);
  const layer: PaintLayer = {
    id: createId('img'),
    name: name ?? nextLayerName(layers),
    visible: true,
    opacity: 1,
    locked: false,
    pixels: new Uint8ClampedArray(image.width * image.height * 4),
  };
  layers.push(layer);
  image.activePaintLayerId = layer.id;
  compositePaintLayers(image);
  image.revision += 1;
  image.userEdited = true;
  return layer;
}

export function duplicatePaintLayer(image: ImageAsset, layerId: string): PaintLayer | null {
  const layers = image.paintLayers;
  if (!layers) return null;
  const index = layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) return null;
  const source = layers[index]!;
  const copy = clonePaintLayer(source);
  copy.id = createId('img');
  copy.name = `${source.name} copy`;
  layers.splice(index + 1, 0, copy);
  image.activePaintLayerId = copy.id;
  compositePaintLayers(image);
  image.revision += 1;
  image.userEdited = true;
  return copy;
}

export function removePaintLayer(image: ImageAsset, layerId: string): boolean {
  const layers = image.paintLayers;
  if (!layers || layers.length <= 1) return false;
  const index = layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) return false;
  layers.splice(index, 1);
  if (image.activePaintLayerId === layerId) {
    image.activePaintLayerId = layers[Math.max(0, index - 1)]?.id;
  }
  compositePaintLayers(image);
  image.revision += 1;
  image.userEdited = true;
  return true;
}

export function movePaintLayer(image: ImageAsset, layerId: string, delta: 1 | -1): boolean {
  const layers = image.paintLayers;
  if (!layers) return false;
  const index = layers.findIndex((layer) => layer.id === layerId);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= layers.length) return false;
  const [layer] = layers.splice(index, 1);
  layers.splice(next, 0, layer!);
  compositePaintLayers(image);
  image.revision += 1;
  image.userEdited = true;
  return true;
}

export function setActivePaintLayer(image: ImageAsset, layerId: string): boolean {
  if (!image.paintLayers?.some((layer) => layer.id === layerId)) return false;
  image.activePaintLayerId = layerId;
  image.revision += 1;
  return true;
}

export function patchPaintLayer(
  image: ImageAsset,
  layerId: string,
  patch: Partial<Pick<PaintLayer, 'name' | 'visible' | 'opacity' | 'locked'>>,
): boolean {
  const layer = image.paintLayers?.find((item) => item.id === layerId);
  if (!layer) return false;
  if (patch.name !== undefined) layer.name = patch.name;
  if (patch.visible !== undefined) layer.visible = patch.visible;
  if (patch.opacity !== undefined) layer.opacity = Math.max(0, Math.min(1, patch.opacity));
  if (patch.locked !== undefined) layer.locked = patch.locked;
  if (patch.visible !== undefined || patch.opacity !== undefined) compositePaintLayers(image);
  image.revision += 1;
  image.userEdited = true;
  return true;
}

export function writePaintPixel(image: ImageAsset, x: number, y: number, colour: Rgba): boolean {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false;
  if (isActivePaintLayerLocked(image)) return false;
  const buf = getPaintTarget(image);
  const i = (y * image.width + x) * 4;
  buf[i] = colour[0];
  buf[i + 1] = colour[1];
  buf[i + 2] = colour[2];
  buf[i + 3] = colour[3];
  compositePaintPixel(image, x, y);
  return true;
}

export function compositePaintLayers(image: ImageAsset): void {
  const layers = image.paintLayers;
  if (!layers?.length) return;
  const out = image.pixels;
  out.fill(0);
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    blitLayer(out, layer.pixels, layer.opacity);
  }
}

export function compositePaintPixel(image: ImageAsset, x: number, y: number): void {
  const layers = image.paintLayers;
  if (!layers?.length) return;
  const dest = image.pixels;
  const i = (y * image.width + x) * 4;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    const srcA = (layer.pixels[i + 3]! / 255) * layer.opacity;
    if (srcA <= 0) continue;
    const outA = srcA + a * (1 - srcA);
    r = (layer.pixels[i]! * srcA + r * a * (1 - srcA)) / outA;
    g = (layer.pixels[i + 1]! * srcA + g * a * (1 - srcA)) / outA;
    b = (layer.pixels[i + 2]! * srcA + b * a * (1 - srcA)) / outA;
    a = outA;
  }
  dest[i] = Math.round(r);
  dest[i + 1] = Math.round(g);
  dest[i + 2] = Math.round(b);
  dest[i + 3] = Math.round(a * 255);
}

export function compositePaintRect(image: ImageAsset, x: number, y: number, width: number, height: number): void {
  if (!image.paintLayers?.length) return;
  const x1 = Math.min(image.width, x + width);
  const y1 = Math.min(image.height, y + height);
  for (let py = Math.max(0, y); py < y1; py++) {
    for (let px = Math.max(0, x); px < x1; px++) {
      compositePaintPixel(image, px, py);
    }
  }
}

function blitLayer(dest: Uint8ClampedArray, src: Uint8ClampedArray, opacity: number): void {
  for (let i = 0; i < dest.length; i += 4) {
    const srcA = (src[i + 3]! / 255) * opacity;
    if (srcA <= 0) continue;
    const da = dest[i + 3]! / 255;
    const outA = srcA + da * (1 - srcA);
    dest[i] = Math.round((src[i]! * srcA + dest[i]! * da * (1 - srcA)) / outA);
    dest[i + 1] = Math.round((src[i + 1]! * srcA + dest[i + 1]! * da * (1 - srcA)) / outA);
    dest[i + 2] = Math.round((src[i + 2]! * srcA + dest[i + 2]! * da * (1 - srcA)) / outA);
    dest[i + 3] = Math.round(outA * 255);
  }
}

function nextLayerName(layers: PaintLayer[]): string {
  let n = layers.length;
  let name = `Layer ${n}`;
  const used = new Set(layers.map((layer) => layer.name));
  while (used.has(name)) {
    n += 1;
    name = `Layer ${n}`;
  }
  return name;
}

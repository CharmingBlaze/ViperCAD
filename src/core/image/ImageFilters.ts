import type { ImageAsset, MaterialAsset, ModelDocument } from '@/core/document/types';
import type { EditorSession } from '@/core/editor/EditorSession';

export type PixelateMode = 'average' | 'center' | 'mosaic';

export type MaterialMapSlot = 'base' | 'normal' | 'roughness' | 'metallic' | 'emissive';

export type MaterialMapEntry = {
  slot: MaterialMapSlot;
  label: string;
  image: ImageAsset;
};

export const PIXELATE_BLOCK_PRESETS = [
  { id: 'fine', label: 'Fine', size: 2 },
  { id: 'medium', label: 'Medium', size: 4 },
  { id: 'chunky', label: 'Chunky', size: 8 },
  { id: 'heavy', label: 'Heavy', size: 16 },
  { id: 'retro', label: 'Retro', size: 32 },
] as const;

const MATERIAL_MAP_SLOTS: Array<{ slot: MaterialMapSlot; label: string; key: keyof MaterialAsset }> = [
  { slot: 'base', label: 'Base colour', key: 'baseColourTextureId' },
  { slot: 'normal', label: 'Normal', key: 'normalTextureId' },
  { slot: 'roughness', label: 'Roughness', key: 'roughnessTextureId' },
  { slot: 'metallic', label: 'Metallic', key: 'metallicTextureId' },
  { slot: 'emissive', label: 'Emissive', key: 'emissiveTextureId' },
];

function clampBlockSize(blockSize: number): number {
  return Math.max(1, Math.min(64, Math.round(blockSize)));
}

function readPixel(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const index = (y * width + x) * 4;
  return [pixels[index]!, pixels[index + 1]!, pixels[index + 2]!, pixels[index + 3]!];
}

function writePixel(
  out: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  rgba: [number, number, number, number],
): void {
  const index = (y * width + x) * 4;
  out[index] = rgba[0];
  out[index + 1] = rgba[1];
  out[index + 2] = rgba[2];
  out[index + 3] = rgba[3];
}

function averageBlock(
  pixels: Uint8ClampedArray,
  width: number,
  blockX: number,
  blockY: number,
  blockW: number,
  blockH: number,
): [number, number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let count = 0;

  for (let y = blockY; y < blockY + blockH; y += 1) {
    for (let x = blockX; x < blockX + blockW; x += 1) {
      const [pr, pg, pb, pa] = readPixel(pixels, width, x, y);
      r += pr;
      g += pg;
      b += pb;
      a += pa;
      count += 1;
    }
  }

  return [
    Math.round(r / count),
    Math.round(g / count),
    Math.round(b / count),
    Math.round(a / count),
  ];
}

function centerBlockSample(
  pixels: Uint8ClampedArray,
  width: number,
  blockX: number,
  blockY: number,
  blockW: number,
  blockH: number,
): [number, number, number, number] {
  const x = blockX + Math.floor((blockW - 1) / 2);
  const y = blockY + Math.floor((blockH - 1) / 2);
  return readPixel(pixels, width, x, y);
}

function sampleBlock(
  pixels: Uint8ClampedArray,
  width: number,
  blockX: number,
  blockY: number,
  blockW: number,
  blockH: number,
  mode: PixelateMode,
): [number, number, number, number] {
  if (mode === 'center') {
    return centerBlockSample(pixels, width, blockX, blockY, blockW, blockH);
  }
  return averageBlock(pixels, width, blockX, blockY, blockW, blockH);
}

export function pixelatePixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  blockSize: number,
  mode: PixelateMode = 'average',
): Uint8ClampedArray {
  const size = clampBlockSize(blockSize);
  if (size === 1) return new Uint8ClampedArray(pixels);

  if (mode === 'mosaic') {
    return pixelateMosaic(pixels, width, height, size);
  }

  const out = new Uint8ClampedArray(pixels.length);

  for (let blockY = 0; blockY < height; blockY += size) {
    const blockH = Math.min(size, height - blockY);
    for (let blockX = 0; blockX < width; blockX += size) {
      const blockW = Math.min(size, width - blockX);
      const rgba = sampleBlock(pixels, width, blockX, blockY, blockW, blockH, mode);

      for (let y = blockY; y < blockY + blockH; y += 1) {
        for (let x = blockX; x < blockX + blockW; x += 1) {
          writePixel(out, width, x, y, rgba);
        }
      }
    }
  }

  return out;
}

function pixelateMosaic(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  blockSize: number,
): Uint8ClampedArray {
  const tilesX = Math.max(1, Math.ceil(width / blockSize));
  const tilesY = Math.max(1, Math.ceil(height / blockSize));
  const tileColors = new Uint8ClampedArray(tilesX * tilesY * 4);

  for (let tileY = 0; tileY < tilesY; tileY += 1) {
    for (let tileX = 0; tileX < tilesX; tileX += 1) {
      const blockX = tileX * blockSize;
      const blockY = tileY * blockSize;
      const blockW = Math.min(blockSize, width - blockX);
      const blockH = Math.min(blockSize, height - blockY);
      const rgba = averageBlock(pixels, width, blockX, blockY, blockW, blockH);
      const index = (tileY * tilesX + tileX) * 4;
      tileColors[index] = rgba[0];
      tileColors[index + 1] = rgba[1];
      tileColors[index + 2] = rgba[2];
      tileColors[index + 3] = rgba[3];
    }
  }

  const out = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tileX = Math.min(tilesX - 1, Math.floor(x / blockSize));
      const tileY = Math.min(tilesY - 1, Math.floor(y / blockSize));
      const index = (tileY * tilesX + tileX) * 4;
      writePixel(out, width, x, y, [
        tileColors[index]!,
        tileColors[index + 1]!,
        tileColors[index + 2]!,
        tileColors[index + 3]!,
      ]);
    }
  }

  return out;
}

export function pixelateModeLabel(mode: PixelateMode): string {
  switch (mode) {
    case 'center':
      return 'Center sample';
    case 'mosaic':
      return 'Mosaic';
    default:
      return 'Block average';
  }
}

function buffersEqual(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

type ImageSnapshot = {
  image: ImageAsset;
  before: Uint8ClampedArray;
  after: Uint8ClampedArray;
};

export function listMaterialMapEntries(doc: ModelDocument, material: MaterialAsset): MaterialMapEntry[] {
  const entries: MaterialMapEntry[] = [];
  const seen = new Set<string>();

  for (const slotInfo of MATERIAL_MAP_SLOTS) {
    const textureId = material[slotInfo.key];
    if (typeof textureId !== 'string' || !textureId) continue;
    const texture = doc.textures.get(textureId);
    if (!texture) continue;
    const image = doc.images.get(texture.imageAssetId);
    if (!image || seen.has(image.id)) continue;
    seen.add(image.id);
    entries.push({ slot: slotInfo.slot, label: slotInfo.label, image });
  }

  return entries;
}

export function listMaterialMapImages(doc: ModelDocument, material: MaterialAsset): ImageAsset[] {
  return listMaterialMapEntries(doc, material).map((entry) => entry.image);
}

export function applyPixelateToImages(
  session: EditorSession,
  images: ImageAsset[],
  blockSize: number,
  material?: MaterialAsset | null,
  mode: PixelateMode = 'average',
): boolean {
  const snapshots: ImageSnapshot[] = [];
  const size = clampBlockSize(blockSize);

  for (const image of images) {
    const before = new Uint8ClampedArray(image.pixels);
    const after = pixelatePixels(before, image.width, image.height, size, mode);
    if (buffersEqual(before, after)) continue;
    snapshots.push({ image, before, after });
  }

  if (!snapshots.length) return false;

  const prevFiltering = material?.textureFiltering;
  let applied = true;

  const apply = () => {
    for (const snapshot of snapshots) {
      snapshot.image.pixels.set(snapshot.after);
      snapshot.image.revision += 1;
    }
    if (material) {
      material.textureFiltering = 'nearest';
      material.presetId = null;
    }
  };

  const revert = () => {
    for (const snapshot of snapshots) {
      snapshot.image.pixels.set(snapshot.before);
      snapshot.image.revision += 1;
    }
    if (material && prevFiltering !== undefined) {
      material.textureFiltering = prevFiltering;
    }
  };

  apply();

  const modeLabel = pixelateModeLabel(mode);
  session.history.execute({
    name: snapshots.length === 1
      ? `Pixelate ${size}px (${modeLabel})`
      : `Pixelate maps ${size}px (${modeLabel})`,
    execute: () => {
      if (applied) return;
      apply();
      applied = true;
      session.requestRedraw();
    },
    undo: () => {
      revert();
      applied = false;
      session.requestRedraw();
    },
  });

  session.document.dirty = true;
  session.requestRedraw();
  return true;
}

export function applyPixelateToImage(
  session: EditorSession,
  image: ImageAsset,
  blockSize: number,
  material?: MaterialAsset | null,
  mode: PixelateMode = 'average',
): boolean {
  return applyPixelateToImages(session, [image], blockSize, material, mode);
}

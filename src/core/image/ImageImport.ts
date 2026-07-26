import type { ModelDocument } from '@/core/document/types';
import {
  createImageAssetFromPixels,
  createTextureAsset,
  fitImageSize,
  IMAGE_SIZE_LIMITS,
} from '@/core/image/PixelEditor';

export type ImportedTextureResult = {
  imageId: string;
  textureId: string;
  width: number;
  height: number;
  scaled: boolean;
  sourceWidth: number;
  sourceHeight: number;
};

export type DecodedImage = {
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  scaled: boolean;
  pixels: Uint8ClampedArray;
};

/** Decode an image without adding it to the project (used by heightmaps and previews). */
export async function decodeImageFile(
  file: File,
  maxAxis: number = IMAGE_SIZE_LIMITS.max,
): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const fitted = fitImageSize(bitmap.width, bitmap.height, maxAxis);
    const canvas = document.createElement('canvas');
    canvas.width = fitted.width;
    canvas.height = fitted.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not read image pixels');
    ctx.imageSmoothingEnabled = fitted.scaled;
    ctx.drawImage(bitmap, 0, 0, fitted.width, fitted.height);
    const data = ctx.getImageData(0, 0, fitted.width, fitted.height);
    return {
      width: fitted.width,
      height: fitted.height,
      sourceWidth: bitmap.width,
      sourceHeight: bitmap.height,
      scaled: fitted.scaled,
      pixels: new Uint8ClampedArray(data.data),
    };
  } finally {
    bitmap.close();
  }
}

/**
 * Decode a browser File (png/jpeg/webp/gif/bmp) into document image + texture assets.
 * Images larger than max axis are downscaled to fit, aspect preserved.
 */
export async function importImageFile(
  doc: ModelDocument,
  file: File,
  options?: { maxAxis?: number; name?: string },
): Promise<ImportedTextureResult> {
  const maxAxis = options?.maxAxis ?? IMAGE_SIZE_LIMITS.max;
  const baseName = options?.name ?? (file.name.replace(/\.[^.]+$/, '') || 'Imported');

  const decoded = await decodeImageFile(file, maxAxis);
  const label = decoded.scaled
    ? `${baseName} (${decoded.width}×${decoded.height})`
    : `${baseName} ${decoded.width}×${decoded.height}`;
  const image = createImageAssetFromPixels(
    doc,
    label,
    decoded.width,
    decoded.height,
    decoded.pixels,
  );
  const texture = createTextureAsset(doc, image, label);
  return {
    imageId: image.id,
    textureId: texture.id,
    width: decoded.width,
    height: decoded.height,
    scaled: decoded.scaled,
    sourceWidth: decoded.sourceWidth,
    sourceHeight: decoded.sourceHeight,
  };
}

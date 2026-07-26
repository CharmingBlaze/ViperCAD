import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@/core/document/ModelDocument';
import {
  createImageAssetFromPixels,
  fitImageSize,
} from '@/core/image/PixelEditor';

describe('fitImageSize', () => {
  it('keeps sizes within max axis', () => {
    expect(fitImageSize(64, 32)).toEqual({ width: 64, height: 32, scaled: false });
  });

  it('downscales preserving aspect', () => {
    expect(fitImageSize(1024, 512, 512)).toEqual({ width: 512, height: 256, scaled: true });
  });
});

describe('createImageAssetFromPixels', () => {
  it('stores RGBA pixels on the document', () => {
    const doc = createEmptyDocument();
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]);
    const image = createImageAssetFromPixels(doc, 'Check', 2, 2, pixels);
    expect(image.width).toBe(2);
    expect(image.height).toBe(2);
    expect([...image.pixels]).toEqual([...pixels]);
    expect(doc.images.get(image.id)).toBe(image);
  });
});

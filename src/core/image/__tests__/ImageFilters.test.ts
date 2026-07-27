import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@/core/document/ModelDocument';
import { pixelatePixels } from '@/core/image/ImageFilters';
import { createImageAsset } from '@/core/image/PixelEditor';

describe('ImageFilters', () => {
  it('pixelatePixels averages colours inside each block', () => {
    const doc = createEmptyDocument('Test');
    const image = createImageAsset(doc, 'Test', 4, 4, [0, 0, 0, 255]);
    image.pixels.set([
      255, 0, 0, 255,   0, 255, 0, 255,   0, 0, 255, 255,   255, 255, 255, 255,
      0, 0, 0, 255,     0, 0, 0, 255,       0, 0, 0, 255,       0, 0, 0, 255,
      255, 255, 0, 255, 255, 255, 0, 255,   255, 255, 0, 255,   255, 255, 0, 255,
      10, 20, 30, 255,  40, 50, 60, 255,    70, 80, 90, 255,    100, 110, 120, 255,
    ]);

    const out = pixelatePixels(image.pixels, 4, 4, 2, 'average');

    expect(out[0]).toBe(64);
    expect(out[1]).toBe(64);
    expect(out[2]).toBe(0);
    expect(out[4]).toBe(out[0]);
    expect(out[8]).toBe(out[0]);
  });

  it('pixelatePixels with block size 1 is unchanged', () => {
    const doc = createEmptyDocument('Test');
    const image = createImageAsset(doc, 'Test', 2, 2, [12, 34, 56, 255]);
    image.pixels.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const out = pixelatePixels(image.pixels, 2, 2, 1);
    expect([...out]).toEqual([...image.pixels]);
  });

  it('pixelatePixels center mode uses the centre texel of each block', () => {
    const doc = createEmptyDocument('Test');
    const image = createImageAsset(doc, 'Test', 4, 4, [0, 0, 0, 255]);
    image.pixels.set([
      10, 0, 0, 255, 20, 0, 0, 255,  30, 0, 0, 255, 40, 0, 0, 255,
      50, 0, 0, 255, 60, 0, 0, 255,  70, 0, 0, 255, 80, 0, 0, 255,
      90, 0, 0, 255, 100, 0, 0, 255, 110, 0, 0, 255, 120, 0, 0, 255,
      130, 0, 0, 255, 140, 0, 0, 255, 150, 0, 0, 255, 160, 0, 0, 255,
    ]);

    const out = pixelatePixels(image.pixels, 4, 4, 2, 'center');

    expect(out[0]).toBe(10);
    expect(out[4]).toBe(10);
    expect(out[8]).toBe(30);
    expect(out[12]).toBe(30);
    expect(out[32]).toBe(90);
    expect(out[48]).toBe(90);
  });

  it('pixelatePixels mosaic mode fills fixed tile cells', () => {
    const doc = createEmptyDocument('Test');
    const image = createImageAsset(doc, 'Test', 4, 4, [0, 0, 0, 255]);
    image.pixels.set([
      200, 0, 0, 255, 200, 0, 0, 255,   0, 0, 200, 255,   0, 0, 200, 255,
      200, 0, 0, 255, 200, 0, 0, 255,   0, 0, 200, 255,   0, 0, 200, 255,
      200, 0, 0, 255, 200, 0, 0, 255,   0, 0, 200, 255,   0, 0, 200, 255,
      200, 0, 0, 255, 200, 0, 0, 255,   0, 0, 200, 255,   0, 0, 200, 255,
    ]);

    const out = pixelatePixels(image.pixels, 4, 4, 2, 'mosaic');

    expect(out[0]).toBe(200);
    expect(out[4]).toBe(200);
    expect(out[8]).toBe(0);
    expect(out[12]).toBe(0);
    expect(out[0]).not.toBe(out[8]);
  });
});

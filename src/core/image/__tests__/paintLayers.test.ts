import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@/core/document/ModelDocument';
import { createImageAsset, getPixel, setPixel } from '@/core/image/PixelEditor';
import {
  addPaintLayer,
  getActivePaintLayer,
  removePaintLayer,
  setActivePaintLayer,
} from '@/core/image/PaintLayers';

describe('paint layers', () => {
  it('keeps the flattened image in sync when painting the top layer', () => {
    const doc = createEmptyDocument();
    const image = createImageAsset(doc, 'Paint', 2, 1, [0, 0, 0, 255]);
    addPaintLayer(image, 'Details');
    expect(image.paintLayers).toHaveLength(2);
    expect(getActivePaintLayer(image)?.name).toBe('Details');
    setPixel(image, 0, 0, [255, 0, 0, 255]);
    expect(getPixel(image, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(getPixel(image, 1, 0)).toEqual([0, 0, 0, 255]);
  });

  it('reveals the background again after the top layer is removed', () => {
    const doc = createEmptyDocument();
    const image = createImageAsset(doc, 'Paint', 1, 1, [0, 0, 255, 255]);
    addPaintLayer(image, 'Cover');
    setPixel(image, 0, 0, [255, 255, 0, 255]);
    expect(getPixel(image, 0, 0)).toEqual([255, 255, 0, 255]);
    const topId = image.activePaintLayerId!;
    setActivePaintLayer(image, image.paintLayers![0]!.id);
    expect(removePaintLayer(image, topId)).toBe(true);
    expect(getPixel(image, 0, 0)).toEqual([0, 0, 255, 255]);
  });
});

import { describe, expect, it } from 'vitest';
import { createDefaultPlaceholderAssets } from '@/core/document/ModelDocument';
import {
  canUseSharedStockPlaceholderMap,
  hydrateDefaultPlaceholderImages,
  isUnhydratedDefaultPlaceholder,
  peekCachedDefaultPlaceholderPixels,
  syncHydrateDefaultPlaceholderImages,
} from '@/core/image/DefaultPlaceholderImage';

describe('default object texture', () => {
  it('starts as the compact generated placeholder', () => {
    const { image } = createDefaultPlaceholderAssets();
    expect(isUnhydratedDefaultPlaceholder(image)).toBe(true);
    expect(image.width).toBe(8);
    expect(image.height).toBe(8);
  });

  it('does not treat painted or imported maps as the generated default', () => {
    const { image } = createDefaultPlaceholderAssets();
    image.pixels[0] = 255;
    expect(isUnhydratedDefaultPlaceholder(image)).toBe(false);
    expect(canUseSharedStockPlaceholderMap(image)).toBe(false);
  });

  it('does not share the stock GPU map after hydrate or user paint', () => {
    const { image } = createDefaultPlaceholderAssets();
    expect(canUseSharedStockPlaceholderMap(image)).toBe(true);
    image.userEdited = true;
    expect(canUseSharedStockPlaceholderMap(image)).toBe(false);
  });

  it('replaces generated pixels with the bundled object texture when available', async () => {
    const { image, texture } = createDefaultPlaceholderAssets();
    const images = new Map([[image.id, image]]);
    const textures = new Map([[texture.id, texture]]);
    const decoded = {
      width: 32,
      height: 32,
      pixels: new Uint8ClampedArray(32 * 32 * 4).fill(90),
    };
    const changed = await hydrateDefaultPlaceholderImages(images, textures, decoded);
    expect(changed).toBe(true);
    expect(image.width).toBe(32);
    expect(image.height).toBe(32);
    expect(image.pixels[0]).toBe(90);
    expect(isUnhydratedDefaultPlaceholder(image)).toBe(false);
    expect(texture.filtering).toBe('linear');
    expect(texture.generateMipmaps).toBe(true);
  });

  it('applies a cached decode immediately', async () => {
    const first = createDefaultPlaceholderAssets();
    const firstImages = new Map([[first.image.id, first.image]]);
    const firstTextures = new Map([[first.texture.id, first.texture]]);
    await hydrateDefaultPlaceholderImages(firstImages, firstTextures, {
      width: 16,
      height: 16,
      pixels: new Uint8ClampedArray(16 * 16 * 4).fill(40),
    });
    expect(peekCachedDefaultPlaceholderPixels()?.width).toBe(16);

    const next = createDefaultPlaceholderAssets();
    const nextImages = new Map([[next.image.id, next.image]]);
    expect(isUnhydratedDefaultPlaceholder(next.image)).toBe(true);
    expect(syncHydrateDefaultPlaceholderImages(nextImages)).toBe(true);
    expect(next.image.width).toBe(16);
    expect(next.image.pixels[0]).toBe(40);
  });
});

import { describe, expect, it } from 'vitest';
import { EditorSession } from '@/core/editor/EditorSession';
import { applyPixelOutlineToImage, flipImageAsset } from '@/core/image/ImageFilters';

describe('PixelOutlineAndFilters', () => {
  it('applies 1px pixel outline around a solid center pixel', () => {
    const session = new EditorSession();
    const image = {
      id: 'img-1',
      name: 'test',
      width: 3,
      height: 3,
      pixels: new Uint8ClampedArray(3 * 3 * 4), // 3x3 transparent image
      revision: 1,
      colourMode: 'rgba' as const,
    };

    // Set center pixel (1, 1) to red
    const centerIdx = (1 * 3 + 1) * 4;
    image.pixels[centerIdx] = 255;
    image.pixels[centerIdx + 3] = 255;

    const outlineColor: [number, number, number, number] = [0, 255, 0, 255];
    const changed = applyPixelOutlineToImage(session, image, outlineColor);

    expect(changed).toBe(true);
    expect(image.revision).toBe(2);

    // Top neighbor (1, 0) should now be green outline
    const topIdx = (0 * 3 + 1) * 4;
    expect(image.pixels[topIdx + 1]).toBe(255);
    expect(image.pixels[topIdx + 3]).toBe(255);
  });

  it('flips image asset horizontally', () => {
    const session = new EditorSession();
    const image = {
      id: 'img-2',
      name: 'test-flip',
      width: 2,
      height: 1,
      pixels: new Uint8ClampedArray([
        255, 0, 0, 255, // Left pixel: Red
        0, 0, 255, 255, // Right pixel: Blue
      ]),
      revision: 1,
      colourMode: 'rgba' as const,
    };

    flipImageAsset(session, image, 'horizontal');

    // Left pixel should now be Blue (0, 0, 255)
    expect(image.pixels[0]).toBe(0);
    expect(image.pixels[2]).toBe(255);
    // Right pixel should now be Red (255, 0, 0)
    expect(image.pixels[4]).toBe(255);
    expect(image.pixels[6]).toBe(0);
  });
});

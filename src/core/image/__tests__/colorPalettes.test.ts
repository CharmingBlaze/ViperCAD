import { describe, expect, it } from 'vitest';
import { BUILTIN_PALETTES, createCustomPalette, findPalette, listPalettes } from '@/core/image/ColorPalettes';

describe('color palettes', () => {
  it('includes game-system palettes and custom copies', () => {
    expect(BUILTIN_PALETTES.some((palette) => palette.id === 'nes')).toBe(true);
    expect(BUILTIN_PALETTES.some((palette) => palette.id === 'c64')).toBe(true);
    expect(BUILTIN_PALETTES.some((palette) => palette.id === 'mastersystem')).toBe(true);
    const custom = createCustomPalette('My game', ['#112233', '#abcdef']);
    expect(custom.custom).toBe(true);
    expect(findPalette(custom.id, [custom]).colors).toEqual(['#112233', '#abcdef']);
    expect(listPalettes([custom]).some((palette) => palette.id === custom.id)).toBe(true);
  });
});

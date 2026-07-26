import { describe, expect, it } from 'vitest';
import {
  generateHeightmap,
  type HeightmapGeneratorKind,
} from '@/core/terrain/HeightmapGenerator';

const options = {
  kind: 'noise' as HeightmapGeneratorKind,
  size: 32,
  seed: 42,
  featureScale: 4,
  octaves: 4,
  roughness: 0.5,
};

const valueAt = (
  map: ReturnType<typeof generateHeightmap>,
  x: number,
  y: number,
) => map.pixels[(y * map.width + x) * 4]!;

describe('procedural heightmap generation', () => {
  it('is deterministic for the same seed and changes with another seed', () => {
    const first = generateHeightmap(options);
    const second = generateHeightmap(options);
    const different = generateHeightmap({ ...options, seed: 43 });
    expect(first.width).toBe(32);
    expect([...first.pixels]).toEqual([...second.pixels]);
    expect([...first.pixels]).not.toEqual([...different.pixels]);
  });

  it('produces opaque grayscale data with useful height variation', () => {
    const generated = generateHeightmap({ ...options, kind: 'mountains' });
    const values: number[] = [];
    for (let index = 0; index < generated.pixels.length; index += 4) {
      const red = generated.pixels[index]!;
      expect(generated.pixels[index + 1]).toBe(red);
      expect(generated.pixels[index + 2]).toBe(red);
      expect(generated.pixels[index + 3]).toBe(255);
      values.push(red);
    }
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(40);
  });

  it('makes island edges lower than the centre', () => {
    const island = generateHeightmap({ ...options, kind: 'island', size: 64 });
    const centre = valueAt(island, 32, 32);
    const edges = [
      valueAt(island, 0, 0),
      valueAt(island, 63, 0),
      valueAt(island, 0, 63),
      valueAt(island, 63, 63),
    ];
    expect(centre).toBeGreaterThan(Math.max(...edges));
  });

  it('supports every generator style', () => {
    const kinds: HeightmapGeneratorKind[] = [
      'noise',
      'mountains',
      'ridged',
      'island',
      'terraces',
      'crater',
    ];
    for (const kind of kinds) {
      const generated = generateHeightmap({ ...options, kind, size: 24 });
      expect(generated.pixels).toHaveLength(24 * 24 * 4);
      const values = [...generated.pixels].filter((_, index) => index % 4 === 0);
      expect(new Set(values).size).toBeGreaterThan(4);
    }
  });
});

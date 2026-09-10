import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@/core/document/ModelDocument';
import { DEFAULT_BLOCKOUT_CLAY, ensureBlockoutMaterial } from '../BlockoutMaterial';

describe('BlockoutMaterial', () => {
  it('creates a light untextured clay and reuses it', () => {
    const doc = createEmptyDocument();
    const first = ensureBlockoutMaterial(doc);
    const second = ensureBlockoutMaterial(doc);
    expect(first).toBe(second);
    const material = doc.materials.get(first)!;
    expect(material.name).toBe(DEFAULT_BLOCKOUT_CLAY.name);
    expect(material.baseColourTextureId).toBeTruthy();
    expect(material.baseColour.x).toBeCloseTo(DEFAULT_BLOCKOUT_CLAY.rgb.x);
  });
});

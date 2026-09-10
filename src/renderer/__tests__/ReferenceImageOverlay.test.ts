import { describe, expect, it } from 'vitest';
import { ReferenceImageOverlayHandle } from '@/renderer/ReferenceImageOverlay';

describe('ReferenceImageOverlayHandle', () => {
  it('draws reference materials without depth so a solid cannot hide them', () => {
    const overlay = new ReferenceImageOverlayHandle();
    const materials = overlay.group.children.flatMap((child) => {
      const material = (child as { material?: { depthTest?: boolean; toneMapped?: boolean } }).material;
      return material ? [material] : [];
    });
    expect(materials.length).toBeGreaterThan(0);
    for (const material of materials) {
      expect(material.depthTest).toBe(false);
      expect(material.toneMapped).toBe(false);
    }
    overlay.dispose();
  });
});

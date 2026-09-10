import {
  DataTexture,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
} from 'three';

export type SculptMatCapType = 'default' | 'clay' | 'red_wax' | 'studio_gray' | 'pearl';

const matcapTextureCache = new Map<SculptMatCapType, DataTexture>();

/**
 * Generates procedural spherical MatCap textures for high-fidelity surface inspection.
 */
export function getSculptMatCapTexture(type: SculptMatCapType): DataTexture {
  let tex = matcapTextureCache.get(type);
  if (tex) return tex;

  const size = 128;
  const data = new Uint8Array(size * size * 4);
  const half = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const nx = (x - half) / half;
      const ny = -(y - half) / half;
      const r2 = nx * nx + ny * ny;

      if (r2 > 1.0) {
        // Outside circle
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 0;
        continue;
      }

      const nz = Math.sqrt(Math.max(0, 1.0 - r2));

      // Key light from top-right-front
      const l1x = 0.5, l1y = 0.6, l1z = 0.62;
      const diff1 = Math.max(0, nx * l1x + ny * l1y + nz * l1z);

      // Rim light from top-back
      const rim = Math.pow(1 - nz, 2.5);

      // Specular highlight
      const hx = (l1x + 0) * 0.707;
      const hy = (l1y + 0) * 0.707;
      const hz = (l1z + 1) * 0.707;
      const spec = Math.pow(Math.max(0, nx * hx + ny * hy + nz * hz), 20);

      let r = 0, g = 0, b = 0;

      if (type === 'clay') {
        // Warm terracotta clay
        r = (0.45 + 0.42 * diff1 + 0.22 * spec + 0.15 * rim) * 255;
        g = (0.32 + 0.35 * diff1 + 0.20 * spec + 0.10 * rim) * 255;
        b = (0.24 + 0.28 * diff1 + 0.18 * spec + 0.08 * rim) * 255;
      } else if (type === 'red_wax') {
        // ZBrush Red Wax
        r = (0.55 + 0.40 * diff1 + 0.35 * spec + 0.25 * rim) * 255;
        g = (0.12 + 0.22 * diff1 + 0.30 * spec + 0.10 * rim) * 255;
        b = (0.12 + 0.20 * diff1 + 0.30 * spec + 0.10 * rim) * 255;
      } else if (type === 'pearl') {
        // High specular pearl
        const specSharp = Math.pow(Math.max(0, nx * hx + ny * hy + nz * hz), 45);
        r = (0.65 + 0.28 * diff1 + 0.55 * specSharp + 0.20 * rim) * 255;
        g = (0.68 + 0.28 * diff1 + 0.55 * specSharp + 0.20 * rim) * 255;
        b = (0.75 + 0.22 * diff1 + 0.55 * specSharp + 0.25 * rim) * 255;
      } else {
        // Studio Gray (default)
        r = (0.35 + 0.45 * diff1 + 0.25 * spec + 0.15 * rim) * 255;
        g = (0.35 + 0.45 * diff1 + 0.25 * spec + 0.15 * rim) * 255;
        b = (0.37 + 0.45 * diff1 + 0.25 * spec + 0.15 * rim) * 255;
      }

      data[idx] = Math.min(255, Math.max(0, Math.round(r)));
      data[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      data[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      data[idx + 3] = 255;
    }
  }

  tex = new DataTexture(data, size, size, RGBAFormat);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  matcapTextureCache.set(type, tex);
  return tex;
}

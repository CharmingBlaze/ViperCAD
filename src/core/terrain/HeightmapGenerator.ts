export type HeightmapGeneratorKind =
  | 'noise'
  | 'mountains'
  | 'ridged'
  | 'island'
  | 'terraces'
  | 'crater';

export type HeightmapGeneratorOptions = {
  kind: HeightmapGeneratorKind;
  size: number;
  seed: number;
  featureScale: number;
  octaves: number;
  roughness: number;
};

export type GeneratedHeightmap = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
};

export const HEIGHTMAP_GENERATOR_LABELS: Record<HeightmapGeneratorKind, string> = {
  noise: 'Rolling noise',
  mountains: 'Mountains',
  ridged: 'Ridged peaks',
  island: 'Island',
  terraces: 'Terraces',
  crater: 'Crater',
};

export function generateHeightmap(
  options: HeightmapGeneratorOptions,
): GeneratedHeightmap {
  const size = clamp(Math.round(options.size) || 256, 16, 512);
  const seed = Math.round(options.seed) || 1;
  const scale = clamp(options.featureScale || 4, 0.5, 32);
  const octaves = clamp(Math.round(options.octaves) || 4, 1, 8);
  const roughness = clamp(options.roughness || 0.5, 0.05, 0.95);
  const pixels = new Uint8ClampedArray(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = size === 1 ? 0 : x / (size - 1);
      const v = size === 1 ? 0 : y / (size - 1);
      const base = fractalNoise(u * scale, v * scale, seed, octaves, roughness);
      let value = base;

      if (options.kind === 'mountains') {
        const ridge = 1 - Math.abs(base * 2 - 1);
        value = clamp01(Math.pow(base, 1.45) * 0.72 + Math.pow(ridge, 2.2) * 0.38);
      } else if (options.kind === 'ridged') {
        value = Math.pow(1 - Math.abs(base * 2 - 1), 2.1);
      } else if (options.kind === 'island') {
        const dx = u * 2 - 1;
        const dy = v * 2 - 1;
        const distance = Math.hypot(dx, dy);
        const falloff = 1 - smoothstep(0.42, 1, distance);
        value = clamp01((base * 0.75 + 0.25) * falloff);
      } else if (options.kind === 'terraces') {
        const steps = 9;
        const stepped = Math.floor(base * steps) / (steps - 1);
        value = clamp01(stepped * 0.92 + base * 0.08);
      } else if (options.kind === 'crater') {
        const dx = u * 2 - 1;
        const dy = v * 2 - 1;
        const distance = Math.hypot(dx, dy);
        const rim = Math.exp(-Math.pow((distance - 0.58) / 0.085, 2));
        const bowl = Math.max(0, 1 - distance / 0.58);
        const outerFalloff = 1 - smoothstep(0.78, 1.25, distance);
        value = clamp01((0.42 + base * 0.22 + rim * 0.5 - bowl * 0.52) * outerFalloff);
      }

      const byte = Math.round(clamp01(value) * 255);
      const index = (y * size + x) * 4;
      pixels[index] = byte;
      pixels[index + 1] = byte;
      pixels[index + 2] = byte;
      pixels[index + 3] = 255;
    }
  }
  return { width: size, height: size, pixels };
}

function fractalNoise(
  x: number,
  y: number,
  seed: number,
  octaves: number,
  roughness: number,
): number {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave++) {
    total += valueNoise(x * frequency, y * frequency, seed + octave * 1013) * amplitude;
    weight += amplitude;
    amplitude *= roughness;
    frequency *= 2;
  }
  return weight > 0 ? total / weight : 0;
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

function hash2(x: number, y: number, seed: number): number {
  let value = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(1e-8, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

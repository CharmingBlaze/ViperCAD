export type SculptFalloff = 'smooth' | 'linear' | 'sharp' | 'spherical' | 'root' | 'constant';

export function falloffWeight(t: number, falloff: SculptFalloff): number {
  const x = Math.max(0, Math.min(1, 1 - t));
  if (x <= 0) return 0;
  if (falloff === 'linear') return x;
  if (falloff === 'sharp') return x * x * x;
  if (falloff === 'spherical') return Math.sqrt(Math.max(0, 1 - (1 - x) * (1 - x)));
  if (falloff === 'root') return Math.sqrt(x);
  if (falloff === 'constant') return 1;
  return x * x * (3 - 2 * x);
}

export function clampSculpt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value) || min));
}

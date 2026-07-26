export type SculptFalloff = 'smooth' | 'linear' | 'sharp';

export function falloffWeight(t: number, falloff: SculptFalloff): number {
  const x = Math.max(0, Math.min(1, 1 - t));
  if (falloff === 'linear') return x;
  if (falloff === 'sharp') return x * x * x;
  return x * x * (3 - 2 * x);
}

export function clampSculpt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value) || min));
}

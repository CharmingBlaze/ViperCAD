export type Vec3 = { x: number; y: number; z: number };

export function v3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function cloneVec3(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scaleVec3(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function negateVec3(a: Vec3): Vec3 {
  return { x: -a.x, y: -a.y, z: -a.z };
}

export function dotVec3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function lengthVec3(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function lengthSqVec3(a: Vec3): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function normalizeVec3(a: Vec3): Vec3 {
  const len = lengthVec3(a);
  if (len < 1e-12) return { x: 0, y: 0, z: 0 };
  return scaleVec3(a, 1 / len);
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export function almostEqualVec3(a: Vec3, b: Vec3, eps = 1e-8): boolean {
  return (
    Math.abs(a.x - b.x) <= eps &&
    Math.abs(a.y - b.y) <= eps &&
    Math.abs(a.z - b.z) <= eps
  );
}

export function isFiniteVec3(a: Vec3): boolean {
  return Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);
}

export const AXIS_X = Object.freeze(v3(1, 0, 0));
export const AXIS_Y = Object.freeze(v3(0, 1, 0));
export const AXIS_Z = Object.freeze(v3(0, 0, 1));
export const AXIS_NEG_X = Object.freeze(v3(-1, 0, 0));
export const AXIS_NEG_Y = Object.freeze(v3(0, -1, 0));
export const AXIS_NEG_Z = Object.freeze(v3(0, 0, -1));

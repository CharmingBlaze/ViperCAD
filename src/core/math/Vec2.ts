export type Vec2 = { x: number; y: number };

export function v2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function cloneVec2(v: Vec2): Vec2 {
  return { x: v.x, y: v.y };
}

export function lerpVec2(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function isFiniteVec2(a: Vec2): boolean {
  return Number.isFinite(a.x) && Number.isFinite(a.y);
}

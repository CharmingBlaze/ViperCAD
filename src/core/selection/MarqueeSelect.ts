/** Shared marquee / box-select helpers (UV + 3D). */

export type ScreenRect = { minX: number; minY: number; maxX: number; maxY: number };

/** Blender-style: drag right = window (contain), drag left = crossing (touch). */
export type MarqueeMode = 'window' | 'crossing';

export function normalizeScreenRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): ScreenRect {
  return {
    minX: Math.min(ax, bx),
    minY: Math.min(ay, by),
    maxX: Math.max(ax, bx),
    maxY: Math.max(ay, by),
  };
}

export function marqueeModeFromDrag(startX: number, currentX: number): MarqueeMode {
  return currentX >= startX ? 'window' : 'crossing';
}

export function pointInRect(x: number, y: number, rect: ScreenRect, pad = 0): boolean {
  return (
    x >= rect.minX - pad &&
    x <= rect.maxX + pad &&
    y >= rect.minY - pad &&
    y <= rect.maxY + pad
  );
}

/** True if the segment AB intersects or touches the axis-aligned rect. */
export function segmentHitsRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  rect: ScreenRect,
): boolean {
  if (pointInRect(ax, ay, rect) || pointInRect(bx, by, rect)) return true;
  // Liang–Barsky style clips against each edge.
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, ax - rect.minX) &&
    clip(dx, rect.maxX - ax) &&
    clip(-dy, ay - rect.minY) &&
    clip(dy, rect.maxY - ay) &&
    t0 <= t1
  );
}

export function pointsSatisfyMarquee(
  points: { x: number; y: number }[],
  rect: ScreenRect,
  mode: MarqueeMode,
): boolean {
  if (!points.length) return false;
  if (mode === 'window') return points.every((p) => pointInRect(p.x, p.y, rect));
  return points.some((p) => pointInRect(p.x, p.y, rect));
}

/** Minimum drag in screen pixels before a marquee counts as a box (else click). */
export const MARQUEE_MIN_DRAG_PX = 4;

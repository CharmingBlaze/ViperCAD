/** High-fidelity outline boundary prep — light dedupe, soft cap, no angle crushing. */

export function lightCleanupBoundary(
  points: { u: number; v: number }[],
  closed: boolean,
  minDistance = 0.35,
): { u: number; v: number }[] {
  if (points.length === 0) return [];
  const working = points.map((point) => ({ ...point }));
  const deduped: { u: number; v: number }[] = [{ ...working[0]! }];
  for (let index = 1; index < working.length; index++) {
    const point = working[index]!;
    const previous = deduped[deduped.length - 1]!;
    if (Math.hypot(point.u - previous.u, point.v - previous.v) >= minDistance) {
      deduped.push({ ...point });
    } else if (!closed && index === working.length - 1) {
      deduped[deduped.length - 1] = { ...point };
    }
  }
  if (!closed && working.length >= 2) {
    deduped[deduped.length - 1] = { ...working[working.length - 1]! };
  }
  return deduped;
}

export function capBoundaryPoints(
  points: { u: number; v: number }[],
  maxPoints: number,
): { u: number; v: number }[] {
  if (points.length <= maxPoints) return points;
  const out: { u: number; v: number }[] = [];
  const step = points.length / maxPoints;
  for (let index = 0; index < maxPoints; index++) {
    out.push(points[Math.min(points.length - 1, Math.round(index * step))]!);
  }
  return out;
}

export function outlineBoundaryBudget(
  outlineSegments: number,
  pointCount: number,
  closed: boolean,
): number {
  const softCap = closed ? Math.max(512, outlineSegments * 8) : Math.max(256, outlineSegments * 4);
  return Math.min(pointCount, softCap);
}

export function prepareOutlineBoundary(
  points: { u: number; v: number }[],
  outlineSegments: number,
  closed: boolean,
): { u: number; v: number }[] | null {
  const deduped = lightCleanupBoundary(points, closed);
  if (closed) {
    if (deduped.length < 3) return null;
    const shaped = ensureCCW(deduped);
    const maxBoundary = outlineBoundaryBudget(outlineSegments, shaped.length, true);
    return shaped.length <= maxBoundary ? shaped : capBoundaryPoints(shaped, maxBoundary);
  }
  if (deduped.length < 2) return null;
  const maxPath = outlineBoundaryBudget(outlineSegments, deduped.length, false);
  return deduped.length <= maxPath ? deduped : capBoundaryPoints(deduped, maxPath);
}

export function preparePathCenterline(
  points: { u: number; v: number }[],
  outlineSegments: number,
): { u: number; v: number }[] | null {
  const deduped = lightCleanupBoundary(points, false, 0.25);
  if (deduped.length < 2) return null;
  const maxSpine = Math.max(outlineSegments * 2, Math.min(deduped.length, 128));
  return deduped.length <= maxSpine ? deduped : capBoundaryPoints(deduped, maxSpine);
}

function ensureCCW(points: { u: number; v: number }[]): { u: number; v: number }[] {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += current.u * next.v - next.u * next.v;
  }
  return area >= 0 ? points : [...points].reverse();
}

import { describe, expect, it } from 'vitest';
import type { EditableMesh } from '@/core/mesh/types';
import { validateMeshFull } from '@/core/mesh/Validation';
import { buildVerticalShapedCapsule } from '@/core/mesh/builders/VerticalCapsuleBuilder';

function stadiumBoundary(cx: number, cy: number, radius: number, bodyLen: number, segs = 24) {
  const pts: { x: number; y: number }[] = [];
  const y0 = cy - bodyLen / 2;
  const y1 = cy + bodyLen / 2;
  for (let i = 0; i <= segs; i++) {
    const a = Math.PI + (i / segs) * Math.PI;
    pts.push({ x: cx + Math.cos(a) * radius, y: y0 + Math.sin(a) * radius });
  }
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI;
    pts.push({ x: cx + Math.cos(a) * radius, y: y1 + Math.sin(a) * radius });
  }
  return pts;
}

function diamondBoundary(cx: number, cy: number, halfW: number, halfH: number) {
  return [
    { x: cx, y: cy - halfH },
    { x: cx + halfW, y: cy },
    { x: cx, y: cy + halfH },
    { x: cx - halfW, y: cy },
  ];
}

function positions(mesh: EditableMesh) {
  return [...mesh.vertices.values()].map((vertex) => vertex.position);
}

function ringYs(mesh: EditableMesh) {
  const ys = new Set<number>();
  for (const point of positions(mesh)) ys.add(Math.round(point.y * 1000) / 1000);
  return [...ys].sort((a, b) => a - b);
}

function ringRadii(mesh: EditableMesh) {
  const byY = new Map<number, { x: number; z: number }[]>();
  for (const point of positions(mesh)) {
    const key = Math.round(point.y * 1000) / 1000;
    const list = byY.get(key) ?? [];
    list.push({ x: point.x, z: point.z });
    byY.set(key, list);
  }
  return [...byY.entries()]
    .map(([y, pts]) => {
      if (pts.length < 3) return { y, radius: 0, isPole: true };
      const mx = pts.reduce((sum, point) => sum + point.x, 0) / pts.length;
      const mz = pts.reduce((sum, point) => sum + point.z, 0) / pts.length;
      const radius =
        pts.reduce((sum, point) => sum + Math.hypot(point.x - mx, point.z - mz), 0) / pts.length;
      return { y, radius, isPole: false };
    })
    .sort((a, b) => a.y - b.y);
}

describe('VerticalCapsuleBuilder', () => {
  it('gently follows silhouette width while retaining a rounded capsule profile', () => {
    const boundary = [
      { x: -6, y: -30 },
      { x: 6, y: -30 },
      { x: 10, y: -12 },
      { x: 15, y: 12 },
      { x: 9, y: 30 },
      { x: -9, y: 30 },
      { x: -15, y: 12 },
      { x: -10, y: -12 },
    ];
    const ideal = buildVerticalShapedCapsule(boundary, {
      radialSegments: 12,
      profileRings: 12,
      silhouetteInfluence: 0,
    });
    const shaped = buildVerticalShapedCapsule(boundary, {
      radialSegments: 12,
      profileRings: 12,
      silhouetteInfluence: 0.3,
    });

    const idealRings = ringRadii(ideal).filter((ring) => !ring.isPole);
    const shapedRings = ringRadii(shaped).filter((ring) => !ring.isPole);
    expect(shapedRings).toHaveLength(idealRings.length);
    expect(
      shapedRings.some((ring, index) => Math.abs(ring.radius - idealRings[index]!.radius) > 0.1),
    ).toBe(true);
    for (let index = 0; index < shapedRings.length; index++) {
      const ratio = shapedRings[index]!.radius / idealRings[index]!.radius;
      expect(ratio).toBeGreaterThan(0.85);
      expect(ratio).toBeLessThan(1.15);
    }
  });

  it('orders meridian rings from bottom pole to top pole without folding the top cap', () => {
    const segments = 10;
    const mesh = buildVerticalShapedCapsule(stadiumBoundary(0, 0, 9, 38), {
      radialSegments: segments,
      profileRings: 10,
    });
    const pts = positions(mesh);

    const orderedYs = [pts[0]!.y];
    for (let index = 1; index < pts.length - 1; index += segments) {
      orderedYs.push(pts[index]!.y);
    }
    orderedYs.push(pts[pts.length - 1]!.y);

    for (let index = 1; index < orderedYs.length; index++) {
      expect(orderedYs[index]!).toBeGreaterThan(orderedYs[index - 1]!);
    }
  });

  it('spaces rings evenly instead of packing the equator', () => {
    const mesh = buildVerticalShapedCapsule(stadiumBoundary(0, 0, 10, 40), {
      radialSegments: 8,
      profileRings: 10,
    });
    const ys = ringYs(mesh);
    expect(ys.length).toBeGreaterThan(6);
    expect(ys.length).toBeLessThan(22);

    const gaps: number[] = [];
    for (let index = 1; index < ys.length; index++) gaps.push(ys[index]! - ys[index - 1]!);
    const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    expect(Math.max(...gaps) / mean).toBeLessThan(2.4);
    expect(Math.min(...gaps) / mean).toBeGreaterThan(0.25);
  });

  it('keeps round tip rings on pointed diamond silhouettes', () => {
    const mesh = buildVerticalShapedCapsule(diamondBoundary(0, 0, 12, 40), {
      radialSegments: 8,
      profileRings: 10,
    });
    const rings = ringRadii(mesh).filter((ring) => !ring.isPole);
    const maxBody = Math.max(...rings.map((ring) => ring.radius));
    expect(rings[0]!.radius).toBeGreaterThan(maxBody * 0.35);
    expect(rings[rings.length - 1]!.radius).toBeGreaterThan(maxBody * 0.35);
    expect(Math.max(...rings.slice(0, 3).map((ring) => ring.radius))).toBeGreaterThan(
      maxBody * 0.65,
    );
  });

  it('stays low-poly with default sketch budget settings', () => {
    const mesh = buildVerticalShapedCapsule(stadiumBoundary(0, 0, 8, 36), {
      radialSegments: 12,
      profileRings: 14,
    });
    expect(mesh.vertices.size).toBeLessThan(340);
    expect(validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });
});

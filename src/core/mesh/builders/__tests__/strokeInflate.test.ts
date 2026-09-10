import { describe, expect, it } from 'vitest';
import { v3 } from '@/core/math/Vec3';
import {
  buildInflatedDoodle,
  doodleCloseDistance,
  isStrokeClosed,
} from '@/core/mesh/builders/StrokeInflateBuilder';
import { validateMeshFull } from '@/core/mesh/Validation';

function circlePoints(n: number, r = 1): ReturnType<typeof v3>[] {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(v3(Math.cos(a) * r, Math.sin(a) * r, 0));
  }
  // Return near start to close.
  pts.push(v3(r, 0, 0.001));
  return pts;
}

describe('StrokeInflateBuilder', () => {
  it('detects a closed loop when the end meets the start', () => {
    const pts = circlePoints(12, 1);
    expect(isStrokeClosed(pts, doodleCloseDistance(0.08, 6))).toBe(true);
    expect(isStrokeClosed(pts.slice(0, 8), 0.1)).toBe(false);
  });

  it('inflates a closed doodle into a solid low-poly mesh', () => {
    const mesh = buildInflatedDoodle({
      points: circlePoints(20, 1),
      thickness: 0.1,
      outlineSegments: 16,
      profile: 'sharp',
    });
    expect(mesh.faces.size).toBeGreaterThan(16);
    expect(mesh.vertices.size).toBeGreaterThan(24);
    const report = validateMeshFull(mesh);
    expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
    for (const v of mesh.vertices.values()) {
      expect(Number.isFinite(v.position.x)).toBe(true);
    }
    const sidesByFace = new Map<string, number>();
    for (const corner of mesh.faceCorners.values()) {
      sidesByFace.set(corner.faceId, (sidesByFace.get(corner.faceId) ?? 0) + 1);
    }
    expect([...sidesByFace.values()].some((count) => count === 4)).toBe(true);
  });

  it('uses more outline verts for medium poly', () => {
    const pts = circlePoints(40, 1);
    const low = buildInflatedDoodle({ points: pts, thickness: 0.08, outlineSegments: 16 });
    const mid = buildInflatedDoodle({ points: pts, thickness: 0.08, outlineSegments: 28 });
    expect(mid.vertices.size).toBeGreaterThan(low.vertices.size);
  });

  it('builds an exact vector pen outline as a flat prism', () => {
    const mesh = buildInflatedDoodle({
      points: [v3(0, 0, 0), v3(2, 0, 0), v3(2, 1, 0), v3(0, 1, 0)],
      thickness: 0.08,
      outlineSegments: 16,
      profile: 'sharp',
      closed: true,
      exactOutline: true,
    });
    expect(mesh.vertices.size).toBe(8);
    expect(mesh.faces.size).toBe(6);
    expect(validateMeshFull(mesh).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('extrudes blob depth from brush thickness, not a fixed minimum', () => {
    const thickness = 0.1;
    const mesh = buildInflatedDoodle({
      points: circlePoints(20, 1),
      thickness,
      outlineSegments: 16,
      profile: 'soft',
    });
    const zs = [...mesh.vertices.values()].map((vertex) => vertex.position.z);
    const height = Math.max(...zs) - Math.min(...zs);
    expect(height).toBeCloseTo(thickness * 3.5, 1);
    expect(height).toBeLessThan(1);
  });

  it('builds a valid soft blob dome with quad rings and cap transitions', () => {
    const outline = buildInflatedDoodle({
      points: circlePoints(30, 1),
      thickness: 0.12,
      outlineSegments: 16,
      profile: 'sharp',
    });
    const mesh = buildInflatedDoodle({
      points: circlePoints(30, 1),
      thickness: 0.12,
      outlineSegments: 16,
      profile: 'soft',
    });
    expect(mesh.vertices.size).toBeGreaterThan(outline.vertices.size);
    expect(mesh.faces.size).toBeGreaterThan(50);
    expect(validateMeshFull(mesh).issues.filter((i) => i.severity === 'error')).toEqual([]);
    const sidesByFace = new Map<string, number>();
    for (const corner of mesh.faceCorners.values()) {
      sidesByFace.set(corner.faceId, (sidesByFace.get(corner.faceId) ?? 0) + 1);
    }
    const sideCounts = [...sidesByFace.values()];
    expect(sideCounts.some((count) => count === 4)).toBe(true);
    expect(sideCounts.some((count) => count === 3)).toBe(true);
    const layerId = mesh.defaultUvLayerId!;
    const uvs = [...mesh.faceCorners.values()]
      .map((corner) => corner.uvs.get(layerId))
      .filter((uv): uv is { x: number; y: number } => !!uv);
    expect(Math.min(...uvs.map((uv) => uv.x))).toBeCloseTo(0);
    expect(Math.max(...uvs.map((uv) => uv.x))).toBeCloseTo(1);
    expect(Math.min(...uvs.map((uv) => uv.y))).toBeCloseTo(0);
    expect(Math.max(...uvs.map((uv) => uv.y))).toBeCloseTo(1);
    expect(new Set(uvs.map((uv) => `${uv.x.toFixed(5)}:${uv.y.toFixed(5)}`)).size)
      .toBeLessThan(uvs.length / 2);
  });

  it('builds a closed outline into a rounded capsule solid', () => {
    const mesh = buildInflatedDoodle({
      points: circlePoints(24, 1),
      thickness: 0.15,
      outlineSegments: 16,
      profile: 'capsule',
    });
    expect(mesh.vertices.size).toBeGreaterThan(32);
    expect(mesh.faces.size).toBeGreaterThan(32);
    expect(validateMeshFull(mesh).issues.filter((i) => i.severity === 'error')).toEqual([]);
    const zs = [...mesh.vertices.values()].map((vertex) => vertex.position.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.2);
  });
});

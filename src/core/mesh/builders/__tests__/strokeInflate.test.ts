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
    });
    expect(mesh.faces.size).toBeGreaterThan(16);
    expect(mesh.vertices.size).toBe(32); // front + back rings
    const report = validateMeshFull(mesh);
    expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
    for (const v of mesh.vertices.values()) {
      expect(Number.isFinite(v.position.x)).toBe(true);
    }
  });

  it('uses more outline verts for medium poly', () => {
    const pts = circlePoints(40, 1);
    const low = buildInflatedDoodle({ points: pts, thickness: 0.08, outlineSegments: 16 });
    const mid = buildInflatedDoodle({ points: pts, thickness: 0.08, outlineSegments: 28 });
    expect(mid.vertices.size).toBeGreaterThan(low.vertices.size);
  });

  it('builds a valid beveled soft shape with controlled topology', () => {
    const mesh = buildInflatedDoodle({
      points: circlePoints(30, 1),
      thickness: 0.12,
      outlineSegments: 16,
      profile: 'soft',
    });
    expect(mesh.vertices.size).toBe(64); // four clean outline rings
    expect(mesh.faces.size).toBeGreaterThan(50);
    expect(validateMeshFull(mesh).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

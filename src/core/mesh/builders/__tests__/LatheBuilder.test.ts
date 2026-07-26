import { describe, expect, it } from 'vitest';
import { v3 } from '@/core/math/Vec3';
import { validateMeshFull } from '@/core/mesh/Validation';
import { buildLathe } from '@/core/mesh/builders/LatheBuilder';

describe('LatheBuilder', () => {
  it('revolves an editable profile into valid quad-ring geometry', () => {
    const mesh = buildLathe({
      points: [
        v3(0, -1, 0),
        v3(0.65, -0.75, 0),
        v3(1, 0, 0),
        v3(0.55, 0.8, 0),
        v3(0, 1, 0),
      ],
      axis: 'y',
      radialSegments: 12,
      profileRings: 16,
      smoothing: 0,
      angleDegrees: 360,
      capStart: true,
      capEnd: true,
    });
    expect(mesh.vertices.size).toBe(38);
    expect(mesh.faces.size).toBeGreaterThan(30);
    expect(validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('finalizes with outward winding when the profile is drawn in reverse', () => {
    const mesh = buildLathe({
      points: [
        v3(0, 1.5, 0),
        v3(0.8, 0.9, 0),
        v3(1.1, 0.1, 0),
        v3(0.55, -0.8, 0),
        v3(0, -1.2, 0),
      ],
      axis: 'y',
      radialSegments: 20,
      profileRings: 32,
      smoothing: 0.15,
      angleDegrees: 360,
      capStart: true,
      capEnd: true,
    });
    expect(validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('supports partial revolutions, profile reduction, and every axis', () => {
    const profile = Array.from({ length: 40 }, (_unused, index) =>
      v3(0.2 + Math.sin(index / 39 * Math.PI) * 0.8, index / 10, 0),
    );
    for (const axis of ['x', 'y', 'z'] as const) {
      const mesh = buildLathe({
        points: profile,
        axis,
        radialSegments: 16,
        profileRings: 10,
        smoothing: 0.35,
        angleDegrees: 180,
        capStart: false,
        capEnd: false,
      });
      expect(mesh.vertices.size).toBeLessThanOrEqual(170);
      expect(mesh.faces.size).toBeGreaterThan(0);
      expect(validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    }
  });
});

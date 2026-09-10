import { describe, expect, it } from 'vitest';
import { buildSphere } from '@/core/mesh/builders/SphereBuilder';
import { applyMeshBrush } from '@/core/sculpt/BrushOps';
import { falloffWeight } from '@/core/sculpt/BrushFalloff';

describe('BrushOps', () => {
  it('calculates expected falloff curves', () => {
    expect(falloffWeight(0, 'smooth')).toBe(1);
    expect(falloffWeight(1, 'smooth')).toBe(0);
    expect(falloffWeight(0.5, 'linear')).toBe(0.5);
    expect(falloffWeight(0.5, 'constant')).toBe(1);
    expect(falloffWeight(0.25, 'root')).toBeCloseTo(Math.sqrt(0.75), 3);
    expect(falloffWeight(0.5, 'spherical')).toBeGreaterThan(0.5);
  });

  it('clay brush builds surface up to offset plane', () => {
    const mesh = buildSphere({ radius: 1, widthSegments: 16, heightSegments: 12 });
    const center = { x: 0, y: 1, z: 0 };
    const normal = { x: 0, y: 1, z: 0 };

    const topVertex = [...mesh.vertices.values()].find((v) => Math.abs(v.position.y - 1) < 0.05)!;
    const initialY = topVertex.position.y;

    applyMeshBrush(mesh, 'clay', center, 0.5, 0.2, 'smooth', false, {
      contactNormal: normal,
    });

    expect(topVertex.position.y).toBeGreaterThan(initialY);
  });

  it('draw brush displaces along contact normal and inverts with sign', () => {
    const mesh = buildSphere({ radius: 1, widthSegments: 16, heightSegments: 12 });
    const center = { x: 0, y: 1, z: 0 };
    const normal = { x: 0, y: 1, z: 0 };

    const topVertex = [...mesh.vertices.values()].find((v) => Math.abs(v.position.y - 1) < 0.05)!;
    const initialY = topVertex.position.y;

    // Draw (outward)
    applyMeshBrush(mesh, 'draw', center, 0.5, 0.15, 'smooth', false, {
      contactNormal: normal,
    });
    expect(topVertex.position.y).toBeGreaterThan(initialY);

    // Inverted Draw (carve inward)
    applyMeshBrush(mesh, 'draw', center, 0.5, 0.3, 'smooth', true, {
      contactNormal: normal,
    });
    expect(topVertex.position.y).toBeLessThan(initialY + 0.1);
  });

  it('mask brush freezes vertices from subsequent brush operations', () => {
    const mesh = buildSphere({ radius: 1, widthSegments: 16, heightSegments: 12 });
    const center = { x: 0, y: 1, z: 0 };
    const mask = new Map<string, number>();

    // Paint full mask on top
    applyMeshBrush(mesh, 'mask', center, 0.5, 1.0, 'constant', false, { mask });
    expect(mask.size).toBeGreaterThan(0);

    const topVertex = [...mesh.vertices.values()].find((v) => Math.abs(v.position.y - 1) < 0.05)!;
    const maskedY = topVertex.position.y;

    // Try inflating with mask applied
    applyMeshBrush(mesh, 'inflate', center, 0.5, 0.5, 'smooth', false, { mask });

    // Top vertex was masked so its position must not move
    expect(topVertex.position.y).toBeCloseTo(maskedY, 5);
  });

  it('twist brush rotates vertices around normal', () => {
    const mesh = buildSphere({ radius: 1, widthSegments: 16, heightSegments: 12 });
    const center = { x: 0, y: 1, z: 0 };
    const normal = { x: 0, y: 1, z: 0 };

    const near = [...mesh.vertices.values()].find(
      (v) => v.position.y > 0.8 && (Math.abs(v.position.x) > 0.1 || Math.abs(v.position.z) > 0.1),
    )!;
    const initialX = near.position.x;
    const initialZ = near.position.z;

    applyMeshBrush(mesh, 'twist', center, 0.5, 0.3, 'smooth', false, {
      contactNormal: normal,
    });

    const changed = near.position.x !== initialX || near.position.z !== initialZ;
    expect(changed).toBe(true);
  });
});

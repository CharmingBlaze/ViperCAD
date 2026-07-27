import { describe, expect, it } from 'vitest';
import { v3 } from '@/core/math/Vec3';
import { validateMeshFull } from '@/core/mesh/Validation';
import {
  buildLimbBlockoutChain,
  buildOutlineBlockout,
} from '@/core/mesh/builders/WorkflowBlockoutBuilder';
import {
  buildWorkflowLimbBlockout,
  buildWorkflowProfileSolid,
} from '@/core/mesh/builders/WorkflowProfileSolidBuilder';

describe('Workflow blockout builders', () => {
  it('builds a closed silhouette as an exact outline solid', () => {
    const outline = [
      v3(0, 0, 0),
      v3(1, 0, 0),
      v3(1, 1, 0),
      v3(0, 1, 0),
    ];
    const mesh = buildOutlineBlockout({
      points: outline,
      depth: 0.24,
      depthSegments: 3,
      roundness: 0.22,
      exactOutline: true,
      name: 'Body Blockout',
    });
    expect(mesh.vertices.size).toBe(outline.length * 4);
    expect(mesh.faces.size).toBeGreaterThanOrEqual(outline.length * 3 + 2);
    expect(validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('scales width and height around the silhouette centroid', () => {
    const outline = [
      v3(-0.5, 0, 0),
      v3(0.5, 0, 0),
      v3(0.5, 1, 0),
      v3(-0.5, 1, 0),
    ];
    const wide = buildOutlineBlockout({
      points: outline,
      depth: 0.2,
      exactOutline: true,
      widthScale: 2,
      heightScale: 0.5,
      name: 'Scaled',
    });
    const xs = [...wide.vertices.values()].map((vertex) => vertex.position.x);
    const ys = [...wide.vertices.values()].map((vertex) => vertex.position.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1.5);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.8);
  });

  it('simplifies noisy freehand outlines to max corners', () => {
    const noisy = Array.from({ length: 40 }, (_value, index) => {
      const t = (index / 40) * Math.PI * 2;
      return v3(Math.cos(t) * 0.5, Math.sin(t) * 0.7, 0);
    });
    const mesh = buildOutlineBlockout({
      points: noisy,
      depth: 0.2,
      maxCorners: 12,
      exactOutline: false,
      name: 'Simplified',
    });
    expect(mesh.vertices.size).toBeLessThanOrEqual(12 * 5);
    expect(mesh.vertices.size).toBeGreaterThanOrEqual(12 * 2);
    expect(validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('builds open limb paths with rings only at joints', () => {
    const path = [v3(0, 0, 0), v3(1, 0.2, 0), v3(2, 0, 0)];
    const mesh = buildLimbBlockoutChain({
      points: path,
      radius: 0.1,
      sides: 4,
      name: 'Limb Blockout',
    });
    expect(mesh.vertices.size).toBe(12);
    expect(validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('uses exact pen corners for profile blockout', () => {
    const headProfile = [
      v3(0, 0, 0),
      v3(0.2, 0.6, 0),
      v3(0.5, 0.85, 0),
      v3(0.9, 0.75, 0),
      v3(1.1, 0.35, 0),
      v3(1.0, 0, 0),
      v3(0.6, -0.25, 0),
      v3(0.2, -0.15, 0),
    ];
    const mesh = buildWorkflowProfileSolid({
      points: headProfile,
      radius: 0.12,
      maxOutlineCorners: 20,
      outlineSegments: 16,
      cyclic: true,
      exactOutline: true,
      name: 'Head Blockout',
    });
    expect(mesh.vertices.size).toBe(headProfile.length * 4);
    expect(validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('builds one limb segment per pen click', () => {
    const path = [v3(0, 0, 0), v3(0, 0.5, 0), v3(0.2, 1, 0), v3(0.5, 1.4, 0)];
    const mesh = buildWorkflowLimbBlockout({
      points: path,
      radius: 0.08,
      segmentCount: 2,
      exactEdges: true,
      sides: 4,
      name: 'Arm Blockout',
    });
    expect(mesh.vertices.size).toBe(path.length * 4);
    expect(validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });
});

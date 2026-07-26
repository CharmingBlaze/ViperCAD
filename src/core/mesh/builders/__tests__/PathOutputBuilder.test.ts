import { describe, expect, it } from 'vitest';
import { v3 } from '@/core/math/Vec3';
import { validateMeshFull } from '@/core/mesh/Validation';
import {
  buildPathOutput,
  type PathOutput,
} from '@/core/mesh/builders/PathOutputBuilder';

const outputs: PathOutput[] = [
  'tube',
  'ribbon',
  'chain',
  'vine',
  'rope',
  'cards',
  'object-array',
  'profile-sweep',
];

describe('PathOutputBuilder', () => {
  it.each(outputs)('builds valid %s output from one procedural path', (output) => {
    const mesh = buildPathOutput({
      points: [
        v3(-2, 0, 0),
        v3(-1, 0.4, 0.2),
        v3(0, 0.1, 0.5),
        v3(1, 0.7, 0.2),
        v3(2, 0.2, 0),
      ],
      output,
      radius: 0.16,
      radialSegments: 8,
      startCap: 'round',
      endCap: 'pointed',
      startScale: 0.8,
      endScale: 1.2,
      offset: 0.1,
      twist: 120,
      spacing: 0.55,
      profile: 'rail',
      profileWidth: 1.2,
      profileHeight: 0.8,
      chainAlternating: true,
      cardCrossed: true,
      distributionMode: 'spacing',
      count: 6,
      startPadding: 0.1,
      endPadding: 0.1,
      randomScale: 0.15,
      rotation: 10,
      randomRotation: 20,
      alternateRotation: true,
      mirrorAlternate: true,
      seed: 42,
      cyclic: false,
    });
    expect(mesh.vertices.size).toBeGreaterThan(0);
    expect(mesh.faces.size).toBeGreaterThan(0);
    expect(validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('uses deterministic distribution and seed settings', () => {
    const settings = {
      points: [v3(0, 0, 0), v3(5, 0, 0)],
      output: 'object-array' as const,
      radius: 0.2,
      radialSegments: 8,
      startCap: 'flat' as const,
      endCap: 'flat' as const,
      startScale: 1,
      endScale: 1,
      offset: 0,
      twist: 0,
      spacing: 1,
      profile: 'round' as const,
      profileWidth: 1,
      profileHeight: 1,
      chainAlternating: true,
      cardCrossed: false,
      distributionMode: 'count' as const,
      count: 5,
      startPadding: 0,
      endPadding: 0,
      randomScale: 0.2,
      rotation: 0,
      randomRotation: 30,
      alternateRotation: false,
      mirrorAlternate: false,
      seed: 77,
      cyclic: false,
    };
    const first = buildPathOutput(settings);
    const second = buildPathOutput(settings);
    expect([...first.vertices.values()].map((vertex) => vertex.position)).toEqual(
      [...second.vertices.values()].map((vertex) => vertex.position),
    );
    expect(first.faces.size).toBe(30);
  });

  it('builds upright tapered cards along a path', () => {
    const mesh = buildPathOutput({
      points: [v3(0, 0, 0), v3(4, 0.2, 0), v3(8, 0, 0)],
      output: 'cards',
      radius: 0.2,
      radialSegments: 8,
      startCap: 'flat',
      endCap: 'flat',
      startScale: 1,
      endScale: 1,
      offset: 0,
      twist: 0,
      spacing: 1,
      profile: 'round',
      profileWidth: 1,
      profileHeight: 1.5,
      chainAlternating: false,
      cardCrossed: true,
      distributionMode: 'count',
      count: 4,
      startPadding: 0,
      endPadding: 0,
      randomScale: 0,
      rotation: 0,
      randomRotation: 0,
      alternateRotation: false,
      mirrorAlternate: false,
      seed: 1,
      cyclic: false,
    });
    const ys = [...mesh.vertices.values()].map((vertex) => vertex.position.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.35);
    expect(mesh.faces.size).toBeGreaterThan(16);
    expect(validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });
});

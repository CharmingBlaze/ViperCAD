import { beforeEach, describe, expect, it } from 'vitest';
import { resetIdCounter } from '@/core/ids/IdService';
import { buildBox, buildPlane } from '@/core/mesh/builders';
import { validateMeshFull } from '@/core/mesh/Validation';
import { evaluateModifierStack } from '@/core/modifiers/evaluate';
import { applyMirrorModifier } from '@/core/modifiers/mirrorModifier';
import { catmullClarkSubdivide, catmullClarkSubdivideOnce } from '@/core/modifiers/subdivisionModifier';
import {
  createDefaultMirrorModifier,
  createDefaultSubdivisionModifier,
  createDefaultArrayModifier,
  createDefaultBevelModifier,
  createDefaultSolidifyModifier,
  createEmptyModifierStack,
} from '@/core/modifiers/types';

beforeEach(() => resetIdCounter(1));

describe('mirror modifier', () => {
  it('mirrors a plane across X and doubles face count', () => {
    const source = buildPlane({ width: 1, depth: 1 });
    const result = applyMirrorModifier(source, createDefaultMirrorModifier('x'));
    expect(result.faces.size).toBe(source.faces.size * 2);
    expect(validateMeshFull(result).ok).toBe(true);
  });

  it('clips negative-side geometry before mirroring', () => {
    const box = buildBox({ width: 2, height: 2, depth: 2 });
    const clipped = applyMirrorModifier(box, { ...createDefaultMirrorModifier('x'), clip: true });
    const unclipped = applyMirrorModifier(box, { ...createDefaultMirrorModifier('x'), clip: false });
    expect(clipped.faces.size).toBeLessThan(unclipped.faces.size);
    expect(validateMeshFull(clipped).ok).toBe(true);
  });
});

describe('subdivision modifier', () => {
  it('subdivides a cube face into four quads per face', () => {
    const cube = buildBox({ width: 1, height: 1, depth: 1 });
    const result = catmullClarkSubdivideOnce(cube, true);
    expect(result.faces.size).toBe(24);
    expect(validateMeshFull(result).ok).toBe(true);
  });

  it('supports multiple subdivision levels', () => {
    const cube = buildBox({ width: 1, height: 1, depth: 1 });
    const result = catmullClarkSubdivide(cube, 2, true);
    expect(result.faces.size).toBe(96);
    expect(validateMeshFull(result).ok).toBe(true);
  });
});

describe('modifier stack evaluation', () => {
  it('applies mirror then subdivision in order', () => {
    const cube = buildBox({ width: 1, height: 1, depth: 1 });
    const stack = createEmptyModifierStack();
    stack.modifiers.push(createDefaultMirrorModifier('x'));
    stack.modifiers.push(createDefaultSubdivisionModifier(1));
    const result = evaluateModifierStack(cube, stack);
    expect(result.faces.size).toBeGreaterThan(cube.faces.size);
    expect(validateMeshFull(result).ok).toBe(true);
  });

  it('evaluates solidify, bevel, and array modifiers without changing the source', () => {
    const source = buildPlane({ width: 1, depth: 1 });
    const stack = createEmptyModifierStack();
    stack.modifiers.push(createDefaultSolidifyModifier());
    stack.modifiers.push({ ...createDefaultBevelModifier(), width: 0.02 });
    stack.modifiers.push({ ...createDefaultArrayModifier(), count: 3, spacing: 2 });
    const result = evaluateModifierStack(source, stack);

    expect(source.faces.size).toBe(1);
    expect(result.faces.size).toBeGreaterThan(source.faces.size * 3);
    expect(validateMeshFull(result).ok).toBe(true);
  });
});

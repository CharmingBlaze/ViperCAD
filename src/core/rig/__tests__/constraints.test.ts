import { describe, expect, it } from 'vitest';
import { evaluateConstraint, type Constraint } from '@/core/rig/constraints';
import { defaultTransform } from '@/core/math/Transform';
import { v3 } from '@/core/math/Vec3';

describe('constraints', () => {
  it('evaluates copyPosition with partial influence', () => {
    const constraint: Constraint = {
      id: 'c1',
      name: 'CopyPos',
      ownerId: 'boneA',
      targetId: 'boneB',
      type: 'copyPosition',
      influence: 0.5,
      enabled: true,
    };

    const owner = defaultTransform();
    owner.position = v3(0, 0, 0);

    const target = defaultTransform();
    target.position = v3(10, 20, 30);

    const result = evaluateConstraint(constraint, owner, target);
    expect(result.position.x).toBeCloseTo(5);
    expect(result.position.y).toBeCloseTo(10);
    expect(result.position.z).toBeCloseTo(15);
  });

  it('evaluates copyRotation constraint', () => {
    const constraint: Constraint = {
      id: 'c2',
      name: 'CopyRot',
      ownerId: 'boneA',
      targetId: 'boneB',
      type: 'copyRotation',
      influence: 1.0,
      enabled: true,
    };

    const owner = defaultTransform();
    const target = defaultTransform();
    target.rotation = v3(0.5, 0.2, 0);

    const result = evaluateConstraint(constraint, owner, target);
    expect(result.rotation.x).toBeCloseTo(0.5, 2);
    expect(result.rotation.y).toBeCloseTo(0.2, 2);
  });

  it('evaluates limitPosition constraint clamping coordinates within bounds', () => {
    const constraint: Constraint = {
      id: 'c3',
      name: 'LimitPos',
      ownerId: 'boneA',
      type: 'limitPosition',
      influence: 1.0,
      enabled: true,
      limits: {
        min: v3(-5, 0, -5),
        max: v3(5, 10, 5),
      },
    };

    const owner = defaultTransform();
    owner.position = v3(20, -10, 2);

    const result = evaluateConstraint(constraint, owner);
    expect(result.position.x).toBe(5);
    expect(result.position.y).toBe(0);
    expect(result.position.z).toBe(2);
  });

  it('bypasses calculation when constraint is disabled', () => {
    const constraint: Constraint = {
      id: 'c4',
      name: 'Disabled',
      ownerId: 'boneA',
      targetId: 'boneB',
      type: 'copyPosition',
      influence: 1.0,
      enabled: false,
    };

    const owner = defaultTransform();
    const target = defaultTransform();
    target.position = v3(100, 100, 100);

    const result = evaluateConstraint(constraint, owner, target);
    expect(result.position.x).toBe(0);
  });
});

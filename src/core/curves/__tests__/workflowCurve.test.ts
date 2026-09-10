import { describe, expect, it } from 'vitest';
import { v3 } from '@/core/math/Vec3';
import {
  curveOperationFromStroke,
  evaluateCurveOperation,
  isWorkflowOperation,
  isWorkflowStyle,
} from '@/core/curves/CurveOperation';
import { validateMeshFull } from '@/core/mesh/Validation';

describe('workflow curve separation', () => {
  it('marks workflow styles as workflow operations', () => {
    const workflow = curveOperationFromStroke({
      style: 'profile-solid',
      points: [v3(0, 0, 0), v3(1, 0, 0), v3(1, 1, 0)],
      radius: 0.2,
      resolution: 'low',
      smooth: true,
      cyclic: false,
      workflowKind: 'freehand',
    });
    const curvesCapsule = curveOperationFromStroke({
      style: 'capsule',
      points: [v3(0, 0, 0), v3(1, 0, 0), v3(2, 0, 0)],
      radius: 0.2,
      resolution: 'low',
      smooth: true,
      cyclic: false,
    });
    expect(isWorkflowStyle('profile-solid')).toBe(true);
    expect(isWorkflowStyle('capsule')).toBe(false);
    expect(isWorkflowOperation(workflow)).toBe(true);
    expect(isWorkflowOperation(curvesCapsule)).toBe(false);
  });

  it('builds profile-solid for workflow outline operations', () => {
    const operation = curveOperationFromStroke({
      style: 'profile-solid',
      points: [v3(0, 0, 0), v3(1, 0.1, 0), v3(2, 0, 0)],
      radius: 0.2,
      resolution: 'low',
      smooth: true,
      cyclic: false,
      pathStartCap: 'round',
      pathEndCap: 'round',
      workflowKind: 'freehand',
    });
    const mesh = evaluateCurveOperation(operation);
    expect(mesh.vertices.size).toBeGreaterThanOrEqual(12);
    expect(validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });
});

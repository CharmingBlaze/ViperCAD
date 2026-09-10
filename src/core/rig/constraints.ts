import { cloneTransform, type Transform } from '@/core/math/Transform';
import { normalizeVec3, subVec3, v3, type Vec3 } from '@/core/math/Vec3';

export type ConstraintType =
  | 'copyPosition'
  | 'copyRotation'
  | 'copyScale'
  | 'aim'
  | 'lookAt'
  | 'parent'
  | 'limitPosition'
  | 'limitRotation'
  | 'limitScale'
  | 'ik';

export type Constraint = {
  id: string;
  name: string;
  ownerId: string;
  targetId?: string;
  type: ConstraintType;
  influence: number;
  enabled: boolean;
  limits?: {
    min?: Vec3;
    max?: Vec3;
  };
  offset?: Transform;
};

import { Euler, Quaternion } from 'three';

function eulerToQuat(rotation: Vec3): Quaternion {
  return new Quaternion().setFromEuler(new Euler(rotation.x, rotation.y, rotation.z, 'XYZ'));
}

function quatToEuler(q: Quaternion): Vec3 {
  const e = new Euler().setFromQuaternion(q, 'XYZ');
  return v3(e.x, e.y, e.z);
}

function lookAtEuler(from: Vec3, to: Vec3): Vec3 {
  const dir = normalizeVec3(subVec3(to, from));
  const yaw = Math.atan2(dir.x, dir.z);
  const pitch = Math.asin(-Math.max(-1, Math.min(1, dir.y)));
  return v3(pitch, yaw, 0);
}

/**
 * Apply a constraint to an owner transform given a target transform
 */
export function evaluateConstraint(
  constraint: Constraint,
  ownerTransform: Transform,
  targetTransform?: Transform,
): Transform {
  if (!constraint.enabled || constraint.influence <= 0) {
    return cloneTransform(ownerTransform);
  }

  const result = cloneTransform(ownerTransform);
  const inf = Math.max(0, Math.min(1, constraint.influence));

  switch (constraint.type) {
    case 'copyPosition':
      if (targetTransform) {
        result.position = {
          x: ownerTransform.position.x + (targetTransform.position.x - ownerTransform.position.x) * inf,
          y: ownerTransform.position.y + (targetTransform.position.y - ownerTransform.position.y) * inf,
          z: ownerTransform.position.z + (targetTransform.position.z - ownerTransform.position.z) * inf,
        };
      }
      break;

    case 'copyRotation':
      if (targetTransform) {
        const qa = eulerToQuat(ownerTransform.rotation);
        const qb = eulerToQuat(targetTransform.rotation);
        qa.slerp(qb, inf);
        result.rotation = quatToEuler(qa);
      }
      break;

    case 'copyScale':
      if (targetTransform) {
        result.scale = {
          x: ownerTransform.scale.x + (targetTransform.scale.x - ownerTransform.scale.x) * inf,
          y: ownerTransform.scale.y + (targetTransform.scale.y - ownerTransform.scale.y) * inf,
          z: ownerTransform.scale.z + (targetTransform.scale.z - ownerTransform.scale.z) * inf,
        };
      }
      break;

    case 'aim':
    case 'lookAt':
      if (targetTransform) {
        const aimRot = lookAtEuler(ownerTransform.position, targetTransform.position);
        const qa = eulerToQuat(ownerTransform.rotation);
        const qb = eulerToQuat(aimRot);
        qa.slerp(qb, inf);
        result.rotation = quatToEuler(qa);
      }
      break;

    case 'limitPosition':
      if (constraint.limits) {
        const min = constraint.limits.min;
        const max = constraint.limits.max;
        const targetPos = {
          x: min?.x !== undefined ? Math.max(min.x, result.position.x) : result.position.x,
          y: min?.y !== undefined ? Math.max(min.y, result.position.y) : result.position.y,
          z: min?.z !== undefined ? Math.max(min.z, result.position.z) : result.position.z,
        };
        if (max?.x !== undefined) targetPos.x = Math.min(max.x, targetPos.x);
        if (max?.y !== undefined) targetPos.y = Math.min(max.y, targetPos.y);
        if (max?.z !== undefined) targetPos.z = Math.min(max.z, targetPos.z);

        result.position = {
          x: ownerTransform.position.x + (targetPos.x - ownerTransform.position.x) * inf,
          y: ownerTransform.position.y + (targetPos.y - ownerTransform.position.y) * inf,
          z: ownerTransform.position.z + (targetPos.z - ownerTransform.position.z) * inf,
        };
      }
      break;

    case 'limitRotation':
      if (constraint.limits) {
        const min = constraint.limits.min;
        const max = constraint.limits.max;
        const targetRot = {
          x: min?.x !== undefined ? Math.max(min.x, result.rotation.x) : result.rotation.x,
          y: min?.y !== undefined ? Math.max(min.y, result.rotation.y) : result.rotation.y,
          z: min?.z !== undefined ? Math.max(min.z, result.rotation.z) : result.rotation.z,
        };
        if (max?.x !== undefined) targetRot.x = Math.min(max.x, targetRot.x);
        if (max?.y !== undefined) targetRot.y = Math.min(max.y, targetRot.y);
        if (max?.z !== undefined) targetRot.z = Math.min(max.z, targetRot.z);

        result.rotation = {
          x: ownerTransform.rotation.x + (targetRot.x - ownerTransform.rotation.x) * inf,
          y: ownerTransform.rotation.y + (targetRot.y - ownerTransform.rotation.y) * inf,
          z: ownerTransform.rotation.z + (targetRot.z - ownerTransform.rotation.z) * inf,
        };
      }
      break;

    case 'parent':
      if (targetTransform) {
        const targetPos = {
          x: targetTransform.position.x + (constraint.offset?.position.x ?? 0),
          y: targetTransform.position.y + (constraint.offset?.position.y ?? 0),
          z: targetTransform.position.z + (constraint.offset?.position.z ?? 0),
        };
        result.position = {
          x: ownerTransform.position.x + (targetPos.x - ownerTransform.position.x) * inf,
          y: ownerTransform.position.y + (targetPos.y - ownerTransform.position.y) * inf,
          z: ownerTransform.position.z + (targetPos.z - ownerTransform.position.z) * inf,
        };
        const qa = eulerToQuat(ownerTransform.rotation);
        const qb = eulerToQuat(targetTransform.rotation);
        qa.slerp(qb, inf);
        result.rotation = quatToEuler(qa);
      }
      break;
  }

  return result;
}

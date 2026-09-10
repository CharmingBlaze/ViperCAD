import { addVec3, dotVec3, scaleVec3, subVec3, v3, type Vec3 } from '@/core/math/Vec3';

export type TwoBoneIkResult = {
  rootPosition: Vec3;
  midPosition: Vec3;
  endPosition: Vec3;
  solved: boolean;
};

/**
 * Analytical 2-bone Inverse Kinematics solver using Trigonometry / Law of Cosines.
 * Solves position for a 2-joint chain (e.g. Thigh->Shin->Foot or UpperArm->Forearm->Hand)
 * to reach target position with optional pole vector bending direction.
 */
export function solveTwoBoneIK(
  rootPos: Vec3,
  midPos: Vec3,
  endPos: Vec3,
  targetPos: Vec3,
  polePos?: Vec3,
): TwoBoneIkResult {
  const l1 = Math.hypot(midPos.x - rootPos.x, midPos.y - rootPos.y, midPos.z - rootPos.z);
  const l2 = Math.hypot(endPos.x - midPos.x, endPos.y - midPos.y, endPos.z - midPos.z);

  if (l1 <= 1e-6 || l2 <= 1e-6) {
    return { rootPosition: rootPos, midPosition: midPos, endPosition: endPos, solved: false };
  }

  // Target vector from root
  const targetVec = subVec3(targetPos, rootPos);
  const rawDist = Math.hypot(targetVec.x, targetVec.y, targetVec.z);
  const dir = rawDist > 1e-6 ? scaleVec3(targetVec, 1 / rawDist) : v3(0, 0, 1);

  // Clamp distance so limb cannot over-extend
  const maxLen = (l1 + l2) * 0.9999;
  const minLen = Math.abs(l1 - l2) * 1.0001;
  const dist = Math.max(minLen, Math.min(maxLen, rawDist));

  // Law of Cosines angle at root joint
  const cosAngleRoot = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
  const clampedCosRoot = Math.max(-1, Math.min(1, cosAngleRoot));
  const angleRoot = Math.acos(clampedCosRoot);

  // Default bend direction plane vector
  let bendDir = v3(0, 1, 0);
  if (polePos) {
    const poleVec = subVec3(polePos, rootPos);
    // Project pole vector perpendicular to dir
    const projLen = dotVec3(poleVec, dir);
    const perpPole = subVec3(poleVec, scaleVec3(dir, projLen));
    const perpLen = Math.hypot(perpPole.x, perpPole.y, perpPole.z);
    if (perpLen > 1e-5) {
      bendDir = scaleVec3(perpPole, 1 / perpLen);
    }
  } else {
    // If no pole target, derive bend direction from initial mid position
    const initMid = subVec3(midPos, rootPos);
    const projLen = dotVec3(initMid, dir);
    const perpMid = subVec3(initMid, scaleVec3(dir, projLen));
    const perpLen = Math.hypot(perpMid.x, perpMid.y, perpMid.z);
    if (perpLen > 1e-5) {
      bendDir = scaleVec3(perpMid, 1 / perpLen);
    }
  }

  // Calculate solved middle joint position
  const midForward = scaleVec3(dir, Math.cos(angleRoot) * l1);
  const midUp = scaleVec3(bendDir, Math.sin(angleRoot) * l1);
  const solvedMid = addVec3(rootPos, addVec3(midForward, midUp));

  // Calculate solved end joint position
  const solvedEnd = addVec3(rootPos, scaleVec3(dir, dist));

  return {
    rootPosition: rootPos,
    midPosition: solvedMid,
    endPosition: solvedEnd,
    solved: true,
  };
}

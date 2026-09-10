import { cloneTransform, type Transform } from '@/core/math/Transform';
import type { Armature, BoneId } from '@/core/rig/types';

/**
 * Returns the mirrored counterpart name for a bone, or null if it represents a center bone.
 * Supports standard game/CAD naming conventions:
 * - Hand_L <-> Hand_R
 * - UpperArm.l <-> UpperArm.r
 * - leg_left <-> leg_right
 * - thigh_L <-> thigh_R
 */
export function getMirroredBoneName(name: string): string | null {
  if (name.endsWith('_L')) return name.slice(0, -2) + '_R';
  if (name.endsWith('_R')) return name.slice(0, -2) + '_L';
  if (name.endsWith('_l')) return name.slice(0, -2) + '_r';
  if (name.endsWith('_r')) return name.slice(0, -2) + '_l';
  if (name.endsWith('.L')) return name.slice(0, -2) + '.R';
  if (name.endsWith('.R')) return name.slice(0, -2) + '.L';
  if (name.endsWith('.l')) return name.slice(0, -2) + '.r';
  if (name.endsWith('.r')) return name.slice(0, -2) + '.l';

  if (name.startsWith('L_')) return 'R_' + name.slice(2);
  if (name.startsWith('R_')) return 'L_' + name.slice(2);
  if (name.startsWith('l_')) return 'r_' + name.slice(2);
  if (name.startsWith('r_')) return 'l_' + name.slice(2);

  if (/^Left([A-Z0-9_]|$)/.test(name)) return 'Right' + name.slice(4);
  if (/^Right([A-Z0-9_]|$)/.test(name)) return 'Left' + name.slice(5);
  if (/^left([A-Z0-9_]|$)/.test(name)) return 'right' + name.slice(4);
  if (/^right([A-Z0-9_]|$)/.test(name)) return 'left' + name.slice(5);

  if (/([A-Z0-9_])Left$/.test(name)) return name.slice(0, -4) + 'Right';
  if (/([A-Z0-9_])Right$/.test(name)) return name.slice(0, -5) + 'Left';
  if (/([A-Z0-9_])left$/.test(name)) return name.slice(0, -4) + 'right';
  if (/([A-Z0-9_])right$/.test(name)) return name.slice(0, -5) + 'left';

  if (/\bLeft\b/i.test(name)) {
    return name.replace(/\bLeft\b/g, 'Right').replace(/\bleft\b/g, 'right').replace(/\bLEFT\b/g, 'RIGHT');
  }
  if (/\bRight\b/i.test(name)) {
    return name.replace(/\bRight\b/g, 'Left').replace(/\bright\b/g, 'left').replace(/\bRIGHT\b/g, 'LEFT');
  }

  return null;
}

/**
 * Invert transform across the X symmetry plane.
 * Inverts X position, Y rotation, and Z rotation.
 */
export function mirrorBoneTransform(source: Transform): Transform {
  const result = cloneTransform(source);
  result.position.x = -result.position.x;
  result.rotation.y = -result.rotation.y;
  result.rotation.z = -result.rotation.z;
  return result;
}

/**
 * Mirror a complete pose across the armature.
 * Pairs corresponding left and right bones, swapping and mirroring their transforms.
 * Center bones keep their identity but are symmetrized across X.
 */
export function mirrorArmaturePose(
  armature: Armature,
  currentPose: Map<BoneId, Transform>,
): Map<BoneId, Transform> {
  const nameToId = new Map<string, BoneId>();
  for (const [id, bone] of armature.bones) {
    nameToId.set(bone.name, id);
  }

  const result = new Map<BoneId, Transform>();

  for (const [boneId, bone] of armature.bones) {
    const originalTransform = currentPose.get(boneId) ?? cloneTransform(bone.localTransform);
    const mirrorName = getMirroredBoneName(bone.name);
    const mirrorId = mirrorName ? nameToId.get(mirrorName) : null;

    if (mirrorId && currentPose.has(mirrorId)) {
      const oppositeTransform = currentPose.get(mirrorId)!;
      result.set(boneId, mirrorBoneTransform(oppositeTransform));
    } else if (mirrorId && armature.bones.has(mirrorId)) {
      const oppositeBone = armature.bones.get(mirrorId)!;
      result.set(boneId, mirrorBoneTransform(oppositeBone.localTransform));
    } else {
      result.set(boneId, mirrorBoneTransform(originalTransform));
    }
  }

  return result;
}

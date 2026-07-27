import { createId } from '@/core/ids/IdService';
import { defaultTransform } from '@/core/math/Transform';
import { v3 } from '@/core/math/Vec3';
import type { Armature, Bone, BoneId } from '@/core/rig/types';

export function createBone(name: string, parentId: BoneId | null, tailLocal = v3(0, 0.25, 0)): Bone {
  return {
    id: createId('bone'),
    name,
    parentId,
    tailLocal: { ...tailLocal },
    roll: 0,
    localTransform: defaultTransform(),
  };
}

/** Humanoid-ish default chain: root → spine → chest → head, plus arms and legs. */
export function createDefaultArmature(name = 'Armature'): Armature {
  const root = createBone('root', null, v3(0, 0.35, 0));
  const spine = createBone('spine', root.id, v3(0, 0.35, 0));
  const chest = createBone('chest', spine.id, v3(0, 0.25, 0));
  const head = createBone('head', chest.id, v3(0, 0.2, 0));
  const armL = createBone('upper_arm.L', chest.id, v3(0.25, 0, 0));
  const foreL = createBone('forearm.L', armL.id, v3(0.22, 0, 0));
  const armR = createBone('upper_arm.R', chest.id, v3(-0.25, 0, 0));
  const foreR = createBone('forearm.R', armR.id, v3(-0.22, 0, 0));
  const legL = createBone('thigh.L', root.id, v3(0.12, -0.4, 0));
  const shinL = createBone('shin.L', legL.id, v3(0, -0.38, 0));
  const legR = createBone('thigh.R', root.id, v3(-0.12, -0.4, 0));
  const shinR = createBone('shin.R', legR.id, v3(0, -0.38, 0));

  const bones = new Map<BoneId, Bone>([
    [root.id, root],
    [spine.id, spine],
    [chest.id, chest],
    [head.id, head],
    [armL.id, armL],
    [foreL.id, foreL],
    [armR.id, armR],
    [foreR.id, foreR],
    [legL.id, legL],
    [shinL.id, shinL],
    [legR.id, legR],
    [shinR.id, shinR],
  ]);

  return {
    id: createId('arm'),
    name,
    rootBoneIds: [root.id],
    bones,
    restTransform: defaultTransform(),
  };
}

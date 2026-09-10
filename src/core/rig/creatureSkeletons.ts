import { createId } from '@/core/ids/IdService';
import { defaultTransform } from '@/core/math/Transform';
import { v3, type Vec3 } from '@/core/math/Vec3';
import { createBone } from '@/core/rig/ArmatureFactory';
import type { Armature, Bone, BoneId } from '@/core/rig/types';

export type CreaturePresetType = 'humanoid' | 'bird' | 'quadruped' | 'fish';

export type BoundingBox3D = {
  min: Vec3;
  max: Vec3;
};

/**
 * Humanoid Armature Preset
 */
export function createHumanoidArmature(name = 'Humanoid_Rig'): Armature {
  const root = createBone('root', null, v3(0, 0.4, 0));
  const pelvis = createBone('pelvis', root.id, v3(0, 0.2, 0));
  const spine = createBone('spine', pelvis.id, v3(0, 0.35, 0));
  const chest = createBone('chest', spine.id, v3(0, 0.3, 0));
  const neck = createBone('neck', chest.id, v3(0, 0.12, 0));
  const head = createBone('head', neck.id, v3(0, 0.2, 0));

  // Arms
  const shoulderL = createBone('shoulder.L', chest.id, v3(0.12, 0.05, 0));
  const upperArmL = createBone('upper_arm.L', shoulderL.id, v3(0.28, -0.05, 0));
  const forearmL = createBone('forearm.L', upperArmL.id, v3(0.26, -0.02, 0));
  const handL = createBone('hand.L', forearmL.id, v3(0.12, 0, 0));

  const shoulderR = createBone('shoulder.R', chest.id, v3(-0.12, 0.05, 0));
  const upperArmR = createBone('upper_arm.R', shoulderR.id, v3(-0.28, -0.05, 0));
  const forearmR = createBone('forearm.R', upperArmR.id, v3(-0.26, -0.02, 0));
  const handR = createBone('hand.R', forearmR.id, v3(-0.12, 0, 0));

  // Legs
  const thighL = createBone('thigh.L', pelvis.id, v3(0.14, -0.42, 0));
  const shinL = createBone('shin.L', thighL.id, v3(0, -0.4, 0));
  const footL = createBone('foot.L', shinL.id, v3(0, -0.08, 0.18));

  const thighR = createBone('thigh.R', pelvis.id, v3(-0.14, -0.42, 0));
  const shinR = createBone('shin.R', thighR.id, v3(0, -0.4, 0));
  const footR = createBone('foot.R', shinR.id, v3(0, -0.08, 0.18));

  const boneList = [
    root, pelvis, spine, chest, neck, head,
    shoulderL, upperArmL, forearmL, handL,
    shoulderR, upperArmR, forearmR, handR,
    thighL, shinL, footL,
    thighR, shinR, footR,
  ];

  const bones = new Map<BoneId, Bone>(boneList.map((b) => [b.id, b]));

  return {
    id: createId('arm'),
    name,
    rootBoneIds: [root.id],
    bones,
    restTransform: defaultTransform(),
  };
}

/**
 * Bird Armature Preset (Wings, neck, beak, tail, legs)
 */
export function createBirdArmature(name = 'Bird_Rig'): Armature {
  const root = createBone('root', null, v3(0, 0.35, 0));
  const body = createBone('body', root.id, v3(0, 0.2, 0.15));
  const neck = createBone('neck', body.id, v3(0, 0.25, 0.15));
  const head = createBone('head', neck.id, v3(0, 0.15, 0.1));
  const beak = createBone('beak', head.id, v3(0, -0.05, 0.2));
  const tail = createBone('tail', body.id, v3(0, 0.05, -0.35));

  // Wings
  const wingBaseL = createBone('wing_shoulder.L', body.id, v3(0.18, 0.1, 0));
  const wingMidL = createBone('wing_arm.L', wingBaseL.id, v3(0.35, 0.05, -0.1));
  const wingTipL = createBone('wing_tip.L', wingMidL.id, v3(0.4, -0.05, -0.15));

  const wingBaseR = createBone('wing_shoulder.R', body.id, v3(-0.18, 0.1, 0));
  const wingMidR = createBone('wing_arm.R', wingBaseR.id, v3(-0.35, 0.05, -0.1));
  const wingTipR = createBone('wing_tip.R', wingMidR.id, v3(-0.4, -0.05, -0.15));

  // Legs
  const thighL = createBone('thigh.L', root.id, v3(0.1, -0.22, -0.05));
  const shinL = createBone('shin.L', thighL.id, v3(0, -0.2, 0.05));
  const clawL = createBone('claw.L', shinL.id, v3(0, -0.06, 0.12));

  const thighR = createBone('thigh.R', root.id, v3(-0.1, -0.22, -0.05));
  const shinR = createBone('shin.R', thighR.id, v3(0, -0.2, 0.05));
  const clawR = createBone('claw.R', shinR.id, v3(0, -0.06, 0.12));

  const boneList = [
    root, body, neck, head, beak, tail,
    wingBaseL, wingMidL, wingTipL,
    wingBaseR, wingMidR, wingTipR,
    thighL, shinL, clawL,
    thighR, shinR, clawR,
  ];

  const bones = new Map<BoneId, Bone>(boneList.map((b) => [b.id, b]));

  return {
    id: createId('arm'),
    name,
    rootBoneIds: [root.id],
    bones,
    restTransform: defaultTransform(),
  };
}

/**
 * Quadruped / Dog Armature Preset (4 legs, spine front/rear, neck, head, tail)
 */
export function createQuadrupedArmature(name = 'Quadruped_Rig'): Armature {
  const root = createBone('root', null, v3(0, 0.4, 0));
  const spineFront = createBone('spine_front', root.id, v3(0, 0.05, 0.35));
  const neck = createBone('neck', spineFront.id, v3(0, 0.25, 0.2));
  const head = createBone('head', neck.id, v3(0, 0.15, 0.22));
  const jaw = createBone('jaw', head.id, v3(0, -0.08, 0.18));

  const spineRear = createBone('spine_rear', root.id, v3(0, -0.02, -0.35));
  const tail1 = createBone('tail_1', spineRear.id, v3(0, 0.15, -0.25));
  const tail2 = createBone('tail_2', tail1.id, v3(0, 0.2, -0.25));

  // Front legs
  const shoulderL = createBone('shoulder_front.L', spineFront.id, v3(0.16, -0.15, 0.05));
  const forearmFL = createBone('forearm_front.L', shoulderL.id, v3(0, -0.28, 0));
  const pawFL = createBone('paw_front.L', forearmFL.id, v3(0, -0.06, 0.1));

  const shoulderR = createBone('shoulder_front.R', spineFront.id, v3(-0.16, -0.15, 0.05));
  const forearmFR = createBone('forearm_front.R', shoulderR.id, v3(0, -0.28, 0));
  const pawFR = createBone('paw_front.R', forearmFR.id, v3(0, -0.06, 0.1));

  // Rear legs
  const hipL = createBone('hip_rear.L', spineRear.id, v3(0.15, -0.18, -0.05));
  const shinRL = createBone('shin_rear.L', hipL.id, v3(0, -0.3, 0.05));
  const pawRL = createBone('paw_rear.L', shinRL.id, v3(0, -0.06, 0.1));

  const hipR = createBone('hip_rear.R', spineRear.id, v3(-0.15, -0.18, -0.05));
  const shinRR = createBone('shin_rear.R', hipR.id, v3(0, -0.3, 0.05));
  const pawRR = createBone('paw_rear.R', shinRR.id, v3(0, -0.06, 0.1));

  const boneList = [
    root, spineFront, neck, head, jaw,
    spineRear, tail1, tail2,
    shoulderL, forearmFL, pawFL,
    shoulderR, forearmFR, pawFR,
    hipL, shinRL, pawRL,
    hipR, shinRR, pawRR,
  ];

  const bones = new Map<BoneId, Bone>(boneList.map((b) => [b.id, b]));

  return {
    id: createId('arm'),
    name,
    rootBoneIds: [root.id],
    bones,
    restTransform: defaultTransform(),
  };
}

/**
 * Fish / Aquatic Armature Preset (Segmented swimming spine + dorsal & side fins)
 */
export function createFishArmature(name = 'Fish_Rig'): Armature {
  const root = createBone('root', null, v3(0, 0, 0.2));
  const spine1 = createBone('spine_1', root.id, v3(0, 0, 0.25));
  const head = createBone('head', spine1.id, v3(0, 0, 0.25));

  const spine2 = createBone('spine_2', root.id, v3(0, 0, -0.25));
  const spine3 = createBone('spine_3', spine2.id, v3(0, 0, -0.25));
  const spine4 = createBone('spine_4', spine3.id, v3(0, 0, -0.25));
  const tailFin = createBone('tail_fin', spine4.id, v3(0, 0.2, -0.3));

  const dorsalFin = createBone('dorsal_fin', spine2.id, v3(0, 0.25, -0.1));
  const finL = createBone('pectoral_fin.L', spine1.id, v3(0.25, -0.1, -0.1));
  const finR = createBone('pectoral_fin.R', spine1.id, v3(-0.25, -0.1, -0.1));

  const boneList = [
    root, spine1, head,
    spine2, spine3, spine4, tailFin,
    dorsalFin, finL, finR,
  ];

  const bones = new Map<BoneId, Bone>(boneList.map((b) => [b.id, b]));

  return {
    id: createId('arm'),
    name,
    rootBoneIds: [root.id],
    bones,
    restTransform: defaultTransform(),
  };
}

/**
 * Factory dispatcher for creature preset types
 */
export function createCreatureArmature(type: CreaturePresetType, name?: string): Armature {
  switch (type) {
    case 'humanoid':
      return createHumanoidArmature(name);
    case 'bird':
      return createBirdArmature(name);
    case 'quadruped':
      return createQuadrupedArmature(name);
    case 'fish':
      return createFishArmature(name);
  }
}

/**
 * Fit and scale an armature's bones to match a 3D bounding box
 */
export function fitArmatureToMeshBounds(armature: Armature, bounds: BoundingBox3D): Armature {
  const sizeX = Math.max(0.01, bounds.max.x - bounds.min.x);
  const sizeY = Math.max(0.01, bounds.max.y - bounds.min.y);
  const sizeZ = Math.max(0.01, bounds.max.z - bounds.min.z);

  const centerX = (bounds.min.x + bounds.max.x) * 0.5;
  const centerY = (bounds.min.y + bounds.max.y) * 0.5;
  const centerZ = (bounds.min.z + bounds.max.z) * 0.5;

  let minTailX = Infinity; let maxTailX = -Infinity;
  let minTailY = Infinity; let maxTailY = -Infinity;
  let minTailZ = Infinity; let maxTailZ = -Infinity;

  for (const bone of armature.bones.values()) {
    minTailX = Math.min(minTailX, bone.tailLocal.x);
    maxTailX = Math.max(maxTailX, bone.tailLocal.x);
    minTailY = Math.min(minTailY, bone.tailLocal.y);
    maxTailY = Math.max(maxTailY, bone.tailLocal.y);
    minTailZ = Math.min(minTailZ, bone.tailLocal.z);
    maxTailZ = Math.max(maxTailZ, bone.tailLocal.z);
  }

  const spanX = Math.max(0.1, maxTailX - minTailX);
  const spanY = Math.max(0.1, maxTailY - minTailY);
  const spanZ = Math.max(0.1, maxTailZ - minTailZ);

  const scaleRatioX = sizeX / (spanX * 2);
  const scaleRatioY = sizeY / (spanY * 2);
  const scaleRatioZ = sizeZ / (spanZ * 2);
  const uniformScale = Math.min(scaleRatioX, scaleRatioY, scaleRatioZ);

  for (const bone of armature.bones.values()) {
    bone.tailLocal = v3(
      bone.tailLocal.x * uniformScale,
      bone.tailLocal.y * uniformScale,
      bone.tailLocal.z * uniformScale,
    );
  }

  armature.restTransform.position = v3(centerX, centerY, centerZ);
  return armature;
}

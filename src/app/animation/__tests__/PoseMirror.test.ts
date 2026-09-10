import { describe, expect, it } from 'vitest';
import { getMirroredBoneName, mirrorArmaturePose, mirrorBoneTransform } from '@/core/rig/poseMirror';
import { defaultTransform } from '@/core/math/Transform';
import type { Armature, Bone } from '@/core/rig/types';

describe('Pose Mirroring for Character Rigging', () => {
  it('correctly maps naming conventions across symmetry planes', () => {
    expect(getMirroredBoneName('Hand_L')).toBe('Hand_R');
    expect(getMirroredBoneName('Hand_R')).toBe('Hand_L');
    expect(getMirroredBoneName('leg.l')).toBe('leg.r');
    expect(getMirroredBoneName('leg.r')).toBe('leg.l');
    expect(getMirroredBoneName('L_Arm')).toBe('R_Arm');
    expect(getMirroredBoneName('R_Arm')).toBe('L_Arm');
    expect(getMirroredBoneName('LeftShoulder')).toBe('RightShoulder');
    expect(getMirroredBoneName('RightShoulder')).toBe('LeftShoulder');
    expect(getMirroredBoneName('Spine')).toBeNull();
    expect(getMirroredBoneName('Hips')).toBeNull();
  });

  it('negates X position and Y/Z rotations on mirrorBoneTransform', () => {
    const original = defaultTransform();
    original.position = { x: 1.5, y: 2.0, z: -0.5 };
    original.rotation = { x: 0.2, y: 0.4, z: -0.6 };

    const mirrored = mirrorBoneTransform(original);
    expect(mirrored.position.x).toBe(-1.5);
    expect(mirrored.position.y).toBe(2.0);
    expect(mirrored.position.z).toBe(-0.5);

    expect(mirrored.rotation.x).toBe(0.2);
    expect(mirrored.rotation.y).toBe(-0.4);
    expect(mirrored.rotation.z).toBe(0.6);
  });

  it('mirrors pose across armature pairs and swaps left and right limbs', () => {
    const armature: Armature = {
      id: 'arm_1',
      name: 'TestArmature',
      rootBoneIds: ['b_spine'],
      bones: new Map<string, Bone>([
        [
          'b_spine',
          { id: 'b_spine', name: 'Spine', parentId: null, tailLocal: { x: 0, y: 1, z: 0 }, roll: 0, localTransform: defaultTransform() },
        ],
        [
          'b_arm_l',
          { id: 'b_arm_l', name: 'Arm_L', parentId: 'b_spine', tailLocal: { x: 0, y: 1, z: 0 }, roll: 0, localTransform: defaultTransform() },
        ],
        [
          'b_arm_r',
          { id: 'b_arm_r', name: 'Arm_R', parentId: 'b_spine', tailLocal: { x: 0, y: 1, z: 0 }, roll: 0, localTransform: defaultTransform() },
        ],
      ]),
      restTransform: defaultTransform(),
    };

    const currentPose = new Map([
      ['b_spine', { ...defaultTransform(), position: { x: 0.5, y: 1, z: 0 } }],
      ['b_arm_l', { ...defaultTransform(), rotation: { x: 0.1, y: 0.3, z: 0.5 } }],
      ['b_arm_r', { ...defaultTransform(), rotation: { x: -0.2, y: -0.4, z: -0.6 } }],
    ]);

    const mirrored = mirrorArmaturePose(armature, currentPose);

    // Spine has mirrored X position
    expect(mirrored.get('b_spine')?.position.x).toBe(-0.5);

    // Arm_L gets Arm_R's transform with negated Y and Z rotation
    const newArmL = mirrored.get('b_arm_l');
    expect(newArmL?.rotation.x).toBe(-0.2);
    expect(newArmL?.rotation.y).toBe(0.4);
    expect(newArmL?.rotation.z).toBe(0.6);

    // Arm_R gets Arm_L's transform with negated Y and Z rotation
    const newArmR = mirrored.get('b_arm_r');
    expect(newArmR?.rotation.x).toBe(0.1);
    expect(newArmR?.rotation.y).toBe(-0.3);
    expect(newArmR?.rotation.z).toBe(-0.5);
  });
});

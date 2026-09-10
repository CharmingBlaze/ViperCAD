import { describe, expect, it } from 'vitest';
import {
  createBirdArmature,
  createCreatureArmature,
  createFishArmature,
  createHumanoidArmature,
  createQuadrupedArmature,
  fitArmatureToMeshBounds,
} from '@/core/rig/creatureSkeletons';
import { v3 } from '@/core/math/Vec3';

describe('creatureSkeletons', () => {
  it('creates a full humanoid armature with symmetric limb naming', () => {
    const arm = createHumanoidArmature();
    expect(arm.bones.size).toBe(20);
    expect(arm.rootBoneIds.length).toBe(1);

    const boneNames = [...arm.bones.values()].map((b) => b.name);
    expect(boneNames).toContain('root');
    expect(boneNames).toContain('head');
    expect(boneNames).toContain('upper_arm.L');
    expect(boneNames).toContain('upper_arm.R');
    expect(boneNames).toContain('thigh.L');
    expect(boneNames).toContain('thigh.R');
  });

  it('creates bird armature with wings, beak, neck, and tail', () => {
    const arm = createBirdArmature();
    expect(arm.bones.size).toBe(18);
    const boneNames = [...arm.bones.values()].map((b) => b.name);
    expect(boneNames).toContain('body');
    expect(boneNames).toContain('neck');
    expect(boneNames).toContain('beak');
    expect(boneNames).toContain('wing_shoulder.L');
    expect(boneNames).toContain('wing_tip.R');
    expect(boneNames).toContain('tail');
  });

  it('creates quadruped armature with front and rear legs and tail', () => {
    const arm = createQuadrupedArmature();
    expect(arm.bones.size).toBe(20);
    const boneNames = [...arm.bones.values()].map((b) => b.name);
    expect(boneNames).toContain('spine_front');
    expect(boneNames).toContain('spine_rear');
    expect(boneNames).toContain('shoulder_front.L');
    expect(boneNames).toContain('hip_rear.R');
    expect(boneNames).toContain('tail_1');
  });

  it('creates fish armature with multi-segment spine and fins', () => {
    const arm = createFishArmature();
    expect(arm.bones.size).toBe(10);
    const boneNames = [...arm.bones.values()].map((b) => b.name);
    expect(boneNames).toContain('spine_1');
    expect(boneNames).toContain('spine_4');
    expect(boneNames).toContain('tail_fin');
    expect(boneNames).toContain('pectoral_fin.L');
  });

  it('dispatcher generates matching creature types', () => {
    const bird = createCreatureArmature('bird');
    const quad = createCreatureArmature('quadruped');
    expect(bird.bones.has(bird.rootBoneIds[0]!)).toBe(true);
    expect(quad.bones.has(quad.rootBoneIds[0]!)).toBe(true);
  });

  it('fits armature to 3D bounding box proportionally and centers it', () => {
    const arm = createHumanoidArmature();
    const bounds = {
      min: v3(-2, 0, -1),
      max: v3(2, 4, 1),
    };

    fitArmatureToMeshBounds(arm, bounds);
    expect(arm.restTransform.position.x).toBeCloseTo(0);
    expect(arm.restTransform.position.y).toBeCloseTo(2);
    expect(arm.restTransform.position.z).toBeCloseTo(0);
  });
});

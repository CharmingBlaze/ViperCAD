import { describe, expect, it } from 'vitest';
import { assignVertexWeights, generateRigidSkinBinding } from '@/core/rig/directWeights';
import { createHumanoidArmature } from '@/core/rig/creatureSkeletons';
import { buildBox } from '@/core/mesh/builders';
import type { SkinBinding } from '@/core/rig/types';

describe('directWeights', () => {
  it('assigns, adds, and removes weights directly for selected vertex IDs', () => {
    const binding: SkinBinding = {
      id: 'skin1',
      name: 'Skin',
      meshId: 'm1',
      objectId: 'obj1',
      armatureId: 'arm1',
      vertexWeights: new Map(),
    };

    const vertexIds = ['v1', 'v2'];

    // 1. Assign 0.8 (normalized to 1.0 for single bone influence)
    assignVertexWeights(binding, vertexIds, 'bone_arm_L', 0.8, 'set');
    expect(binding.vertexWeights.get('v1')).toEqual([{ boneId: 'bone_arm_L', weight: 1.0 }]);

    // 2. Add another bone with 0.5
    assignVertexWeights(binding, vertexIds, 'bone_forearm_L', 0.5, 'add');
    const v1Weights = binding.vertexWeights.get('v1')!;
    expect(v1Weights.length).toBe(2);
    expect(v1Weights.reduce((s, w) => s + w.weight, 0)).toBeCloseTo(1.0);

    // 3. Remove bone_arm_L
    assignVertexWeights(binding, vertexIds, 'bone_arm_L', 0, 'remove');
    const v1AfterRemove = binding.vertexWeights.get('v1')!;
    expect(v1AfterRemove.length).toBe(1);
    expect(v1AfterRemove[0]!.boneId).toBe('bone_forearm_L');
  });

  it('generates rigid 1-bone skin binding for low-poly geometry', () => {
    const mesh = buildBox({ width: 1, height: 2, depth: 1 });
    const arm = createHumanoidArmature();

    const rigid = generateRigidSkinBinding('Rigid_Skin', mesh, 'obj_box', arm);
    expect(rigid.vertexWeights.size).toBe(mesh.vertices.size);

    for (const influences of rigid.vertexWeights.values()) {
      expect(influences.length).toBe(1);
      expect(influences[0]!.weight).toBe(1.0);
    }
  });
});

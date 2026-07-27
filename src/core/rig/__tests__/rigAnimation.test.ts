import { beforeEach, describe, expect, it } from 'vitest';
import { resetIdCounter } from '@/core/ids/IdService';
import { createDefaultArmature } from '@/core/rig/ArmatureFactory';
import { boneWorldMatrix, orderedBoneIds, transformVec3ByMat4 } from '@/core/rig/boneMatrices';
import { insertBoneKeyframe, keyframeTimesForBone, sampledLocalTransforms } from '@/core/rig/keyframes';
import { createDefaultAnimationClip } from '@/core/rig/RigDocument';
import { buildBox } from '@/core/mesh/builders';
import { generateEnvelopeSkinBinding } from '@/core/rig/skinning';
import { paintBoneWeight } from '@/core/rig/weightPaint';
import { cloneTransform, defaultTransform } from '@/core/math/Transform';

beforeEach(() => resetIdCounter(1));

describe('bone matrices', () => {
  it('orders bones depth-first from root', () => {
    const armature = createDefaultArmature();
    const ordered = orderedBoneIds(armature);
    expect(ordered[0]).toBe(armature.rootBoneIds[0]);
    expect(ordered.length).toBe(armature.bones.size);
  });

  it('computes bone world matrices', () => {
    const armature = createDefaultArmature();
    const rootId = armature.rootBoneIds[0]!;
    const cache = new Map();
    const locals = sampledLocalTransforms(armature, null, 0);
    const world = boneWorldMatrix(armature, rootId, locals, cache);
    const head = transformVec3ByMat4(world, { x: 0, y: 0, z: 0 });
    expect(Number.isFinite(head.x)).toBe(true);
  });
});

describe('keyframes', () => {
  it('inserts and samples bone keyframes', () => {
    const armature = createDefaultArmature();
    const clip = createDefaultAnimationClip();
    const boneId = armature.rootBoneIds[0]!;
    const value = cloneTransform(defaultTransform());
    value.rotation.y = 0.5;
    insertBoneKeyframe(clip, boneId, 0.5, value);
    expect(keyframeTimesForBone(clip, boneId)).toEqual([0.5]);
    const locals = sampledLocalTransforms(armature, clip, 0.5);
    expect(locals.get(boneId)?.rotation.y).toBeCloseTo(0.5);
  });

  it('interpolates rotation with slerp between keyframes', () => {
    const armature = createDefaultArmature();
    const clip = createDefaultAnimationClip();
    const boneId = armature.rootBoneIds[0]!;
    const start = cloneTransform(defaultTransform());
    start.rotation.y = 0;
    const end = cloneTransform(defaultTransform());
    end.rotation.y = Math.PI / 2;
    insertBoneKeyframe(clip, boneId, 0, start);
    insertBoneKeyframe(clip, boneId, 1, end);
    const mid = sampledLocalTransforms(armature, clip, 0.5).get(boneId)!;
    expect(mid.rotation.y).toBeGreaterThan(0.3);
    expect(mid.rotation.y).toBeLessThan(1.2);
  });
});

describe('weight paint', () => {
  it('adds weight for vertices inside brush radius', () => {
    const armature = createDefaultArmature();
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const binding = generateEnvelopeSkinBinding('Body', mesh, 'obj_1', armature);
    const boneId = armature.rootBoneIds[0]!;
    const vertex = [...mesh.vertices.values()][0]!;
    const touched = paintBoneWeight(mesh, binding, boneId, vertex.position, 0.2, 1, true);
    expect(touched).toBeGreaterThan(0);
    const weight = binding.vertexWeights.get(vertex.id)?.find((entry) => entry.boneId === boneId)?.weight ?? 0;
    expect(weight).toBeGreaterThan(0);
  });
});

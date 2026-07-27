import { beforeEach, describe, expect, it } from 'vitest';
import { resetIdCounter } from '@/core/ids/IdService';
import { createEmptyProject } from '@/core/document/ViperProject';
import { createDefaultArmature } from '@/core/rig/ArmatureFactory';
import { addBone, extrudeBone, removeBone, renameBone } from '@/core/rig/ArmatureEditor';
import {
  createClipForRig,
  deleteClipForRig,
  listClipsForRig,
  setActiveClip,
} from '@/core/rig/AnimationLibrary';
import { applyCurrentPoseAsRest } from '@/core/rig/RestPose';
import { ensureActiveClip, readRigDocumentSettings } from '@/core/rig/RigDocument';
import { insertBoneKeyframe, keyframeTimesForBone, moveBoneKeyframe, removeBoneKeyframe, sampledLocalTransforms } from '@/core/rig/keyframes';
import { evaluateArmaturePose } from '@/core/rig/evaluatePose';
import { boneWorldMatrix, transformVec3ByMat4 } from '@/core/rig/boneMatrices';
import { buildBox } from '@/core/mesh/builders';
import { generateEnvelopeSkinBinding, pruneBoneInfluences } from '@/core/rig/skinning';
import { findPrimaryRigForModel } from '@/core/rig/RigLookup';
import { defaultTransform } from '@/core/math/Transform';

beforeEach(() => resetIdCounter(1));

describe('ArmatureEditor', () => {
  it('adds, renames, and removes bones', () => {
    const armature = createDefaultArmature();
    const initial = armature.bones.size;
    const child = addBone(armature, 'extra', armature.rootBoneIds[0]!);
    expect(armature.bones.has(child.id)).toBe(true);
    renameBone(armature, child.id, 'renamed');
    expect(armature.bones.get(child.id)?.name).toBe('renamed');
    removeBone(armature, child.id);
    expect(armature.bones.size).toBe(initial);
  });

  it('extrudes a bone child at the parent tail', () => {
    const armature = createDefaultArmature();
    const rootId = armature.rootBoneIds[0]!;
    const child = extrudeBone(armature, rootId, 'extruded');
    expect(child).not.toBeNull();
    expect(armature.bones.get(child!.id)?.parentId).toBe(rootId);
  });
});

describe('AnimationLibrary', () => {
  it('creates multiple clips and switches active clip', () => {
    const project = createEmptyProject();
    const rigDoc = project.documents.get(project.rigDocumentIds[0]!)!;
    const first = ensureActiveClip(project, rigDoc);
    const second = createClipForRig(project, rigDoc, 'Walk');
    expect(listClipsForRig(project, rigDoc).length).toBe(2);
    expect(readRigDocumentSettings(rigDoc).activeClipId).toBe(second.id);
    setActiveClip(project, rigDoc, first.id);
    expect(readRigDocumentSettings(rigDoc).activeClipId).toBe(first.id);
    expect(deleteClipForRig(project, rigDoc, second.id)).toBe(true);
    expect(listClipsForRig(project, rigDoc).length).toBe(1);
  });
});

describe('RestPose and keyframes', () => {
  it('bakes animated pose into rest and clears tracks', () => {
    const project = createEmptyProject();
    const rigDoc = project.documents.get(project.rigDocumentIds[0]!)!;
    const armature = createDefaultArmature();
    const clip = ensureActiveClip(project, rigDoc);
    const boneId = armature.rootBoneIds[0]!;
    const posed = defaultTransform();
    posed.rotation.y = 0.5;
    insertBoneKeyframe(clip, boneId, 0, posed);
    applyCurrentPoseAsRest(armature, clip, 0);
    expect(armature.bones.get(boneId)?.localTransform.rotation.y).toBeCloseTo(0.5);
    expect(clip.tracks.length).toBe(0);
  });

  it('removes keyframes at a given time', () => {
    const armature = createDefaultArmature();
    const clip = { id: 'clip', name: 'A', duration: 1, fps: 24, tracks: [] as import('@/core/rig/types').BoneAnimationTrack[] };
    const boneId = armature.rootBoneIds[0]!;
    insertBoneKeyframe(clip, boneId, 0.5, defaultTransform());
    removeBoneKeyframe(clip, boneId, 0.5);
    expect(clip.tracks[0]?.keyframes.length ?? 0).toBe(0);
  });

  it('moves keyframes in time', () => {
    const armature = createDefaultArmature();
    const clip = { id: 'clip', name: 'A', duration: 2, fps: 24, tracks: [] as import('@/core/rig/types').BoneAnimationTrack[] };
    const boneId = armature.rootBoneIds[0]!;
    insertBoneKeyframe(clip, boneId, 0.5, defaultTransform());
    expect(moveBoneKeyframe(clip, boneId, 0.5, 1.0)).toBe(true);
    expect(keyframeTimesForBone(clip, boneId)).toEqual([1.0]);
  });
});

describe('skinning and pose evaluation', () => {
  it('weights vertices using bone segment distance', () => {
    const armature = createDefaultArmature();
    const mesh = buildBox({ width: 0.2, height: 1.6, depth: 0.2 });
    const binding = generateEnvelopeSkinBinding('Body', mesh, 'obj_1', armature, null, 1.0);
    const weighted = [...binding.vertexWeights.values()].filter((influences) => influences.length > 0);
    expect(weighted.length).toBeGreaterThan(0);
    for (const influences of weighted) {
      expect(influences.reduce((sum, entry) => sum + entry.weight, 0)).toBeCloseTo(1, 3);
    }
  });

  it('bone roll twists offsets around the bone axis', () => {
    const armature = createDefaultArmature();
    const bone = armature.bones.get([...armature.bones.values()].find((b) => b.name === 'upper_arm.L')!.id)!;
    const locals = sampledLocalTransforms(armature, null, 0);
    const cacheA = new Map();
    const worldA = boneWorldMatrix(armature, bone.id, locals, cacheA);
    const offsetA = transformVec3ByMat4(worldA, { x: 0, y: 0.08, z: 0 });
    bone.roll = Math.PI / 4;
    const cacheB = new Map();
    const worldB = boneWorldMatrix(armature, bone.id, locals, cacheB);
    const offsetB = transformVec3ByMat4(worldB, { x: 0, y: 0.08, z: 0 });
    expect(offsetB.z).not.toBeCloseTo(offsetA.z, 2);
  });

  it('prunes influences when bones are removed', () => {
    const armature = createDefaultArmature();
    const child = addBone(armature, 'child', armature.rootBoneIds[0]!);
    const mesh = buildBox({ width: 0.2, height: 1.6, depth: 0.2 });
    const binding = generateEnvelopeSkinBinding('Body', mesh, 'obj_1', armature, null, 1.0);
    binding.vertexWeights.set([...mesh.vertices.keys()][0]!, [
      { boneId: child.id, weight: 0.5 },
      { boneId: armature.rootBoneIds[0]!, weight: 0.5 },
    ]);
    removeBone(armature, child.id);
    pruneBoneInfluences(binding, [child.id]);
    for (const influences of binding.vertexWeights.values()) {
      expect(influences.every((entry) => entry.boneId !== child.id)).toBe(true);
    }
  });

  it('evaluateArmaturePose matches matrix hierarchy at rest', () => {
    const armature = createDefaultArmature();
    const boneId = armature.rootBoneIds[0]!;
    const pose = evaluateArmaturePose(armature, null, 0).get(boneId)!;
    const matrixHead = boneWorldMatrix(armature, boneId, sampledLocalTransforms(armature, null, 0), new Map());
    expect(pose.headWorld.x).toBeCloseTo(matrixHead[12]!, 3);
  });
});

describe('RigLookup', () => {
  it('finds rig documents linked to a model', () => {
    const project = createEmptyProject();
    const modelId = project.modelDocumentIds[0]!;
    const rig = findPrimaryRigForModel(project, modelId);
    expect(rig?.kind).toBe('rig');
    expect(readRigDocumentSettings(rig!).sourceModelDocumentId).toBe(modelId);
  });
});

import { defaultTransform } from '@/core/math/Transform';
import type {
  AnimationClip,
  Armature,
  Bone,
  BoneAnimationTrack,
  BoneInfluence,
  SkinBinding,
} from '@/core/rig/types';

type EncodedBone = Omit<Bone, 'tailLocal' | 'localTransform'> & {
  tailLocal: { x: number; y: number; z: number };
  localTransform: {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
  };
};

export type EncodedArmature = {
  id: string;
  name: string;
  rootBoneIds: string[];
  bones: EncodedBone[];
  restTransform: EncodedBone['localTransform'];
};

export type EncodedSkinBinding = {
  id: string;
  name: string;
  meshId: string;
  objectId: string;
  armatureId: string;
  vertexWeights: [string, BoneInfluence[]][];
};

export type EncodedAnimationClip = {
  id: string;
  name: string;
  duration: number;
  fps: number;
  tracks: BoneAnimationTrack[];
};

export function encodeArmature(armature: Armature): EncodedArmature {
  return {
    id: armature.id,
    name: armature.name,
    rootBoneIds: [...armature.rootBoneIds],
    restTransform: cloneTransform(armature.restTransform),
    bones: [...armature.bones.values()].map((bone) => ({
      ...bone,
      tailLocal: { ...bone.tailLocal },
      localTransform: cloneTransform(bone.localTransform),
    })),
  };
}

export function decodeArmature(encoded: EncodedArmature): Armature {
  return {
    id: encoded.id,
    name: encoded.name,
    rootBoneIds: [...encoded.rootBoneIds],
    restTransform: cloneTransform(encoded.restTransform),
    bones: new Map(encoded.bones.map((bone) => [bone.id, {
      ...bone,
      tailLocal: { ...bone.tailLocal },
      localTransform: cloneTransform(bone.localTransform),
    }])),
  };
}

export function encodeSkinBinding(binding: SkinBinding): EncodedSkinBinding {
  return {
    id: binding.id,
    name: binding.name,
    meshId: binding.meshId,
    objectId: binding.objectId,
    armatureId: binding.armatureId,
    vertexWeights: [...binding.vertexWeights.entries()].map(([vertexId, weights]) => [vertexId, weights.map((w) => ({ ...w }))]),
  };
}

export function decodeSkinBinding(encoded: EncodedSkinBinding): SkinBinding {
  return {
    id: encoded.id,
    name: encoded.name,
    meshId: encoded.meshId,
    objectId: encoded.objectId,
    armatureId: encoded.armatureId,
    vertexWeights: new Map(encoded.vertexWeights.map(([vertexId, weights]) => [vertexId, weights.map((w) => ({ ...w }))])),
  };
}

export function encodeAnimationClip(clip: AnimationClip): EncodedAnimationClip {
  return {
    id: clip.id,
    name: clip.name,
    duration: clip.duration,
    fps: clip.fps,
    tracks: clip.tracks.map((track) => ({
      boneId: track.boneId,
      keyframes: track.keyframes.map((keyframe) => ({
        time: keyframe.time,
        value: cloneTransform(keyframe.value),
      })),
    })),
  };
}

export function decodeAnimationClip(encoded: EncodedAnimationClip): AnimationClip {
  return {
    id: encoded.id,
    name: encoded.name,
    duration: encoded.duration,
    fps: encoded.fps,
    tracks: encoded.tracks.map((track) => ({
      boneId: track.boneId,
      keyframes: track.keyframes.map((keyframe) => ({
        time: keyframe.time,
        value: cloneTransform(keyframe.value),
      })),
    })),
  };
}

function cloneTransform(transform: EncodedBone['localTransform']) {
  return {
    position: { ...transform.position },
    rotation: { ...transform.rotation },
    scale: { ...transform.scale },
  };
}

export function emptyRigCollections() {
  return {
    armatures: new Map<string, Armature>(),
    skinBindings: new Map<string, SkinBinding>(),
    animationClips: new Map<string, AnimationClip>(),
  };
}

export function defaultRestTransform() {
  return cloneTransform(defaultTransform());
}

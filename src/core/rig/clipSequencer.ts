import { createId } from '@/core/ids/IdService';
import { cloneTransform, type Transform } from '@/core/math/Transform';
import type { Vec3 } from '@/core/math/Vec3';
import { insertBoneKeyframe, sampledLocalTransforms } from '@/core/rig/keyframes';
import type { AnimationClip, AnimationClipId, Armature, BoneId } from '@/core/rig/types';

export type ClipSequenceItem = {
  id: string;
  clipId: AnimationClipId;
  name: string;
  startTime: number;
  duration: number;
  speedMultiplier: number;
  blendIn: number;
  blendOut: number;
};

type Quat = { x: number; y: number; z: number; w: number };

function eulerToQuat(rotation: Vec3): Quat {
  const cx = Math.cos(rotation.x * 0.5);
  const sx = Math.sin(rotation.x * 0.5);
  const cy = Math.cos(rotation.y * 0.5);
  const sy = Math.sin(rotation.y * 0.5);
  const cz = Math.cos(rotation.z * 0.5);
  const sz = Math.sin(rotation.z * 0.5);
  return {
    w: cx * cy * cz + sx * sy * sz,
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * sy * sz - sx * cy * cz,
  };
}

function quatToEuler(q: Quat): Vec3 {
  const sinrCosp = 2 * (q.w * q.x + q.y * q.z);
  const cosrCosp = 1 - 2 * (q.x * q.x + q.y * q.y);
  const x = Math.atan2(sinrCosp, cosrCosp);
  const sinp = 2 * (q.w * q.y - q.z * q.x);
  const y = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp);
  const sinyCosp = 2 * (q.w * q.z + q.x * q.y);
  const cosyCosp = 1 - 2 * (q.y * q.y + q.z * q.z);
  const z = Math.atan2(sinyCosp, cosyCosp);
  return { x, y, z };
}

function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (dot > 0.9995) {
    return {
      x: a.x + t * (bx - a.x),
      y: a.y + t * (by - a.y),
      z: a.z + t * (bz - a.z),
      w: a.w + t * (bw - a.w),
    };
  }
  const theta = Math.acos(Math.min(1, dot));
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  return {
    x: wa * a.x + wb * bx,
    y: wa * a.y + wb * by,
    z: wa * a.z + wb * bz,
    w: wa * a.w + wb * bw,
  };
}

function blendTransforms(a: Transform, b: Transform, t: number): Transform {
  const qa = eulerToQuat(a.rotation);
  const qb = eulerToQuat(b.rotation);
  const q = quatSlerp(qa, qb, t);
  return {
    position: {
      x: a.position.x + (b.position.x - a.position.x) * t,
      y: a.position.y + (b.position.y - a.position.y) * t,
      z: a.position.z + (b.position.z - a.position.z) * t,
    },
    rotation: quatToEuler(q),
    scale: {
      x: a.scale.x + (b.scale.x - a.scale.x) * t,
      y: a.scale.y + (b.scale.y - a.scale.y) * t,
      z: a.scale.z + (b.scale.z - a.scale.z) * t,
    },
  };
}

/**
 * Calculate the weight of a sequence item at master time (accounting for blend-in and blend-out)
 */
export function calculateItemWeight(item: ClipSequenceItem, masterTime: number): number {
  if (masterTime < item.startTime || masterTime > item.startTime + item.duration) return 0;
  const localElapsed = masterTime - item.startTime;
  const localRemaining = item.duration - localElapsed;

  let inWeight = 1.0;
  if (item.blendIn > 0 && localElapsed < item.blendIn) {
    const t = localElapsed / item.blendIn;
    inWeight = t * t * (3 - 2 * t); // smoothstep
  }

  let outWeight = 1.0;
  if (item.blendOut > 0 && localRemaining < item.blendOut) {
    const t = localRemaining / item.blendOut;
    outWeight = t * t * (3 - 2 * t); // smoothstep
  }

  return Math.max(0, Math.min(1, inWeight * outWeight));
}

/**
 * Sample all sequenced clips at a specific master time with cross-fading
 */
export function sampleSequencedClips(
  items: ClipSequenceItem[],
  clips: Map<AnimationClipId, AnimationClip>,
  armature: Armature,
  masterTime: number,
): Map<BoneId, Transform> {
  const activeItems = items
    .map((item) => ({
      item,
      clip: clips.get(item.clipId),
      weight: calculateItemWeight(item, masterTime),
    }))
    .filter((entry) => entry.clip && entry.weight > 0);

  if (activeItems.length === 0) {
    return sampledLocalTransforms(armature, null, masterTime);
  }

  if (activeItems.length === 1) {
    const { item, clip } = activeItems[0]!;
    const localTime = ((masterTime - item.startTime) * item.speedMultiplier) % (clip!.duration || 1);
    return sampledLocalTransforms(armature, clip!, localTime);
  }

  // Multi-clip blending: blend consecutively by normalized weight
  const totalWeight = activeItems.reduce((sum, entry) => sum + entry.weight, 0) || 1;
  const sampledMaps = activeItems.map(({ item, clip, weight }) => {
    const localTime = ((masterTime - item.startTime) * item.speedMultiplier) % (clip!.duration || 1);
    return {
      transforms: sampledLocalTransforms(armature, clip!, localTime),
      normalizedWeight: weight / totalWeight,
    };
  });

  const result = new Map<BoneId, Transform>();
  for (const [boneId, bone] of armature.bones) {
    let accumulated: Transform = cloneTransform(bone.localTransform);
    let currentWeightSum = 0;

    for (let i = 0; i < sampledMaps.length; i++) {
      const { transforms, normalizedWeight } = sampledMaps[i]!;
      const t = transforms.get(boneId) ?? bone.localTransform;
      if (i === 0) {
        accumulated = cloneTransform(t);
        currentWeightSum = normalizedWeight;
      } else {
        const blendFactor = normalizedWeight / (currentWeightSum + normalizedWeight || 1);
        accumulated = blendTransforms(accumulated, t, blendFactor);
        currentWeightSum += normalizedWeight;
      }
    }
    result.set(boneId, accumulated);
  }

  return result;
}

/**
 * Compute the total master duration of the sequence track
 */
export function getSequenceTotalDuration(items: ClipSequenceItem[]): number {
  if (items.length === 0) return 0;
  return items.reduce((max, item) => Math.max(max, item.startTime + item.duration), 0);
}

/**
 * Bake a full multi-clip sequence track into a single seamless continuous AnimationClip
 */
export function bakeSequenceToSingleClip(
  items: ClipSequenceItem[],
  clips: Map<AnimationClipId, AnimationClip>,
  armature: Armature,
  options: { name?: string; fps?: number } = {},
): AnimationClip {
  const totalDuration = Math.max(0.1, getSequenceTotalDuration(items));
  const fps = options.fps ?? 24;
  const totalFrames = Math.max(1, Math.round(totalDuration * fps));

  const newClip: AnimationClip = {
    id: createId('clip'),
    name: options.name ?? 'Baked_Sequence',
    duration: totalDuration,
    fps,
    tracks: [],
    events: [],
  };

  for (let frame = 0; frame <= totalFrames; frame++) {
    const masterTime = (frame / totalFrames) * totalDuration;
    const sampledPose = sampleSequencedClips(items, clips, armature, masterTime);

    for (const [boneId, transform] of sampledPose) {
      insertBoneKeyframe(newClip, boneId, masterTime, transform, 'smooth');
    }
  }

  return newClip;
}

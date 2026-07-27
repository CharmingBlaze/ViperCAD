import { cloneTransform, defaultTransform, type Transform } from '@/core/math/Transform';
import type { Vec3 } from '@/core/math/Vec3';
import type { AnimationClip, Armature, BoneId } from '@/core/rig/types';

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
    z: cx * cy * sz - sx * sy * cz,
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

function lerpTransform(a: Transform, b: Transform, t: number): Transform {
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

function sampleTrack(keyframes: { time: number; value: Transform }[], time: number): Transform {
  if (!keyframes.length) return defaultTransform();
  if (time <= keyframes[0]!.time) return cloneTransform(keyframes[0]!.value);
  const last = keyframes[keyframes.length - 1]!;
  if (time >= last.time) return cloneTransform(last.value);
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const current = keyframes[index]!;
    const next = keyframes[index + 1]!;
    if (time >= current.time && time <= next.time) {
      const span = next.time - current.time || 1;
      const t = (time - current.time) / span;
      return lerpTransform(current.value, next.value, t);
    }
  }
  return cloneTransform(last.value);
}

export function sampledLocalTransforms(
  armature: Armature,
  clip: AnimationClip | null,
  time: number,
): Map<BoneId, Transform> {
  const locals = new Map<BoneId, Transform>();
  for (const bone of armature.bones.values()) {
    locals.set(bone.id, cloneTransform(bone.localTransform));
  }
  if (!clip) return locals;
  for (const track of clip.tracks) {
    locals.set(track.boneId, sampleTrack(track.keyframes, time));
  }
  return locals;
}

export function insertBoneKeyframe(
  clip: AnimationClip,
  boneId: BoneId,
  time: number,
  value: Transform,
): void {
  let track = clip.tracks.find((entry) => entry.boneId === boneId);
  if (!track) {
    track = { boneId, keyframes: [] };
    clip.tracks.push(track);
  }
  const existing = track.keyframes.findIndex((keyframe) => Math.abs(keyframe.time - time) < 1e-4);
  const snapshot = cloneTransform(value);
  if (existing >= 0) track.keyframes[existing] = { time, value: snapshot };
  else track.keyframes.push({ time, value: snapshot });
  track.keyframes.sort((a, b) => a.time - b.time);
  const lastTime = track.keyframes[track.keyframes.length - 1]?.time ?? clip.duration;
  if (lastTime > clip.duration) clip.duration = lastTime;
}

export function removeBoneKeyframe(clip: AnimationClip, boneId: BoneId, time: number): void {
  const track = clip.tracks.find((entry) => entry.boneId === boneId);
  if (!track) return;
  track.keyframes = track.keyframes.filter((keyframe) => Math.abs(keyframe.time - time) >= 1e-4);
}

export function moveBoneKeyframe(
  clip: AnimationClip,
  boneId: BoneId,
  fromTime: number,
  toTime: number,
): boolean {
  const track = clip.tracks.find((entry) => entry.boneId === boneId);
  if (!track) return false;
  const index = track.keyframes.findIndex((keyframe) => Math.abs(keyframe.time - fromTime) < 1e-4);
  if (index < 0) return false;
  const clamped = Math.max(0, toTime);
  if (track.keyframes.some((keyframe, i) => i !== index && Math.abs(keyframe.time - clamped) < 1e-4)) {
    return false;
  }
  track.keyframes[index]!.time = clamped;
  track.keyframes.sort((a, b) => a.time - b.time);
  const lastTime = track.keyframes[track.keyframes.length - 1]?.time ?? clip.duration;
  if (lastTime > clip.duration) clip.duration = lastTime;
  return true;
}

export function hasKeyframeAt(clip: AnimationClip | null, boneId: BoneId, time: number): boolean {
  if (!clip) return false;
  const track = clip.tracks.find((entry) => entry.boneId === boneId);
  return !!track?.keyframes.some((keyframe) => Math.abs(keyframe.time - time) < 1e-4);
}

export function keyframeTimesForBone(clip: AnimationClip | null, boneId: BoneId): number[] {
  if (!clip) return [];
  const track = clip.tracks.find((entry) => entry.boneId === boneId);
  return track ? track.keyframes.map((keyframe) => keyframe.time) : [];
}

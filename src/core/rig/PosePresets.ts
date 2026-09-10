import { v3 } from '@/core/math/Vec3';
import type { AnimationClip, Armature } from '@/core/rig/types';
import { insertBoneKeyframe } from '@/core/rig/keyframes';

export type PosePresetName = 'T-Pose' | 'A-Pose' | 'Combat Stance' | 'Sitting' | 'Crouching';

/** Standard pose rotations (Euler angles in radians) for character bones */
const POSE_PRESETS: Record<PosePresetName, Record<string, { x?: number; y?: number; z?: number }>> = {
  'T-Pose': {
    arm: { x: 0, y: 0, z: 0 },
    leg: { x: 0, y: 0, z: 0 },
  },
  'A-Pose': {
    'upper_arm.l': { x: 0, y: 0, z: -0.7 },
    'upper_arm.r': { x: 0, y: 0, z: 0.7 },
    'upperarm.l': { x: 0, y: 0, z: -0.7 },
    'upperarm.r': { x: 0, y: 0, z: 0.7 },
    arm_l: { x: 0, y: 0, z: -0.7 },
    arm_r: { x: 0, y: 0, z: 0.7 },
  },
  'Combat Stance': {
    spine: { x: 0.15, y: -0.2, z: 0 },
    'upperarm.l': { x: 0.6, y: 0.4, z: -0.3 },
    'upperarm.r': { x: 0.8, y: -0.4, z: 0.3 },
    'thigh.l': { x: -0.3, y: 0.2, z: 0 },
    'thigh.r': { x: 0.3, y: -0.2, z: 0 },
  },
  'Sitting': {
    'thigh.l': { x: -1.4, y: 0, z: 0 },
    'thigh.r': { x: -1.4, y: 0, z: 0 },
    'shin.l': { x: 1.4, y: 0, z: 0 },
    'shin.r': { x: 1.4, y: 0, z: 0 },
  },
  'Crouching': {
    spine: { x: 0.3, y: 0, z: 0 },
    'thigh.l': { x: -1.1, y: 0, z: 0 },
    'thigh.r': { x: -1.1, y: 0, z: 0 },
    'shin.l': { x: 1.6, y: 0, z: 0 },
    'shin.r': { x: 1.6, y: 0, z: 0 },
  },
};

/** Apply a preset pose to matching bones in armature at keyframe time */
export function applyPosePreset(
  armature: Armature,
  clip: AnimationClip,
  presetName: PosePresetName,
  time = 0,
): number {
  const preset = POSE_PRESETS[presetName];
  if (!preset) return 0;

  let applied = 0;
  for (const bone of armature.bones.values()) {
    const nameLower = bone.name.toLowerCase();
    for (const [key, euler] of Object.entries(preset)) {
      if (nameLower.includes(key)) {
        const rotation = v3(euler.x ?? 0, euler.y ?? 0, euler.z ?? 0);
        insertBoneKeyframe(clip, bone.id, time, {
          position: bone.localTransform.position,
          rotation,
          scale: v3(1, 1, 1),
        });
        applied++;
        break;
      }
    }
  }
  return applied;
}

/** Generate a 24-frame walking motion cycle clip */
export function generateWalkCycle(clip: AnimationClip, armature: Armature): void {
  clip.duration = 1.0;
  clip.fps = 24;

  const totalFrames = 24;
  for (let f = 0; f <= totalFrames; f++) {
    const time = (f / totalFrames) * clip.duration;
    const phase = (f / totalFrames) * Math.PI * 2;

    const legLSwing = Math.sin(phase) * 0.45;
    const legRSwing = Math.sin(phase + Math.PI) * 0.45;
    const armLSwing = Math.sin(phase + Math.PI) * 0.35;
    const armRSwing = Math.sin(phase) * 0.35;
    const hipBob = Math.abs(Math.sin(phase * 2)) * 0.04;
    const spineTwist = Math.sin(phase) * 0.08;

    for (const bone of armature.bones.values()) {
      const name = bone.name.toLowerCase();
      let rot = v3(0, 0, 0);
      let pos = { ...bone.localTransform.position };

      if (name.includes('hip') || name.includes('pelvis') || name.includes('root')) {
        pos.y = bone.localTransform.position.y - hipBob;
      } else if (name.includes('spine')) {
        rot = v3(0, spineTwist, 0);
      } else if (name.includes('thigh.l') || name.includes('leg_l')) {
        rot = v3(legLSwing, 0, 0);
      } else if (name.includes('thigh.r') || name.includes('leg_r')) {
        rot = v3(legRSwing, 0, 0);
      } else if (name.includes('upperarm.l') || name.includes('arm_l')) {
        rot = v3(armLSwing, 0, 0);
      } else if (name.includes('upperarm.r') || name.includes('arm_r')) {
        rot = v3(armRSwing, 0, 0);
      }

      insertBoneKeyframe(clip, bone.id, time, {
        position: pos,
        rotation: rot,
        scale: v3(1, 1, 1),
      });
    }
  }
}

/** Generate a 48-frame subtle idle breathing cycle clip */
export function generateIdleCycle(clip: AnimationClip, armature: Armature): void {
  clip.duration = 2.0;
  clip.fps = 24;

  const totalFrames = 48;
  for (let f = 0; f <= totalFrames; f++) {
    const time = (f / totalFrames) * clip.duration;
    const phase = (f / totalFrames) * Math.PI * 2;

    const breath = Math.sin(phase) * 0.06;
    const sway = Math.cos(phase * 0.5) * 0.02;

    for (const bone of armature.bones.values()) {
      const name = bone.name.toLowerCase();
      let rot = v3(0, 0, 0);

      if (name.includes('chest') || name.includes('spine')) {
        rot = v3(breath, 0, sway);
      } else if (name.includes('head')) {
        rot = v3(-breath * 0.5, 0, 0);
      }

      insertBoneKeyframe(clip, bone.id, time, {
        position: bone.localTransform.position,
        rotation: rot,
        scale: v3(1, 1, 1),
      });
    }
  }
}

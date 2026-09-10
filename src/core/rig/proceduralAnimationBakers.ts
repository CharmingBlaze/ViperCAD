import { defaultTransform } from '@/core/math/Transform';
import { v3 } from '@/core/math/Vec3';
import { insertBoneKeyframe } from '@/core/rig/keyframes';
import type { AnimationClip, Armature, BoneId } from '@/core/rig/types';

/**
 * Helper to find bone ID by name substring (case-insensitive)
 */
function findBoneId(armature: Armature, pattern: string | RegExp): BoneId | null {
  for (const [id, bone] of armature.bones) {
    if (typeof pattern === 'string') {
      if (bone.name.toLowerCase().includes(pattern.toLowerCase())) return id;
    } else {
      if (pattern.test(bone.name)) return id;
    }
  }
  return null;
}

/**
 * Procedural Bird Flight / Wing Flapping Generator
 */
export function bakeBirdFlight(
  clip: AnimationClip,
  armature: Armature,
  options: { duration?: number; fps?: number; flapSpeed?: number } = {},
): void {
  const duration = options.duration ?? 1.0;
  const fps = options.fps ?? 24;
  const flapSpeed = options.flapSpeed ?? 2.0; // 2 flaps per second
  const totalFrames = Math.round(duration * fps);
  clip.duration = duration;
  clip.fps = fps;
  clip.tracks = [];

  const bodyId = findBoneId(armature, 'body') ?? findBoneId(armature, 'root');
  const wingBaseL = findBoneId(armature, /wing_(shoulder|arm|base)\.L/i);
  const wingMidL = findBoneId(armature, /wing_arm\.L/i);
  const wingTipL = findBoneId(armature, /wing_tip\.L/i);
  const wingBaseR = findBoneId(armature, /wing_(shoulder|arm|base)\.R/i);
  const wingMidR = findBoneId(armature, /wing_arm\.R/i);
  const wingTipR = findBoneId(armature, /wing_tip\.R/i);
  const tailId = findBoneId(armature, 'tail');
  const neckId = findBoneId(armature, 'neck');

  for (let frame = 0; frame <= totalFrames; frame++) {
    const time = (frame / totalFrames) * duration;
    const phase = (time * flapSpeed * Math.PI * 2);

    // Body bobbing up/down
    if (bodyId) {
      const t = defaultTransform();
      t.position.y = Math.sin(phase) * 0.08;
      t.rotation.x = Math.sin(phase + 0.5) * 0.05;
      insertBoneKeyframe(clip, bodyId, time, t, 'smooth');
    }

    // Left Wing
    const flapAngle = Math.sin(phase) * 0.55;
    if (wingBaseL) {
      const t = defaultTransform();
      t.rotation.z = flapAngle;
      t.rotation.y = Math.cos(phase) * 0.15;
      insertBoneKeyframe(clip, wingBaseL, time, t, 'smooth');
    }
    if (wingMidL) {
      const t = defaultTransform();
      t.rotation.z = Math.sin(phase + 0.4) * 0.35;
      insertBoneKeyframe(clip, wingMidL, time, t, 'smooth');
    }
    if (wingTipL) {
      const t = defaultTransform();
      t.rotation.z = Math.sin(phase + 0.8) * 0.45;
      insertBoneKeyframe(clip, wingTipL, time, t, 'smooth');
    }

    // Right Wing (mirrored Z)
    if (wingBaseR) {
      const t = defaultTransform();
      t.rotation.z = -flapAngle;
      t.rotation.y = -Math.cos(phase) * 0.15;
      insertBoneKeyframe(clip, wingBaseR, time, t, 'smooth');
    }
    if (wingMidR) {
      const t = defaultTransform();
      t.rotation.z = -Math.sin(phase + 0.4) * 0.35;
      insertBoneKeyframe(clip, wingMidR, time, t, 'smooth');
    }
    if (wingTipR) {
      const t = defaultTransform();
      t.rotation.z = -Math.sin(phase + 0.8) * 0.45;
      insertBoneKeyframe(clip, wingTipR, time, t, 'smooth');
    }

    // Tail feather stabilizer
    if (tailId) {
      const t = defaultTransform();
      t.rotation.x = -Math.sin(phase) * 0.12;
      insertBoneKeyframe(clip, tailId, time, t, 'smooth');
    }

    // Neck / Head counter-balance
    if (neckId) {
      const t = defaultTransform();
      t.rotation.x = -Math.sin(phase + 0.5) * 0.06;
      insertBoneKeyframe(clip, neckId, time, t, 'smooth');
    }
  }
}

/**
 * Procedural Bird Drinking / Pecking Animation
 */
export function bakeBirdDrink(
  clip: AnimationClip,
  armature: Armature,
  options: { duration?: number; fps?: number } = {},
): void {
  const duration = options.duration ?? 2.0;
  const fps = options.fps ?? 24;
  clip.duration = duration;
  clip.fps = fps;
  clip.tracks = [];

  const bodyId = findBoneId(armature, 'body') ?? findBoneId(armature, 'root');
  const neckId = findBoneId(armature, 'neck');
  const headId = findBoneId(armature, 'head');
  const beakId = findBoneId(armature, 'beak');
  const tailId = findBoneId(armature, 'tail');

  // Keyframe points in drinking action:
  // 0.0: Rest upright
  // 0.35: Dip down to drink water
  // 0.65: Pecking water surface
  // 1.1: Tilt head back to swallow
  // 1.7: Return to upright rest
  const keyPoints = [
    { t: 0.0, dip: 0, tiltBack: 0, tailUp: 0 },
    { t: 0.25 * duration, dip: 0.7, tiltBack: 0, tailUp: 0.25 },
    { t: 0.45 * duration, dip: 0.75, tiltBack: 0, tailUp: 0.28 },
    { t: 0.60 * duration, dip: 0.7, tiltBack: 0, tailUp: 0.25 },
    { t: 0.75 * duration, dip: -0.2, tiltBack: 0.55, tailUp: -0.15 },
    { t: 0.90 * duration, dip: -0.15, tiltBack: 0.5, tailUp: -0.1 },
    { t: 1.0 * duration, dip: 0, tiltBack: 0, tailUp: 0 },
  ];

  for (const p of keyPoints) {
    if (bodyId) {
      const t = defaultTransform();
      t.rotation.x = p.dip * 0.4;
      insertBoneKeyframe(clip, bodyId, p.t, t, 'smooth');
    }
    if (neckId) {
      const t = defaultTransform();
      t.rotation.x = p.dip * 0.6 - p.tiltBack * 0.4;
      insertBoneKeyframe(clip, neckId, p.t, t, 'smooth');
    }
    if (headId) {
      const t = defaultTransform();
      t.rotation.x = p.dip * 0.4 - p.tiltBack * 0.5;
      insertBoneKeyframe(clip, headId, p.t, t, 'smooth');
    }
    if (beakId) {
      const t = defaultTransform();
      t.rotation.x = (p.dip > 0.5 ? 0.15 : 0);
      insertBoneKeyframe(clip, beakId, p.t, t, 'smooth');
    }
    if (tailId) {
      const t = defaultTransform();
      t.rotation.x = p.tailUp * 0.5;
      insertBoneKeyframe(clip, tailId, p.t, t, 'smooth');
    }
  }
}

/**
 * Procedural Quadruped / Dog Walk & Run Cycle Generator
 */
export function bakeQuadrupedLocomotion(
  clip: AnimationClip,
  armature: Armature,
  options: { duration?: number; fps?: number; isRun?: boolean } = {},
): void {
  const isRun = options.isRun ?? false;
  const duration = options.duration ?? (isRun ? 0.6 : 1.2);
  const fps = options.fps ?? 24;
  const totalFrames = Math.round(duration * fps);
  clip.duration = duration;
  clip.fps = fps;
  clip.tracks = [];

  const rootId = findBoneId(armature, 'root');
  const spineFrontId = findBoneId(armature, 'spine_front');
  const spineRearId = findBoneId(armature, 'spine_rear');
  const headId = findBoneId(armature, 'head');
  const tail1Id = findBoneId(armature, 'tail_1');
  const tail2Id = findBoneId(armature, 'tail_2');

  // Front legs
  const shoulderFL = findBoneId(armature, /shoulder.*front\.L|shoulder\.L/i);
  const forearmFL = findBoneId(armature, /forearm.*front\.L|forearm\.L/i);
  const shoulderFR = findBoneId(armature, /shoulder.*front\.R|shoulder\.R/i);
  const forearmFR = findBoneId(armature, /forearm.*front\.R|forearm\.R/i);

  // Rear legs
  const hipRL = findBoneId(armature, /hip.*rear\.L|thigh\.L/i);
  const shinRL = findBoneId(armature, /shin.*rear\.L|shin\.L/i);
  const hipRR = findBoneId(armature, /hip.*rear\.R|thigh\.R/i);
  const shinRR = findBoneId(armature, /shin.*rear\.R|shin\.R/i);

  const strideMult = isRun ? 0.65 : 0.38;

  for (let frame = 0; frame <= totalFrames; frame++) {
    const time = (frame / totalFrames) * duration;
    const phase = (time / duration) * Math.PI * 2;

    // Body bounce and roll
    if (rootId) {
      const t = defaultTransform();
      t.position.y = Math.abs(Math.sin(phase * 2)) * (isRun ? 0.08 : 0.03);
      t.rotation.z = Math.sin(phase) * 0.03;
      insertBoneKeyframe(clip, rootId, time, t, 'smooth');
    }

    // Spine flex
    if (spineFrontId && spineRearId) {
      const tFront = defaultTransform();
      tFront.rotation.x = Math.sin(phase) * (isRun ? 0.15 : 0.04);
      insertBoneKeyframe(clip, spineFrontId, time, tFront, 'smooth');

      const tRear = defaultTransform();
      tRear.rotation.x = -Math.sin(phase) * (isRun ? 0.15 : 0.04);
      insertBoneKeyframe(clip, spineRearId, time, tRear, 'smooth');
    }

    // Tail wagging
    if (tail1Id) {
      const t = defaultTransform();
      t.rotation.y = Math.sin(phase * 2) * 0.35;
      t.rotation.x = 0.1 + Math.cos(phase * 2) * 0.05;
      insertBoneKeyframe(clip, tail1Id, time, t, 'smooth');
    }
    if (tail2Id) {
      const t = defaultTransform();
      t.rotation.y = Math.sin(phase * 2 - 0.5) * 0.5;
      insertBoneKeyframe(clip, tail2Id, time, t, 'smooth');
    }

    // Head bob
    if (headId) {
      const t = defaultTransform();
      t.rotation.x = Math.sin(phase + 0.5) * (isRun ? 0.1 : 0.04);
      insertBoneKeyframe(clip, headId, time, t, 'smooth');
    }

    // Diagonal leg gait: Front Left + Rear Right in phase; Front Right + Rear Left 180° out of phase
    const phaseFL = phase;
    const phaseFR = phase + Math.PI;
    const phaseRL = phase + Math.PI + (isRun ? 0.3 : 0.15);
    const phaseRR = phase + (isRun ? 0.3 : 0.15);

    // Front Left Leg
    if (shoulderFL) {
      const t = defaultTransform();
      t.rotation.x = Math.sin(phaseFL) * strideMult;
      insertBoneKeyframe(clip, shoulderFL, time, t, 'smooth');
    }
    if (forearmFL) {
      const t = defaultTransform();
      t.rotation.x = Math.max(0, -Math.sin(phaseFL) * strideMult * 1.2);
      insertBoneKeyframe(clip, forearmFL, time, t, 'smooth');
    }

    // Front Right Leg
    if (shoulderFR) {
      const t = defaultTransform();
      t.rotation.x = Math.sin(phaseFR) * strideMult;
      insertBoneKeyframe(clip, shoulderFR, time, t, 'smooth');
    }
    if (forearmFR) {
      const t = defaultTransform();
      t.rotation.x = Math.max(0, -Math.sin(phaseFR) * strideMult * 1.2);
      insertBoneKeyframe(clip, forearmFR, time, t, 'smooth');
    }

    // Rear Left Leg
    if (hipRL) {
      const t = defaultTransform();
      t.rotation.x = Math.sin(phaseRL) * strideMult;
      insertBoneKeyframe(clip, hipRL, time, t, 'smooth');
    }
    if (shinRL) {
      const t = defaultTransform();
      t.rotation.x = Math.max(0, -Math.sin(phaseRL) * strideMult * 1.3);
      insertBoneKeyframe(clip, shinRL, time, t, 'smooth');
    }

    // Rear Right Leg
    if (hipRR) {
      const t = defaultTransform();
      t.rotation.x = Math.sin(phaseRR) * strideMult;
      insertBoneKeyframe(clip, hipRR, time, t, 'smooth');
    }
    if (shinRR) {
      const t = defaultTransform();
      t.rotation.x = Math.max(0, -Math.sin(phaseRR) * strideMult * 1.3);
      insertBoneKeyframe(clip, shinRR, time, t, 'smooth');
    }
  }
}

/**
 * Procedural Fish / Aquatic Swim Undulation Generator
 */
export function bakeFishSwim(
  clip: AnimationClip,
  armature: Armature,
  options: { duration?: number; fps?: number; waveSpeed?: number } = {},
): void {
  const duration = options.duration ?? 1.2;
  const fps = options.fps ?? 24;
  const waveSpeed = options.waveSpeed ?? 1.5;
  const totalFrames = Math.round(duration * fps);
  clip.duration = duration;
  clip.fps = fps;
  clip.tracks = [];

  const rootId = findBoneId(armature, 'root');
  const spine1Id = findBoneId(armature, 'spine_1');
  const spine2Id = findBoneId(armature, 'spine_2');
  const spine3Id = findBoneId(armature, 'spine_3');
  const spine4Id = findBoneId(armature, 'spine_4');
  const tailFinId = findBoneId(armature, 'tail_fin');
  const finLId = findBoneId(armature, /pectoral_fin\.L|fin\.L/i);
  const finRId = findBoneId(armature, /pectoral_fin\.R|fin\.R/i);

  const spineChain = [
    { id: rootId, amp: 0.08, phaseOffset: 0.0 },
    { id: spine1Id, amp: 0.12, phaseOffset: 0.4 },
    { id: spine2Id, amp: 0.22, phaseOffset: 0.9 },
    { id: spine3Id, amp: 0.35, phaseOffset: 1.5 },
    { id: spine4Id, amp: 0.50, phaseOffset: 2.2 },
    { id: tailFinId, amp: 0.65, phaseOffset: 2.9 },
  ];

  for (let frame = 0; frame <= totalFrames; frame++) {
    const time = (frame / totalFrames) * duration;
    const basePhase = (time * waveSpeed * Math.PI * 2);

    for (const segment of spineChain) {
      if (!segment.id) continue;
      const t = defaultTransform();
      t.rotation.y = Math.sin(basePhase + segment.phaseOffset) * segment.amp;
      insertBoneKeyframe(clip, segment.id, time, t, 'smooth');
    }

    // Pectoral fin paddling
    if (finLId) {
      const t = defaultTransform();
      t.rotation.y = Math.sin(basePhase + 0.3) * 0.3;
      t.rotation.z = Math.cos(basePhase + 0.3) * 0.2;
      insertBoneKeyframe(clip, finLId, time, t, 'smooth');
    }
    if (finRId) {
      const t = defaultTransform();
      t.rotation.y = -Math.sin(basePhase + 0.3) * 0.3;
      t.rotation.z = -Math.cos(basePhase + 0.3) * 0.2;
      insertBoneKeyframe(clip, finRId, time, t, 'smooth');
    }
  }
}

/**
 * Procedural Combat Strike / Attack Animation Generator
 */
export function bakeCombatAttack(
  clip: AnimationClip,
  armature: Armature,
  options: { duration?: number; fps?: number } = {},
): void {
  const duration = options.duration ?? 0.8;
  const fps = options.fps ?? 24;
  clip.duration = duration;
  clip.fps = fps;
  clip.tracks = [];

  const rootId = findBoneId(armature, 'root');
  const chestId = findBoneId(armature, 'chest') ?? findBoneId(armature, 'spine');
  const armR = findBoneId(armature, 'upper_arm.R');
  const foreR = findBoneId(armature, 'forearm.R');
  const handR = findBoneId(armature, 'hand.R');
  const armL = findBoneId(armature, 'upper_arm.L');

  // Keyframe points:
  // 0.0: Ready stance
  // 0.25: Windup / pull arm back & twist chest
  // 0.40: Fast snap / strike forward
  // 0.55: Impact hold & follow-through
  // 0.80: Settle back to stance
  const keyframes = [
    { t: 0.0, rootY: 0, chestRotY: 0, armPitch: 0, armRoll: 0, forePitch: 0 },
    { t: 0.25 * duration, rootY: -0.04, chestRotY: -0.4, armPitch: -0.6, armRoll: 0.5, forePitch: 1.2 },
    { t: 0.40 * duration, rootY: 0.02, chestRotY: 0.5, armPitch: 0.9, armRoll: -0.2, forePitch: 0.1 },
    { t: 0.55 * duration, rootY: 0.0, chestRotY: 0.4, armPitch: 0.8, armRoll: -0.1, forePitch: 0.2 },
    { t: duration, rootY: 0, chestRotY: 0, armPitch: 0, armRoll: 0, forePitch: 0 },
  ];

  for (const kf of keyframes) {
    if (rootId) {
      const t = defaultTransform();
      t.position.y = kf.rootY;
      insertBoneKeyframe(clip, rootId, kf.t, t, 'smooth');
    }
    if (chestId) {
      const t = defaultTransform();
      t.rotation.y = kf.chestRotY;
      insertBoneKeyframe(clip, chestId, kf.t, t, 'smooth');
    }
    if (armR) {
      const t = defaultTransform();
      t.rotation.x = kf.armPitch;
      t.rotation.z = kf.armRoll;
      insertBoneKeyframe(clip, armR, kf.t, t, 'smooth');
    }
    if (foreR) {
      const t = defaultTransform();
      t.rotation.x = kf.forePitch;
      insertBoneKeyframe(clip, foreR, kf.t, t, 'smooth');
    }
    if (handR) {
      const t = defaultTransform();
      t.rotation.x = kf.armPitch * 0.5;
      insertBoneKeyframe(clip, handR, kf.t, t, 'smooth');
    }
    if (armL) {
      const t = defaultTransform();
      t.rotation.x = -kf.armPitch * 0.4;
      t.rotation.z = -0.3;
      insertBoneKeyframe(clip, armL, kf.t, t, 'smooth');
    }
  }
}

/**
 * Procedural Squash & Stretch Dynamics Baker
 * Modifies an existing clip or bakes a bounce deformation onto root/spine bones.
 */
export function bakeSquashAndStretch(
  clip: AnimationClip,
  armature: Armature,
  options: { intensity?: number; bounceRate?: number } = {},
): void {
  const intensity = options.intensity ?? 0.25;
  const bounceRate = options.bounceRate ?? 2.0;
  const fps = clip.fps || 24;
  const totalFrames = Math.round(clip.duration * fps);

  const rootId = findBoneId(armature, 'root') ?? armature.rootBoneIds[0];
  if (!rootId) return;

  for (let frame = 0; frame <= totalFrames; frame++) {
    const time = (frame / totalFrames) * clip.duration;
    const phase = time * bounceRate * Math.PI * 2;
    const squash = Math.sin(phase) * intensity;

    // Volume-preserving scale: Y stretches, X and Z compress inversely
    const scaleY = 1.0 + squash;
    const scaleXZ = 1.0 / Math.sqrt(Math.max(0.2, scaleY));

    const t = defaultTransform();
    t.scale = v3(scaleXZ, scaleY, scaleXZ);
    t.position.y = Math.max(0, -squash * 0.1);
    insertBoneKeyframe(clip, rootId, time, t, 'smooth');
  }
}

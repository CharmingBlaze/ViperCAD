import { createId } from '@/core/ids/IdService';
import { cloneTransform, defaultTransform, type Transform } from '@/core/math/Transform';
import { v3 } from '@/core/math/Vec3';
import type { ClipSequenceItem } from '@/core/rig/clipSequencer';
import type { AnimationClip, Armature, Bone, BoneId } from '@/core/rig/types';

export type GlbaSceneExport = {
  format: 'GLBA_SCENE';
  version: '1.0';
  timestamp: string;
  sourceModelName?: string;
  armature?: {
    id: string;
    name: string;
    rootBoneIds: string[];
    bones: Array<{
      id: string;
      name: string;
      parentId: string | null;
      tailLocal: { x: number; y: number; z: number };
      roll: number;
      localTransform: Transform;
    }>;
  };
  clips: AnimationClip[];
  clipSequence?: ClipSequenceItem[];
};

export type GlbkfKeyframeExport = {
  format: 'GLBKF_KEYFRAMES';
  version: '1.0';
  clipName: string;
  duration: number;
  fps: number;
  tracks: AnimationClip['tracks'];
};

export type GlbcaSequenceExport = {
  format: 'GLBCA_CLIP_SEQUENCE';
  version: '1.0';
  totalDuration: number;
  items: ClipSequenceItem[];
};

/**
 * Export full scene state as .glba JSON string
 */
export function exportGlbaSceneJson(
  armature: Armature | null,
  clips: AnimationClip[],
  clipSequence: ClipSequenceItem[] = [],
  sourceModelName?: string,
): string {
  const payload: GlbaSceneExport = {
    format: 'GLBA_SCENE',
    version: '1.0',
    timestamp: new Date().toISOString(),
    sourceModelName,
    clips,
    clipSequence,
  };

  if (armature) {
    payload.armature = {
      id: armature.id,
      name: armature.name,
      rootBoneIds: [...armature.rootBoneIds],
      bones: Array.from(armature.bones.values()).map((b) => ({
        id: b.id,
        name: b.name,
        parentId: b.parentId,
        tailLocal: { ...b.tailLocal },
        roll: b.roll,
        localTransform: cloneTransform(b.localTransform),
      })),
    };
  }

  return JSON.stringify(payload, null, 2);
}

/**
 * Parse and restore .glba scene data
 */
export function parseGlbaSceneJson(jsonString: string): {
  armature: Armature | null;
  clips: AnimationClip[];
  clipSequence: ClipSequenceItem[];
  sourceModelName?: string;
} {
  const data = JSON.parse(jsonString) as Partial<GlbaSceneExport>;
  if (data.format !== 'GLBA_SCENE' && !data.clips) {
    throw new Error('Invalid .glba file: missing GLBA_SCENE header');
  }

  let armature: Armature | null = null;
  if (data.armature) {
    const bones = new Map<BoneId, Bone>();
    for (const b of data.armature.bones) {
      bones.set(b.id, {
        id: b.id,
        name: b.name,
        parentId: b.parentId,
        tailLocal: v3(b.tailLocal.x, b.tailLocal.y, b.tailLocal.z),
        roll: b.roll ?? 0,
        localTransform: b.localTransform ?? defaultTransform(),
      });
    }
    armature = {
      id: data.armature.id ?? createId('arm'),
      name: data.armature.name ?? 'Imported_Armature',
      rootBoneIds: data.armature.rootBoneIds ?? [],
      bones,
      restTransform: defaultTransform(),
    };
  }

  const clips: AnimationClip[] = (data.clips ?? []).map((c) => ({
    id: c.id ?? createId('clip'),
    name: c.name ?? 'Clip',
    duration: c.duration ?? 1.0,
    fps: c.fps ?? 24,
    tracks: c.tracks ?? [],
    events: c.events ?? [],
    rootMotion: c.rootMotion,
  }));

  const clipSequence: ClipSequenceItem[] = data.clipSequence ?? [];

  return {
    armature,
    clips,
    clipSequence,
    sourceModelName: data.sourceModelName,
  };
}

/**
 * Export active clip keyframes as .glbkf JSON string
 */
export function exportGlbkfKeyframesJson(clip: AnimationClip): string {
  const payload: GlbkfKeyframeExport = {
    format: 'GLBKF_KEYFRAMES',
    version: '1.0',
    clipName: clip.name,
    duration: clip.duration,
    fps: clip.fps,
    tracks: clip.tracks,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Parse .glbkf keyframes JSON string
 */
export function parseGlbkfKeyframesJson(jsonString: string): GlbkfKeyframeExport {
  const data = JSON.parse(jsonString) as Partial<GlbkfKeyframeExport>;
  if (data.format !== 'GLBKF_KEYFRAMES' && !data.tracks) {
    throw new Error('Invalid .glbkf file: missing keyframe track data');
  }
  return {
    format: 'GLBKF_KEYFRAMES',
    version: '1.0',
    clipName: data.clipName ?? 'Imported_Keyframes',
    duration: data.duration ?? 1.0,
    fps: data.fps ?? 24,
    tracks: data.tracks ?? [],
  };
}

/**
 * Export clip sequence track as .glbca JSON string
 */
export function exportGlbcaSequenceJson(items: ClipSequenceItem[], totalDuration: number): string {
  const payload: GlbcaSequenceExport = {
    format: 'GLBCA_CLIP_SEQUENCE',
    version: '1.0',
    totalDuration,
    items,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Parse .glbca sequence track JSON string
 */
export function parseGlbcaSequenceJson(jsonString: string): GlbcaSequenceExport {
  const data = JSON.parse(jsonString) as Partial<GlbcaSequenceExport>;
  return {
    format: 'GLBCA_CLIP_SEQUENCE',
    version: '1.0',
    totalDuration: data.totalDuration ?? 0,
    items: data.items ?? [],
  };
}

import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  SphereGeometry,
} from 'three';
import { getActiveClip, readRigDocumentSettings } from '@/core/rig/RigDocument';
import { boneHeadTailWorld, boneWorldMatrix, orderedBoneIds } from '@/core/rig/boneMatrices';
import { sampledLocalTransforms } from '@/core/rig/keyframes';
import type { BoneId } from '@/core/rig/types';
import type { AnimationSession } from './AnimationSession';

export type BoneHandleKind = 'head' | 'tail' | 'shaft';

export function boneOctahedronPositions(
  head: { x: number; y: number; z: number },
  tail: { x: number; y: number; z: number },
): number[] {
  const vx = tail.x - head.x;
  const vy = tail.y - head.y;
  const vz = tail.z - head.z;
  const len = Math.hypot(vx, vy, vz) || 0.001;
  let px: number;
  let py: number;
  let pz: number;
  if (Math.abs(vy) < 0.9) {
    px = vz;
    py = 0;
    pz = -vx;
  } else {
    px = 0;
    py = vz;
    pz = -vy;
  }
  const pl = Math.hypot(px, py, pz) || 1;
  const scale = Math.max(0.035, len * 0.16);
  px = (px / pl) * scale;
  py = (py / pl) * scale;
  pz = (pz / pl) * scale;
  let qx = vy * pz - vz * py;
  let qy = vz * px - vx * pz;
  let qz = vx * py - vy * px;
  const ql = Math.hypot(qx, qy, qz) || 1;
  qx = (qx / ql) * scale;
  qy = (qy / ql) * scale;
  qz = (qz / ql) * scale;
  const mx = (head.x + tail.x) * 0.5;
  const my = (head.y + tail.y) * 0.5;
  const mz = (head.z + tail.z) * 0.5;
  const a = { x: mx + px, y: my + py, z: mz + pz };
  const b = { x: mx + qx, y: my + qy, z: mz + qz };
  const c = { x: mx - px, y: my - py, z: mz - pz };
  const d = { x: mx - qx, y: my - qy, z: mz - qz };
  const push = (from: typeof head, to: typeof tail, out: number[]) => {
    out.push(from.x, from.y, from.z, to.x, to.y, to.z);
  };
  const out: number[] = [];
  push(head, tail, out);
  push(head, a, out);
  push(head, b, out);
  push(head, c, out);
  push(head, d, out);
  push(a, tail, out);
  push(b, tail, out);
  push(c, tail, out);
  push(d, tail, out);
  return out;
}

export function classifyBoneHandle(
  hit: { x: number; y: number; z: number },
  head: { x: number; y: number; z: number },
  tail: { x: number; y: number; z: number },
  radius: number,
): BoneHandleKind {
  const dh = Math.hypot(hit.x - head.x, hit.y - head.y, hit.z - head.z);
  const dt = Math.hypot(hit.x - tail.x, hit.y - tail.y, hit.z - tail.z);
  if (dh <= radius && dh <= dt) return 'head';
  if (dt <= radius) return 'tail';
  return 'shaft';
}

const HANDLE_RADIUS = 0.045;
const OCTA_FLOATS = 54;
const handleGeometry = new SphereGeometry(HANDLE_RADIUS, 10, 8);

/** Viewport overlay of armature bones (and onion-skin ghosts) for Animate/Rig mode. */
export class AnimationBonesOverlay {
  readonly group = new Group();
  private lines: LineSegments[] = [];
  private handles: Mesh[] = [];
  private ghostGroup = new Group();
  private handleGroup = new Group();

  constructor() {
    this.group.name = 'animation-bones';
    this.group.renderOrder = 20;
    this.group.frustumCulled = false;
    this.group.add(this.ghostGroup);
    this.group.add(this.handleGroup);
  }

  reset(): void {
    this.rebuild([]);
    this.ghostGroup.clear();
  }

  clear(): void {
    this.group.visible = false;
    this.ghostGroup.clear();
  }

  sync(animation: AnimationSession): void {
    this.group.visible = true;
    animation.ensureSetup();
    const settings = readRigDocumentSettings(animation.rigDocument);
    const armature = settings.armatureId ? animation.project.armatures.get(settings.armatureId) : null;
    if (!armature) {
      this.rebuild([]);
      this.ghostGroup.clear();
      return;
    }

    const ids = orderedBoneIds(armature);
    if (
      this.lines.length !== ids.length ||
      this.lines.some((line, index) => line.userData.boneId !== ids[index])
    ) {
      this.rebuild(ids);
    }

    const clip = getActiveClip(animation.project, animation.rigDocument);
    const locals = sampledLocalTransforms(armature, clip, animation.playbackTime);
    for (const [id, transform] of animation.poseScratch) locals.set(id, transform);
    const cache = new Map();
    const showHandles = animation.editMode === 'edit';
    this.handleGroup.visible = showHandles;

    for (let index = 0; index < this.lines.length; index += 1) {
      const line = this.lines[index]!;
      const boneId = line.userData.boneId as BoneId;
      const bone = armature.bones.get(boneId);
      if (!bone) continue;
      const world = boneWorldMatrix(armature, boneId, locals, cache);
      const { head, tail } = boneHeadTailWorld(bone, world);
      const positions = line.geometry.getAttribute('position') as BufferAttribute;
      (positions.array as Float32Array).set(boneOctahedronPositions(head, tail));
      positions.needsUpdate = true;
      line.geometry.computeBoundingSphere();
      const selected = animation.selectedBoneId === boneId;
      (line.material as LineBasicMaterial).color.set(selected ? 0x1473e6 : 0x9c9c9c);

      const headMesh = this.handles[index * 2];
      const tailMesh = this.handles[index * 2 + 1];
      if (headMesh && tailMesh) {
        headMesh.position.set(head.x, head.y, head.z);
        tailMesh.position.set(tail.x, tail.y, tail.z);
        const color = selected ? 0x1473e6 : 0xc8c8c8;
        (headMesh.material as MeshBasicMaterial).color.set(color);
        (tailMesh.material as MeshBasicMaterial).color.set(color);
      }
    }

    this.ghostGroup.clear();
    if (!animation.onionSkinning.enabled || !clip) return;

    const fps = clip.fps || 24;
    const dt = 1 / fps;
    const steps: { time: number; color: number; alpha: number }[] = [];
    for (let i = 1; i <= animation.onionSkinning.framesBefore; i += 1) {
      const t = animation.playbackTime - i * dt * animation.onionSkinning.step;
      if (t >= 0) {
        steps.push({
          time: t,
          color: 0x3399ff,
          alpha: animation.onionSkinning.opacity * (1 - (i - 1) / animation.onionSkinning.framesBefore),
        });
      }
    }
    for (let i = 1; i <= animation.onionSkinning.framesAfter; i += 1) {
      const t = animation.playbackTime + i * dt * animation.onionSkinning.step;
      if (t <= clip.duration) {
        steps.push({
          time: t,
          color: 0xff3399,
          alpha: animation.onionSkinning.opacity * (1 - (i - 1) / animation.onionSkinning.framesAfter),
        });
      }
    }

    for (const step of steps) {
      const ghostLocals = sampledLocalTransforms(armature, clip, step.time);
      const ghostCache = new Map();
      const positions: number[] = [];
      for (const boneId of ids) {
        const bone = armature.bones.get(boneId);
        if (!bone) continue;
        const world = boneWorldMatrix(armature, boneId, ghostLocals, ghostCache);
        const { head, tail } = boneHeadTailWorld(bone, world);
        positions.push(head.x, head.y, head.z, tail.x, tail.y, tail.z);
      }
      if (positions.length === 0) continue;
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
      const mat = new LineBasicMaterial({
        color: step.color,
        transparent: true,
        opacity: step.alpha,
        depthTest: false,
      });
      const ghost = new LineSegments(geo, mat);
      ghost.renderOrder = 9;
      this.ghostGroup.add(ghost);
    }
  }

  pick(raycaster: Raycaster): BoneId | null {
    return this.pickEdit(raycaster)?.boneId ?? null;
  }

  pickEdit(raycaster: Raycaster): { boneId: BoneId; handle: BoneHandleKind } | null {
    if (this.handleGroup.visible) {
      const handleHits = raycaster.intersectObjects(this.handles, false);
      const handle = handleHits[0]?.object;
      if (handle && typeof handle.userData.boneId === 'string') {
        return {
          boneId: handle.userData.boneId as BoneId,
          handle: handle.userData.handle === 'tail' ? 'tail' : 'head',
        };
      }
    }

    raycaster.params.Line ??= { threshold: 0.14 };
    raycaster.params.Line.threshold = 0.14;
    const hits = raycaster.intersectObjects(this.lines, false);
    const hit = hits[0];
    const boneId = hit?.object.userData.boneId;
    if (typeof boneId !== 'string' || !hit) return null;
    const positions = (hit.object as LineSegments).geometry.getAttribute('position') as BufferAttribute;
    const head = { x: positions.getX(0), y: positions.getY(0), z: positions.getZ(0) };
    const tail = { x: positions.getX(1), y: positions.getY(1), z: positions.getZ(1) };
    return {
      boneId: boneId as BoneId,
      handle: classifyBoneHandle(hit.point, head, tail, 0.08),
    };
  }

  getHandleWorld(boneId: BoneId, handle: 'head' | 'tail'): { x: number; y: number; z: number } | null {
    const mesh = this.handles.find(
      (item) => item.userData.boneId === boneId && item.userData.handle === handle,
    );
    if (!mesh) return null;
    return { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z };
  }

  private rebuild(ids: BoneId[]): void {
    for (const line of this.lines) {
      this.group.remove(line);
      line.geometry.dispose();
      (line.material as LineBasicMaterial).dispose();
    }
    for (const handle of this.handles) {
      this.handleGroup.remove(handle);
      (handle.material as MeshBasicMaterial).dispose();
    }
    this.lines = [];
    this.handles = [];
    for (const boneId of ids) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(OCTA_FLOATS), 3));
      const line = new LineSegments(
        geometry,
        new LineBasicMaterial({
          color: 0xd0d0d0,
          transparent: true,
          opacity: 1,
          depthTest: false,
          fog: false,
        }),
      );
      line.userData.boneId = boneId;
      line.renderOrder = 10;
      line.frustumCulled = false;
      this.lines.push(line);
      this.group.add(line);

      for (const kind of ['head', 'tail'] as const) {
        const mesh = new Mesh(
          handleGeometry,
          new MeshBasicMaterial({
            color: 0xc8c8c8,
            depthTest: false,
            transparent: true,
            opacity: 0.95,
            fog: false,
          }),
        );
        mesh.userData.boneId = boneId;
        mesh.userData.handle = kind;
        mesh.renderOrder = 12;
        mesh.frustumCulled = false;
        this.handles.push(mesh);
        this.handleGroup.add(mesh);
      }
    }
  }
}

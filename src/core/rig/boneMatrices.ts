import { transformPoint } from '@/core/math/Transform';
import type { Transform } from '@/core/math/Transform';
import type { Vec3 } from '@/core/math/Vec3';
import type { Armature, Bone, BoneId } from '@/core/rig/types';

/** Column-major 4×4 matrix (Three.js compatible). */
export type Mat4 = Float32Array;

export function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function transformToMat4(transform: Transform): Mat4 {
  const m = mat4Identity();
  const { x: rx, y: ry, z: rz } = transform.rotation;
  const cx = Math.cos(rx); const sx = Math.sin(rx);
  const cy = Math.cos(ry); const sy = Math.sin(ry);
  const cz = Math.cos(rz); const sz = Math.sin(rz);
  const r00 = cy * cz;
  const r01 = sx * sy * cz - cx * sz;
  const r02 = cx * sy * cz + sx * sz;
  const r10 = cy * sz;
  const r11 = sx * sy * sz + cx * cz;
  const r12 = cx * sy * sz - sx * cz;
  const r20 = -sy;
  const r21 = sx * cy;
  const r22 = cx * cy;
  const sx_ = transform.scale.x;
  const sy_ = transform.scale.y;
  const sz_ = transform.scale.z;
  m[0] = r00 * sx_; m[1] = r10 * sx_; m[2] = r20 * sx_;
  m[4] = r01 * sy_; m[5] = r11 * sy_; m[6] = r21 * sy_;
  m[8] = r02 * sz_; m[9] = r12 * sz_; m[10] = r22 * sz_;
  m[12] = transform.position.x;
  m[13] = transform.position.y;
  m[14] = transform.position.z;
  return m;
}

export function multiplyMat4(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

export function invertMat4Affine(m: Mat4): Mat4 {
  const out = mat4Identity();
  const r00 = m[0]; const r01 = m[4]; const r02 = m[8];
  const r10 = m[1]; const r11 = m[5]; const r12 = m[9];
  const r20 = m[2]; const r21 = m[6]; const r22 = m[10];
  const tx = m[12]; const ty = m[13]; const tz = m[14];
  out[0] = r00; out[1] = r10; out[2] = r20;
  out[4] = r01; out[5] = r11; out[6] = r21;
  out[8] = r02; out[9] = r12; out[10] = r22;
  out[12] = -(r00 * tx + r01 * ty + r02 * tz);
  out[13] = -(r10 * tx + r11 * ty + r12 * tz);
  out[14] = -(r20 * tx + r21 * ty + r22 * tz);
  return out;
}

export function transformVec3ByMat4(m: Mat4, point: Vec3): Vec3 {
  const x = point.x; const y = point.y; const z = point.z;
  return {
    x: m[0] * x + m[4] * y + m[8] * z + m[12],
    y: m[1] * x + m[5] * y + m[9] * z + m[13],
    z: m[2] * x + m[6] * y + m[10] * z + m[14],
  };
}

export function translationMat4(offset: Vec3): Mat4 {
  const m = mat4Identity();
  m[12] = offset.x;
  m[13] = offset.y;
  m[14] = offset.z;
  return m;
}

/** Roll twist around the bone's tail direction (edit-bone roll). */
export function boneRollMat4(tailLocal: Vec3, roll: number): Mat4 {
  if (Math.abs(roll) < 1e-8) return mat4Identity();
  const len = Math.hypot(tailLocal.x, tailLocal.y, tailLocal.z);
  const ax = len > 1e-6 ? tailLocal.x / len : 0;
  const ay = len > 1e-6 ? tailLocal.y / len : 1;
  const az = len > 1e-6 ? tailLocal.z / len : 0;
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  const t = 1 - c;
  const m = mat4Identity();
  m[0] = t * ax * ax + c;
  m[1] = t * ax * ay + s * az;
  m[2] = t * ax * az - s * ay;
  m[4] = t * ax * ay - s * az;
  m[5] = t * ay * ay + c;
  m[6] = t * ay * az + s * ax;
  m[8] = t * ax * az + s * ay;
  m[9] = t * ay * az - s * ax;
  m[10] = t * az * az + c;
  return m;
}

export function boneLocalMatrix(bone: Bone, local: Transform): Mat4 {
  return multiplyMat4(transformToMat4(local), boneRollMat4(bone.tailLocal, bone.roll));
}

export function boneWorldMatrix(
  armature: Armature,
  boneId: BoneId,
  localOverrides: Map<BoneId, Transform>,
  cache: Map<BoneId, Mat4>,
): Mat4 {
  const cached = cache.get(boneId);
  if (cached) return cached;

  const bone = armature.bones.get(boneId);
  if (!bone) return mat4Identity();
  const local = localOverrides.get(boneId) ?? bone.localTransform;
  const localMat = boneLocalMatrix(bone, local);
  if (!bone.parentId) {
    const root = multiplyMat4(transformToMat4(armature.restTransform), localMat);
    cache.set(boneId, root);
    return root;
  }
  const parentBone = armature.bones.get(bone.parentId)!;
  const parentWorld = boneWorldMatrix(armature, bone.parentId, localOverrides, cache);
  const link = translationMat4(parentBone.tailLocal);
  const world = multiplyMat4(parentWorld, multiplyMat4(link, localMat));
  cache.set(boneId, world);
  return world;
}

export function boneHeadTailWorld(bone: Bone, worldMat: Mat4): { head: Vec3; tail: Vec3 } {
  const head = transformVec3ByMat4(worldMat, { x: 0, y: 0, z: 0 });
  const tail = transformVec3ByMat4(worldMat, bone.tailLocal);
  return { head, tail };
}

export function orderedBoneIds(armature: Armature): BoneId[] {
  const ordered: BoneId[] = [];
  const visit = (boneId: BoneId) => {
    ordered.push(boneId);
    for (const bone of armature.bones.values()) {
      if (bone.parentId === boneId) visit(bone.id);
    }
  };
  for (const rootId of armature.rootBoneIds) visit(rootId);
  for (const bone of armature.bones.values()) {
    if (!ordered.includes(bone.id)) ordered.push(bone.id);
  }
  return ordered;
}

export function restBoneLocalTransforms(armature: Armature): Map<BoneId, Transform> {
  const map = new Map<BoneId, Transform>();
  for (const bone of armature.bones.values()) {
    map.set(bone.id, bone.localTransform);
  }
  return map;
}

/** Decompose world matrix into local transform relative to parent world matrix. */
export function worldToLocalMat4(world: Mat4, parentWorld: Mat4 | null): Mat4 {
  if (!parentWorld) return world;
  return multiplyMat4(invertMat4Affine(parentWorld), world);
}

export function mat4ToTransform(m: Mat4): Transform {
  return {
    position: { x: m[12], y: m[13], z: m[14] },
    rotation: { x: 0, y: 0, z: 0 },
    scale: {
      x: Math.hypot(m[0], m[1], m[2]) || 1,
      y: Math.hypot(m[4], m[5], m[6]) || 1,
      z: Math.hypot(m[8], m[9], m[10]) || 1,
    },
  };
}

export function boneTailFromTransform(bone: Bone, transform: Transform): Vec3 {
  return transformPoint(bone.tailLocal, transform);
}

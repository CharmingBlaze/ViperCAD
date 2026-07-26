import type { ModelDocument } from '@/core/document/types';
import { cloneTransform, type Transform } from '@/core/math/Transform';
import {
  addVec3,
  crossVec3,
  dotVec3,
  normalizeVec3,
  scaleVec3,
  subVec3,
  v3,
  type Vec3,
} from '@/core/math/Vec3';
import { bumpPositions } from '@/core/mesh/EditableMesh';
import type { VertexId } from '@/core/mesh/types';
import type { TransformDelta, TransformSnapshot } from './types';
import { applyLiveSymmetricVertexEdit } from '@/core/symmetry/Symmetry';

/** Restore initial snapshot then apply current delta (idempotent live preview). */
export function applyDeltaFromSnapshot(
  doc: ModelDocument,
  snapshot: TransformSnapshot,
  delta: TransformDelta,
  pivot: Vec3,
): void {
  restoreObjectsAndVerts(doc, snapshot);

  if (snapshot.mode === 'object') {
    for (const entry of snapshot.objects) {
      const object = doc.objects.get(entry.objectId);
      if (!object) continue;
      object.transform = transformObject(entry.transform, delta, pivot);
    }
  } else if (snapshot.vertices) {
    const mesh = doc.meshes.get(snapshot.vertices.meshId);
    const object = doc.objects.get(snapshot.vertices.objectId);
    if (!mesh || !object) return;
    const inv = inverseObjectTransform(object.transform);
    const before = new Map<VertexId, Vec3>();
    const after = new Map<VertexId, Vec3>();
    for (const id of snapshot.vertices.primaryVertexIds) {
      const local0 = snapshot.vertices.positions.get(id);
      if (!local0) continue;
      const world0 = objectPointToWorld(local0, object.transform);
      const world1 = transformWorldPoint(world0, delta, pivot);
      const local1 = worldPointToObject(world1, inv);
      before.set(id, local0);
      after.set(id, local1);
    }
    applyLiveSymmetricVertexEdit(
      mesh,
      before,
      after,
      doc.settings.symmetry,
    );
    bumpPositions(mesh);
  }
  doc.dirty = true;
}

function restoreObjectsAndVerts(doc: ModelDocument, snapshot: TransformSnapshot): void {
  for (const entry of snapshot.objects) {
    const object = doc.objects.get(entry.objectId);
    if (object) object.transform = cloneTransform(entry.transform);
  }
  if (snapshot.vertices) {
    const mesh = doc.meshes.get(snapshot.vertices.meshId);
    if (mesh) {
      for (const [id, pos] of snapshot.vertices.positions) {
        const v = mesh.vertices.get(id);
        if (v) v.position = { ...pos };
      }
    }
  }
}

function transformObject(initial: Transform, delta: TransformDelta, pivot: Vec3): Transform {
  const next = cloneTransform(initial);
  // Translate
  next.position = addVec3(initial.position, delta.translation);

  // Rotate around pivot (object origin relative to pivot)
  if (Math.abs(delta.rotationAngle) > 1e-12) {
    const offset = subVec3(initial.position, pivot);
    const rotated = rotateAroundAxis(offset, delta.rotationAxis, delta.rotationAngle);
    next.position = addVec3(pivot, rotated);
    next.rotation = {
      x: initial.rotation.x + delta.rotationAxis.x * delta.rotationAngle,
      y: initial.rotation.y + delta.rotationAxis.y * delta.rotationAngle,
      z: initial.rotation.z + delta.rotationAxis.z * delta.rotationAngle,
    };
    // For axis-aligned rotations, apply euler on matching axis more cleanly
    const ax = Math.abs(delta.rotationAxis.x);
    const ay = Math.abs(delta.rotationAxis.y);
    const az = Math.abs(delta.rotationAxis.z);
    if (ax > 0.99 && ay < 0.1 && az < 0.1) {
      next.rotation = {
        x: initial.rotation.x + delta.rotationAngle * Math.sign(delta.rotationAxis.x || 1),
        y: initial.rotation.y,
        z: initial.rotation.z,
      };
    } else if (ay > 0.99 && ax < 0.1 && az < 0.1) {
      next.rotation = {
        x: initial.rotation.x,
        y: initial.rotation.y + delta.rotationAngle * Math.sign(delta.rotationAxis.y || 1),
        z: initial.rotation.z,
      };
    } else if (az > 0.99 && ax < 0.1 && ay < 0.1) {
      next.rotation = {
        x: initial.rotation.x,
        y: initial.rotation.y,
        z: initial.rotation.z + delta.rotationAngle * Math.sign(delta.rotationAxis.z || 1),
      };
    }
  }

  next.scale = {
    x: initial.scale.x * delta.scale.x,
    y: initial.scale.y * delta.scale.y,
    z: initial.scale.z * delta.scale.z,
  };

  // Scale position relative to pivot for non-uniform / uniform scale
  if (
    Math.abs(delta.scale.x - 1) > 1e-12 ||
    Math.abs(delta.scale.y - 1) > 1e-12 ||
    Math.abs(delta.scale.z - 1) > 1e-12
  ) {
    const offset = subVec3(next.position, pivot);
    next.position = addVec3(pivot, {
      x: offset.x * delta.scale.x,
      y: offset.y * delta.scale.y,
      z: offset.z * delta.scale.z,
    });
  }

  return next;
}

function transformWorldPoint(point: Vec3, delta: TransformDelta, pivot: Vec3): Vec3 {
  let p = addVec3(point, delta.translation);
  if (Math.abs(delta.rotationAngle) > 1e-12) {
    const offset = subVec3(p, pivot);
    p = addVec3(pivot, rotateAroundAxis(offset, delta.rotationAxis, delta.rotationAngle));
  }
  if (
    Math.abs(delta.scale.x - 1) > 1e-12 ||
    Math.abs(delta.scale.y - 1) > 1e-12 ||
    Math.abs(delta.scale.z - 1) > 1e-12
  ) {
    const offset = subVec3(p, pivot);
    p = addVec3(pivot, {
      x: offset.x * delta.scale.x,
      y: offset.y * delta.scale.y,
      z: offset.z * delta.scale.z,
    });
  }
  return p;
}

export function rotateAroundAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const a = normalizeVec3(axis);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = dotVec3(a, v);
  const cross = crossVec3(a, v);
  return addVec3(
    addVec3(scaleVec3(v, cos), scaleVec3(cross, sin)),
    scaleVec3(a, dot * (1 - cos)),
  );
}

function objectPointToWorld(local: Vec3, transform: Transform): Vec3 {
  let x = local.x * transform.scale.x;
  let y = local.y * transform.scale.y;
  let z = local.z * transform.scale.z;
  const cx = Math.cos(transform.rotation.x), sx = Math.sin(transform.rotation.x);
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  const cy = Math.cos(transform.rotation.y), sy = Math.sin(transform.rotation.y);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  const cz = Math.cos(transform.rotation.z), sz = Math.sin(transform.rotation.z);
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  return v3(x + transform.position.x, y + transform.position.y, z + transform.position.z);
}

type InvTransform = {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
};

function inverseObjectTransform(t: Transform): InvTransform {
  return {
    position: t.position,
    rotation: t.rotation,
    scale: {
      x: t.scale.x === 0 ? 0 : 1 / t.scale.x,
      y: t.scale.y === 0 ? 0 : 1 / t.scale.y,
      z: t.scale.z === 0 ? 0 : 1 / t.scale.z,
    },
  };
}

function worldPointToObject(world: Vec3, inv: InvTransform): Vec3 {
  let x = world.x - inv.position.x;
  let y = world.y - inv.position.y;
  let z = world.z - inv.position.z;
  // Inverse Euler XYZ = Z^-1 Y^-1 X^-1
  const cz = Math.cos(-inv.rotation.z), sz = Math.sin(-inv.rotation.z);
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  const cy = Math.cos(-inv.rotation.y), sy = Math.sin(-inv.rotation.y);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  const cx = Math.cos(-inv.rotation.x), sx = Math.sin(-inv.rotation.x);
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  return v3(x * inv.scale.x, y * inv.scale.y, z * inv.scale.z);
}

/** Constrain a free translation vector to axis / plane in orientation space. */
export function constrainTranslation(
  delta: Vec3,
  constraint: 'none' | 'x' | 'y' | 'z' | 'xy' | 'xz' | 'yz',
  basisX: Vec3,
  basisY: Vec3,
  basisZ: Vec3,
): Vec3 {
  if (constraint === 'none') return delta;
  const lx = dotVec3(delta, basisX);
  const ly = dotVec3(delta, basisY);
  const lz = dotVec3(delta, basisZ);
  const out = v3();
  const add = (axis: Vec3, s: number) => {
    out.x += axis.x * s;
    out.y += axis.y * s;
    out.z += axis.z * s;
  };
  if (constraint === 'x') add(basisX, lx);
  else if (constraint === 'y') add(basisY, ly);
  else if (constraint === 'z') add(basisZ, lz);
  else if (constraint === 'xy') {
    add(basisX, lx);
    add(basisY, ly);
  } else if (constraint === 'xz') {
    add(basisX, lx);
    add(basisZ, lz);
  } else if (constraint === 'yz') {
    add(basisY, ly);
    add(basisZ, lz);
  }
  return out;
}

export function constrainScale(
  factor: number,
  constraint: 'none' | 'x' | 'y' | 'z' | 'xy' | 'xz' | 'yz',
): Vec3 {
  if (constraint === 'none') return v3(factor, factor, factor);
  if (constraint === 'x') return v3(factor, 1, 1);
  if (constraint === 'y') return v3(1, factor, 1);
  if (constraint === 'z') return v3(1, 1, factor);
  if (constraint === 'xy') return v3(factor, factor, 1);
  if (constraint === 'xz') return v3(factor, 1, factor);
  return v3(1, factor, factor); // yz
}

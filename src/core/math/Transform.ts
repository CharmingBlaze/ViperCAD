import { cloneVec3, v3, type Vec3 } from './Vec3';

export type Transform = {
  position: Vec3;
  rotation: Vec3; // Euler XYZ radians
  scale: Vec3;
};

export function defaultTransform(): Transform {
  return {
    position: v3(0, 0, 0),
    rotation: v3(0, 0, 0),
    scale: v3(1, 1, 1),
  };
}

export function cloneTransform(t: Transform): Transform {
  return {
    position: cloneVec3(t.position),
    rotation: cloneVec3(t.rotation),
    scale: cloneVec3(t.scale),
  };
}

export function transformPoint(point: Vec3, transform: Transform): Vec3 {
  let x = point.x * transform.scale.x; let y = point.y * transform.scale.y; let z = point.z * transform.scale.z;
  const cx = Math.cos(transform.rotation.x), sx = Math.sin(transform.rotation.x); [y, z] = [y * cx - z * sx, y * sx + z * cx];
  const cy = Math.cos(transform.rotation.y), sy = Math.sin(transform.rotation.y); [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  const cz = Math.cos(transform.rotation.z), sz = Math.sin(transform.rotation.z); [x, y] = [x * cz - y * sz, x * sz + y * cz];
  return v3(x + transform.position.x, y + transform.position.y, z + transform.position.z);
}

/** Inverse of {@link transformPoint} (Euler XYZ, non-uniform scale). */
export function inverseTransformPointApprox(point: Vec3, transform: Transform): Vec3 {
  let x = point.x - transform.position.x;
  let y = point.y - transform.position.y;
  let z = point.z - transform.position.z;
  const cz = Math.cos(-transform.rotation.z);
  const sz = Math.sin(-transform.rotation.z);
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  const cy = Math.cos(-transform.rotation.y);
  const sy = Math.sin(-transform.rotation.y);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  const cx = Math.cos(-transform.rotation.x);
  const sx = Math.sin(-transform.rotation.x);
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  const sxScale = transform.scale.x || 1;
  const syScale = transform.scale.y || 1;
  const szScale = transform.scale.z || 1;
  return v3(x / sxScale, y / syScale, z / szScale);
}

export function transformDeterminantSign(transform: Transform): number {
  return Math.sign(transform.scale.x * transform.scale.y * transform.scale.z) || 1;
}

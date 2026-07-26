import { v2 } from '@/core/math/Vec2';
import {
  addVec3,
  crossVec3,
  normalizeVec3,
  scaleVec3,
  subVec3,
  v3,
  type Vec3,
} from '@/core/math/Vec3';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import { validateMeshFull } from '@/core/mesh/Validation';
import { flipFaces } from '@/core/mesh/ops/basic';
import type { EditableMesh, VertexId } from '@/core/mesh/types';

export type LatheAxis = 'x' | 'y' | 'z';

export type LatheOptions = {
  points: Vec3[];
  axis: LatheAxis;
  radialSegments: number;
  profileRings: number;
  smoothing: number;
  angleDegrees: number;
  capStart: boolean;
  capEnd: boolean;
  name?: string;
};

type ProfilePoint = { height: number; radius: number };

/** Revolve a drawn world-space profile around its best-fit baseline. */
export function buildLathe(options: LatheOptions): EditableMesh {
  const segments = clampInt(options.radialSegments, 3, 96);
  const angle = Math.max(1, Math.min(360, options.angleDegrees)) * Math.PI / 180;
  const full = Math.abs(angle - Math.PI * 2) < 1e-5;
  const sideCount = full ? segments : segments + 1;
  const basis = profileBasis(options.points, options.axis);
  let profile = toProfile(options.points, basis);
  profile = reduceProfile(profile, clampInt(options.profileRings, 2, 128));
  profile = smoothProfile(profile, options.smoothing);
  if (profile.length < 2) profile.push({ height: profile[0]?.height ?? 0.1, radius: 0 });

  const builder = new MeshBuilder(options.name ?? 'Lathe', false);
  const rings: VertexId[][] = profile.map((point) => {
    if (point.radius < 1e-5) {
      return [builder.vertex(addVec3(basis.origin, scaleVec3(basis.axis, point.height)))];
    }
    return Array.from({ length: sideCount }, (_unused, side) => {
      const t = side / segments;
      const theta = angle * t;
      return builder.vertex(addVec3(
        addVec3(basis.origin, scaleVec3(basis.axis, point.height)),
        addVec3(
          scaleVec3(basis.radialU, Math.cos(theta) * point.radius),
          scaleVec3(basis.radialV, Math.sin(theta) * point.radius),
        ),
      ));
    });
  });

  for (let row = 0; row < rings.length - 1; row++) {
    const a = rings[row]!;
    const b = rings[row + 1]!;
    const sideFaces = full ? segments : segments;
    for (let side = 0; side < sideFaces; side++) {
      const next = full ? (side + 1) % segments : side + 1;
      const u0 = side / segments;
      const u1 = (side + 1) / segments;
      const v0 = row / Math.max(1, rings.length - 1);
      const v1 = (row + 1) / Math.max(1, rings.length - 1);
      if (a.length === 1 && b.length > 1) {
        builder.tri(a[0]!, b[next]!, b[side]!, [v2(0.5, v0), v2(u1, v1), v2(u0, v1)]);
      } else if (b.length === 1 && a.length > 1) {
        builder.tri(b[0]!, a[side]!, a[next]!, [v2(0.5, v1), v2(u0, v0), v2(u1, v0)]);
      } else if (a.length > 1 && b.length > 1) {
        builder.quad(a[side]!, a[next]!, b[next]!, b[side]!, [
          v2(u0, v0), v2(u1, v0), v2(u1, v1), v2(u0, v1),
        ]);
      }
    }
  }

  if (full && options.capStart && rings[0]!.length > 2) {
    builder.ngon([...rings[0]!].reverse(), discUvs(rings[0]!.length, true));
  }
  if (full && options.capEnd && rings[rings.length - 1]!.length > 2) {
    builder.ngon([...rings[rings.length - 1]!], discUvs(rings[rings.length - 1]!.length, false));
  }
  const mesh = builder.build();
  if (full && validateMeshFull(mesh).issues.some((issue) => issue.code === 'INWARD_WINDING')) {
    const flipped = flipFaces(mesh, [...mesh.faces.keys()]);
    if (!flipped.ok) throw new Error(flipped.error?.message ?? 'Could not finalize lathe winding');
  }
  return mesh;
}

function profileBasis(points: Vec3[], axisName: LatheAxis) {
  const axis = axisName === 'x' ? v3(1, 0, 0) : axisName === 'y' ? v3(0, 1, 0) : v3(0, 0, 1);
  const candidates =
    axisName === 'x' ? [v3(0, 1, 0), v3(0, 0, 1)] :
    axisName === 'y' ? [v3(1, 0, 0), v3(0, 0, 1)] :
    [v3(1, 0, 0), v3(0, 1, 0)];
  const span = (candidate: Vec3) => {
    const values = points.map((point) => dot(point, candidate));
    return Math.max(...values) - Math.min(...values);
  };
  const radialU = span(candidates[1]!) > span(candidates[0]!) ? candidates[1]! : candidates[0]!;
  const radialV = normalizeVec3(crossVec3(axis, radialU));
  const radialValues = points.map((point) => dot(point, radialU));
  const otherValues = points.map((point) => dot(point, radialV));
  const baseline = Math.min(...radialValues);
  const otherCentre = otherValues.reduce((sum, value) => sum + value, 0) / Math.max(1, otherValues.length);
  const origin = addVec3(scaleVec3(radialU, baseline), scaleVec3(radialV, otherCentre));
  return { axis, radialU, radialV, origin };
}

function toProfile(
  points: Vec3[],
  basis: ReturnType<typeof profileBasis>,
): ProfilePoint[] {
  const mapped = points.map((point) => ({
    height: dot(subVec3(point, basis.origin), basis.axis),
    radius: Math.max(0, dot(subVec3(point, basis.origin), basis.radialU)),
  }));
  return mapped.filter((point, index) => {
    const previous = mapped[index - 1];
    return !previous || Math.hypot(point.height - previous.height, point.radius - previous.radius) > 1e-6;
  });
}

function reduceProfile(profile: ProfilePoint[], maxRings: number): ProfilePoint[] {
  if (profile.length <= maxRings) return profile.map((point) => ({ ...point }));
  const distances = [0];
  for (let index = 1; index < profile.length; index++) {
    distances.push(distances[index - 1]! + Math.hypot(
      profile[index]!.height - profile[index - 1]!.height,
      profile[index]!.radius - profile[index - 1]!.radius,
    ));
  }
  const total = distances[distances.length - 1]!;
  return Array.from({ length: maxRings }, (_unused, index) => {
    const target = total * index / Math.max(1, maxRings - 1);
    let segment = 1;
    while (segment < distances.length - 1 && distances[segment]! < target) segment++;
    const before = distances[segment - 1]!;
    const after = distances[segment]!;
    const t = after > before ? (target - before) / (after - before) : 0;
    return {
      height: profile[segment - 1]!.height + (profile[segment]!.height - profile[segment - 1]!.height) * t,
      radius: profile[segment - 1]!.radius + (profile[segment]!.radius - profile[segment - 1]!.radius) * t,
    };
  });
}

function smoothProfile(profile: ProfilePoint[], amount: number): ProfilePoint[] {
  const blend = Math.max(0, Math.min(1, amount));
  if (blend <= 0 || profile.length < 3) return profile;
  let result = profile.map((point) => ({ ...point }));
  const passes = Math.max(1, Math.round(blend * 4));
  for (let pass = 0; pass < passes; pass++) {
    result = result.map((point, index) => {
      if (index === 0 || index === result.length - 1) return point;
      const previous = result[index - 1]!;
      const next = result[index + 1]!;
      const weight = blend * 0.5;
      return {
        height: point.height * (1 - weight) + (previous.height + next.height) * weight * 0.5,
        radius: point.radius * (1 - weight) + (previous.radius + next.radius) * weight * 0.5,
      };
    });
  }
  return result;
}

function discUvs(count: number, reverse: boolean) {
  const values = Array.from({ length: count }, (_unused, index) => {
    const angle = index / count * Math.PI * 2;
    return v2(0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5);
  });
  return reverse ? values.reverse() : values;
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(Number.isFinite(value) ? value : min)));
}

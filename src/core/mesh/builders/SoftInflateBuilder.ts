import { v2 } from '@/core/math/Vec2';
import {
  addVec3,
  scaleVec3,
  type Vec3,
} from '@/core/math/Vec3';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import { flipFaces } from '@/core/mesh/ops/basic';
import type { EditableMesh, VertexId } from '@/core/mesh/types';
import { validateMeshFull } from '@/core/mesh/Validation';
import { unwrapUvAuto } from '@/core/uv/UvOperations';

export type SoftInflateDomeOptions = {
  boundary: { u: number; v: number }[];
  plane: {
    origin: Vec3;
    normal: Vec3;
    axisU: Vec3;
    axisV: Vec3;
  };
  depth: number;
  rings?: number;
  /** 0 = flat-shoulder outline, 1 = full rounded blob. */
  inflation?: number;
  name?: string;
};

type PlaneBasis = SoftInflateDomeOptions['plane'];

/** Paint 3D outline/blob — matched quad rings with compact cap transitions. */
export function buildSoftInflateDome(options: SoftInflateDomeOptions): EditableMesh {
  const polygon = ensureCCW(options.boundary);
  const n = polygon.length;
  if (n < 3) return new MeshBuilder(options.name ?? 'Soft Inflate', false).build();

  const { u: cx, v: cy } = polygonCentroid(polygon);
  const depth = Math.max(4, options.depth);
  const sliceCount = Math.max(4, options.rings ?? 6);
  const inflation = Math.max(0, Math.min(1, options.inflation ?? 0.65));
  const capScale = 0.34 + (0.08 - 0.34) * inflation;
  const profilePower = 1.45 + (0.52 - 1.45) * inflation;
  const plane = options.plane;

  const builder = new MeshBuilder(options.name ?? 'Soft Inflate', false);
  const slices: { ring: VertexId[]; t: number }[] = [];

  for (let sliceIndex = 0; sliceIndex <= sliceCount; sliceIndex++) {
    const t = sliceIndex / sliceCount;
    const theta = Math.PI * (1 - t);
    const normalOffset = (depth / 2) * Math.cos(theta);
    const scale = capScale + (1 - capScale) * Math.pow(Math.sin(theta), profilePower);
    const ring: VertexId[] = [];
    for (let index = 0; index < n; index++) {
      const point = polygon[index]!;
      ring.push(builder.vertex(fromLocal(
        cx + (point.u - cx) * scale,
        cy + (point.v - cy) * scale,
        plane,
        normalOffset,
      )));
    }
    slices.push({ ring, t });
  }

  for (let sliceIndex = 0; sliceIndex < slices.length - 1; sliceIndex++) {
    const lower = slices[sliceIndex]!;
    const upper = slices[sliceIndex + 1]!;
    stitchRingPair(builder, lower.ring, upper.ring, lower.t, upper.t, n);
  }

  const innerScale = capScale * 0.22;
  const bottomInner: VertexId[] = [];
  const topInner: VertexId[] = [];
  for (let index = 0; index < n; index++) {
    const point = polygon[index]!;
    bottomInner.push(builder.vertex(fromLocal(
      cx + (point.u - cx) * innerScale,
      cy + (point.v - cy) * innerScale,
      plane,
      -depth / 2,
    )));
    topInner.push(builder.vertex(fromLocal(
      cx + (point.u - cx) * innerScale,
      cy + (point.v - cy) * innerScale,
      plane,
      depth / 2,
    )));
  }

  for (let index = 0; index < n; index++) {
    const next = (index + 1) % n;
    const u0 = index / n;
    const u1 = (index + 1) / n;
    builder.quad(
      slices[0]!.ring[index]!,
      bottomInner[index]!,
      bottomInner[next]!,
      slices[0]!.ring[next]!,
      [v2(u0, 0), v2(u0, 0.04), v2(u1, 0.04), v2(u1, 0)],
    );
    builder.quad(
      slices[slices.length - 1]!.ring[index]!,
      slices[slices.length - 1]!.ring[next]!,
      topInner[next]!,
      topInner[index]!,
      [v2(u0, 1), v2(u1, 1), v2(u1, 0.96), v2(u0, 0.96)],
    );
  }

  const bottomCenter = builder.vertex(fromLocal(cx, cy, plane, -depth / 2));
  const topCenter = builder.vertex(fromLocal(cx, cy, plane, depth / 2));
  for (let index = 0; index < n; index++) {
    const next = (index + 1) % n;
    const u0 = index / n;
    const u1 = (index + 1) / n;
    builder.tri(bottomCenter, bottomInner[next]!, bottomInner[index]!, [
      v2(0.5, 0.02), v2(u1, 0.04), v2(u0, 0.04),
    ]);
    builder.tri(topCenter, topInner[index]!, topInner[next]!, [
      v2(0.5, 0.98), v2(u0, 0.96), v2(u1, 0.96),
    ]);
  }

  return finishDoodleMesh(ensureOutward(builder.build()));
}

function stitchRingPair(
  builder: MeshBuilder,
  ringLower: VertexId[],
  ringUpper: VertexId[],
  vLower: number,
  vUpper: number,
  segments: number,
): void {
  if (ringLower.length === 1 && ringUpper.length > 1) {
    const pole = ringLower[0]!;
    for (let segment = 0; segment < ringUpper.length; segment++) {
      const next = (segment + 1) % ringUpper.length;
      builder.tri(pole, ringUpper[next]!, ringUpper[segment]!, [
        v2(0.5, vLower), v2((segment + 1) / segments, vUpper), v2(segment / segments, vUpper),
      ]);
    }
    return;
  }
  if (ringUpper.length === 1 && ringLower.length > 1) {
    const pole = ringUpper[0]!;
    for (let segment = 0; segment < ringLower.length; segment++) {
      const next = (segment + 1) % ringLower.length;
      builder.tri(pole, ringLower[segment]!, ringLower[next]!, [
        v2(0.5, vUpper), v2(segment / segments, vLower), v2((segment + 1) / segments, vLower),
      ]);
    }
    return;
  }
  for (let segment = 0; segment < segments; segment++) {
    const next = (segment + 1) % segments;
    const u0 = segment / segments;
    const u1 = (segment + 1) / segments;
    builder.quad(
      ringLower[segment]!,
      ringLower[next]!,
      ringUpper[next]!,
      ringUpper[segment]!,
      [v2(u0, vLower), v2(u1, vLower), v2(u1, vUpper), v2(u0, vUpper)],
    );
  }
}

function fromLocal(u: number, v: number, plane: PlaneBasis, normalOffset: number): Vec3 {
  return addVec3(
    plane.origin,
    addVec3(
      addVec3(scaleVec3(plane.axisU, u), scaleVec3(plane.axisV, v)),
      scaleVec3(plane.normal, normalOffset),
    ),
  );
}

function polygonCentroid(poly: { u: number; v: number }[]): { u: number; v: number } {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < poly.length; index++) {
    const current = poly[index]!;
    const next = poly[(index + 1) % poly.length]!;
    const cross = current.u * next.v - next.u * current.v;
    area += cross;
    cx += (current.u + next.u) * cross;
    cy += (current.v + next.v) * cross;
  }
  if (Math.abs(area) < 1e-6) {
    return {
      u: poly.reduce((sum, point) => sum + point.u, 0) / poly.length,
      v: poly.reduce((sum, point) => sum + point.v, 0) / poly.length,
    };
  }
  const factor = 1 / (3 * area);
  return { u: cx * factor, v: cy * factor };
}

function ensureCCW(poly: { u: number; v: number }[]): { u: number; v: number }[] {
  let area = 0;
  for (let index = 0; index < poly.length; index++) {
    const current = poly[index]!;
    const next = poly[(index + 1) % poly.length]!;
    area += current.u * next.v - next.u * current.v;
  }
  return area >= 0 ? poly : [...poly].reverse();
}

function finishDoodleMesh(mesh: EditableMesh): EditableMesh {
  if (
    mesh.defaultUvLayerId &&
    [...mesh.faceCorners.values()].every((corner) => {
      const uv = corner.uvs.get(mesh.defaultUvLayerId!);
      return !uv || (uv.x === 0 && uv.y === 0);
    })
  ) {
    unwrapUvAuto(mesh, [...mesh.faces.keys()], mesh.defaultUvLayerId);
  }
  return mesh;
}

function ensureOutward(mesh: EditableMesh): EditableMesh {
  if (validateMeshFull(mesh).issues.some((issue) => issue.code === 'INWARD_WINDING')) {
    const result = flipFaces(mesh, [...mesh.faces.keys()]);
    if (!result.ok) throw new Error(result.error?.message ?? 'Could not correct soft inflate winding');
  }
  return mesh;
}

export function ringCountForBudget(outlineSegments: number): number {
  if (outlineSegments >= 24) return 5;
  if (outlineSegments >= 16) return 4;
  return 3;
}

import { v2 } from '@/core/math/Vec2';
import {
  addVec3,
  crossVec3,
  dotVec3,
  lengthVec3,
  normalizeVec3,
  scaleVec3,
  subVec3,
  v3,
  type Vec3,
} from '@/core/math/Vec3';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import { flipFaces } from '@/core/mesh/ops/basic';
import type { EditableMesh, VertexId } from '@/core/mesh/types';
import { validateMeshFull } from '@/core/mesh/Validation';
import { unwrapUvAuto } from '@/core/uv/UvOperations';

export type SilhouetteExtrudeOptions = {
  boundary: { u: number; v: number }[];
  plane: {
    origin: Vec3;
    normal: Vec3;
    axisU: Vec3;
    axisV: Vec3;
  };
  depth: number;
  name?: string;
};

/** Build a closed 2D ribbon outline from an open stroke for flat extrusion. */
export function strokeToFlatOutline(
  points: { u: number; v: number }[],
  halfWidth: number,
): { u: number; v: number }[] | null {
  if (points.length < 2 || halfWidth <= 0) return null;

  const left: { u: number; v: number }[] = [];
  const right: { u: number; v: number }[] = [];

  for (let index = 0; index < points.length; index++) {
    const prev = points[Math.max(0, index - 1)]!;
    const current = points[index]!;
    const next = points[Math.min(points.length - 1, index + 1)]!;

    let tx = next.u - prev.u;
    let ty = next.v - prev.v;
    let len = Math.hypot(tx, ty);
    if (len < 1e-8) {
      tx = next.u - current.u;
      ty = next.v - current.v;
      len = Math.hypot(tx, ty) || 1;
    }
    tx /= len;
    ty /= len;
    const nx = -ty;
    const ny = tx;

    left.push({ u: current.u + nx * halfWidth, v: current.v + ny * halfWidth });
    right.push({ u: current.u - nx * halfWidth, v: current.v - ny * halfWidth });
  }

  return [...left, ...right.reverse()];
}

/** Flat prism from a closed 2D silhouette — n-gon caps and quad side walls. */
export function buildSilhouetteExtrude(options: SilhouetteExtrudeOptions): EditableMesh {
  const polygon = ensureCCW(options.boundary);
  const n = polygon.length;
  if (n < 3) return new MeshBuilder(options.name ?? 'Silhouette', false).build();

  const depth = Math.max(1e-4, options.depth);
  const half = depth / 2;
  const plane = options.plane;
  const builder = new MeshBuilder(options.name ?? 'Silhouette', false);

  const minU = Math.min(...polygon.map((point) => point.u));
  const maxU = Math.max(...polygon.map((point) => point.u));
  const minV = Math.min(...polygon.map((point) => point.v));
  const maxV = Math.max(...polygon.map((point) => point.v));
  const spanU = Math.max(1e-8, maxU - minU);
  const spanV = Math.max(1e-8, maxV - minV);
  const planarUv = (point: { u: number; v: number }) =>
    v2((point.u - minU) / spanU, (point.v - minV) / spanV);

  const front: VertexId[] = [];
  const back: VertexId[] = [];
  for (const point of polygon) {
    front.push(builder.vertex(fromLocal(point.u, point.v, plane, half)));
    back.push(builder.vertex(fromLocal(point.u, point.v, plane, -half)));
  }

  builder.ngon([...front], front.map((_, index) => planarUv(polygon[index]!)));
  builder.ngon([...back].reverse(), back.map((_, index) => planarUv(polygon[n - 1 - index]!)));

  for (let index = 0; index < n; index++) {
    const next = (index + 1) % n;
    const u0 = index / n;
    const u1 = (index + 1) / n;
    builder.quad(front[index]!, back[index]!, back[next]!, front[next]!, [
      v2(u0, 1), v2(u0, 0), v2(u1, 0), v2(u1, 1),
    ]);
  }

  return finishDoodleMesh(ensureOutward(builder.build()));
}

function fromLocal(u: number, v: number, plane: SilhouetteExtrudeOptions['plane'], normalOffset: number): Vec3 {
  return addVec3(
    plane.origin,
    addVec3(
      addVec3(scaleVec3(plane.axisU, u), scaleVec3(plane.axisV, v)),
      scaleVec3(plane.normal, normalOffset),
    ),
  );
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
    if (!result.ok) throw new Error(result.error?.message ?? 'Could not correct silhouette winding');
  }
  return mesh;
}

export function fitStrokePlane(points: Vec3[]) {
  const origin = points.reduce((acc, point) => addVec3(acc, point), v3());
  const o = scaleVec3(origin, 1 / points.length);
  let normal = v3(0, 0, 0);
  for (let index = 1; index < points.length - 1; index++) {
    normal = addVec3(
      normal,
      crossVec3(subVec3(points[index]!, o), subVec3(points[index + 1]!, o)),
    );
  }
  if (lengthVec3(normal) < 1e-8) normal = v3(0, 0, 1);
  normal = normalizeVec3(normal);
  let axisU =
    Math.abs(dotVec3(normal, v3(0, 1, 0))) < 0.9
      ? normalizeVec3(crossVec3(v3(0, 1, 0), normal))
      : normalizeVec3(crossVec3(v3(1, 0, 0), normal));
  if (lengthVec3(axisU) < 1e-8) axisU = v3(1, 0, 0);
  const axisV = normalizeVec3(crossVec3(normal, axisU));
  return { origin: o, normal, axisU, axisV };
}

export function toLocalPoint(point: Vec3, plane: ReturnType<typeof fitStrokePlane>): { u: number; v: number } {
  const delta = subVec3(point, plane.origin);
  return { u: dotVec3(delta, plane.axisU), v: dotVec3(delta, plane.axisV) };
}

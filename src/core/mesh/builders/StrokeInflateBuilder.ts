import { v2 } from '@/core/math/Vec2';
import {
  addVec3,
  crossVec3,
  dotVec3,
  lengthSqVec3,
  lengthVec3,
  normalizeVec3,
  scaleVec3,
  subVec3,
  v3,
  type Vec3,
} from '@/core/math/Vec3';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import type { EditableMesh } from '@/core/mesh/types';
import { unwrapUvAuto } from '@/core/uv/UvOperations';
import { resampleStrokePoints } from './StrokeTubeBuilder';

export type InflateDoodleOptions = {
  points: Vec3[];
  /** Half-thickness along the silhouette normal (full depth = 2 * thickness). */
  thickness: number;
  /** Target outline vertex count (low ~16, medium ~28). */
  outlineSegments?: number;
  /** Sharp = crisp prism; soft = beveled, inflated silhouette. */
  profile?: 'sharp' | 'soft';
  name?: string;
};

/** True when the stroke end returns near the start (Paint 3D “connect”). */
export function isStrokeClosed(points: Vec3[], closeDistance: number): boolean {
  if (points.length < 4) return false;
  const a = points[0]!;
  const b = points[points.length - 1]!;
  if (lengthSqVec3(subVec3(a, b)) > closeDistance * closeDistance) return false;
  // Path must have real extent so a tiny scribble doesn’t inflate.
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += lengthVec3(subVec3(points[i]!, points[i - 1]!));
  }
  return len >= closeDistance * 4;
}

type PlaneBasis = { origin: Vec3; normal: Vec3; axisU: Vec3; axisV: Vec3 };

function fitStrokePlane(points: Vec3[]): PlaneBasis {
  const origin = points.reduce((acc, p) => addVec3(acc, p), v3());
  const o = scaleVec3(origin, 1 / points.length);
  // Covariance via two edges spanning the doodle.
  let n = v3(0, 0, 0);
  for (let i = 1; i < points.length - 1; i++) {
    n = addVec3(
      n,
      crossVec3(subVec3(points[i]!, o), subVec3(points[i + 1]!, o)),
    );
  }
  if (lengthVec3(n) < 1e-8) n = v3(0, 0, 1);
  n = normalizeVec3(n);
  let axisU =
    Math.abs(dotVec3(n, v3(0, 1, 0))) < 0.9
      ? normalizeVec3(crossVec3(v3(0, 1, 0), n))
      : normalizeVec3(crossVec3(v3(1, 0, 0), n));
  if (lengthVec3(axisU) < 1e-8) axisU = v3(1, 0, 0);
  const axisV = normalizeVec3(crossVec3(n, axisU));
  return { origin: o, normal: n, axisU, axisV };
}

function toLocal(p: Vec3, plane: PlaneBasis): { u: number; v: number } {
  const d = subVec3(p, plane.origin);
  return { u: dotVec3(d, plane.axisU), v: dotVec3(d, plane.axisV) };
}

function fromLocal(u: number, v: number, plane: PlaneBasis, nOff: number): Vec3 {
  return addVec3(
    plane.origin,
    addVec3(
      addVec3(scaleVec3(plane.axisU, u), scaleVec3(plane.axisV, v)),
      scaleVec3(plane.normal, nOff),
    ),
  );
}

/** Uniformly resample a closed ring to `count` vertices. */
function resampleClosedRing(
  ring: { u: number; v: number }[],
  count: number,
): { u: number; v: number }[] {
  if (ring.length < 3) return ring;
  const closed = [...ring, ring[0]!];
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < closed.length - 1; i++) {
    const a = closed[i]!;
    const b = closed[i + 1]!;
    const len = Math.hypot(b.u - a.u, b.v - a.v);
    segLens.push(len);
    total += len;
  }
  if (total < 1e-8) return ring.slice(0, Math.min(count, ring.length));

  const out: { u: number; v: number }[] = [];
  for (let i = 0; i < count; i++) {
    const target = (i / count) * total;
    let acc = 0;
    for (let s = 0; s < segLens.length; s++) {
      const next = acc + segLens[s]!;
      if (target <= next || s === segLens.length - 1) {
        const t = segLens[s]! < 1e-12 ? 0 : (target - acc) / segLens[s]!;
        const a = closed[s]!;
        const b = closed[s + 1]!;
        out.push({ u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t });
        break;
      }
      acc = next;
    }
  }
  return out;
}

function polygonArea(poly: { u: number; v: number }[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.u * q.v - q.u * p.v;
  }
  return a * 0.5;
}

/** Ear-clip a simple 2D polygon → triangle index triples. */
function earClip2d(poly: { u: number; v: number }[]): [number, number, number][] {
  const n = poly.length;
  if (n < 3) return [];
  const idx = Array.from({ length: n }, (_, i) => i);
  const area = polygonArea(poly);
  const ccw = area >= 0;
  const tris: [number, number, number][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length]!;
      const i1 = idx[i]!;
      const i2 = idx[(i + 1) % idx.length]!;
      const a = poly[i0]!;
      const b = poly[i1]!;
      const c = poly[i2]!;
      const cross = (b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u);
      if (ccw ? cross <= 1e-12 : cross >= -1e-12) continue; // not a convex ear
      let inside = false;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (pointInTri(poly[j]!, a, b, c)) {
          inside = true;
          break;
        }
      }
      if (inside) continue;
      tris.push([i0, i1, i2]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push([idx[0]!, idx[1]!, idx[2]!]);
  return tris;
}

function pointInTri(
  p: { u: number; v: number },
  a: { u: number; v: number },
  b: { u: number; v: number },
  c: { u: number; v: number },
): boolean {
  const sign = (p1: typeof p, p2: typeof p, p3: typeof p) =>
    (p1.u - p3.u) * (p2.v - p3.v) - (p2.u - p3.u) * (p1.v - p3.v);
  const b1 = sign(p, a, b) < 0;
  const b2 = sign(p, b, c) < 0;
  const b3 = sign(p, c, a) < 0;
  return b1 === b2 && b2 === b3;
}

/**
 * Paint 3D–style inflate: closed silhouette → low/mid-poly solid prism
 * extruded along the doodle plane normal.
 */
export function buildInflatedDoodle(options: InflateDoodleOptions): EditableMesh {
  const thickness = Math.max(1e-4, options.thickness);
  const outlineTarget = Math.max(8, Math.min(48, Math.floor(options.outlineSegments ?? 16)));
  const name = options.name ?? 'Doodle';
  const profile = options.profile ?? 'sharp';
  const minSpacing = thickness * 0.35;
  let path = resampleStrokePoints(options.points, minSpacing);
  // Drop the duplicate closing sample if present.
  if (
    path.length >= 2 &&
    lengthSqVec3(subVec3(path[0]!, path[path.length - 1]!)) < minSpacing * minSpacing
  ) {
    path = path.slice(0, -1);
  }
  if (path.length < 3) {
    // Fallback tiny triangle inflate.
    path = [v3(0, 0, 0), v3(thickness * 4, 0, 0), v3(thickness * 2, thickness * 4, 0)];
  }

  const plane = fitStrokePlane(path);
  let ring2d = path.map((p) => toLocal(p, plane));
  // Ensure CCW for outward normals with +normal = “front”.
  if (polygonArea(ring2d) < 0) ring2d = [...ring2d].reverse();
  ring2d = resampleClosedRing(ring2d, outlineTarget);
  const minU = Math.min(...ring2d.map((point) => point.u));
  const maxU = Math.max(...ring2d.map((point) => point.u));
  const minV = Math.min(...ring2d.map((point) => point.v));
  const maxV = Math.max(...ring2d.map((point) => point.v));
  const spanU = Math.max(1e-8, maxU - minU);
  const spanV = Math.max(1e-8, maxV - minV);
  const planarUv = (point: { u: number; v: number }) =>
    v2((point.u - minU) / spanU, (point.v - minV) / spanV);

  // Keep ear-clip for concave silhouettes; fan from centroid for convex-ish rings.
  const tris = earClip2d(ring2d);
  const b = new MeshBuilder(name, false);
  if (profile === 'soft') {
    const cu = ring2d.reduce((s, p) => s + p.u, 0) / ring2d.length;
    const cv = ring2d.reduce((s, p) => s + p.v, 0) / ring2d.length;
    const inset = 0.8;
    const outerFront: string[] = [];
    const outerBack: string[] = [];
    const innerFront: string[] = [];
    const innerBack: string[] = [];
    for (const p of ring2d) {
      const iu = cu + (p.u - cu) * inset;
      const iv = cv + (p.v - cv) * inset;
      outerFront.push(b.vertex(fromLocal(p.u, p.v, plane, thickness * 0.18)));
      outerBack.push(b.vertex(fromLocal(p.u, p.v, plane, -thickness * 0.18)));
      innerFront.push(b.vertex(fromLocal(iu, iv, plane, thickness)));
      innerBack.push(b.vertex(fromLocal(iu, iv, plane, -thickness)));
    }

    // Rounded profile: side wall + front/back bevel rings.
    for (let i = 0; i < ring2d.length; i++) {
      const j = (i + 1) % ring2d.length;
      const u0 = i / ring2d.length;
      const u1 = (i + 1) / ring2d.length;
      const outerI = planarUv(ring2d[i]!);
      const outerJ = planarUv(ring2d[j]!);
      const innerI = planarUv({
        u: cu + (ring2d[i]!.u - cu) * inset,
        v: cv + (ring2d[i]!.v - cv) * inset,
      });
      const innerJ = planarUv({
        u: cu + (ring2d[j]!.u - cu) * inset,
        v: cv + (ring2d[j]!.v - cv) * inset,
      });
      b.quad(outerFront[i]!, outerBack[i]!, outerBack[j]!, outerFront[j]!, [
        v2(u0, 1), v2(u0, 0), v2(u1, 0), v2(u1, 1),
      ]);
      b.quad(outerFront[i]!, outerFront[j]!, innerFront[j]!, innerFront[i]!, [
        outerI, outerJ, innerJ, innerI,
      ]);
      b.quad(outerBack[j]!, outerBack[i]!, innerBack[i]!, innerBack[j]!, [
        outerJ, outerI, innerI, innerJ,
      ]);
    }
    if (tris.length) {
      for (const [i0, i1, i2] of tris) {
        const uv0 = planarUv({
          u: cu + (ring2d[i0]!.u - cu) * inset,
          v: cv + (ring2d[i0]!.v - cv) * inset,
        });
        const uv1 = planarUv({
          u: cu + (ring2d[i1]!.u - cu) * inset,
          v: cv + (ring2d[i1]!.v - cv) * inset,
        });
        const uv2 = planarUv({
          u: cu + (ring2d[i2]!.u - cu) * inset,
          v: cv + (ring2d[i2]!.v - cv) * inset,
        });
        b.tri(innerFront[i0]!, innerFront[i1]!, innerFront[i2]!, [uv0, uv1, uv2]);
        b.tri(innerBack[i0]!, innerBack[i2]!, innerBack[i1]!, [uv0, uv2, uv1]);
      }
    } else {
      const frontCentre = b.vertex(fromLocal(cu, cv, plane, thickness));
      const backCentre = b.vertex(fromLocal(cu, cv, plane, -thickness));
      const centreUv = planarUv({ u: cu, v: cv });
      for (let i = 0; i < ring2d.length; i++) {
        const j = (i + 1) % ring2d.length;
        const uvI = planarUv({
          u: cu + (ring2d[i]!.u - cu) * inset,
          v: cv + (ring2d[i]!.v - cv) * inset,
        });
        const uvJ = planarUv({
          u: cu + (ring2d[j]!.u - cu) * inset,
          v: cv + (ring2d[j]!.v - cv) * inset,
        });
        b.tri(frontCentre, innerFront[i]!, innerFront[j]!, [centreUv, uvI, uvJ]);
        b.tri(backCentre, innerBack[j]!, innerBack[i]!, [centreUv, uvJ, uvI]);
      }
    }
    return finishDoodleMesh(b.build());
  }

  const front: string[] = [];
  const back: string[] = [];
  for (const p of ring2d) {
    front.push(b.vertex(fromLocal(p.u, p.v, plane, thickness)));
    back.push(b.vertex(fromLocal(p.u, p.v, plane, -thickness)));
  }

  const cu = ring2d.reduce((s, p) => s + p.u, 0) / ring2d.length;
  const cv = ring2d.reduce((s, p) => s + p.v, 0) / ring2d.length;
  // Prefer ear-clipped caps (handles concave doodles). Side walls use winding
  // that twins the rim edges of those caps.
  if (tris.length > 0) {
    for (const [i0, i1, i2] of tris) {
      const uv0 = planarUv(ring2d[i0]!);
      const uv1 = planarUv(ring2d[i1]!);
      const uv2 = planarUv(ring2d[i2]!);
      // Front: CCW from +normal (outside).
      b.tri(front[i0]!, front[i1]!, front[i2]!, [uv0, uv1, uv2]);
      // Back: CCW from -normal (outside) ⇒ reverse index order.
      b.tri(back[i0]!, back[i2]!, back[i1]!, [uv0, uv2, uv1]);
    }
  } else {
    const frontCentre = b.vertex(fromLocal(cu, cv, plane, thickness));
    const backCentre = b.vertex(fromLocal(cu, cv, plane, -thickness));
    const centreUv = planarUv({ u: cu, v: cv });
    for (let i = 0; i < ring2d.length; i++) {
      const j = (i + 1) % ring2d.length;
      const uvI = planarUv(ring2d[i]!);
      const uvJ = planarUv(ring2d[j]!);
      b.tri(frontCentre, front[i]!, front[j]!, [centreUv, uvI, uvJ]);
      b.tri(backCentre, back[j]!, back[i]!, [centreUv, uvJ, uvI]);
    }
  }

  // Side walls: shared rim edge must twin the front cap (front[j]→front[i]).
  for (let i = 0; i < ring2d.length; i++) {
    const j = (i + 1) % ring2d.length;
    const u0 = i / ring2d.length;
    const u1 = (i + 1) / ring2d.length;
    b.quad(front[i]!, back[i]!, back[j]!, front[j]!, [
      v2(u0, 1),
      v2(u0, 0),
      v2(u1, 0),
      v2(u1, 1),
    ]);
  }

  return finishDoodleMesh(b.build());
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

/** Close distance used for connect detection (world units). */
export function doodleCloseDistance(radius: number, pathLength: number): number {
  return Math.max(radius * 2.2, Math.min(pathLength * 0.12, radius * 8));
}

export function strokePathLength(points: Vec3[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += lengthVec3(subVec3(points[i]!, points[i - 1]!));
  }
  return len;
}

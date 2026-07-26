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

export type StrokeTubeOptions = {
  points: Vec3[];
  radius: number;
  radialSegments?: number;
  /** Drop samples closer than this (defaults to radius * 0.55). */
  minSpacing?: number;
  name?: string;
  capped?: boolean;
};

/** Resample a polyline, dropping near-duplicate samples. */
export function resampleStrokePoints(points: Vec3[], minSpacing: number): Vec3[] {
  if (points.length === 0) return [];
  const out: Vec3[] = [{ ...points[0]! }];
  const minSq = Math.max(1e-12, minSpacing * minSpacing);
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    const prev = out[out.length - 1]!;
    if (lengthSqVec3(subVec3(p, prev)) >= minSq) out.push({ ...p });
  }
  // Keep the true end point if it was culled but still meaningfully away.
  const last = points[points.length - 1]!;
  const tip = out[out.length - 1]!;
  if (lengthSqVec3(subVec3(last, tip)) > 1e-12) {
    if (out.length === 1 || lengthSqVec3(subVec3(last, tip)) >= minSq * 0.25) {
      out.push({ ...last });
    } else {
      out[out.length - 1] = { ...last };
    }
  }
  return out;
}

/**
 * Build a low/mid-poly tube that follows a freehand 3D stroke path.
 * Uses parallel transport so the cross-section twists smoothly.
 */
export function buildStrokeTube(options: StrokeTubeOptions): EditableMesh {
  const radius = Math.max(1e-4, options.radius);
  const segs = Math.max(3, Math.floor(options.radialSegments ?? 6));
  const minSpacing = options.minSpacing ?? radius * 0.55;
  const capped = options.capped !== false;
  const name = options.name ?? 'Doodle';
  const path = resampleStrokePoints(options.points, minSpacing);
  if (path.length < 2) {
    // Degenerate: tiny capsule along +Z so callers still get a mesh.
    path.push(addVec3(path[0] ?? v3(), v3(0, 0, Math.max(radius * 2, minSpacing))));
    if (path.length < 2) path.unshift(v3());
  }

  const tangents: Vec3[] = [];
  for (let i = 0; i < path.length; i++) {
    if (i === 0) tangents.push(normalizeVec3(subVec3(path[1]!, path[0]!)));
    else if (i === path.length - 1)
      tangents.push(normalizeVec3(subVec3(path[i]!, path[i - 1]!)));
    else tangents.push(normalizeVec3(subVec3(path[i + 1]!, path[i - 1]!)));
    if (lengthVec3(tangents[i]!) < 1e-8) tangents[i] = v3(0, 1, 0);
  }

  // Parallel-transport frames.
  const normals: Vec3[] = [];
  const binormals: Vec3[] = [];
  {
    const t0 = tangents[0]!;
    let n0 =
      Math.abs(dotVec3(t0, v3(0, 1, 0))) < 0.9
        ? normalizeVec3(crossVec3(t0, v3(0, 1, 0)))
        : normalizeVec3(crossVec3(t0, v3(1, 0, 0)));
    if (lengthVec3(n0) < 1e-8) n0 = v3(1, 0, 0);
    normals.push(n0);
    binormals.push(normalizeVec3(crossVec3(t0, n0)));
  }
  for (let i = 1; i < path.length; i++) {
    const tPrev = tangents[i - 1]!;
    const t = tangents[i]!;
    let n = normals[i - 1]!;
    const axis = crossVec3(tPrev, t);
    const axisLen = lengthVec3(axis);
    if (axisLen > 1e-8) {
      const angle = Math.atan2(axisLen, Math.max(-1, Math.min(1, dotVec3(tPrev, t))));
      n = rotateAroundAxis(n, normalizeVec3(axis), angle);
    }
    n = normalizeVec3(subVec3(n, scaleVec3(t, dotVec3(n, t))));
    if (lengthVec3(n) < 1e-8) {
      n =
        Math.abs(dotVec3(t, v3(0, 1, 0))) < 0.9
          ? normalizeVec3(crossVec3(t, v3(0, 1, 0)))
          : normalizeVec3(crossVec3(t, v3(1, 0, 0)));
    }
    normals.push(n);
    binormals.push(normalizeVec3(crossVec3(t, n)));
  }

  const b = new MeshBuilder(name, false);
  const rings: string[][] = [];
  for (let i = 0; i < path.length; i++) {
    const centre = path[i]!;
    const n = normals[i]!;
    const bn = binormals[i]!;
    const ring: string[] = [];
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const offset = addVec3(scaleVec3(n, Math.cos(a) * radius), scaleVec3(bn, Math.sin(a) * radius));
      ring.push(b.vertex(addVec3(centre, offset)));
    }
    rings.push(ring);
  }

  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i]!;
    const c = rings[i + 1]!;
    const v0 = i / Math.max(1, rings.length - 1);
    const v1 = (i + 1) / Math.max(1, rings.length - 1);
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      const u0 = s / segs;
      const u1 = (s + 1) / segs;
      b.quad(a[s]!, a[s1]!, c[s1]!, c[s]!, [
        v2(u0, v0),
        v2(u1, v0),
        v2(u1, v1),
        v2(u0, v1),
      ]);
    }
  }

  if (capped) {
    const capUv = (i: number) =>
      v2(
        0.5 + 0.5 * Math.cos((i / segs) * Math.PI * 2),
        0.5 + 0.5 * Math.sin((i / segs) * Math.PI * 2),
      );
    const start = rings[0]!;
    const end = rings[rings.length - 1]!;
    b.ngon([...start].reverse(), [...Array(segs).keys()].reverse().map(capUv));
    b.ngon([...end], [...Array(segs).keys()].map(capUv));
  }

  const mesh = b.build();
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

function rotateAroundAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const a = normalizeVec3(axis);
  // Rodrigues
  return addVec3(
    addVec3(scaleVec3(v, c), scaleVec3(crossVec3(a, v), s)),
    scaleVec3(a, dotVec3(a, v) * (1 - c)),
  );
}

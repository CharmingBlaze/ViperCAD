import { crossVec3, dotVec3, lengthSqVec3, subVec3, type Vec3 } from '@/core/math/Vec3';
import { faceCornerIds, faceVertexIds } from './EditableMesh';
import { computeFaceNormal } from './Normals';
import type { EditableMesh, FaceId, FaceCornerId, VertexId } from './types';

export type TriIndex = [number, number, number];

export type FaceTriangulation = {
  faceId: FaceId;
  /** Indices into the face's ordered corner/vertex loop. */
  triangles: TriIndex[];
  /** Preferred diagonal for quads (stable cache hint). */
  quadDiagonal?: '0-2' | '1-3';
};

/**
 * Stable triangulation for render. Does not create logical triangle faces.
 * Quads prefer the diagonal that maximises planarity / triangle quality.
 */
export function triangulateFace(mesh: EditableMesh, faceId: FaceId): FaceTriangulation {
  const verts = faceVertexIds(mesh, faceId);
  const n = verts.length;

  if (n < 3) return { faceId, triangles: [] };
  if (n === 3) return { faceId, triangles: [[0, 1, 2]] };
  if (n === 4) {
    let diagonal = mesh.triangulationHints.get(faceId);
    if (!diagonal) {
      diagonal = chooseQuadDiagonal(mesh, verts);
      mesh.triangulationHints.set(faceId, diagonal);
    }
    const triangles: TriIndex[] =
      diagonal === '0-2'
        ? [
            [0, 1, 2],
            [0, 2, 3],
          ]
        : [
            [0, 1, 3],
            [1, 2, 3],
          ];
    return { faceId, triangles, quadDiagonal: diagonal };
  }

  // Ear clipping for n-gons (works for mild concave polygons in plane).
  return { faceId, triangles: earClip(mesh, faceId, verts) };
}

export function triangulateMesh(mesh: EditableMesh): Map<FaceId, FaceTriangulation> {
  const map = new Map<FaceId, FaceTriangulation>();
  for (const face of mesh.faces.values()) {
    map.set(face.id, triangulateFace(mesh, face.id));
  }
  return map;
}

function chooseQuadDiagonal(mesh: EditableMesh, verts: VertexId[]): '0-2' | '1-3' {
  const p = verts.map((id) => mesh.vertices.get(id)!.position);
  const score02 = diagonalScore(p[0]!, p[1]!, p[2]!, p[3]!, true);
  const score13 = diagonalScore(p[0]!, p[1]!, p[2]!, p[3]!, false);
  // Prefer 0-2 on ties for stability.
  return score02 >= score13 ? '0-2' : '1-3';
}

function diagonalScore(a: Vec3, b: Vec3, c: Vec3, d: Vec3, use02: boolean): number {
  // Higher is better: prefer shorter diagonal + more similar triangle areas.
  if (use02) {
    const diag = lengthSqVec3(subVec3(c, a));
    const n1 = crossVec3(subVec3(b, a), subVec3(c, a));
    const n2 = crossVec3(subVec3(c, a), subVec3(d, a));
    const area1 = Math.hypot(n1.x, n1.y, n1.z);
    const area2 = Math.hypot(n2.x, n2.y, n2.z);
    const balance = 1 / (1 + Math.abs(area1 - area2));
    return balance * 10 - diag;
  }
  const diag = lengthSqVec3(subVec3(d, b));
  const n1 = crossVec3(subVec3(b, a), subVec3(d, a));
  const n2 = crossVec3(subVec3(c, b), subVec3(d, b));
  const area1 = Math.hypot(n1.x, n1.y, n1.z);
  const area2 = Math.hypot(n2.x, n2.y, n2.z);
  const balance = 1 / (1 + Math.abs(area1 - area2));
  return balance * 10 - diag;
}

function earClip(mesh: EditableMesh, faceId: FaceId, verts: VertexId[]): TriIndex[] {
  const positions = verts.map((id) => mesh.vertices.get(id)!.position);
  const normal = computeFaceNormal(mesh, faceId);
  const indices = positions.map((_, i) => i);
  const triangles: TriIndex[] = [];
  let guard = 0;

  while (indices.length > 3 && guard < 10_000) {
    guard += 1;
    let earFound = false;
    for (let i = 0; i < indices.length; i++) {
      const i0 = indices[(i - 1 + indices.length) % indices.length]!;
      const i1 = indices[i]!;
      const i2 = indices[(i + 1) % indices.length]!;
      if (!isEar(positions, indices, i0, i1, i2, normal)) continue;
      triangles.push([i0, i1, i2]);
      indices.splice(i, 1);
      earFound = true;
      break;
    }
    if (!earFound) {
      // Fallback fan from vertex 0 — keeps winding, may be imperfect for severe concavity.
      const root = indices[0]!;
      for (let i = 1; i < indices.length - 1; i++) {
        triangles.push([root, indices[i]!, indices[i + 1]!]);
      }
      break;
    }
  }
  if (indices.length === 3) {
    triangles.push([indices[0]!, indices[1]!, indices[2]!]);
  }
  return triangles;
}

function isEar(
  positions: Vec3[],
  indices: number[],
  i0: number,
  i1: number,
  i2: number,
  normal: Vec3,
): boolean {
  const a = positions[i0]!;
  const b = positions[i1]!;
  const c = positions[i2]!;
  const cross = crossVec3(subVec3(b, a), subVec3(c, a));
  if (dotVec3(cross, normal) <= 1e-12) return false; // reflex or degenerate

  for (const idx of indices) {
    if (idx === i0 || idx === i1 || idx === i2) continue;
    if (pointInTriangle(positions[idx]!, a, b, c, normal)) return false;
  }
  return true;
}

function pointInTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3, normal: Vec3): boolean {
  const ab = subVec3(b, a);
  const bc = subVec3(c, b);
  const ca = subVec3(a, c);
  const ap = subVec3(p, a);
  const bp = subVec3(p, b);
  const cp = subVec3(p, c);
  const c1 = crossVec3(ab, ap);
  const c2 = crossVec3(bc, bp);
  const c3 = crossVec3(ca, cp);
  return dotVec3(c1, normal) >= -1e-10 && dotVec3(c2, normal) >= -1e-10 && dotVec3(c3, normal) >= -1e-10;
}

export type RenderCornerRef = {
  faceId: FaceId;
  faceCornerId: FaceCornerId;
  vertexId: VertexId;
  loopIndex: number;
};

export function faceCornerLoop(mesh: EditableMesh, faceId: FaceId): RenderCornerRef[] {
  const corners = faceCornerIds(mesh, faceId);
  const verts = faceVertexIds(mesh, faceId);
  return corners.map((faceCornerId, loopIndex) => ({
    faceId,
    faceCornerId,
    vertexId: verts[loopIndex]!,
    loopIndex,
  }));
}

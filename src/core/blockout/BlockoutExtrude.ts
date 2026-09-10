import { ShapeUtils, Vector2 } from 'three';
import { addVec3, scaleVec3, subVec3, type Vec3, v3 } from '@/core/math/Vec3';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import { flipFaces } from '@/core/mesh/ops/basic';
import type { EditableMesh } from '@/core/mesh/types';
import { validateMeshFull } from '@/core/mesh/Validation';
import { unwrapUvAuto } from '@/core/uv/UvOperations';

export function planeNormal(plane: 'front' | 'side' | 'top'): Vec3 {
  if (plane === 'side') return v3(1, 0, 0);
  if (plane === 'top') return v3(0, 1, 0);
  return v3(0, 0, 1);
}

export function contourOnPlane(points: Vec3[], plane: 'front' | 'side' | 'top'): Vector2[] {
  if (plane === 'side') return points.map((p) => new Vector2(p.z, p.y));
  if (plane === 'top') return points.map((p) => new Vector2(p.x, p.z));
  return points.map((p) => new Vector2(p.x, p.y));
}

export function liftPlanePoint(u: number, v: number, plane: 'front' | 'side' | 'top', origin: Vec3): Vec3 {
  if (plane === 'side') return v3(origin.x, v, u);
  if (plane === 'top') return v3(u, origin.y, v);
  return v3(u, v, origin.z);
}

/** Faceted ellipse inside the bounding box of two corners. Default 8 sides for blockout. */
export function buildLowPolyEllipseContour(
  a: Vec3,
  b: Vec3,
  plane: 'front' | 'side' | 'top',
  sides = 8,
): Vec3[] {
  const [ca, cb] = contourOnPlane([a, b], plane);
  if (!ca || !cb) return [];
  const minU = Math.min(ca.x, cb.x);
  const maxU = Math.max(ca.x, cb.x);
  const minV = Math.min(ca.y, cb.y);
  const maxV = Math.max(ca.y, cb.y);
  const rx = (maxU - minU) / 2;
  const ry = (maxV - minV) / 2;
  if (rx < 0.02 || ry < 0.02) return [];
  const cx = (minU + maxU) / 2;
  const cy = (minV + maxV) / 2;
  const n = Math.max(6, Math.min(12, Math.round(sides)));
  const points: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n;
    points.push(liftPlanePoint(cx + rx * Math.cos(angle), cy + ry * Math.sin(angle), plane, a));
  }
  return points;
}

/** Extrude a planar silhouette into a boxy solid. Returns null if the contour cannot triangulate. */
export function buildBlockoutExtrudeMesh(
  rawPoints: Vec3[],
  plane: 'front' | 'side' | 'top',
  thickness: number,
  symmetric: boolean,
  name = 'Blockout Extrude',
): EditableMesh | null {
  if (rawPoints.length < 3) return null;
  const points = [...rawPoints];
  const normal = planeNormal(plane);
  const contour = contourOnPlane(points, plane);

  let area = 0;
  for (let i = 0; i < contour.length; i++) {
    const next = (i + 1) % contour.length;
    area += contour[i]!.x * contour[next]!.y - contour[next]!.x * contour[i]!.y;
  }
  if (area < 0) {
    points.reverse();
    contour.reverse();
  }

  const triangles = ShapeUtils.triangulateShape(contour, []);
  if (!triangles.length) return null;

  const depth = Math.max(0.01, thickness);
  const half = depth / 2;
  const startOffset = symmetric ? -half : 0;
  const endOffset = symmetric ? half : depth;

  const b = new MeshBuilder(name, false);
  const frontVerts = points.map((p) => b.vertex(addVec3(p, scaleVec3(normal, endOffset))));
  const backVerts = points.map((p) => b.vertex(addVec3(p, scaleVec3(normal, startOffset))));

  for (const tri of triangles) {
    b.tri(frontVerts[tri[0]!]!, frontVerts[tri[1]!]!, frontVerts[tri[2]!]!);
  }
  for (const tri of triangles) {
    b.tri(backVerts[tri[2]!]!, backVerts[tri[1]!]!, backVerts[tri[0]!]!);
  }

  const n = points.length;
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    b.quad(frontVerts[next]!, frontVerts[i]!, backVerts[i]!, backVerts[next]!);
  }

  const mesh = ensureOutward(b.build());
  if (mesh.defaultUvLayerId) {
    unwrapUvAuto(mesh, [...mesh.faces.keys()], mesh.defaultUvLayerId);
  }
  return mesh;
}

/** Shift vertices so the bounds centre is the local origin. Returns the former centre in world space. */
export function localizeMeshToBoundsCentre(mesh: EditableMesh): Vec3 {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const vertex of mesh.vertices.values()) {
    const p = vertex.position;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
    maxZ = Math.max(maxZ, p.z);
  }
  if (!Number.isFinite(minX)) return v3();
  const centre = v3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  for (const vertex of mesh.vertices.values()) {
    vertex.position = subVec3(vertex.position, centre);
  }
  mesh.geometryVersion += 1;
  mesh.dirty.positions = mesh.dirty.normals = mesh.dirty.bounds = mesh.dirty.bvh = true;
  return centre;
}

function ensureOutward(mesh: EditableMesh): EditableMesh {
  if (validateMeshFull(mesh).issues.some((issue) => issue.code === 'INWARD_WINDING')) {
    const result = flipFaces(mesh, [...mesh.faces.keys()]);
    if (!result.ok) return mesh;
  }
  return mesh;
}

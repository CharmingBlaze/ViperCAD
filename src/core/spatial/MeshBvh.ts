import { crossVec3, dotVec3, subVec3, type Vec3 } from '@/core/math/Vec3';
import { faceVertexIds } from '@/core/mesh/EditableMesh';
import { triangulateFace } from '@/core/mesh/Triangulation';
import type { EditableMesh, FaceId, VertexId } from '@/core/mesh/types';

type Bounds = { min: Vec3; max: Vec3 };
type Triangle = { faceId: FaceId; vertexIds: [VertexId, VertexId, VertexId]; bounds: Bounds; centre: Vec3 };
type Node = { bounds: Bounds; left?: Node; right?: Node; triangles?: Triangle[] };
export type MeshRayHit = { faceId: FaceId; distance: number; position: Vec3; barycentric: Vec3 };

/** Serializable, renderer-independent per-mesh triangle BVH for picking and snapping. */
export class MeshBvh {
  private root: Node | null = null;
  topologyVersion = -1;
  geometryVersion = -1;

  build(mesh: EditableMesh): void {
    const triangles: Triangle[] = [];
    for (const face of mesh.faces.values()) {
      const vertices = faceVertexIds(mesh, face.id);
      for (const tri of triangulateFace(mesh, face.id).triangles) {
        const ids: [VertexId, VertexId, VertexId] = [vertices[tri[0]]!, vertices[tri[1]]!, vertices[tri[2]]!];
        const points = ids.map((id) => mesh.vertices.get(id)!.position); const bounds = boundsOf(points);
        triangles.push({ faceId: face.id, vertexIds: ids, bounds, centre: { x: (points[0]!.x + points[1]!.x + points[2]!.x) / 3, y: (points[0]!.y + points[1]!.y + points[2]!.y) / 3, z: (points[0]!.z + points[1]!.z + points[2]!.z) / 3 } });
      }
    }
    this.root = buildNode(triangles); this.topologyVersion = mesh.topologyVersion; this.geometryVersion = mesh.geometryVersion;
  }

  /** Refit leaf and parent bounds after position-only edits without repartitioning triangles. */
  refit(mesh: EditableMesh): boolean {
    if (!this.root || this.topologyVersion !== mesh.topologyVersion) return false;
    const refitNode = (node: Node): Bounds | null => {
      if (node.triangles) {
        for (const triangle of node.triangles) {
          const points = triangle.vertexIds.map((id) => mesh.vertices.get(id)?.position);
          if (points.some((point) => !point)) return null;
          triangle.bounds = boundsOf(points as Vec3[]);
          triangle.centre = {
            x: (points[0]!.x + points[1]!.x + points[2]!.x) / 3,
            y: (points[0]!.y + points[1]!.y + points[2]!.y) / 3,
            z: (points[0]!.z + points[1]!.z + points[2]!.z) / 3,
          };
        }
        node.bounds = mergeBounds(node.triangles.map((triangle) => triangle.bounds));
        return node.bounds;
      }
      const children = [node.left && refitNode(node.left), node.right && refitNode(node.right)]
        .filter((bounds): bounds is Bounds => !!bounds);
      if (!children.length) return null;
      node.bounds = mergeBounds(children);
      return node.bounds;
    };
    if (!refitNode(this.root)) return false;
    this.geometryVersion = mesh.geometryVersion;
    return true;
  }

  ensure(mesh: EditableMesh): void {
    if (this.topologyVersion !== mesh.topologyVersion) this.build(mesh);
    else if (this.geometryVersion !== mesh.geometryVersion && !this.refit(mesh)) this.build(mesh);
  }

  raycast(mesh: EditableMesh, origin: Vec3, direction: Vec3, maxDistance = Infinity): MeshRayHit | null {
    this.ensure(mesh); if (!this.root) return null; let best: MeshRayHit | null = null; const stack = [this.root];
    while (stack.length) {
      const node = stack.pop()!; if (!rayBounds(origin, direction, node.bounds, best?.distance ?? maxDistance)) continue;
      if (node.left) stack.push(node.left); if (node.right) stack.push(node.right);
      for (const tri of node.triangles ?? []) {
        const [a, b, c] = tri.vertexIds.map((id) => mesh.vertices.get(id)!.position); const hit = rayTriangle(origin, direction, a!, b!, c!);
        if (hit && hit.distance <= maxDistance && (!best || hit.distance < best.distance)) best = { faceId: tri.faceId, ...hit };
      }
    }
    return best;
  }
}

function buildNode(triangles: Triangle[]): Node | null {
  if (!triangles.length) return null; const bounds = mergeBounds(triangles.map((t) => t.bounds)); if (triangles.length <= 8) return { bounds, triangles };
  const spans = { x: bounds.max.x - bounds.min.x, y: bounds.max.y - bounds.min.y, z: bounds.max.z - bounds.min.z }; const axis: keyof Vec3 = spans.x >= spans.y && spans.x >= spans.z ? 'x' : spans.y >= spans.z ? 'y' : 'z';
  triangles.sort((a, b) => a.centre[axis] - b.centre[axis]); const mid = Math.floor(triangles.length / 2);
  return { bounds, left: buildNode(triangles.slice(0, mid))!, right: buildNode(triangles.slice(mid))! };
}
function boundsOf(points: Vec3[]): Bounds {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

function mergeBounds(bounds: Bounds[]): Bounds {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < bounds.length; i++) {
    const b = bounds[i]!;
    if (b.min.x < minX) minX = b.min.x;
    if (b.max.x > maxX) maxX = b.max.x;
    if (b.min.y < minY) minY = b.min.y;
    if (b.max.y > maxY) maxY = b.max.y;
    if (b.min.z < minZ) minZ = b.min.z;
    if (b.max.z > maxZ) maxZ = b.max.z;
  }
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}
function rayBounds(o: Vec3, d: Vec3, b: Bounds, max: number) { let near = 0, far = max; for (const axis of ['x', 'y', 'z'] as const) { const inv = Math.abs(d[axis]) < 1e-12 ? Infinity : 1 / d[axis]; let t0 = (b.min[axis] - o[axis]) * inv, t1 = (b.max[axis] - o[axis]) * inv; if (t0 > t1) [t0, t1] = [t1, t0]; near = Math.max(near, t0); far = Math.min(far, t1); if (far < near) return false; } return true; }
function rayTriangle(o: Vec3, d: Vec3, a: Vec3, b: Vec3, c: Vec3): Omit<MeshRayHit, 'faceId'> | null { const e1 = subVec3(b, a), e2 = subVec3(c, a), p = crossVec3(d, e2), det = dotVec3(e1, p); if (Math.abs(det) < 1e-12) return null; const inv = 1 / det, tvec = subVec3(o, a), u = dotVec3(tvec, p) * inv; if (u < 0 || u > 1) return null; const q = crossVec3(tvec, e1), v = dotVec3(d, q) * inv; if (v < 0 || u + v > 1) return null; const distance = dotVec3(e2, q) * inv; if (distance < 0) return null; return { distance, position: { x: o.x + d.x * distance, y: o.y + d.y * distance, z: o.z + d.z * distance }, barycentric: { x: 1 - u - v, y: u, z: v } }; }

import { transformPoint, type Transform } from '@/core/math/Transform';
import type { Vec3 } from '@/core/math/Vec3';
import { faceVertexIds, getEdgeVertices } from '@/core/mesh/EditableMesh';
import type { EditableMesh, EdgeId, FaceId, VertexId } from '@/core/mesh/types';

export type SnapIndexEntry =
  | { kind: 'vertex'; id: VertexId; position: Vec3 }
  | { kind: 'edgeMid'; id: EdgeId; position: Vec3 }
  | { kind: 'edge'; id: EdgeId; a: Vec3; b: Vec3; position: Vec3 }
  | { kind: 'faceCentre'; id: FaceId; position: Vec3 };

/** Uniform grid for fixed-radius snap candidate queries. */
export class UniformGridIndex {
  private cells = new Map<string, SnapIndexEntry[]>();
  cellSize: number;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }
  private key(x: number, y: number, z: number): string {
    const s = this.cellSize;
    return `${Math.floor(x / s)},${Math.floor(y / s)},${Math.floor(z / s)}`;
  }

  insert(entry: SnapIndexEntry): void {
    const k = this.key(entry.position.x, entry.position.y, entry.position.z);
    let bucket = this.cells.get(k);
    if (!bucket) {
      bucket = [];
      this.cells.set(k, bucket);
    }
    bucket.push(entry);
  }

  /** Insert a segment into every cell overlapping its AABB. */
  insertSegment(entry: Extract<SnapIndexEntry, { kind: 'edge' }>): void {
    const s = this.cellSize;
    const minX = Math.floor(Math.min(entry.a.x, entry.b.x) / s);
    const maxX = Math.floor(Math.max(entry.a.x, entry.b.x) / s);
    const minY = Math.floor(Math.min(entry.a.y, entry.b.y) / s);
    const maxY = Math.floor(Math.max(entry.a.y, entry.b.y) / s);
    const minZ = Math.floor(Math.min(entry.a.z, entry.b.z) / s);
    const maxZ = Math.floor(Math.max(entry.a.z, entry.b.z) / s);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const k = `${x},${y},${z}`;
          let bucket = this.cells.get(k);
          if (!bucket) {
            bucket = [];
            this.cells.set(k, bucket);
          }
          bucket.push(entry);
        }
      }
    }
  }

  querySphere(center: Vec3, radius: number): SnapIndexEntry[] {
    const s = this.cellSize;
    const r = Math.max(0, Math.ceil(radius / s));
    const cx = Math.floor(center.x / s);
    const cy = Math.floor(center.y / s);
    const cz = Math.floor(center.z / s);
    const out: SnapIndexEntry[] = [];
    const seen = new Set<SnapIndexEntry>();
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          const bucket = this.cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!bucket) continue;
          for (const entry of bucket) {
            if (seen.has(entry)) continue;
            seen.add(entry);
            out.push(entry);
          }
        }
      }
    }
    return out;
  }
}

/** Build a world-space snap index for one mesh object. */
export function buildSnapIndex(
  mesh: EditableMesh,
  transform: Transform,
  cellSize: number,
  options?: { vertices?: boolean; edges?: boolean; faceCentres?: boolean },
): UniformGridIndex {
  const index = new UniformGridIndex(Math.max(1e-4, cellSize));
  const wantVerts = options?.vertices !== false;
  const wantEdges = options?.edges !== false;
  const wantFaces = options?.faceCentres !== false;

  if (wantVerts) {
    for (const vertex of mesh.vertices.values()) {
      index.insert({
        kind: 'vertex',
        id: vertex.id,
        position: transformPoint(vertex.position, transform),
      });
    }
  }

  if (wantEdges) {
    for (const edge of mesh.edges.values()) {
      const pair = getEdgeVertices(mesh, edge.id);
      if (!pair) continue;
      const a = transformPoint(mesh.vertices.get(pair[0])!.position, transform);
      const b = transformPoint(mesh.vertices.get(pair[1])!.position, transform);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
      index.insert({ kind: 'edgeMid', id: edge.id, position: mid });
      index.insertSegment({ kind: 'edge', id: edge.id, a, b, position: mid });
    }
  }

  if (wantFaces) {
    for (const face of mesh.faces.values()) {
      const ids = faceVertexIds(mesh, face.id);
      if (!ids.length) continue;
      const centre = ids.reduce(
        (sum, id) => {
          const p = transformPoint(mesh.vertices.get(id)!.position, transform);
          return {
            x: sum.x + p.x / ids.length,
            y: sum.y + p.y / ids.length,
            z: sum.z + p.z / ids.length,
          };
        },
        { x: 0, y: 0, z: 0 },
      );
      index.insert({ kind: 'faceCentre', id: face.id, position: centre });
    }
  }

  return index;
}

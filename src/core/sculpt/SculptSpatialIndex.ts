import type { Vec3 } from '@/core/math/Vec3';
import type { EditableMesh, VertexId } from '@/core/mesh/types';

/**
 * 3D Spatial hash grid to accelerate radial vertex queries (radius search)
 * from O(N) to O(k) during brush strokes.
 */
export class SculptSpatialIndex {
  private cellSize: number = 0.2;
  private invCellSize: number = 5.0;
  private grid = new Map<string, VertexId[]>();
  private meshId: string = '';
  private topologyVersion: number = -1;

  constructor(cellSize: number = 0.2) {
    this.setCellSize(cellSize);
  }

  setCellSize(size: number): void {
    this.cellSize = Math.max(0.01, size);
    this.invCellSize = 1 / this.cellSize;
  }

  private cellKey(ix: number, iy: number, iz: number): string {
    return `${ix},${iy},${iz}`;
  }

  build(mesh: EditableMesh, targetCellSize?: number): void {
    this.meshId = mesh.id;
    this.topologyVersion = mesh.topologyVersion;
    this.grid.clear();

    if (targetCellSize) {
      this.setCellSize(targetCellSize);
    } else if (mesh.vertices.size > 0) {
      // Estimate reasonable cell size from mesh bounding box
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const vertex of mesh.vertices.values()) {
        const { x, y, z } = vertex.position;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
      }
      const maxSpan = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
      // Roughly 16-32 cells across max span
      const estimated = Math.max(0.02, maxSpan / 24);
      this.setCellSize(estimated);
    }

    for (const [id, vertex] of mesh.vertices) {
      const ix = Math.floor(vertex.position.x * this.invCellSize);
      const iy = Math.floor(vertex.position.y * this.invCellSize);
      const iz = Math.floor(vertex.position.z * this.invCellSize);
      const key = this.cellKey(ix, iy, iz);
      let list = this.grid.get(key);
      if (!list) {
        list = [];
        this.grid.set(key, list);
      }
      list.push(id);
    }
  }

  ensure(mesh: EditableMesh, radius?: number): void {
    if (this.meshId !== mesh.id || this.topologyVersion !== mesh.topologyVersion) {
      this.build(mesh, radius ? Math.max(0.05, radius) : undefined);
    } else if (radius && (radius > this.cellSize * 4 || radius < this.cellSize * 0.25)) {
      // If brush radius is drastically different from current cell size, rebuild
      this.build(mesh, Math.max(0.05, radius));
    }
  }

  querySphere(mesh: EditableMesh, center: Vec3, radius: number): { id: VertexId; distance: number }[] {
    this.ensure(mesh, radius);

    // If mesh is tiny, fallback to direct filter to avoid overhead
    if (mesh.vertices.size < 120) {
      const result: { id: VertexId; distance: number }[] = [];
      const r2 = radius * radius;
      for (const [id, vertex] of mesh.vertices) {
        const dx = vertex.position.x - center.x;
        const dy = vertex.position.y - center.y;
        const dz = vertex.position.z - center.z;
        const dist2 = dx * dx + dy * dy + dz * dz;
        if (dist2 <= r2) {
          result.push({ id, distance: Math.sqrt(dist2) });
        }
      }
      return result;
    }

    const minX = Math.floor((center.x - radius) * this.invCellSize);
    const maxX = Math.floor((center.x + radius) * this.invCellSize);
    const minY = Math.floor((center.y - radius) * this.invCellSize);
    const maxY = Math.floor((center.y + radius) * this.invCellSize);
    const minZ = Math.floor((center.z - radius) * this.invCellSize);
    const maxZ = Math.floor((center.z + radius) * this.invCellSize);

    const r2 = radius * radius;
    const result: { id: VertexId; distance: number }[] = [];
    const visited = new Set<VertexId>();

    for (let ix = minX; ix <= maxX; ix++) {
      for (let iy = minY; iy <= maxY; iy++) {
        for (let iz = minZ; iz <= maxZ; iz++) {
          const list = this.grid.get(this.cellKey(ix, iy, iz));
          if (!list) continue;
          for (const id of list) {
            if (visited.has(id)) continue;
            visited.add(id);
            const vertex = mesh.vertices.get(id);
            if (!vertex) continue;
            const dx = vertex.position.x - center.x;
            const dy = vertex.position.y - center.y;
            const dz = vertex.position.z - center.z;
            const dist2 = dx * dx + dy * dy + dz * dz;
            if (dist2 <= r2) {
              result.push({ id, distance: Math.sqrt(dist2) });
            }
          }
        }
      }
    }

    return result;
  }
}

const spatialIndexCache = new Map<string, SculptSpatialIndex>();

export function getOrCreateSpatialIndex(mesh: EditableMesh): SculptSpatialIndex {
  let index = spatialIndexCache.get(mesh.id);
  if (!index) {
    index = new SculptSpatialIndex();
    spatialIndexCache.set(mesh.id, index);
  }
  return index;
}

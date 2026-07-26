import { v2, type Vec2 } from '@/core/math/Vec2';
import type { Vec3 } from '@/core/math/Vec3';
import { addFace, addVertex, createEmptyMesh } from './EditableMesh';
import { assertMeshValid } from './Validation';
import type { EditableMesh, EdgeId, VertexId } from './types';

type PendingFace = {
  vertexIds: VertexId[];
  uvs?: Vec2[];
  materialSlot?: number;
};

/**
 * Shared primitive construction API.
 * All builders must go through this so topology is consistent.
 */
export class MeshBuilder {
  private mesh: EditableMesh;
  private pending: PendingFace[] = [];
  private validateOnBuild: boolean;

  constructor(name = 'Mesh', validateOnBuild = true) {
    this.mesh = createEmptyMesh(name);
    this.validateOnBuild = validateOnBuild;
  }

  vertex(position: Vec3): VertexId {
    return addVertex(this.mesh, position);
  }

  tri(a: VertexId, b: VertexId, c: VertexId, uvs?: Vec2[], materialSlot = 0): void {
    this.pending.push({ vertexIds: [a, b, c], uvs, materialSlot });
  }

  quad(
    a: VertexId,
    b: VertexId,
    c: VertexId,
    d: VertexId,
    uvs?: Vec2[],
    materialSlot = 0,
  ): void {
    this.pending.push({ vertexIds: [a, b, c, d], uvs, materialSlot });
  }

  ngon(vertexIds: VertexId[], uvs?: Vec2[], materialSlot = 0): void {
    this.pending.push({ vertexIds: [...vertexIds], uvs, materialSlot });
  }

  setMaterialSlotCount(count: number): void {
    this.mesh.materialSlotCount = Math.max(1, count);
  }

  setName(name: string): void {
    this.mesh.name = name;
  }

  build(): EditableMesh {
    const edgeLookup = new Map<string, EdgeId>();

    for (const face of this.pending) {
      addFace(this.mesh, face.vertexIds, {
        materialSlot: face.materialSlot,
        uvs: face.uvs,
        edgeLookup,
      });
    }

    if (this.validateOnBuild) {
      assertMeshValid(this.mesh, true);
    }
    return this.mesh;
  }
}

/** Default box UVs per face (unit square). */
export function unitQuadUVs(): Vec2[] {
  return [v2(0, 0), v2(1, 0), v2(1, 1), v2(0, 1)];
}

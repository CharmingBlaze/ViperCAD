import type { EditableMesh } from '@/core/mesh/types';
import { bumpPositions, faceCornerIds } from '@/core/mesh/EditableMesh';
import { dotVec3, type Vec3 } from '@/core/math/Vec3';

export type TerrainTextureLayer = 'grass' | 'dirt' | 'rock' | 'sand' | 'snow' | 'asphalt' | 'cobblestone';

export type AutoPaintRules = {
  flatMaxAngleDeg?: number; // e.g. < 20° -> Grass
  slopeMaxAngleDeg?: number; // e.g. < 35° -> Dirt
  cliffMinAngleDeg?: number; // e.g. > 35° -> Rock/Cliff
  snowMinHeight?: number; // e.g. > 8.0 Y -> Snow
  beachMaxHeight?: number; // e.g. < 0.5 Y -> Sand
};

/** Calculates face normal vector. */
function faceNormal(mesh: EditableMesh, faceId: string): Vec3 {
  const corners = faceCornerIds(mesh, faceId);
  if (corners.length < 3) return { x: 0, y: 1, z: 0 };
  const p0 = mesh.vertices.get(mesh.faceCorners.get(corners[0]!)!.vertexId)!.position;
  const p1 = mesh.vertices.get(mesh.faceCorners.get(corners[1]!)!.vertexId)!.position;
  const p2 = mesh.vertices.get(mesh.faceCorners.get(corners[2]!)!.vertexId)!.position;

  const ax = p1.x - p0.x, ay = p1.y - p0.y, az = p1.z - p0.z;
  const bx = p2.x - p0.x, by = p2.y - p0.y, bz = p2.z - p0.z;

  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;

  const len = Math.hypot(nx, ny, nz);
  return len > 1e-6 ? { x: nx / len, y: ny / len, z: nz / len } : { x: 0, y: 1, z: 0 };
}

/** Automatically assigns texture layer coordinates based on slope angle and altitude. */
export function autoPaintTerrainMesh(
  mesh: EditableMesh,
  rules: AutoPaintRules = {},
): number {
  const layerId = mesh.defaultUvLayerId;
  if (!layerId) return 0;

  const flatMaxCos = Math.cos(((rules.flatMaxAngleDeg ?? 20) * Math.PI) / 180);
  const cliffMinCos = Math.cos(((rules.cliffMinAngleDeg ?? 38) * Math.PI) / 180);
  const snowY = rules.snowMinHeight ?? 7.5;
  const beachY = rules.beachMaxHeight ?? 0.4;

  let painted = 0;

  // Layer UV offsets on atlas: Grass=(0,0), Dirt=(0.25,0), Rock=(0.5,0), Snow=(0.75,0), Sand=(0,0.5)
  for (const face of mesh.faces.values()) {
    const normal = faceNormal(mesh, face.id);
    const upDot = dotVec3(normal, { x: 0, y: 1, z: 0 });

    // Calculate average face Y altitude
    let avgY = 0;
    const cornerIds = faceCornerIds(mesh, face.id);
    for (const cid of cornerIds) {
      const corner = mesh.faceCorners.get(cid)!;
      const vertex = mesh.vertices.get(corner.vertexId)!;
      avgY += vertex.position.y;
    }
    avgY /= Math.max(1, cornerIds.length);

    let layerOffsetU = 0;
    let layerOffsetV = 0;

    if (avgY >= snowY && upDot >= flatMaxCos) {
      // Mountain Peak -> Snow
      layerOffsetU = 0.75;
      layerOffsetV = 0;
    } else if (upDot < cliffMinCos) {
      // Steep Cliff -> Rock
      layerOffsetU = 0.5;
      layerOffsetV = 0;
    } else if (avgY <= beachY && upDot >= flatMaxCos) {
      // Low Coastline -> Sand
      layerOffsetU = 0;
      layerOffsetV = 0.5;
    } else if (upDot < flatMaxCos) {
      // Slope -> Dirt
      layerOffsetU = 0.25;
      layerOffsetV = 0;
    } else {
      // Flat Ground -> Grass
      layerOffsetU = 0;
      layerOffsetV = 0;
    }

    for (const cid of cornerIds) {
      const corner = mesh.faceCorners.get(cid)!;
      const uv = corner.uvs.get(layerId) ?? { x: 0, y: 0 };
      corner.uvs.set(layerId, {
        x: (uv.x % 0.25) + layerOffsetU,
        y: (uv.y % 0.25) + layerOffsetV,
      });
    }
    painted += 1;
  }

  bumpPositions(mesh);
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
  return painted;
}

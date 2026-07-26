import { v2, type Vec2 } from '@/core/math/Vec2';
import { addVec3, scaleVec3, type Vec3 } from '@/core/math/Vec3';
import {
  addFace,
  addVertex,
  buildEdgeLookup,
  cloneMeshPreserveIds,
  faceCornerIds,
  faceVertexIds,
  removeFace,
} from '@/core/mesh/EditableMesh';
import type { AtlasTileRect, EditableMesh, FaceId, UvLayerId, VertexId } from '@/core/mesh/types';

/**
 * Clone a mesh and bake viewport-only atlas tile wraps into standard UVs/geometry.
 * glTF / Blender cannot run the WebGL fract() tile wrap shader, so expanded repeat
 * UVs must become real faces with UVs inside each tile rect.
 */
export function bakeAtlasTilesForExport(mesh: EditableMesh): EditableMesh {
  const out = cloneMeshPreserveIds(mesh);
  const faceIds = [...out.faces.keys()].filter((faceId) => faceHasAtlasTile(out, faceId));
  for (const faceId of faceIds) {
    bakeFaceAtlasTile(out, faceId);
  }
  return out;
}

export function faceHasAtlasTile(mesh: EditableMesh, faceId: FaceId): boolean {
  return faceCornerIds(mesh, faceId).some((id) => {
    const tile = mesh.faceCorners.get(id)?.atlasTile;
    return !!tile && tile.maxU - tile.minU > 1e-8 && tile.maxV - tile.minV > 1e-8;
  });
}

function bakeFaceAtlasTile(mesh: EditableMesh, faceId: FaceId): void {
  const cornerIds = faceCornerIds(mesh, faceId);
  const tile = cornerIds.map((id) => mesh.faceCorners.get(id)?.atlasTile).find((t) => t) ?? null;
  if (!tile) return;

  const layerId = mesh.defaultUvLayerId;
  if (!layerId || cornerIds.length < 3) {
    clearAtlasTile(mesh, cornerIds);
    return;
  }

  const spanU = tile.maxU - tile.minU;
  const spanV = tile.maxV - tile.minV;
  if (spanU <= 1e-8 || spanV <= 1e-8) {
    clearAtlasTile(mesh, cornerIds);
    return;
  }

  const locals = cornerIds.map((id) => {
    const uv = mesh.faceCorners.get(id)!.uvs.get(layerId) ?? { x: 0, y: 0 };
    return {
      u: (uv.x - tile.minU) / spanU,
      v: (uv.y - tile.minV) / spanV,
    };
  });
  const minLU = Math.min(...locals.map((l) => l.u));
  const maxLU = Math.max(...locals.map((l) => l.u));
  const minLV = Math.min(...locals.map((l) => l.v));
  const maxLV = Math.max(...locals.map((l) => l.v));
  const repeatU = Math.max(1, Math.min(64, Math.round(maxLU - minLU)));
  const repeatV = Math.max(1, Math.min(64, Math.round(maxLV - minLV)));

  if (cornerIds.length === 4 && (repeatU > 1 || repeatV > 1)) {
    subdivideQuadAtlasTile(mesh, faceId, tile, repeatU, repeatV, minLU, minLV, locals);
    return;
  }

  wrapCornersIntoTile(mesh, cornerIds, tile);
}

function wrapCornersIntoTile(mesh: EditableMesh, cornerIds: string[], tile: AtlasTileRect): void {
  const spanU = tile.maxU - tile.minU;
  const spanV = tile.maxV - tile.minV;
  const layerId = mesh.defaultUvLayerId;
  for (const id of cornerIds) {
    const corner = mesh.faceCorners.get(id);
    if (!corner) continue;
    if (layerId) {
      const uv = corner.uvs.get(layerId);
      if (uv) {
        corner.uvs.set(layerId, {
          x: wrapIntoRange(uv.x, tile.minU, spanU),
          y: wrapIntoRange(uv.y, tile.minV, spanV),
        });
      }
    }
    corner.atlasTile = null;
  }
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
}

function clearAtlasTile(mesh: EditableMesh, cornerIds: string[]): void {
  for (const id of cornerIds) {
    const corner = mesh.faceCorners.get(id);
    if (corner) corner.atlasTile = null;
  }
}

/** Wrap value into [min, min+span) like GLSL fract (exact integers → low edge). */
export function wrapIntoRange(value: number, min: number, span: number): number {
  if (span <= 1e-12) return min;
  let t = (value - min) / span;
  t -= Math.floor(t);
  if (t < 0) t += 1;
  if (t > 1 - 1e-7) t = 0;
  return min + t * span;
}

function subdivideQuadAtlasTile(
  mesh: EditableMesh,
  faceId: FaceId,
  tile: AtlasTileRect,
  repeatU: number,
  repeatV: number,
  minLU: number,
  minLV: number,
  locals: { u: number; v: number }[],
): void {
  const face = mesh.faces.get(faceId);
  if (!face) return;
  const cornerIds = faceCornerIds(mesh, faceId);
  const vertexIds = faceVertexIds(mesh, faceId);
  if (cornerIds.length !== 4 || vertexIds.length !== 4) {
    wrapCornersIntoTile(mesh, cornerIds, tile);
    return;
  }

  const layerId = mesh.defaultUvLayerId!;
  const spanU = tile.maxU - tile.minU;
  const spanV = tile.maxV - tile.minV;
  const corners = cornerIds.map((id, index) => {
    const uv = mesh.faceCorners.get(id)!.uvs.get(layerId) ?? { x: 0, y: 0 };
    return {
      vertexId: vertexIds[index]!,
      localU: (uv.x - tile.minU) / spanU,
      localV: (uv.y - tile.minV) / spanV,
      uvs: snapshotCornerUvs(mesh, id),
      position: mesh.vertices.get(vertexIds[index]!)!.position,
    };
  });

  const pick = (targetU: number, targetV: number) =>
    corners.reduce((best, corner) => {
      const bestDist = (best.localU - targetU) ** 2 + (best.localV - targetV) ** 2;
      const dist = (corner.localU - targetU) ** 2 + (corner.localV - targetV) ** 2;
      return dist < bestDist ? corner : best;
    });

  const bl = pick(minLU, minLV);
  const br = pick(minLU + repeatU, minLV);
  const tr = pick(minLU + repeatU, minLV + repeatV);
  const tl = pick(minLU, minLV + repeatV);

  // Preserve original face winding in UV space (avoid flipped normals after bake).
  let uvArea = 0;
  for (let i = 0; i < locals.length; i++) {
    const a = locals[i]!;
    const b = locals[(i + 1) % locals.length]!;
    uvArea += a.u * b.v - b.u * a.v;
  }
  const ccwInUv = uvArea >= 0;

  const grid: VertexId[][] = [];
  const gridLayerUvs: Map<UvLayerId, Vec2>[][] = [];
  for (let j = 0; j <= repeatV; j++) {
    const row: VertexId[] = [];
    const uvRow: Map<UvLayerId, Vec2>[] = [];
    const t = j / repeatV;
    for (let i = 0; i <= repeatU; i++) {
      const s = i / repeatU;
      if (i === 0 && j === 0) {
        row.push(bl.vertexId);
        uvRow.push(cloneUvMap(bl.uvs));
      } else if (i === repeatU && j === 0) {
        row.push(br.vertexId);
        uvRow.push(cloneUvMap(br.uvs));
      } else if (i === repeatU && j === repeatV) {
        row.push(tr.vertexId);
        uvRow.push(cloneUvMap(tr.uvs));
      } else if (i === 0 && j === repeatV) {
        row.push(tl.vertexId);
        uvRow.push(cloneUvMap(tl.uvs));
      } else {
        const position = bilinearVec3(bl.position, br.position, tl.position, tr.position, s, t);
        row.push(addVertex(mesh, position));
        uvRow.push(bilinearUvMaps(bl.uvs, br.uvs, tl.uvs, tr.uvs, s, t));
      }
    }
    grid.push(row);
    gridLayerUvs.push(uvRow);
  }

  const materialSlot = face.materialSlot;
  const flatShaded = face.flatShaded;
  removeFace(mesh, faceId);
  const edgeLookup = buildEdgeLookup(mesh);

  for (let j = 0; j < repeatV; j++) {
    for (let i = 0; i < repeatU; i++) {
      const verts = ccwInUv
        ? [grid[j]![i]!, grid[j]![i + 1]!, grid[j + 1]![i + 1]!, grid[j + 1]![i]!]
        : [grid[j]![i]!, grid[j + 1]![i]!, grid[j + 1]![i + 1]!, grid[j]![i + 1]!];
      const uvs: Vec2[] = ccwInUv
        ? [v2(tile.minU, tile.minV), v2(tile.maxU, tile.minV), v2(tile.maxU, tile.maxV), v2(tile.minU, tile.maxV)]
        : [v2(tile.minU, tile.minV), v2(tile.minU, tile.maxV), v2(tile.maxU, tile.maxV), v2(tile.maxU, tile.minV)];
      const cellUvMaps = ccwInUv
        ? [
            gridLayerUvs[j]![i]!,
            gridLayerUvs[j]![i + 1]!,
            gridLayerUvs[j + 1]![i + 1]!,
            gridLayerUvs[j + 1]![i]!,
          ]
        : [
            gridLayerUvs[j]![i]!,
            gridLayerUvs[j + 1]![i]!,
            gridLayerUvs[j + 1]![i + 1]!,
            gridLayerUvs[j]![i + 1]!,
          ];
      const added = addFace(mesh, verts, {
        materialSlot,
        flatShaded,
        uvs,
        edgeLookup,
      });
      const newCorners = faceCornerIds(mesh, added.faceId);
      for (let c = 0; c < newCorners.length; c++) {
        const corner = mesh.faceCorners.get(newCorners[c]!)!;
        corner.atlasTile = null;
        for (const [otherLayer, uv] of cellUvMaps[c]!) {
          if (otherLayer !== layerId) corner.uvs.set(otherLayer, { ...uv });
        }
        corner.uvs.set(layerId, uvs[c]!);
      }
    }
  }
  mesh.geometryVersion += 1;
  mesh.topologyVersion += 1;
  mesh.dirty.topology = true;
  mesh.dirty.uvs = true;
}

function snapshotCornerUvs(mesh: EditableMesh, cornerId: string): Map<UvLayerId, Vec2> {
  const corner = mesh.faceCorners.get(cornerId)!;
  const map = new Map<UvLayerId, Vec2>();
  for (const [layerId, uv] of corner.uvs) map.set(layerId, { x: uv.x, y: uv.y });
  return map;
}

function cloneUvMap(map: Map<UvLayerId, Vec2>): Map<UvLayerId, Vec2> {
  const out = new Map<UvLayerId, Vec2>();
  for (const [layerId, uv] of map) out.set(layerId, { x: uv.x, y: uv.y });
  return out;
}

function bilinearVec3(bl: Vec3, br: Vec3, tl: Vec3, tr: Vec3, s: number, t: number): Vec3 {
  const bottom = addVec3(scaleVec3(bl, 1 - s), scaleVec3(br, s));
  const top = addVec3(scaleVec3(tl, 1 - s), scaleVec3(tr, s));
  return addVec3(scaleVec3(bottom, 1 - t), scaleVec3(top, t));
}

function bilinearUvMaps(
  bl: Map<UvLayerId, Vec2>,
  br: Map<UvLayerId, Vec2>,
  tl: Map<UvLayerId, Vec2>,
  tr: Map<UvLayerId, Vec2>,
  s: number,
  t: number,
): Map<UvLayerId, Vec2> {
  const layers = new Set<UvLayerId>([...bl.keys(), ...br.keys(), ...tl.keys(), ...tr.keys()]);
  const out = new Map<UvLayerId, Vec2>();
  for (const layerId of layers) {
    const a = bl.get(layerId) ?? { x: 0, y: 0 };
    const b = br.get(layerId) ?? { x: 0, y: 0 };
    const c = tl.get(layerId) ?? { x: 0, y: 0 };
    const d = tr.get(layerId) ?? { x: 0, y: 0 };
    const bottom = { x: a.x * (1 - s) + b.x * s, y: a.y * (1 - s) + b.y * s };
    const top = { x: c.x * (1 - s) + d.x * s, y: c.y * (1 - s) + d.y * s };
    out.set(layerId, {
      x: bottom.x * (1 - t) + top.x * t,
      y: bottom.y * (1 - t) + top.y * t,
    });
  }
  return out;
}

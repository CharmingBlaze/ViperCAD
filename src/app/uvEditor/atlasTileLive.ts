import type { EditableMesh, FaceCornerId, FaceId } from '@/core/mesh/types';
import type { UvSnapshot } from '@/core/uv/UvEdit';
import type { TextureWorkspaceState } from '@/workspace/TextureWorkspace';

export type AtlasTileRect = { minU: number; minV: number; maxU: number; maxV: number };

/** Live atlas UV stamp: UV snapshot only (no mesh clone / subdivision). */
export type LiveAtlasTileSession = {
  objectId: string;
  meshId: string;
  layerId: string;
  faceIds: FaceId[];
  before: UvSnapshot;
  beforeTiles: Map<FaceCornerId, AtlasTileRect | null>;
  sourceSelectionKey: string;
  paramsKey: string;
  dirty: boolean;
};

export type AtlasTilePlacementInput = {
  imageWidth: number;
  imageHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  padding: number;
  quarterTurns: 0 | 1 | 2 | 3;
  flipU: boolean;
  flipV: boolean;
  repeatU: number;
  repeatV: number;
};

export function buildAtlasTilePlacement(
  tex: TextureWorkspaceState,
  image: { width: number; height: number } | null | undefined,
): AtlasTilePlacementInput | null {
  if (!image) return null;
  return {
    imageWidth: image.width,
    imageHeight: image.height,
    x: tex.atlasTileX,
    y: tex.atlasTileY,
    width: tex.atlasTileWidth * tex.atlasSelectionColumns + tex.atlasMarginX * (tex.atlasSelectionColumns - 1),
    height: tex.atlasTileHeight * tex.atlasSelectionRows + tex.atlasMarginY * (tex.atlasSelectionRows - 1),
    padding: tex.atlasPadding,
    quarterTurns: tex.atlasQuarterTurns,
    flipU: tex.atlasFlipU,
    flipV: tex.atlasFlipV,
    repeatU: tex.atlasRepeatU,
    repeatV: tex.atlasRepeatV,
  };
}

export function buildAtlasTileParamsKey(
  tex: TextureWorkspaceState,
  imageId: string,
): string {
  return [
    imageId,
    tex.atlasTileX,
    tex.atlasTileY,
    tex.atlasTileWidth,
    tex.atlasTileHeight,
    tex.atlasSelectionColumns,
    tex.atlasSelectionRows,
    tex.atlasMarginX,
    tex.atlasMarginY,
    tex.atlasPadding,
    tex.atlasQuarterTurns,
    tex.atlasFlipU ? 1 : 0,
    tex.atlasFlipV ? 1 : 0,
    tex.atlasRepeatU,
    tex.atlasRepeatV,
  ].join('|');
}

export function snapshotAtlasTiles(
  mesh: EditableMesh,
  cornerIds: Iterable<FaceCornerId>,
): Map<FaceCornerId, AtlasTileRect | null> {
  const snap = new Map<FaceCornerId, AtlasTileRect | null>();
  for (const id of cornerIds) {
    const tile = mesh.faceCorners.get(id)?.atlasTile;
    snap.set(id, tile ? { ...tile } : null);
  }
  return snap;
}

export function applyAtlasTileSnapshot(
  mesh: EditableMesh,
  snapshot: Map<FaceCornerId, AtlasTileRect | null>,
): void {
  for (const [id, tile] of snapshot) {
    const corner = mesh.faceCorners.get(id);
    if (corner) corner.atlasTile = tile ? { ...tile } : null;
  }
}

export function restoreUvAndAtlasSnapshot(
  mesh: EditableMesh,
  layerId: string,
  snapshot: UvSnapshot,
  tiles: Map<FaceCornerId, AtlasTileRect | null>,
): void {
  for (const [cornerId, uv] of snapshot) {
    const corner = mesh.faceCorners.get(cornerId);
    if (corner) corner.uvs.set(layerId, { x: uv.x, y: uv.y });
  }
  applyAtlasTileSnapshot(mesh, tiles);
  mesh.geometryVersion += 1;
  mesh.dirty.uvs = true;
}

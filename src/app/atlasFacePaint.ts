import type { EditorSession } from '@/core/editor/EditorSession';
import type { ObjectId } from '@/core/document/types';
import { faceCornerIds } from '@/core/mesh/EditableMesh';
import type { EdgeId, FaceId } from '@/core/mesh/types';
import { inverseTransformPointApprox } from '@/core/math/Transform';
import type { Vec3 } from '@/core/math/Vec3';
import { applyAtlasTileToFaces, autoDownEdgeId, closestFaceEdgeId } from '@/core/uv/AtlasUv';
import { snapshotUvs, type UvSnapshot } from '@/core/uv/UvEdit';
import { resolveActiveTexture } from '@/core/texture/resolveActiveTexture';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import {
  applyAtlasTileSnapshot,
  buildAtlasTilePlacement,
  restoreUvAndAtlasSnapshot,
  snapshotAtlasTiles,
  type AtlasTileRect,
} from '@/app/uvEditor/atlasTileLive';
import { rememberAtlasStamp } from '@/app/tilesetWorkspace';

type PaintStroke = {
  objectId: ObjectId;
  meshId: string;
  layerId: string;
  before: UvSnapshot;
  beforeTiles: Map<string, AtlasTileRect | null>;
  painted: Set<string>;
};

let stroke: PaintStroke | null = null;

function activeLayerId(session: EditorSession, workspace: WorkspaceController, meshId: string): string | null {
  const mesh = session.document.meshes.get(meshId);
  if (!mesh) return null;
  return workspace.texture.activeUvLayerId && mesh.uvLayers.has(workspace.texture.activeUvLayerId)
    ? workspace.texture.activeUvLayerId
    : mesh.defaultUvLayerId;
}

function resolveDownEdge(
  session: EditorSession,
  workspace: WorkspaceController,
  mesh: NonNullable<ReturnType<EditorSession['document']['meshes']['get']>>,
  faceId: FaceId,
  localPoint?: Vec3,
): EdgeId | undefined {
  if (!workspace.texture.atlasHintDown) return undefined;
  const selected = [...session.selection.state.selectedEdgeIds].find((id) => {
    const heIds = [...mesh.halfEdges.values()].filter((he) => he.edgeId === id && he.faceId === faceId);
    return heIds.length > 0;
  });
  if (selected) return selected;
  if (localPoint) return closestFaceEdgeId(mesh, faceId, localPoint) ?? autoDownEdgeId(mesh, faceId) ?? undefined;
  return autoDownEdgeId(mesh, faceId) ?? undefined;
}

export function paintAtlasFace(
  session: EditorSession,
  workspace: WorkspaceController,
  objectId: ObjectId,
  faceId: FaceId,
  options?: { localPoint?: Vec3 },
): boolean {
  const object = session.document.objects.get(objectId);
  const mesh = object?.meshId ? session.document.meshes.get(object.meshId) : null;
  if (!object || !mesh || !mesh.faces.has(faceId)) return false;
  const ctx = resolveActiveTexture(session.document, session.selection.state);
  const imageId = workspace.texture.activeImageId ?? ctx.imageId;
  const image = imageId ? session.document.images.get(imageId) : null;
  const placement = buildAtlasTilePlacement(workspace.texture, image);
  const layerId = activeLayerId(session, workspace, mesh.id);
  if (!placement || !image || !layerId) return false;

  const key = `${objectId}:${faceId}`;
  if (stroke && (stroke.objectId !== objectId || stroke.meshId !== mesh.id)) {
    endAtlasFacePaintStroke(session);
  }
  if (stroke?.painted.has(key)) return false;

  if (!stroke) {
    stroke = {
      objectId,
      meshId: mesh.id,
      layerId,
      before: new Map(),
      beforeTiles: new Map(),
      painted: new Set(),
    };
  }

  const corners = faceCornerIds(mesh, faceId);
  for (const [id, uv] of snapshotUvs(mesh, corners, layerId)) {
    if (!stroke.before.has(id)) stroke.before.set(id, uv);
  }
  for (const [id, tile] of snapshotAtlasTiles(mesh, corners)) {
    if (!stroke.beforeTiles.has(id)) stroke.beforeTiles.set(id, tile);
  }

  applyAtlasTileToFaces(mesh, [faceId], layerId, {
    ...placement,
    downEdgeId: resolveDownEdge(session, workspace, mesh, faceId, options?.localPoint),
  });
  stroke.painted.add(key);
  object.metadata.atlasTileSize = `${workspace.texture.atlasTileWidth}x${workspace.texture.atlasTileHeight}`;
  object.metadata.atlasImage = image.name;
  session.document.dirty = true;
  session.selection.setMode('face');
  session.selection.selectObjects([objectId], 'replace');
  session.selection.selectFaces([faceId], 'replace');
  session.requestRedraw();
  return true;
}

export function pickAtlasTileFromFace(
  session: EditorSession,
  workspace: WorkspaceController,
  objectId: ObjectId,
  faceId: FaceId,
): boolean {
  const object = session.document.objects.get(objectId);
  const mesh = object?.meshId ? session.document.meshes.get(object.meshId) : null;
  const ctx = resolveActiveTexture(session.document, session.selection.state);
  const imageId = workspace.texture.activeImageId ?? ctx.imageId;
  const image = imageId ? session.document.images.get(imageId) : null;
  const layerId = mesh ? activeLayerId(session, workspace, mesh.id) : null;
  if (!mesh || !image || !layerId || !mesh.faces.has(faceId)) return false;
  const corners = faceCornerIds(mesh, faceId);
  const uvs = corners.map((id) => mesh.faceCorners.get(id)?.uvs.get(layerId)).filter(Boolean) as { x: number; y: number }[];
  if (!uvs.length) return false;
  const minU = Math.min(...uvs.map((uv) => uv.x));
  const maxU = Math.max(...uvs.map((uv) => uv.x));
  const minV = Math.min(...uvs.map((uv) => uv.y));
  const maxV = Math.max(...uvs.map((uv) => uv.y));
  const tex = workspace.texture;
  const stepX = tex.atlasTileWidth + tex.atlasMarginX;
  const stepY = tex.atlasTileHeight + tex.atlasMarginY;
  const pixelLeft = minU * image.width;
  const pixelTop = (1 - maxV) * image.height;
  const tileX = tex.atlasOffsetX + Math.round((pixelLeft - tex.atlasOffsetX) / stepX) * stepX;
  const tileY = tex.atlasOffsetY + Math.round((pixelTop - tex.atlasOffsetY) / stepY) * stepY;
  workspace.patchTexture({
    atlasTileX: Math.max(tex.atlasOffsetX, Math.min(image.width - tex.atlasTileWidth, tileX)),
    atlasTileY: Math.max(tex.atlasOffsetY, Math.min(image.height - tex.atlasTileHeight, tileY)),
    atlasSelectionColumns: Math.max(1, Math.round(((maxU - minU) * image.width + tex.atlasMarginX) / stepX)),
    atlasSelectionRows: Math.max(1, Math.round(((maxV - minV) * image.height + tex.atlasMarginY) / stepY)),
    uvPanelTab: 'tiles',
  });
  rememberAtlasStamp(workspace);
  session.selection.setMode('face');
  session.selection.selectObjects([objectId], 'replace');
  session.selection.selectFaces([faceId], 'replace');
  session.requestRedraw();
  return true;
}

export function endAtlasFacePaintStroke(session: EditorSession): boolean {
  const live = stroke;
  stroke = null;
  if (!live || !live.painted.size || !live.before.size) return false;
  const object = session.document.objects.get(live.objectId);
  const mesh = object?.meshId ? session.document.meshes.get(object.meshId) : null;
  if (!mesh || mesh.id !== live.meshId) return false;
  const after = snapshotUvs(mesh, live.before.keys(), live.layerId);
  const afterTiles = snapshotAtlasTiles(mesh, live.before.keys());
  const before = live.before;
  const beforeTiles = live.beforeTiles;
  let applied = true;
  session.history.execute({
    name: live.painted.size > 1 ? 'Paint Atlas Tiles' : 'Paint Atlas Tile',
    execute: () => {
      if (applied) return;
      for (const [cornerId, uv] of after) {
        const corner = mesh.faceCorners.get(cornerId);
        if (corner) corner.uvs.set(live.layerId, { x: uv.x, y: uv.y });
      }
      applyAtlasTileSnapshot(mesh, afterTiles);
      mesh.geometryVersion += 1;
      mesh.dirty.uvs = true;
      applied = true;
      session.requestRedraw();
    },
    undo: () => {
      restoreUvAndAtlasSnapshot(mesh, live.layerId, before, beforeTiles);
      applied = false;
      session.requestRedraw();
    },
  });
  return true;
}

export function localPointOnObject(
  session: EditorSession,
  objectId: ObjectId,
  worldPoint: Vec3,
): Vec3 | undefined {
  const object = session.document.objects.get(objectId);
  if (!object) return undefined;
  return inverseTransformPointApprox(worldPoint, object.transform);
}

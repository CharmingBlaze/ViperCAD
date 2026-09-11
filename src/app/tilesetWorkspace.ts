import { createMaterial } from '@/core/document/ModelDocument';
import { resolveActiveTexture } from '@/core/texture/resolveActiveTexture';
import { activeTerrain } from '@/core/terrain/Terrain';
import { createImageAssetFromPixels, createTextureAsset } from '@/core/image/PixelEditor';
import { DEFAULT_PLACEHOLDER_IMAGE_NAME } from '@/core/image/DefaultPlaceholderImage';
import { TileDrawTool, type TileDrawMode, type TileDrawShape } from '@/core/tools/TileDrawTool';
import {
  WORLD_XY_PLANE,
  WORLD_XZ_PLANE,
  WORLD_YZ_PLANE,
  constructionPlaneThrough,
} from '@/core/snap/SnapEngine';
import { addVec3, lengthSqVec3, scaleVec3, subVec3 } from '@/core/math/Vec3';
import { transformPoint } from '@/core/math/Transform';
import type { EditorSession } from '@/core/editor/EditorSession';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import type { AtlasRecentTile, TextureWorkspaceState } from '@/workspace/TextureWorkspace';

export const TILE_DRAW_MODE_HOTKEYS: Record<string, TileDrawMode> = {
  b: 'paint',
  x: 'erase',
  r: 'replace',
  i: 'pick',
  f: 'fill',
};

export const TILE_DRAW_PLANE_HOTKEYS: Record<string, TextureWorkspaceState['atlasPlaneOrientation'] | 'surface'> = {
  '1': 'floor',
  '2': 'wall-x',
  '3': 'wall-z',
  '4': 'surface',
};

export const TILE_DRAW_SHAPE_HOTKEYS: Record<string, TileDrawShape> = {
  '1': 'single',
  '2': 'stroke',
  '3': 'line',
  '4': 'rectangle',
};

export type TileEditorJob = 'tileset' | 'build' | 'paint';

export function tileEditorJob(
  session: Pick<EditorSession, 'tools'>,
  workspace: Pick<WorkspaceController, 'texture'>,
): TileEditorJob {
  if (session.tools.getActive()?.id === 'tile-draw') return 'build';
  if (workspace.texture.atlasPaintMode && workspace.texture.uvPanelTab === 'tiles') return 'paint';
  return 'tileset';
}

export function tileDrawPlaneLabel(tex: TextureWorkspaceState): string {
  if (tex.atlasUseFacePlane) return tex.atlasSurfaceLocked ? 'Surface locked' : 'Surface';
  if (tex.atlasPlaneOrientation === 'wall-x') return 'Front';
  if (tex.atlasPlaneOrientation === 'wall-z') return 'Side';
  return 'Floor';
}

export function tileDrawPlaneAxis(tex: TextureWorkspaceState): string {
  if (tex.atlasUseFacePlane) return 'Surface';
  if (tex.atlasPlaneOrientation === 'wall-x') return 'XY';
  if (tex.atlasPlaneOrientation === 'wall-z') return 'YZ';
  return 'XZ';
}

export function tileDrawDepthLabel(tex: TextureWorkspaceState): string {
  const depth = Number(tex.atlasPlaneOffset.toFixed(2));
  const layer = Math.round(tex.atlasPlaneOffset / Math.max(0.01, tileDrawCellSize(tex)));
  if (tex.atlasUseFacePlane) return tex.atlasSurfaceLocked ? 'Locked' : 'Hover';
  if (tex.atlasPlaneOrientation === 'wall-x') return `Depth Z ${depth}`;
  if (tex.atlasPlaneOrientation === 'wall-z') return `Depth X ${depth}`;
  return `Layer ${layer}`;
}

export function clampAtlasStamp(
  workspace: WorkspaceController,
  image: { width: number; height: number } | null | undefined,
): void {
  if (!image) return;
  const tex = workspace.texture;
  const tileWidth = Math.min(image.width, Math.max(1, tex.atlasTileWidth));
  const tileHeight = Math.min(image.height, Math.max(1, tex.atlasTileHeight));
  const stepX = tileWidth + Math.max(0, tex.atlasMarginX);
  const stepY = tileHeight + Math.max(0, tex.atlasMarginY);
  const minX = Math.max(0, tex.atlasOffsetX);
  const minY = Math.max(0, tex.atlasOffsetY);
  const maxX = Math.max(minX, image.width - tileWidth);
  const maxY = Math.max(minY, image.height - tileHeight);
  const snappedX = Math.min(maxX, Math.max(minX, minX + Math.round((tex.atlasTileX - minX) / Math.max(1, stepX)) * stepX));
  const snappedY = Math.min(maxY, Math.max(minY, minY + Math.round((tex.atlasTileY - minY) / Math.max(1, stepY)) * stepY));
  const maxColumns = Math.max(1, Math.floor((image.width - snappedX + tex.atlasMarginX) / stepX));
  const maxRows = Math.max(1, Math.floor((image.height - snappedY + tex.atlasMarginY) / stepY));
  if (
    snappedX === tex.atlasTileX &&
    snappedY === tex.atlasTileY &&
    tex.atlasSelectionColumns <= maxColumns &&
    tex.atlasSelectionRows <= maxRows &&
    tileWidth === tex.atlasTileWidth &&
    tileHeight === tex.atlasTileHeight
  ) {
    return;
  }
  workspace.patchTexture({
    atlasTileX: snappedX,
    atlasTileY: snappedY,
    atlasTileWidth: tileWidth,
    atlasTileHeight: tileHeight,
    atlasSelectionColumns: Math.min(tex.atlasSelectionColumns, maxColumns),
    atlasSelectionRows: Math.min(tex.atlasSelectionRows, maxRows),
  });
}

export const ATLAS_TILE_SIZE_PRESETS = [8, 16, 32, 64] as const;

export function setAtlasTileSize(
  workspace: WorkspaceController,
  image: { width: number; height: number } | null | undefined,
  width: number,
  height = width,
): void {
  const maxW = image?.width ?? 4096;
  const maxH = image?.height ?? 4096;
  workspace.patchTexture({
    atlasTileWidth: Math.min(maxW, Math.max(1, Math.round(width) || 1)),
    atlasTileHeight: Math.min(maxH, Math.max(1, Math.round(height) || 1)),
  });
  clampAtlasStamp(workspace, image);
}

export function rememberAtlasStamp(workspace: WorkspaceController): void {
  const tex = workspace.texture;
  const next: AtlasRecentTile = {
    x: tex.atlasTileX,
    y: tex.atlasTileY,
    columns: tex.atlasSelectionColumns,
    rows: tex.atlasSelectionRows,
  };
  const recent = [
    next,
    ...tex.atlasRecentTiles.filter((tile) => tile.x !== next.x || tile.y !== next.y || tile.columns !== next.columns || tile.rows !== next.rows),
  ].slice(0, 8);
  workspace.patchTexture({ atlasRecentTiles: recent });
}

/** Terrain splat stays in the Terrain shell. UV/Paint must show the albedo / atlas. */
export function shouldPreviewTerrainAlbedo(
  workspace: Pick<WorkspaceController, 'shellMode'> | null | undefined,
): boolean {
  return workspace?.shellMode === 'texture';
}

export function tileDrawCellSize(tex: TextureWorkspaceState): number {
  if (tex.atlasUsePixelDensity) {
    return Math.max(0.01, tex.atlasTileHeight / Math.max(1, tex.atlasPixelsPerUnit));
  }
  return Math.max(0.01, tex.atlasPlaneSize);
}

export function applyTerrainTilesetMaterialPreset(session: EditorSession): boolean {
  const terrain = activeTerrain(session);
  if (!terrain) return false;
  const materialId = terrain.object.materialSlotIds[0];
  const material = materialId ? session.document.materials.get(materialId) : null;
  const texture = material?.baseColourTextureId
    ? session.document.textures.get(material.baseColourTextureId)
    : null;
  if (!material || !texture) return false;
  texture.filtering = 'nearest';
  texture.generateMipmaps = false;
  material.textureFiltering = 'nearest';
  session.document.dirty = true;
  return true;
}

function selectObjectFaces(session: EditorSession, objectId: string): boolean {
  const object = session.document.objects.get(objectId);
  const mesh = object?.meshId ? session.document.meshes.get(object.meshId) : null;
  if (!object || !mesh) return false;
  session.tools.setActive('select', session.context());
  session.selection.setMode('face');
  session.selection.selectFaces([...mesh.faces.keys()], 'replace');
  return true;
}

function selectTerrainFaces(session: EditorSession): boolean {
  const terrain = activeTerrain(session);
  if (!terrain) return false;
  return selectObjectFaces(session, terrain.object.id);
}

function bindExistingTileset(
  session: EditorSession,
  workspace: WorkspaceController,
  materialId: string | null | undefined,
  textureId: string | null | undefined,
  imageId: string | null | undefined,
): boolean {
  const material = materialId ? session.document.materials.get(materialId) : null;
  const texture = material?.baseColourTextureId
    ? session.document.textures.get(material.baseColourTextureId)
    : textureId
      ? session.document.textures.get(textureId)
      : null;
  const image = texture
    ? session.document.images.get(texture.imageAssetId)
    : imageId
      ? session.document.images.get(imageId)
      : null;
  if (!material || !texture || !image) return false;
  workspace.patchTexture({
    activeMaterialId: material.id,
    activeTextureId: texture.id,
    activeImageId: image.id,
  });
  clampAtlasStamp(workspace, image);
  return true;
}

export function ensureTilesetMaterial(
  session: EditorSession,
  workspace: WorkspaceController,
): boolean {
  const tex = workspace.texture;
  const ctx = resolveActiveTexture(session.document, session.selection.state);
  if (bindExistingTileset(session, workspace, ctx.materialId, ctx.textureId, ctx.imageId)) {
    return true;
  }
  if (bindExistingTileset(session, workspace, tex.activeMaterialId, tex.activeTextureId, tex.activeImageId)) {
    return true;
  }

  const pixels = buildPlaceholderTilesetPixels();
  const createdImage = createImageAssetFromPixels(session.document, 'Tileset Atlas', 64, 64, pixels);
  const createdTexture = createTextureAsset(session.document, createdImage, 'Tileset Atlas');
  createdTexture.filtering = 'nearest';
  createdTexture.wrapping = 'clamp';
  createdTexture.generateMipmaps = false;
  const object = ctx.objectId ? session.document.objects.get(ctx.objectId) : null;
  const createdMaterial = createMaterial(session.document, {
    name: 'Tileset Material',
    assignToObjectId: object && object.materialSlotIds.length === 0 ? object.id : undefined,
  });
  createdMaterial.baseColourTextureId = createdTexture.id;
  createdMaterial.textureFiltering = 'nearest';
  createdMaterial.textureWrapping = 'clamp';
  createdMaterial.alphaMode = 'mask';
  createdMaterial.alphaCutoff = 0.5;
  createdMaterial.doubleSided = true;
  createdMaterial.shadingModel = 'unlit';
  createdMaterial.unlit = true;
  createdMaterial.roughness = 1;
  createdMaterial.metallic = 0;
  workspace.patchTexture({
    activeMaterialId: createdMaterial.id,
    activeTextureId: createdTexture.id,
    activeImageId: createdImage.id,
    atlasTileWidth: 16,
    atlasTileHeight: 16,
  });
  clampAtlasStamp(workspace, createdImage);
  session.document.dirty = true;
  return true;
}

export function openTerrainAlbedoPaint(
  session: EditorSession,
  workspace: WorkspaceController,
): boolean {
  if (!selectTerrainFaces(session)) return false;
  workspace.patchTexture({
    uvPanelTab: 'paint',
    uvPointerMode: false,
    paintMode3D: true,
    uvInspectorOpen: true,
    maximize: 'none',
    activeRightEditor: 'combined',
  });
  workspace.setShellMode('texture');
  session.requestRedraw();
  return true;
}

export const TILESET_POPUP_WIDTH = 320;

export function isPlaceholderTilesetImage(image: { name: string; width: number; height: number }): boolean {
  return image.name === DEFAULT_PLACEHOLDER_IMAGE_NAME || (image.width <= 8 && image.height <= 8);
}

export function tilesetPopupParkPosition(
  workspace: Pick<WorkspaceController, 'texture'>,
  viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth,
): { x: number; y: number } {
  const inspector = workspace.texture.uvInspectorOpen ? workspace.texture.uvInspectorWidth : 0;
  return {
    x: Math.max(48, viewportWidth - inspector - TILESET_POPUP_WIDTH - 16),
    y: 88,
  };
}

export function tilesetPopupCovers3dView(
  workspace: Pick<WorkspaceController, 'texture'>,
  viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth,
): boolean {
  const inspector = workspace.texture.uvInspectorOpen ? workspace.texture.uvInspectorWidth : 0;
  const modellingWidth = Math.max(320, viewportWidth - inspector);
  const splitX = modellingWidth * workspace.texture.splitRatio;
  return workspace.texture.atlasPanelX + 48 < splitX;
}

/** Keep the workspace tileset only while it is the object's current map. */
export function shouldKeepWorkspaceTileset(
  session: Pick<EditorSession, 'document' | 'selection'>,
  workspace: Pick<WorkspaceController, 'texture'>,
): boolean {
  const tex = workspace.texture;
  if (tex.uvPanelTab !== 'tiles') return false;
  const image = tex.activeImageId ? session.document.images.get(tex.activeImageId) : null;
  if (!image) return false;
  const selection = session.selection?.state;
  if (!selection) return true;
  const ctx = resolveActiveTexture(session.document, selection);
  return !ctx.imageId || ctx.imageId === image.id;
}

export function isTilesetWorkspace(workspace: Pick<WorkspaceController, 'shellMode' | 'texture'>): boolean {
  return workspace.shellMode === 'texture' && workspace.texture.uvPanelTab === 'tiles';
}

export function shouldShowTilesetPanel(workspace: Pick<WorkspaceController, 'texture'>): boolean {
  return workspace.texture.uvPanelTab === 'tiles' && workspace.texture.atlasPanelOpen;
}

export function hideTilesetPopup(workspace: WorkspaceController): void {
  workspace.patchTexture({ atlasPanelOpen: false });
}

export function toggleTilesetPopup(
  workspace: WorkspaceController,
  viewport: { width: number } = typeof window === 'undefined'
    ? { width: 1440 }
    : { width: window.innerWidth },
): boolean {
  if (workspace.texture.atlasPanelOpen) {
    hideTilesetPopup(workspace);
    return false;
  }
  showTilesetPopup(workspace, viewport);
  return true;
}

export function openUvPixelWorkspace(
  session: EditorSession,
  workspace: WorkspaceController,
): boolean {
  if (session.tools.getActive()?.id === 'tile-draw') {
    session.tools.setActive('select', session.context());
  }
  const keepPaint = workspace.texture.uvPanelTab === 'paint';
  workspace.patchTexture({
    uvPanelTab: keepPaint ? 'paint' : 'edit',
    uvPointerMode: !keepPaint,
    paintMode3D: keepPaint,
    atlasPaintMode: false,
    atlasPanelOpen: false,
    uvInspectorOpen: true,
    maximize: 'none',
    activeRightEditor: 'combined',
  });
  workspace.setShellMode('texture');
  session.requestRedraw();
  return true;
}

export function showTilesetPopup(
  workspace: WorkspaceController,
  viewport: { width: number } = typeof window === 'undefined'
    ? { width: 1440 }
    : { width: window.innerWidth },
): void {
  const docked = workspace.texture.atlasPanelDock !== 'float';
  const park = !docked && tilesetPopupCovers3dView(workspace, viewport.width)
    ? tilesetPopupParkPosition(workspace, viewport.width)
    : null;
  workspace.patchTexture({
    atlasPanelOpen: true,
    atlasPanelMinimized: false,
    ...(park ? { atlasPanelX: park.x, atlasPanelY: park.y } : {}),
  });
}

export function openTilesetWorkspace(
  session: EditorSession,
  workspace: WorkspaceController,
  options: { selectAllFaces?: boolean } = {},
): boolean {
  ensureTilesetMaterial(session, workspace);
  if (options.selectAllFaces) {
    const objectId = session.selection.state.activeObjectId;
    if (objectId) selectObjectFaces(session, objectId);
  }
  if (session.tools.getActive()?.id === 'tile-draw') {
    session.tools.setActive('select', session.context());
  }
  workspace.patchTexture({
    uvPanelTab: 'tiles',
    uvPointerMode: true,
    paintMode3D: false,
    atlasPaintMode: false,
    uvInspectorOpen: true,
    maximize: 'none',
    activeRightEditor: 'combined',
    atlasPanelDock: workspace.texture.atlasPanelDock === 'float' ? 'right' : workspace.texture.atlasPanelDock,
  });
  showTilesetPopup(workspace);
  workspace.setShellMode('texture');
  session.requestRedraw();
  return true;
}

export function prepareTilePaint(
  session: EditorSession,
  workspace: WorkspaceController,
): boolean {
  ensureTilesetMaterial(session, workspace);
  if (session.tools.getActive()?.id === 'tile-draw') {
    session.tools.setActive('select', session.context());
  }
  workspace.patchTexture({
    uvPanelTab: 'tiles',
    uvPointerMode: true,
    paintMode3D: false,
    atlasPaintMode: true,
    uvInspectorOpen: true,
    maximize: 'none',
    activeRightEditor: 'combined',
    atlasPanelDock: workspace.texture.atlasPanelDock === 'float' ? 'right' : workspace.texture.atlasPanelDock,
  });
  showTilesetPopup(workspace);
  workspace.setShellMode('texture');
  session.selection.setMode('face');
  session.requestRedraw();
  return true;
}

export function openTerrainTilesetWorkspace(
  session: EditorSession,
  workspace: WorkspaceController,
): boolean {
  if (!selectTerrainFaces(session)) return false;
  applyTerrainTilesetMaterialPreset(session);
  return openTilesetWorkspace(session, workspace);
}

export function applyAtlasConstructionPlane(
  session: EditorSession,
  orientation: TextureWorkspaceState['atlasPlaneOrientation'],
  offset = 0,
): void {
  const base = orientation === 'floor'
    ? WORLD_XZ_PLANE
    : orientation === 'wall-x'
      ? WORLD_XY_PLANE
      : WORLD_YZ_PLANE;
  const id = orientation === 'floor' ? 'top' : orientation === 'wall-x' ? 'front' : 'right';
  session.constructionPlane = constructionPlaneThrough(
    base,
    addVec3(base.origin, scaleVec3(base.normal, offset)),
  );
  session.constructionPlaneId = `${id}@${offset}`;
}

export function applyTileDrawToolConfig(
  session: EditorSession,
  workspace: WorkspaceController,
  mode?: TileDrawMode,
): boolean {
  const tex = workspace.texture;
  const ctx = resolveActiveTexture(session.document, session.selection.state);
  const materialId = tex.activeMaterialId ?? ctx.materialId;
  const imageId = tex.activeImageId ?? ctx.imageId;
  const image = imageId ? session.document.images.get(imageId) : null;
  const tool = session.tools.get('tile-draw') as TileDrawTool | undefined;
  if (!tool || !image || !materialId) return false;
  const pixelsPerUnit = Math.max(1, tex.atlasPixelsPerUnit);
  tool.setConfig({
    mode: mode ?? tex.atlasDrawMode,
    shape: tex.atlasDrawShape,
    autoTile: tex.atlasAutoTile,
    materialId,
    imageName: image.name,
    imageWidth: image.width,
    imageHeight: image.height,
    tileX: tex.atlasTileX,
    tileY: tex.atlasTileY,
    tileWidth: tex.atlasTileWidth,
    tileHeight: tex.atlasTileHeight,
    marginX: tex.atlasMarginX,
    marginY: tex.atlasMarginY,
    selectionColumns: tex.atlasSelectionColumns,
    selectionRows: tex.atlasSelectionRows,
    padding: tex.atlasPadding,
    quarterTurns: tex.atlasQuarterTurns,
    flipU: tex.atlasFlipU,
    flipV: tex.atlasFlipV,
    cellWidth: tex.atlasUsePixelDensity ? tex.atlasTileWidth / pixelsPerUnit : tex.atlasWorldTileWidth,
    cellHeight: tex.atlasUsePixelDensity ? tex.atlasTileHeight / pixelsPerUnit : tex.atlasWorldTileHeight,
    pattern: tex.atlasFillPattern,
    randomSeed: tex.atlasRandomSeed,
    layer: tex.atlasTileLayer,
    fillColumns: tex.atlasFillColumns,
    fillRows: tex.atlasFillRows,
    joinMulti: tex.atlasJoinMulti,
  }, session.context());
  if (!tex.atlasUseFacePlane) {
    applyAtlasConstructionPlane(session, tex.atlasPlaneOrientation, tex.atlasPlaneOffset);
  }
  if (typeof tool.syncWorkPlane === 'function') {
    tool.syncWorkPlane(session.constructionPlane, session.context());
  }
  return true;
}

export function setTileDrawMode(
  session: EditorSession,
  workspace: WorkspaceController,
  mode: TileDrawMode,
): boolean {
  workspace.patchTexture({ atlasDrawMode: mode });
  if (session.tools.getActive()?.id === 'tile-draw') {
    return applyTileDrawToolConfig(session, workspace, mode);
  }
  return true;
}

export function toggleTileDrawTool(
  session: EditorSession,
  workspace: WorkspaceController,
  mode?: TileDrawMode,
): boolean {
  if (session.tools.getActive()?.id === 'tile-draw' && !mode) {
    session.tools.setActive('select', session.context());
    session.requestRedraw();
    return true;
  }
  if (mode) workspace.patchTexture({ atlasDrawMode: mode });
  if (!applyTileDrawToolConfig(session, workspace, mode)) return false;
  workspace.patchTexture({
    paintMode3D: false,
    atlasPaintMode: false,
    uvPointerMode: true,
    uvPanelTab: 'tiles',
    uvInspectorOpen: true,
  });
  showTilesetPopup(workspace);
  session.tools.setActive('tile-draw', session.context());
  session.requestRedraw();
  return true;
}

export function prepareTileDraw(
  session: EditorSession,
  workspace: WorkspaceController,
  mode: TileDrawMode = 'paint',
): boolean {
  ensureTilesetMaterial(session, workspace);
  const hasTiles = [...session.document.objects.values()].some((object) => !!object.metadata.tileLayer);
  workspace.patchTexture({
    uvPanelTab: 'tiles',
    uvPointerMode: true,
    paintMode3D: false,
    atlasPaintMode: false,
    uvInspectorOpen: true,
    maximize: 'none',
    activeRightEditor: 'combined',
    splitRatio: 0.72,
    atlasDrawMode: mode,
    atlasPanelDock: workspace.texture.atlasPanelDock === 'float' ? 'right' : workspace.texture.atlasPanelDock,
    ...(hasTiles || workspace.texture.atlasUseFacePlane ? {} : { atlasPlaneOrientation: 'floor' as const }),
  });
  showTilesetPopup(workspace);
  workspace.setShellMode('texture');
  toggleTileDrawTool(session, workspace, mode);
  session.requestRedraw();
  return session.tools.getActive()?.id === 'tile-draw';
}

export function prepareTerrainTileDraw(
  session: EditorSession,
  workspace: WorkspaceController,
  mode: TileDrawMode = 'paint',
): boolean {
  const terrain = activeTerrain(session);
  if (!terrain) return prepareTileDraw(session, workspace, mode);
  applyTerrainTilesetMaterialPreset(session);
  session.selection.setMode('object');
  session.selection.selectObjects([terrain.object.id], 'replace');
  return prepareTileDraw(session, workspace, mode);
}

export function setTileDrawPlane(
  session: EditorSession,
  workspace: WorkspaceController,
  plane: TextureWorkspaceState['atlasPlaneOrientation'] | 'surface',
): boolean {
  if (plane === 'surface') {
    workspace.patchTexture({ atlasUseFacePlane: true, atlasSurfaceLocked: false });
    snapTileDrawToSelection(session, workspace);
    return true;
  }
  workspace.patchTexture({
    atlasPlaneOrientation: plane,
    atlasUseFacePlane: false,
    atlasSurfaceLocked: false,
  });
  applyAtlasConstructionPlane(session, plane, workspace.texture.atlasPlaneOffset);
  if (session.tools.getActive()?.id === 'tile-draw') applyTileDrawToolConfig(session, workspace);
  session.requestRedraw();
  return true;
}

export function toggleTileDrawSurfaceLock(
  session: EditorSession,
  workspace: WorkspaceController,
): boolean {
  const next = !workspace.texture.atlasSurfaceLocked;
  if (next) {
    session.setConstructionPlaneFromSelection();
    snapTileDrawToNearestVertex(session, workspace);
  }
  workspace.patchTexture({
    atlasUseFacePlane: true,
    atlasSurfaceLocked: next,
  });
  const tool = session.tools.get('tile-draw') as TileDrawTool | undefined;
  tool?.syncWorkPlane(session.constructionPlane, session.context());
  session.requestRedraw();
  return true;
}

export function snapTileDrawToNearestVertex(
  session: EditorSession,
  workspace: WorkspaceController,
): boolean {
  const hint = session.constructionPlane.origin;
  let best: { x: number; y: number; z: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  const objectId = session.selection.state.activeObjectId
    ?? [...session.selection.state.selectedObjectIds][0]
    ?? null;
  const objects = objectId
    ? [session.document.objects.get(objectId)].filter(Boolean)
    : [...session.document.objects.values()];
  for (const object of objects) {
    const mesh = object!.meshId ? session.document.meshes.get(object!.meshId) : null;
    if (!mesh) continue;
    for (const vertex of mesh.vertices.values()) {
      const world = transformPoint(vertex.position, object!.transform);
      const dist = lengthSqVec3(subVec3(world, hint));
      if (dist < bestDist) {
        bestDist = dist;
        best = world;
      }
    }
  }
  if (!best) return false;
  session.constructionPlane = { ...session.constructionPlane, origin: best };
  workspace.patchTexture({ atlasUseFacePlane: true });
  const tool = session.tools.get('tile-draw') as TileDrawTool | undefined;
  tool?.syncWorkPlane(session.constructionPlane, session.context());
  session.requestRedraw();
  return true;
}

export function snapTileDrawToSelection(
  session: EditorSession,
  workspace: WorkspaceController,
): boolean {
  if (!session.setConstructionPlaneFromSelection()) {
    workspace.patchTexture({ atlasUseFacePlane: true });
    return false;
  }
  snapTileDrawToNearestVertex(session, workspace);
  workspace.patchTexture({ atlasUseFacePlane: true });
  const tool = session.tools.get('tile-draw') as TileDrawTool | undefined;
  tool?.syncWorkPlane(session.constructionPlane, session.context());
  session.requestRedraw();
  return true;
}

export function nudgeTileDrawPlane(
  session: EditorSession,
  workspace: WorkspaceController,
  steps: number,
): boolean {
  const delta = steps * tileDrawCellSize(workspace.texture);
  if (workspace.texture.atlasUseFacePlane) {
    const current = Number(session.constructionPlaneId.match(/@(-?[\d.]+)$/)?.[1] ?? 0);
    session.offsetConstructionPlane(current + delta);
    workspace.patchTexture({ atlasPlaneOffset: workspace.texture.atlasPlaneOffset + delta });
    const tool = session.tools.get('tile-draw') as TileDrawTool | undefined;
    tool?.syncWorkPlane(session.constructionPlane, session.context());
    session.requestRedraw();
    return true;
  }
  workspace.patchTexture({ atlasPlaneOffset: workspace.texture.atlasPlaneOffset + delta });
  if (session.tools.getActive()?.id === 'tile-draw') {
    applyTileDrawToolConfig(session, workspace);
  } else {
    applyAtlasConstructionPlane(
      session,
      workspace.texture.atlasPlaneOrientation,
      workspace.texture.atlasPlaneOffset,
    );
    session.requestRedraw();
  }
  return true;
}

export function applyTileDrawHotkey(
  session: EditorSession,
  workspace: WorkspaceController,
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey'>,
): boolean {
  if (session.tools.getActive()?.id !== 'tile-draw') return false;
  if (event.ctrlKey || event.metaKey) return false;
  const key = event.key.toLowerCase();
  const tex = workspace.texture;

  if (key === '[' || key === ']') {
    return nudgeTileDrawPlane(session, workspace, key === ']' ? 1 : -1);
  }
  if (key === 'q' || key === 'e') {
    if (event.shiftKey) {
      workspace.patchTexture(key === 'q' ? { atlasFlipV: !tex.atlasFlipV } : { atlasFlipU: !tex.atlasFlipU });
    } else {
      const delta = key === 'q' ? 3 : 1;
      workspace.patchTexture({ atlasQuarterTurns: ((tex.atlasQuarterTurns + delta) % 4) as 0 | 1 | 2 | 3 });
    }
    applyTileDrawToolConfig(session, workspace);
    return true;
  }
  if (event.shiftKey) {
    const shape = TILE_DRAW_SHAPE_HOTKEYS[key];
    if (shape) {
      workspace.patchTexture({ atlasDrawShape: shape });
      applyTileDrawToolConfig(session, workspace);
      return true;
    }
    return false;
  }
  if (key === 'l') return toggleTileDrawSurfaceLock(session, workspace);
  if (key === 'v') return snapTileDrawToNearestVertex(session, workspace);
  const plane = TILE_DRAW_PLANE_HOTKEYS[key];
  if (plane) return setTileDrawPlane(session, workspace, plane);
  const mode = TILE_DRAW_MODE_HOTKEYS[key];
  if (mode) return setTileDrawMode(session, workspace, mode);
  if (key === 'escape') return toggleTileDrawTool(session, workspace);
  if (event.key.startsWith('Arrow')) {
    const image = tex.activeImageId ? session.document.images.get(tex.activeImageId) : null;
    if (!image) return false;
    const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    const stepX = tex.atlasTileWidth + tex.atlasMarginX;
    const stepY = tex.atlasTileHeight + tex.atlasMarginY;
    workspace.patchTexture({
      atlasTileX: Math.max(tex.atlasOffsetX, Math.min(image.width - tex.atlasTileWidth, tex.atlasTileX + dx * stepX)),
      atlasTileY: Math.max(tex.atlasOffsetY, Math.min(image.height - tex.atlasTileHeight, tex.atlasTileY + dy * stepY)),
    });
    applyTileDrawToolConfig(session, workspace);
    return true;
  }
  return false;
}

function buildPlaceholderTilesetPixels(size = 64, tile = 16): Uint8ClampedArray {
  const colors = [
    [220, 90, 70], [70, 160, 90], [70, 120, 210], [230, 190, 60],
    [160, 90, 200], [40, 180, 180], [230, 130, 50], [90, 90, 100],
    [180, 70, 90], [90, 140, 70], [100, 160, 220], [200, 160, 80],
    [140, 100, 80], [60, 80, 90], [240, 240, 230], [30, 30, 36],
  ];
  const pixels = new Uint8ClampedArray(size * size * 4);
  const columns = size / tile;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color = colors[(Math.floor(y / tile) * columns + Math.floor(x / tile)) % colors.length]!;
      const inset = x % tile === 0 || y % tile === 0;
      const index = (y * size + x) * 4;
      pixels[index] = inset ? Math.max(0, color[0]! - 40) : color[0]!;
      pixels[index + 1] = inset ? Math.max(0, color[1]! - 40) : color[1]!;
      pixels[index + 2] = inset ? Math.max(0, color[2]! - 40) : color[2]!;
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

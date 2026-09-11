import { describe, expect, it } from 'vitest';
import {
  applyAtlasConstructionPlane,
  applyTileDrawHotkey,
  applyTileDrawToolConfig,
  clampAtlasStamp,
  isPlaceholderTilesetImage,
  nudgeTileDrawPlane,
  openTerrainAlbedoPaint,
  openTerrainTilesetWorkspace,
  openTilesetWorkspace,
  openUvPixelWorkspace,
  prepareTerrainTileDraw,
  prepareTileDraw,
  prepareTilePaint,
  setTileDrawMode,
  setTileDrawPlane,
  snapTileDrawToNearestVertex,
  shouldKeepWorkspaceTileset,
  shouldPreviewTerrainAlbedo,
  shouldShowTilesetPanel,
  showTilesetPopup,
  setAtlasTileSize,
  tileEditorJob,
  toggleTileDrawSurfaceLock,
  toggleTilesetPopup,
} from '@/app/tilesetWorkspace';
import { commitMeshObject, createMaterial } from '@/core/document/ModelDocument';
import { EditorSession } from '@/core/editor/EditorSession';
import { DEFAULT_PLACEHOLDER_IMAGE_NAME } from '@/core/image/DefaultPlaceholderImage';
import { createImageAssetFromPixels, createTextureAsset } from '@/core/image/PixelEditor';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { activeTerrain, createTerrain } from '@/core/terrain/Terrain';
import { TileDrawTool } from '@/core/tools/TileDrawTool';
import { WorkspaceController } from '@/workspace/WorkspaceController';

describe('tileset workspace', () => {
  it('opens UV/Paint tiles from a terrain and crisps the albedo', () => {
    const session = new EditorSession();
    const workspace = new WorkspaceController();
    createTerrain(session, { size: 8, resolution: 4 });
    expect(openTerrainTilesetWorkspace(session, workspace)).toBe(true);
    expect(workspace.shellMode).toBe('texture');
    expect(workspace.texture.uvPanelTab).toBe('tiles');
    expect(workspace.texture.uvPointerMode).toBe(true);
    expect(workspace.texture.uvInspectorOpen).toBe(true);
    expect(workspace.texture.atlasPanelOpen).toBe(true);
    expect(workspace.texture.atlasPanelMinimized).toBe(false);
    expect(session.tools.getActive()?.id).not.toBe('tile-draw');
    const terrain = activeTerrain(session)!;
    const material = session.document.materials.get(terrain.object.materialSlotIds[0]!)!;
    const texture = session.document.textures.get(material.baseColourTextureId!)!;
    expect(texture.filtering).toBe('nearest');
    expect(texture.generateMipmaps).toBe(false);
  });

  it('opens albedo paint without leaving the terrain texture', () => {
    const session = new EditorSession();
    const workspace = new WorkspaceController();
    createTerrain(session, { size: 8, resolution: 4 });
    expect(openTerrainAlbedoPaint(session, workspace)).toBe(true);
    expect(workspace.shellMode).toBe('texture');
    expect(workspace.texture.uvPanelTab).toBe('paint');
    expect(workspace.texture.paintMode3D).toBe(true);
    expect(workspace.texture.uvInspectorOpen).toBe(true);
  });

  it('shows terrain albedo only in the texture shell', () => {
    const workspace = new WorkspaceController();
    workspace.setShellMode('terrain');
    expect(shouldPreviewTerrainAlbedo(workspace)).toBe(false);
    workspace.setShellMode('texture');
    expect(shouldPreviewTerrainAlbedo(workspace)).toBe(true);
  });

  it('configures 3D tile draw from the terrain albedo', () => {
    const session = new EditorSession();
    const workspace = new WorkspaceController();
    createTerrain(session, { size: 8, resolution: 4 });
    openTerrainTilesetWorkspace(session, workspace);
    expect(applyTileDrawToolConfig(session, workspace)).toBe(true);
    const tool = session.tools.get('tile-draw') as TileDrawTool;
    expect(tool.config.materialId).toBeTruthy();
    expect(tool.config.imageWidth).toBe(256);
    expect(tool.config.imageHeight).toBe(256);
  });

  it('starts 3D tile draw from the terrain objects workflow', () => {
    const session = new EditorSession();
    const workspace = new WorkspaceController();
    createTerrain(session, { size: 8, resolution: 4 });
    expect(prepareTerrainTileDraw(session, workspace, 'erase')).toBe(true);
    expect(workspace.shellMode).toBe('texture');
    expect(workspace.texture.uvPanelTab).toBe('tiles');
    expect(session.tools.getActive()?.id).toBe('tile-draw');
    expect((session.tools.getActive() as TileDrawTool).config.mode).toBe('erase');
  });

  it('opens a tileset workspace from a blank scene', () => {
    const session = new EditorSession();
    const workspace = new WorkspaceController();
    expect(openTilesetWorkspace(session, workspace)).toBe(true);
    expect(workspace.shellMode).toBe('texture');
    expect(workspace.texture.uvPanelTab).toBe('tiles');
    expect(workspace.texture.atlasPanelOpen).toBe(true);
    expect(workspace.texture.atlasPanelMinimized).toBe(false);
    expect(workspace.texture.activeImageId).toBeTruthy();
    expect(session.document.images.get(workspace.texture.activeImageId!)?.name).toBe(DEFAULT_PLACEHOLDER_IMAGE_NAME);
    expect(session.tools.getActive()?.id).not.toBe('tile-draw');
    expect(workspace.texture.atlasPanelDock).toBe('right');
  });

  it('uses the selected object texture instead of a generated tileset atlas', () => {
    const session = new EditorSession();
    const workspace = new WorkspaceController();
    const { objectId } = commitMeshObject(session.document, buildBox({ width: 1, height: 1, depth: 1 }));
    session.selection.setMode('object');
    session.selection.selectObjects([objectId], 'replace');
    expect(openTilesetWorkspace(session, workspace)).toBe(true);
    const image = session.document.images.get(workspace.texture.activeImageId!)!;
    expect(image.name).toBe(DEFAULT_PLACEHOLDER_IMAGE_NAME);
    expect(image.name).not.toBe('Tileset Atlas');
    const object = session.document.objects.get(objectId)!;
    expect(object.materialSlotIds[0]).toBe(workspace.texture.activeMaterialId);
  });

  it('abandons a leftover generated atlas when the object already has a texture', () => {
    const session = new EditorSession();
    const workspace = new WorkspaceController();
    const leftoverImage = createImageAssetFromPixels(
      session.document,
      'Tileset Atlas',
      64,
      64,
      new Uint8ClampedArray(64 * 64 * 4),
    );
    const leftoverTexture = createTextureAsset(session.document, leftoverImage, 'Tileset Atlas');
    const leftoverMaterial = createMaterial(session.document, { name: 'Tileset Material' });
    leftoverMaterial.baseColourTextureId = leftoverTexture.id;
    workspace.patchTexture({
      activeImageId: leftoverImage.id,
      activeMaterialId: leftoverMaterial.id,
      activeTextureId: leftoverTexture.id,
      uvPanelTab: 'tiles',
      atlasPanelOpen: true,
    });
    const { objectId } = commitMeshObject(session.document, buildBox({ width: 1, height: 1, depth: 1 }));
    session.selection.setMode('object');
    session.selection.selectObjects([objectId], 'replace');
    expect(shouldKeepWorkspaceTileset(session, workspace)).toBe(false);
    expect(openTilesetWorkspace(session, workspace)).toBe(true);
    expect(session.document.images.get(workspace.texture.activeImageId!)?.name).toBe(DEFAULT_PLACEHOLDER_IMAGE_NAME);
    expect(shouldKeepWorkspaceTileset(session, workspace)).toBe(true);
  });

  it('switches to Sprytile paint without leaving the current texture', () => {
    const session = new EditorSession();
    const workspace = new WorkspaceController();
    openTilesetWorkspace(session, workspace);
    expect(prepareTilePaint(session, workspace)).toBe(true);
    expect(session.tools.getActive()?.id).not.toBe('tile-draw');
    expect(workspace.texture.atlasPaintMode).toBe(true);
    expect(workspace.texture.uvPanelTab).toBe('tiles');
    expect(session.selection.state.mode).toBe('face');
    expect(session.document.images.get(workspace.texture.activeImageId!)?.name).toBe(DEFAULT_PLACEHOLDER_IMAGE_NAME);
  });

  it('starts Crocotile 3D draw without terrain', () => {
    const session = new EditorSession();
    const workspace = new WorkspaceController();
    expect(prepareTileDraw(session, workspace)).toBe(true);
    expect(session.tools.getActive()?.id).toBe('tile-draw');
    expect(workspace.texture.atlasPanelOpen).toBe(true);
    expect(workspace.texture.atlasPanelMinimized).toBe(false);
    expect(workspace.texture.atlasPlaneOrientation).toBe('floor');
    expect(workspace.texture.splitRatio).toBeCloseTo(0.72);
    const tool = session.tools.getActive() as TileDrawTool;
    expect(tool.config.materialId).toBeTruthy();
    expect(tool.config.imageWidth).toBe(8);
  });

  it('offsets the draw plane and switches live draw modes', () => {
    const session = new EditorSession();
    const workspace = new WorkspaceController();
    prepareTileDraw(session, workspace);
    workspace.patchTexture({ atlasUsePixelDensity: false, atlasPlaneSize: 1, atlasPlaneOffset: 0 });
    applyAtlasConstructionPlane(session, 'floor', 2);
    expect(session.constructionPlane.origin.y).toBeCloseTo(2);
    expect(nudgeTileDrawPlane(session, workspace, 1)).toBe(true);
    expect(workspace.texture.atlasPlaneOffset).toBeCloseTo(1);
    expect(setTileDrawMode(session, workspace, 'replace')).toBe(true);
    expect((session.tools.getActive() as TileDrawTool).config.mode).toBe('replace');
    expect(applyTileDrawHotkey(session, workspace, {
      key: 'x',
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
    })).toBe(true);
    expect((session.tools.getActive() as TileDrawTool).config.mode).toBe('erase');
  });

  it('parks the tileset popup over the UV pane instead of the 3D view', () => {
    const workspace = new WorkspaceController();
    workspace.patchTexture({
      atlasPanelX: 80,
      atlasPanelY: 88,
      atlasPanelDock: 'float',
      uvInspectorOpen: true,
      uvInspectorWidth: 280,
      splitRatio: 0.46,
    });
    showTilesetPopup(workspace, { width: 1440 });
    expect(workspace.texture.atlasPanelOpen).toBe(true);
    expect(workspace.texture.atlasPanelMinimized).toBe(false);
    expect(workspace.texture.atlasPanelX).toBe(824);
    expect(workspace.texture.atlasPanelY).toBe(88);
  });

  it('leaves a UV-side palette where the user parked it', () => {
    const workspace = new WorkspaceController();
    workspace.patchTexture({ atlasPanelX: 980, atlasPanelY: 120, atlasPanelDock: 'float', uvInspectorOpen: true, uvInspectorWidth: 280 });
    showTilesetPopup(workspace, { width: 1440 });
    expect(workspace.texture.atlasPanelX).toBe(980);
    expect(workspace.texture.atlasPanelY).toBe(120);
  });

  it('keeps the current object texture while the tiles tab is open', () => {
    const session = new EditorSession();
    const workspace = new WorkspaceController();
    const { objectId } = commitMeshObject(session.document, buildBox({ width: 1, height: 1, depth: 1 }));
    session.selection.setMode('object');
    session.selection.selectObjects([objectId], 'replace');
    openTilesetWorkspace(session, workspace);
    expect(isPlaceholderTilesetImage({ name: DEFAULT_PLACEHOLDER_IMAGE_NAME, width: 8, height: 8 })).toBe(true);
    expect(session.document.images.get(workspace.texture.activeImageId!)?.name).toBe(DEFAULT_PLACEHOLDER_IMAGE_NAME);
    expect(shouldKeepWorkspaceTileset(session, workspace)).toBe(true);
  });

  it('keeps one stamp across Tileset, Build, and Paint', () => {
    const session = new EditorSession();
    const workspace = new WorkspaceController();
    openTilesetWorkspace(session, workspace);
    workspace.patchTexture({ atlasTileX: 0, atlasTileY: 0, atlasQuarterTurns: 1, atlasFlipU: true });
    expect(tileEditorJob(session, workspace)).toBe('tileset');
    expect(prepareTileDraw(session, workspace)).toBe(true);
    expect(tileEditorJob(session, workspace)).toBe('build');
    expect(workspace.texture.atlasTileX).toBe(0);
    expect(workspace.texture.atlasFlipU).toBe(true);
    expect(prepareTilePaint(session, workspace)).toBe(true);
    expect(tileEditorJob(session, workspace)).toBe('paint');
    expect(workspace.texture.atlasTileY).toBe(0);
    expect(workspace.texture.atlasQuarterTurns).toBe(1);
  });

  it('maps Build plane and shape hotkeys without leaving tile draw', () => {
    const session = new EditorSession();
    const workspace = new WorkspaceController();
    prepareTileDraw(session, workspace);
    expect(applyTileDrawHotkey(session, workspace, { key: '2', shiftKey: false, ctrlKey: false, metaKey: false })).toBe(true);
    expect(workspace.texture.atlasPlaneOrientation).toBe('wall-x');
    expect(workspace.texture.atlasUseFacePlane).toBe(false);
    expect(applyTileDrawHotkey(session, workspace, { key: '4', shiftKey: false, ctrlKey: false, metaKey: false })).toBe(true);
    expect(workspace.texture.atlasUseFacePlane).toBe(true);
    expect(applyTileDrawHotkey(session, workspace, { key: '3', shiftKey: true, ctrlKey: false, metaKey: false })).toBe(true);
    expect(workspace.texture.atlasDrawShape).toBe('line');
    expect(applyTileDrawHotkey(session, workspace, { key: 'i', shiftKey: false, ctrlKey: false, metaKey: false })).toBe(true);
    expect(workspace.texture.atlasDrawMode).toBe('pick');
    expect(setTileDrawPlane(session, workspace, 'floor')).toBe(true);
    expect(toggleTileDrawSurfaceLock(session, workspace)).toBe(true);
    expect(workspace.texture.atlasSurfaceLocked).toBe(true);
    expect(session.tools.getActive()?.id).toBe('tile-draw');
  });

  it('snaps the work plane to the nearest vertex', () => {
    const session = new EditorSession();
    const workspace = new WorkspaceController();
    const { objectId } = commitMeshObject(session.document, buildBox({ width: 2, height: 2, depth: 2 }));
    session.selection.selectObjects([objectId], 'replace');
    session.constructionPlane = {
      origin: { x: 10, y: 10, z: 10 },
      normal: { x: 0, y: 1, z: 0 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 0, z: 1 },
    };
    expect(snapTileDrawToNearestVertex(session, workspace)).toBe(true);
    expect(session.constructionPlane.origin.x).toBeLessThan(2);
    expect(session.constructionPlane.origin.y).toBeLessThan(2);
    expect(workspace.texture.atlasUseFacePlane).toBe(true);
  });

  it('clamps a leftover stamp back onto the current atlas', () => {
    const workspace = new WorkspaceController();
    workspace.patchTexture({ atlasTileX: 96, atlasTileY: 144, atlasSelectionColumns: 3, atlasSelectionRows: 2 });
    clampAtlasStamp(workspace, { width: 64, height: 64 });
    expect(workspace.texture.atlasTileX).toBe(48);
    expect(workspace.texture.atlasTileY).toBe(48);
    expect(workspace.texture.atlasSelectionColumns).toBe(1);
    expect(workspace.texture.atlasSelectionRows).toBe(1);
  });

  it('toggles the tileset palette and hides it in UV / Pixel', () => {
    const session = new EditorSession();
    const workspace = new WorkspaceController();
    expect(openTilesetWorkspace(session, workspace)).toBe(true);
    expect(shouldShowTilesetPanel(workspace)).toBe(true);
    expect(toggleTilesetPopup(workspace)).toBe(false);
    expect(workspace.texture.atlasPanelOpen).toBe(false);
    expect(shouldShowTilesetPanel(workspace)).toBe(false);
    expect(toggleTilesetPopup(workspace)).toBe(true);
    expect(workspace.texture.atlasPanelOpen).toBe(true);
    expect(openUvPixelWorkspace(session, workspace)).toBe(true);
    expect(workspace.texture.uvPanelTab).toBe('edit');
    expect(workspace.texture.atlasPanelOpen).toBe(false);
    expect(shouldShowTilesetPanel(workspace)).toBe(false);
    expect(session.tools.getActive()?.id).not.toBe('tile-draw');
  });

  it('does not show a leftover tileset palette on the UV tab', () => {
    const workspace = new WorkspaceController();
    workspace.patchTexture({ uvPanelTab: 'edit', atlasPanelOpen: true });
    expect(shouldShowTilesetPanel(workspace)).toBe(false);
  });

  it('changes atlas tile size and keeps the stamp on the image', () => {
    const workspace = new WorkspaceController();
    workspace.patchTexture({ atlasTileWidth: 16, atlasTileHeight: 16, atlasTileX: 48, atlasTileY: 32 });
    setAtlasTileSize(workspace, { width: 64, height: 64 }, 32);
    expect(workspace.texture.atlasTileWidth).toBe(32);
    expect(workspace.texture.atlasTileHeight).toBe(32);
    expect(workspace.texture.atlasTileX).toBe(32);
    expect(workspace.texture.atlasTileY).toBe(32);
    setAtlasTileSize(workspace, { width: 64, height: 64 }, 128, 8);
    expect(workspace.texture.atlasTileWidth).toBe(64);
    expect(workspace.texture.atlasTileHeight).toBe(8);
  });
});

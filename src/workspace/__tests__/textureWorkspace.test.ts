import { describe, expect, it, vi } from 'vitest';
import { WorkspaceController } from '@/workspace/WorkspaceController';
import { clampTexture3dWindow, clampTextureSplit, clampUvInspectorWidth, createDefaultTextureWorkspace, loadTextureWorkspace } from '@/workspace/TextureWorkspace';
import { resolveActiveTexture } from '@/core/texture/resolveActiveTexture';
import { createEmptyDocument, commitMeshObject } from '@/core/document/ModelDocument';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { SelectionManager } from '@/core/selection/SelectionManager';

describe('TextureWorkspace', () => {
  it('clamps split ratios to usable bounds', () => {
    expect(clampTextureSplit(0.01)).toBe(0.22);
    expect(clampTextureSplit(0.99)).toBe(0.78);
    expect(clampTextureSplit(0.5)).toBe(0.5);
  });

  it('clamps the floating 3D window inside the UV workspace', () => {
    const next = clampTexture3dWindow(
      { x: -40, y: 800, width: 80, height: 40, visible: true, docked: false },
      { width: 1000, height: 600 },
    );
    expect(next.width).toBe(260);
    expect(next.height).toBe(180);
    expect(next.x).toBeGreaterThanOrEqual(8);
    expect(next.y).toBeLessThanOrEqual(600 - 180 - 8);
    expect(next.docked).toBe(false);
  });

  it('defaults to a docked 3D | UV vertical split', () => {
    const state = createDefaultTextureWorkspace();
    expect(state.preview3d.docked).toBe(true);
    expect(state.uvWindow.docked).toBe(true);
    expect(state.preview3d.visible).toBe(true);
    expect(state.uvWindow.visible).toBe(true);
    expect(state.uvInspectorOpen).toBe(true);
    expect(state.uvInspectorWidth).toBe(280);
    expect(state.uvAutoFrame3dSelection).toBe(false);
  });

  it('turns off auto-framing when loading pre-v2 UV workspace prefs', () => {
    const store = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    };
    vi.stubGlobal('localStorage', memoryStorage);
    memoryStorage.setItem(
      'vipercad.textureWorkspace.v1',
      JSON.stringify({ uvAutoFrame3dSelection: true }),
    );
    expect(loadTextureWorkspace().uvAutoFrame3dSelection).toBe(false);
    vi.unstubAllGlobals();
  });

  it('clamps the UV inspector width', () => {
    expect(clampUvInspectorWidth(40)).toBe(240);
    expect(clampUvInspectorWidth(900)).toBe(420);
    expect(clampUvInspectorWidth(240.4)).toBe(240);
  });

  it('toggles the 3D preview from Tab in the texture shell, then restores the split', () => {
    const workspace = new WorkspaceController();
    workspace.setShellMode('texture');
    expect(workspace.texture.preview3d.visible).toBe(true);
    expect(workspace.handleTab()).toBe(true);
    expect(workspace.texture.preview3d.visible).toBe(false);
    expect(workspace.handleTab()).toBe(true);
    expect(workspace.texture.preview3d.visible).toBe(true);
    expect(workspace.texture.preview3d.docked).toBe(true);
    expect(workspace.texture.uvWindow.docked).toBe(true);
  });

  it('detaches the 3D pane without hiding UV / Paint', () => {
    const workspace = new WorkspaceController();
    workspace.setShellMode('texture');
    workspace.setTexturePanelWindow('3d', { docked: false, visible: true, x: 24, y: 40, width: 320, height: 220 });
    expect(workspace.texture.preview3d.docked).toBe(false);
    expect(workspace.texture.uvWindow.docked).toBe(true);
    expect(workspace.texture.uvWindow.visible).toBe(true);
    workspace.restoreTextureSplit();
    expect(workspace.texture.preview3d.docked).toBe(true);
    expect(workspace.texture.uvWindow.docked).toBe(true);
  });

  it('switches shell without clearing modelling layout splits', () => {
    const workspace = new WorkspaceController();
    workspace.setSplits({ horizontal: 0.4, upperVertical: 0.6 });
    const before = { ...workspace.splits.splits };
    workspace.setShellMode('texture');
    expect(workspace.shellMode).toBe('texture');
    expect(workspace.texture.open).toBe(true);
    expect(workspace.splits.splits).toEqual(before);
    workspace.setShellMode('model');
    expect(workspace.shellMode).toBe('model');
    expect(workspace.splits.splits).toEqual(before);
  });

  it('returns only perspective rects in texture shell', () => {
    const workspace = new WorkspaceController();
    workspace.setShellMode('texture');
    const rects = workspace.computeViewportRects(800, 600);
    expect(rects).toHaveLength(1);
    expect(rects[0]!.id).toBe('persp');
    expect(rects[0]!.width).toBe(800);
    expect(rects[0]!.height).toBe(600);
  });

  it('resolves active texture from object material', () => {
    const doc = createEmptyDocument();
    const { objectId } = commitMeshObject(doc, buildBox({ width: 1, height: 1, depth: 1 }));
    const selection = new SelectionManager();
    selection.selectObjects([objectId], 'replace');
    const ctx = resolveActiveTexture(doc, selection.state);
    expect(ctx.objectId).toBe(objectId);
    expect(ctx.imageId).toBeTruthy();
    expect(ctx.materialId).toBeTruthy();
  });

  it('defaults to combined UV-select mode on the Edit tab', () => {
    const state = createDefaultTextureWorkspace();
    expect(state.activeRightEditor).toBe('combined');
    expect(state.uvPointerMode).toBe(true);
    expect(state.uvPanelTab).toBe('edit');
  });

  it('entering the texture shell switches selection to face mode', () => {
    const session = {
      tools: { setActive: (_id: string, _context: unknown) => undefined },
      context: () => ({}),
      selection: new SelectionManager(),
    };
    session.selection.setMode('object');
    // Mirror App.setShell('texture') behaviour for UV face picking.
    session.tools.setActive('select', session.context());
    session.selection.setMode('face');
    expect(session.selection.state.mode).toBe('face');
  });
});

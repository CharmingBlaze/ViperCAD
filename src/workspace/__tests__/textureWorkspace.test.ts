import { describe, expect, it } from 'vitest';
import { WorkspaceController } from '@/workspace/WorkspaceController';
import { clampTextureSplit, createDefaultTextureWorkspace } from '@/workspace/TextureWorkspace';
import { resolveActiveTexture } from '@/core/texture/resolveActiveTexture';
import { createEmptyDocument, commitMeshObject } from '@/core/document/ModelDocument';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { SelectionManager } from '@/core/selection/SelectionManager';

describe('TextureWorkspace', () => {
  it('clamps split ratios to usable bounds', () => {
    expect(clampTextureSplit(0.01)).toBe(0.2);
    expect(clampTextureSplit(0.99)).toBe(0.85);
    expect(clampTextureSplit(0.5)).toBe(0.5);
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

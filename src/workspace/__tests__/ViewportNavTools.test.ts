import { describe, expect, it } from 'vitest';
import { WorkspaceController } from '../WorkspaceController';
import type { AppShellMode } from '../types';

const SHELLS: AppShellMode[] = [
  'model',
  'sculpt',
  'terrain',
  'texture',
  'rig',
  'animate',
  'blockout',
];

describe('viewport navigation tools', () => {
  it('starts with pan / orbit / zoom tools visible', () => {
    const workspace = new WorkspaceController();
    expect(workspace.viewportNavToolsVisible).toBe(true);
  });

  it('draws create tools on surfaces by default', () => {
    const workspace = new WorkspaceController();
    expect(workspace.getDrawOnSurfaces()).toBe(true);
    workspace.setDrawOnSurfaces(false);
    expect(workspace.getDrawOnSurfaces()).toBe(false);
    workspace.setDrawOnSurfaces(true);
    expect(workspace.getDrawOnSurfaces()).toBe(true);
  });

  it('restores the tools when entering every workspace', () => {
    const workspace = new WorkspaceController();
    for (const mode of SHELLS) {
      workspace.setViewportNavToolsVisible(false);
      expect(workspace.viewportNavToolsVisible).toBe(false);
      workspace.setShellMode(mode);
      expect(workspace.viewportNavToolsVisible).toBe(true);
    }
  });
});

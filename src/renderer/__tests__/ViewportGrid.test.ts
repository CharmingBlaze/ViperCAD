import { describe, expect, it } from 'vitest';
import { ShaderMaterial, Vector3 } from 'three';
import { niceGridSize, niceGridSpacing, ViewportGrid } from '@/renderer/ViewportGrid';
import { parseHexColor, themeById } from '@/app/theme/themeTokens';

describe('ViewportGrid', () => {
  it('anchors the floor patch on the snapped view target', () => {
    const grid = new ViewportGrid();
    grid.update('top', 20, new Vector3(100, 0, -50), 1);
    expect(grid.mesh.position.x).toBeCloseTo(100);
    expect(grid.mesh.position.z).toBeCloseTo(-50);
    expect((grid.mesh.material as ShaderMaterial).uniforms.planeMode.value).toBe(0);
    expect((grid.mesh.material as ShaderMaterial).uniforms.cellSize.value).toBe(1);
  });

  it('uses a vertical plane for front views', () => {
    const grid = new ViewportGrid();
    grid.update('front', 20, new Vector3(0, 4, 0), 1);
    expect((grid.mesh.material as ShaderMaterial).uniforms.planeMode.value).toBe(1);
    expect(grid.mesh.position.y).toBeCloseTo(4);
  });

  it('keeps about eighteen cells visible across a view span', () => {
    const span = 512;
    const spacing = niceGridSpacing(span);
    const cells = span / spacing;
    expect(cells).toBeGreaterThan(10);
    expect(cells).toBeLessThan(40);
  });

  it('extends the perspective patch far beyond the visible span', () => {
    expect(niceGridSize(16, true)).toBeGreaterThan(niceGridSize(16, false));
  });

  it('retints grid and axis colours from a theme', () => {
    const grid = new ViewportGrid();
    grid.applyPalette({
      zenith: '#000000',
      horizon: '#111111',
      ground: '#000000',
      sun: '#ffffff',
      fog: '#111111',
      gridMinor: '#224422',
      gridMajor: '#448844',
      gridFloor: '#111111',
      gizmoX: '#ff0000',
      gizmoY: '#00ff00',
      gizmoZ: '#0000ff',
      gizmoView: '#ffff00',
      gizmoCentre: '#ffffff',
      overlaySelected: '#ffaa00',
      overlayHover: '#00ffff',
      overlayActive: '#ffffaa',
    });
    const uniforms = (grid.mesh.material as ShaderMaterial).uniforms;
    expect(uniforms.minorColor.value.getHex()).toBe(0x224422);
    expect(uniforms.axisX.value.getHex()).toBe(0xff0000);
    expect(uniforms.axisY.value.getHex()).toBe(0x00ff00);
    expect(uniforms.axisZ.value.getHex()).toBe(0x0000ff);
  });

  it('keeps grid palettes independent per pane', () => {
    const a = new ViewportGrid();
    const b = new ViewportGrid();
    a.applyPalette(themeById('phosphor').palette);
    b.applyPalette(themeById('obsidian').palette);
    const aMinor = (a.mesh.material as ShaderMaterial).uniforms.minorColor.value;
    const bMinor = (b.mesh.material as ShaderMaterial).uniforms.minorColor.value;
    expect(aMinor).not.toBe(bMinor);
    expect(aMinor.getHex()).toBe(parseHexColor(themeById('phosphor').palette.gridMinor));
    expect(bMinor.getHex()).toBe(parseHexColor(themeById('obsidian').palette.gridMinor));
  });

  it('restores grid colours when switching back to a previous theme', () => {
    const grid = new ViewportGrid();
    grid.applyPalette(themeById('phosphor').palette);
    grid.applyPalette(themeById('ice').palette);
    const obsidian = themeById('obsidian').palette;
    grid.applyPalette(obsidian);
    const uniforms = (grid.mesh.material as ShaderMaterial).uniforms;
    expect(uniforms.minorColor.value.getHex()).toBe(parseHexColor(obsidian.gridMinor));
    expect(uniforms.majorColor.value.getHex()).toBe(parseHexColor(obsidian.gridMajor));
    expect(uniforms.floorColor.value.getHex()).toBe(parseHexColor(obsidian.gridFloor));
    expect(uniforms.axisY.value.getHex()).toBe(parseHexColor(obsidian.gizmoY));
  });
});

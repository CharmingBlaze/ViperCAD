import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { ViewportWorld, VIEWPORT_CLEAR } from '@/renderer/ViewportWorld';
import { parseHexColor, themeById } from '@/app/theme/themeTokens';

describe('ViewportWorld', () => {
  it('uses a sky colour as the fallback clear', () => {
    expect(VIEWPORT_CLEAR).toBe(0x1b1d20);
  });

  it('applies a theme sky palette', () => {
    const world = new ViewportWorld();
    const palette = themeById('phosphor').palette;
    world.applyPalette(palette);
    expect(world.material.uniforms.horizon.value.getHex()).toBe(parseHexColor(palette.horizon));
    expect(world.material.uniforms.zenith.value.getHex()).toBe(parseHexColor(palette.zenith));
  });

  it('restores sky colours when switching back to a previous theme', () => {
    const world = new ViewportWorld();
    world.applyPalette(themeById('phosphor').palette);
    world.applyPalette(themeById('synthwave').palette);
    const obsidian = themeById('obsidian').palette;
    world.applyPalette(obsidian);
    expect(world.material.uniforms.horizon.value.getHex()).toBe(parseHexColor(obsidian.horizon));
    expect(world.material.uniforms.zenith.value.getHex()).toBe(parseHexColor(obsidian.zenith));
    expect(world.material.uniforms.ground.value.getHex()).toBe(parseHexColor(obsidian.ground));
    expect(world.material.uniforms.sunColor.value.getHex()).toBe(parseHexColor(obsidian.sun));
  });

  it('rebuilds camera rays from the current projection', () => {
    const world = new ViewportWorld();
    const camera = new PerspectiveCamera(55, 1.5, 0.1, 1000);
    camera.position.set(12, 8, 12);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    world.sync(camera);
    const inverse = world.material.uniforms.viewProjInverse.value;
    expect(inverse.elements.some((value: number) => value !== 0)).toBe(true);
  });
});

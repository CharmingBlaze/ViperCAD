import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { ViewportWorld, VIEWPORT_CLEAR } from '@/renderer/ViewportWorld';

describe('ViewportWorld', () => {
  it('uses a sky colour as the fallback clear', () => {
    expect(VIEWPORT_CLEAR).toBe(0x1b1d20);
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

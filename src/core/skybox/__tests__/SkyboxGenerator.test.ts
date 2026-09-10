import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SKY_PARAMS,
  SKY_PRESETS,
  generateSkyboxCubeMesh,
  generateSkysphereMesh,
} from '@/core/skybox/SkyboxGenerator';

describe('SkyboxGenerator', () => {
  it('generates inverted 3D Skysphere mesh with 360° UV mapping', () => {
    const skysphere = generateSkysphereMesh(500, 16);
    expect(skysphere.vertices.size).toBeGreaterThan(0);
    expect(skysphere.faces.size).toBeGreaterThan(0);

    const defaultLayer = skysphere.defaultUvLayerId!;
    for (const corner of skysphere.faceCorners.values()) {
      const uv = corner.uvs.get(defaultLayer);
      expect(uv).toBeDefined();
    }
  });

  it('generates inverted 6-sided Skybox Cube mesh', () => {
    const skyboxCube = generateSkyboxCubeMesh(500);
    expect(skyboxCube.vertices.size).toBe(8);
    expect(skyboxCube.faces.size).toBe(6);
  });

  it('provides complete default sky parameters and presets', () => {
    expect(DEFAULT_SKY_PARAMS.sunElevation).toBeGreaterThan(0);
    expect(SKY_PRESETS.sunset.horizonColor).toBeDefined();
    expect(SKY_PRESETS.night.starIntensity).toBeGreaterThan(0.5);
  });
});

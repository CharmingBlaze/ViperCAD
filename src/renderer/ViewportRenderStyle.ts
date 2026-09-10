import {
  Color,
  type Material,
  type MeshBasicMaterial,
  type MeshPhysicalMaterial,
  type MeshStandardMaterial,
  type Texture,
} from 'three';
import { normalizeShadingMode, type ShadingMode } from '@/workspace/types';
import type { ObjectRenderHandle } from '@/renderer/MeshRenderAdapter';

export type StandardLikeMaterial = (MeshStandardMaterial | MeshPhysicalMaterial | MeshBasicMaterial) & {
  wireframe: boolean;
  color: Color;
  map: Texture | null;
};

type StyledMaterial = Material & {
  wireframe: boolean;
  color: Color;
  map: Texture | null;
  flatShading?: boolean;
  normalMap?: Texture | null;
  roughnessMap?: Texture | null;
  metalnessMap?: Texture | null;
  emissiveMap?: Texture | null;
};

type MaterialBaseline = {
  wireframe: boolean;
  flatShading: boolean;
  color: number;
  map: Texture | null;
  normalMap: Texture | null;
  roughnessMap: Texture | null;
  metalnessMap: Texture | null;
  emissiveMap: Texture | null;
};

function asStandardLike(material: Material): StandardLikeMaterial | null {
  if ('wireframe' in material || 'color' in material) {
    return material as StandardLikeMaterial;
  }
  return null;
}

function asStyledMaterial(material: Material): StyledMaterial | null {
  if ('wireframe' in material && 'color' in material && 'map' in material) {
    return material as StyledMaterial;
  }
  return null;
}

function ensureBaseline(material: StyledMaterial): MaterialBaseline {
  const existing = material.userData.viperRenderBaseline as MaterialBaseline | undefined;
  const std = asStandardLike(material);
  if (existing) {
    if (std?.map) existing.map = std.map;
    return existing;
  }

  const baseline: MaterialBaseline = {
    wireframe: std?.wireframe ?? material.wireframe,
    flatShading: std && 'flatShading' in std
      ? Boolean((std as unknown as { flatShading: boolean }).flatShading)
      : material.flatShading ?? false,
    color: std?.color ? std.color.getHex() : material.color.getHex(),
    map: std?.map ?? material.map,
    normalMap: std && 'normalMap' in std
      ? (std as unknown as { normalMap: Texture | null }).normalMap
      : material.normalMap ?? null,
    roughnessMap: std && 'roughnessMap' in std
      ? (std as unknown as { roughnessMap: Texture | null }).roughnessMap
      : material.roughnessMap ?? null,
    metalnessMap: std && 'metalnessMap' in std
      ? (std as unknown as { metalnessMap: Texture | null }).metalnessMap
      : material.metalnessMap ?? null,
    emissiveMap: std && 'emissiveMap' in std
      ? (std as unknown as { emissiveMap: Texture | null }).emissiveMap
      : material.emissiveMap ?? null,
  };
  material.userData.viperRenderBaseline = baseline;
  return baseline;
}

function restoreMaps(material: StyledMaterial, baseline: MaterialBaseline): void {
  material.map = baseline.map;
  if ('normalMap' in material) material.normalMap = baseline.normalMap;
  if ('roughnessMap' in material) material.roughnessMap = baseline.roughnessMap;
  if ('metalnessMap' in material) material.metalnessMap = baseline.metalnessMap;
  if ('emissiveMap' in material) material.emissiveMap = baseline.emissiveMap;
}

export function applyViewportRenderStyle(
  handle: ObjectRenderHandle,
  modeInput: ShadingMode | unknown,
  options: { displayTextures?: boolean } = {},
): void {
  const mode = normalizeShadingMode(modeInput);
  const displayTextures = options.displayTextures !== false;

  for (const rawMaterial of handle.materials) {
    const material = asStyledMaterial(rawMaterial);
    if (!material) continue;
    const baseline = ensureBaseline(material);
    const std = asStandardLike(material);

    if (std) {
      std.wireframe = mode === 'wireframe';
      if (mode === 'silhouette') {
        if (std.color) std.color.setHex(0x1a1a1a);
      } else {
        if (std.color) std.color.setHex(baseline.color);
      }
    }
    if (mode === 'silhouette' || !displayTextures) {
      if (std) std.map = null;
    } else {
      restoreMaps(material, baseline);
    }

    // Preserve authored face shading in every preview. Game mode is an engine
    // look (overlays off), not a forced-flat override — artists who want flat
    // set it on the material. Skyboxes stay smooth so the dome does not facet.
    if (std && 'flatShading' in std) {
      const isSky = handle.mesh.name.toLowerCase().includes('sky');
      (std as unknown as { flatShading: boolean }).flatShading = isSky
        ? false
        : baseline.flatShading;
    } else if ('flatShading' in material) {
      const isSky = handle.mesh.name.toLowerCase().includes('sky');
      material.flatShading = isSky ? false : baseline.flatShading;
    }

    material.needsUpdate = true;
  }
}

export function renderStyleShowsAllEdges(modeInput: ShadingMode | unknown): boolean {
  const mode = normalizeShadingMode(modeInput);
  return mode === 'outlines';
}

export function renderStyleHidesEdgeOverlay(modeInput: ShadingMode | unknown): boolean {
  const mode = normalizeShadingMode(modeInput);
  return mode === 'wireframe' || mode === 'game' || mode === 'silhouette';
}

export function edgeOverlayStyleForRenderMode(modeInput: ShadingMode | unknown): {
  color: Color;
  opacity: number;
} {
  const mode = normalizeShadingMode(modeInput);
  if (mode === 'game') {
    return { color: new Color(0x0a0c10), opacity: 0.95 };
  }
  return { color: new Color(0x1a1f28), opacity: 0.42 };
}

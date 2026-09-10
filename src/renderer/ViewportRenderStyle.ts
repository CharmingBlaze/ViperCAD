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

function ensureBaseline(material: Material): MaterialBaseline {
  const existing = material.userData.viperRenderBaseline as MaterialBaseline | undefined;
  const std = asStandardLike(material);
  if (existing) {
    if (std?.map) existing.map = std.map;
    return existing;
  }

  const baseline: MaterialBaseline = {
    wireframe: std?.wireframe ?? false,
    flatShading: std && 'flatShading' in std ? Boolean((std as unknown as { flatShading: boolean }).flatShading) : false,
    color: std?.color ? std.color.getHex() : 0xffffff,
    map: std?.map ?? null,
    normalMap: std && 'normalMap' in std ? (std as unknown as { normalMap: Texture | null }).normalMap : null,
    roughnessMap: std && 'roughnessMap' in std ? (std as unknown as { roughnessMap: Texture | null }).roughnessMap : null,
    metalnessMap: std && 'metalnessMap' in std ? (std as unknown as { metalnessMap: Texture | null }).metalnessMap : null,
    emissiveMap: std && 'emissiveMap' in std ? (std as unknown as { emissiveMap: Texture | null }).emissiveMap : null,
  };
  material.userData.viperRenderBaseline = baseline;
  return baseline;
}

function restoreMaps(material: Material, baseline: MaterialBaseline): void {
  const std = asStandardLike(material);
  if (!std) return;

  std.map = baseline.map;
  if ('normalMap' in std) (std as unknown as { normalMap: Texture | null }).normalMap = baseline.normalMap;
  if ('roughnessMap' in std) (std as unknown as { roughnessMap: Texture | null }).roughnessMap = baseline.roughnessMap;
  if ('metalnessMap' in std) (std as unknown as { metalnessMap: Texture | null }).metalnessMap = baseline.metalnessMap;
  if ('emissiveMap' in std) (std as unknown as { emissiveMap: Texture | null }).emissiveMap = baseline.emissiveMap;
}

export function applyViewportRenderStyle(
  handle: ObjectRenderHandle,
  modeInput: ShadingMode | unknown,
  options: { displayTextures?: boolean } = {},
): void {
  const mode = normalizeShadingMode(modeInput);
  const displayTextures = options.displayTextures !== false;

  for (const material of handle.materials) {
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

    // Studio preview is a lit asset view, not a topology-debug view. Preserve
    // the material/face shading authored by the user so curved assets read
    // smoothly while modelling.
    if (std && 'flatShading' in std) {
      (std as unknown as { flatShading: boolean }).flatShading = baseline.flatShading;
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

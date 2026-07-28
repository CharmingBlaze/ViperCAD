import {
  Color,
  type Material,
  type Texture,
} from 'three';
import { normalizeShadingMode, type ShadingMode } from '@/workspace/types';
import type { ObjectRenderHandle } from '@/renderer/MeshRenderAdapter';

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

function asStyledMaterial(material: Material): StyledMaterial | null {
  if ('wireframe' in material && 'color' in material && 'map' in material) {
    return material as StyledMaterial;
  }
  return null;
}

function ensureBaseline(material: StyledMaterial): MaterialBaseline {
  const existing = material.userData.viperRenderBaseline as MaterialBaseline | undefined;
  if (existing) return existing;

  const baseline: MaterialBaseline = {
    wireframe: material.wireframe,
    flatShading: material.flatShading ?? false,
    color: material.color.getHex(),
    map: material.map,
    normalMap: material.normalMap ?? null,
    roughnessMap: material.roughnessMap ?? null,
    metalnessMap: material.metalnessMap ?? null,
    emissiveMap: material.emissiveMap ?? null,
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
): void {
  const mode = normalizeShadingMode(modeInput);

  for (const rawMaterial of handle.materials) {
    const material = asStyledMaterial(rawMaterial);
    if (!material) continue;
    const baseline = ensureBaseline(material);

    material.wireframe = mode === 'wireframe';
    material.color.setHex(baseline.color);
    restoreMaps(material, baseline);

    if ('flatShading' in material) {
      material.flatShading = mode === 'game' ? true : baseline.flatShading;
    }

    material.needsUpdate = true;
  }
}

export function renderStyleShowsAllEdges(modeInput: ShadingMode | unknown): boolean {
  const mode = normalizeShadingMode(modeInput);
  return mode === 'outlines' || mode === 'game';
}

export function renderStyleHidesEdgeOverlay(modeInput: ShadingMode | unknown): boolean {
  return normalizeShadingMode(modeInput) === 'wireframe';
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

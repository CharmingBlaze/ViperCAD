import {
  Color,
  type Material,
  type MeshBasicMaterial,
  type MeshPhysicalMaterial,
  type MeshStandardMaterial,
} from 'three';
import { normalizeShadingMode, type ShadingMode } from '@/workspace/types';
import type { ObjectRenderHandle } from '@/renderer/MeshRenderAdapter';

type StandardLike = MeshStandardMaterial | MeshPhysicalMaterial | MeshBasicMaterial;

type MaterialBaseline = {
  wireframe: boolean;
  flatShading: boolean;
  color: number;
  map: Material['map'];
  normalMap: StandardLike['normalMap'];
  roughnessMap: StandardLike['roughnessMap'];
  metalnessMap: StandardLike['metalnessMap'];
  emissiveMap: StandardLike['emissiveMap'];
};

function asStandardLike(material: Material): StandardLike | null {
  if ('roughness' in material || 'normalMap' in material || material.type === 'MeshBasicMaterial') {
    return material as StandardLike;
  }
  return null;
}

function ensureBaseline(material: Material): MaterialBaseline {
  const existing = material.userData.viperRenderBaseline as MaterialBaseline | undefined;
  if (existing) return existing;

  const standard = asStandardLike(material);
  const baseline: MaterialBaseline = {
    wireframe: material.wireframe,
    flatShading: standard && 'flatShading' in standard ? standard.flatShading : false,
    color: material.color.getHex(),
    map: material.map,
    normalMap: standard?.normalMap ?? null,
    roughnessMap: standard?.roughnessMap ?? null,
    metalnessMap: standard?.metalnessMap ?? null,
    emissiveMap: standard?.emissiveMap ?? null,
  };
  material.userData.viperRenderBaseline = baseline;
  return baseline;
}

function restoreMaps(material: Material, baseline: MaterialBaseline): void {
  material.map = baseline.map;
  const standard = asStandardLike(material);
  if (!standard) return;
  standard.normalMap = baseline.normalMap;
  standard.roughnessMap = baseline.roughnessMap;
  standard.metalnessMap = baseline.metalnessMap;
  standard.emissiveMap = baseline.emissiveMap;
}

export function applyViewportRenderStyle(
  handle: ObjectRenderHandle,
  modeInput: ShadingMode | unknown,
): void {
  const mode = normalizeShadingMode(modeInput);

  for (const material of handle.materials) {
    const baseline = ensureBaseline(material);
    const standard = asStandardLike(material);

    material.wireframe = mode === 'wireframe';
    material.color.setHex(baseline.color);
    restoreMaps(material, baseline);

    if (standard && 'flatShading' in standard) {
      standard.flatShading = mode === 'game' ? true : baseline.flatShading;
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

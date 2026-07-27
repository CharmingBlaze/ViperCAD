import {
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Material,
} from 'three';
import type { MaterialAsset, ModelDocument, ObjectId, ViperProject } from '@/core/document/types';
import type { BoneId, SkinBinding } from '@/core/rig/types';
import {
  materialAssetToThree,
  type RenderAssetResolver,
} from '@/renderer/MeshRenderAdapter';
import type { RigSkinnedMesh } from '@/core/rig/SkinnedMeshBuilder';
import { BufferAttribute } from 'three';

export type RigViewportDisplayMode = 'material' | 'uv' | 'wireframe';

export function resolveObjectMaterials(
  project: ViperProject,
  source: ModelDocument,
  objectId: ObjectId,
): { materials: MaterialAsset[]; assets: RenderAssetResolver } {
  const object = source.objects.get(objectId);
  const materials = (object?.materialSlotIds ?? [])
    .map((id) => project.materials.get(id))
    .filter((material): material is MaterialAsset => !!material);
  return {
    materials,
    assets: { textures: project.textures, images: project.images },
  };
}

export function buildSkinnedMeshMaterials(
  materialAssets: MaterialAsset[],
  assets: RenderAssetResolver,
  slotCount: number,
): Material | Material[] {
  if (!materialAssets.length) {
    return new MeshStandardMaterial({
      color: 0x8ea0b8,
      metalness: 0.05,
      roughness: 0.75,
    });
  }

  const slots = Math.max(slotCount, materialAssets.length, 1);
  const threeMaterials: Material[] = [];
  for (let slot = 0; slot < slots; slot += 1) {
    const asset = materialAssets[slot] ?? materialAssets[materialAssets.length - 1]!;
    threeMaterials.push(materialAssetToThree(asset, assets));
  }
  return threeMaterials.length === 1 ? threeMaterials[0]! : threeMaterials;
}

let uvCheckerMaterial: MeshBasicMaterial | null = null;

export function createUvCheckerMaterial(): MeshBasicMaterial {
  if (uvCheckerMaterial) return uvCheckerMaterial;
  const material = new MeshBasicMaterial({ color: 0xffffff });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec4 diffuseColor = vec4( diffuse, opacity );',
      `#ifdef USE_UV
        vec2 checkerUv = vUv * 10.0;
        vec2 cell = floor(checkerUv);
        float check = mod(cell.x + cell.y, 2.0);
        vec3 checker = mix(vec3(0.12, 0.14, 0.18), vec3(0.82, 0.85, 0.9), check);
        vec4 diffuseColor = vec4(checker, opacity);
      #else
        vec4 diffuseColor = vec4( diffuse, opacity );
      #endif`,
    );
  };
  const previousKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${previousKey()}|rigUvChecker`;
  uvCheckerMaterial = material;
  return material;
}

function applyWeightPaintColors(
  rigMesh: RigSkinnedMesh,
  binding: SkinBinding,
  boneId: BoneId,
): void {
  const colors = new Float32Array(rigMesh.renderVertexIds.length * 3);
  for (let index = 0; index < rigMesh.renderVertexIds.length; index += 1) {
    const vertexId = rigMesh.renderVertexIds[index]!;
    const weight = binding.vertexWeights.get(vertexId)?.find((entry) => entry.boneId === boneId)?.weight ?? 0;
    colors[index * 3] = 0.2 + weight * 0.7;
    colors[index * 3 + 1] = 0.25 + weight * 0.2;
    colors[index * 3 + 2] = 0.35;
  }
  rigMesh.mesh.geometry.setAttribute('color', new BufferAttribute(colors, 3));
  rigMesh.mesh.material = rigMesh.weightPaintMaterial;
}

export function clearWeightPaintColors(rigMesh: RigSkinnedMesh): void {
  rigMesh.mesh.geometry.deleteAttribute('color');
}

function asMaterialArray(materials: Material | Material[]): Material[] {
  return Array.isArray(materials) ? materials : [materials];
}

export function applyRigMeshDisplayMode(
  rigMesh: RigSkinnedMesh,
  mode: RigViewportDisplayMode,
  options: {
    weightPaint?: boolean;
    binding?: SkinBinding;
    boneId?: BoneId | null;
  } = {},
): void {
  if (options.weightPaint && options.binding && options.boneId) {
    applyWeightPaintColors(rigMesh, options.binding, options.boneId);
    return;
  }

  rigMesh.mesh.geometry.deleteAttribute('color');

  if (mode === 'uv') {
    rigMesh.mesh.material = createUvCheckerMaterial();
    return;
  }

  for (const material of asMaterialArray(rigMesh.baseMaterials)) {
    material.wireframe = mode === 'wireframe';
    material.vertexColors = false;
    material.needsUpdate = true;
  }
  rigMesh.mesh.material = rigMesh.baseMaterials;
}

export function applyStaticMeshDisplayMode(
  materials: Material[],
  mode: RigViewportDisplayMode,
): Material | Material[] {
  if (mode === 'uv') return createUvCheckerMaterial();
  for (const material of materials) {
    material.wireframe = mode === 'wireframe';
    material.needsUpdate = true;
  }
  return materials.length === 1 ? materials[0]! : materials;
}

export function disposeRigMeshMaterials(rigMesh: RigSkinnedMesh): void {
  for (const material of asMaterialArray(rigMesh.baseMaterials)) {
    disposeThreeMaterial(material);
  }
  rigMesh.weightPaintMaterial?.dispose();
}

export function disposeStaticRenderHandle(handle: { materials: Material[]; renderData: { geometry: { dispose(): void } }; edgeOverlay: { geometry: { dispose(): void } } }): void {
  for (const material of handle.materials) disposeThreeMaterial(material);
  handle.renderData.geometry.dispose();
  handle.edgeOverlay.geometry.dispose();
}

function disposeThreeMaterial(material: Material): void {
  const maps = material as MeshStandardMaterial;
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap'] as const) {
    maps[key]?.dispose();
  }
  material.dispose();
}

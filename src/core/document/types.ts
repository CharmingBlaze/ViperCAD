import type { ElementId } from '@/core/ids/IdService';
import type { Transform } from '@/core/math/Transform';
import type { Vec3 } from '@/core/math/Vec3';
import type { EditableMesh, MeshId } from '@/core/mesh/types';

export type ObjectId = ElementId;
export type MaterialId = ElementId;
export type TextureId = ElementId;
export type ImageId = ElementId;

export type SceneObject = {
  id: ObjectId;
  name: string;
  parentId: ObjectId | null;
  childIds: ObjectId[];
  transform: Transform;
  meshId: MeshId | null;
  /** Ordered material slot → material asset. */
  materialSlotIds: MaterialId[];
  visible: boolean;
  locked: boolean;
  metadata: Record<string, string>;
};

export type MaterialShadingModel = 'lit' | 'unlit' | 'physical';

export type MaterialAsset = {
  id: MaterialId;
  name: string;
  shadingModel: MaterialShadingModel;
  /** Last applied preset id, or null when hand-edited. */
  presetId: string | null;
  baseColour: Vec3;
  baseColourTextureId: TextureId | null;
  normalTextureId: TextureId | null;
  roughness: number;
  roughnessTextureId: TextureId | null;
  metallic: number;
  metallicTextureId: TextureId | null;
  emissive: Vec3;
  emissiveIntensity: number;
  emissiveTextureId: TextureId | null;
  opacity: number;
  alphaMode: 'opaque' | 'mask' | 'blend';
  alphaCutoff: number;
  /** Glass / physical transmission (0 = opaque). */
  transmission: number;
  /** Index of refraction for glass and physical materials. */
  ior: number;
  clearcoat: number;
  clearcoatRoughness: number;
  doubleSided: boolean;
  unlit: boolean;
  flatShaded: boolean;
  textureFiltering: 'nearest' | 'linear';
  textureWrapping: 'repeat' | 'clamp';
  uvLayerIndex: number;
};

export type ImageAsset = {
  id: ImageId;
  name: string;
  width: number;
  height: number;
  colourMode: 'rgba' | 'indexed';
  /** RGBA bytes length = width * height * 4 */
  pixels: Uint8ClampedArray;
  revision: number;
};

export type TextureAsset = {
  id: TextureId;
  name: string;
  imageAssetId: ImageId;
  filtering: 'nearest' | 'linear';
  wrapping: 'repeat' | 'clamp';
  /** UV tile count. Optional for backward-compatible project loading. */
  repeatU?: number;
  repeatV?: number;
  offsetU?: number;
  offsetV?: number;
  rotationDegrees?: number;
  colourSpace: 'srgb' | 'linear';
  generateMipmaps: boolean;
};

export type SymmetryAxis = 'x' | 'y' | 'z';

export type SymmetrySettings = {
  x: boolean;
  y: boolean;
  z: boolean;
  radialEnabled: boolean;
  radialAxis: SymmetryAxis;
  radialCount: number;
  /** Shared by component transforms and future sculpt brushes. */
  liveMirror: boolean;
  mergeTolerance: number;
};

export type ProjectSettings = {
  units: 'meters' | 'centimeters' | 'unitless';
  gridSize: number;
  gridDivisions: number;
  snapEnabled: boolean;
  snapIncrement: number;
  angleSnapDegrees: number;
  modellingProfile: 'general' | 'character';
  symmetry: SymmetrySettings;
};

export type ModelDocument = {
  id: ElementId;
  name: string;
  version: number;
  objects: Map<ObjectId, SceneObject>;
  rootObjectIds: ObjectId[];
  meshes: Map<MeshId, EditableMesh>;
  materials: Map<MaterialId, MaterialAsset>;
  textures: Map<TextureId, TextureAsset>;
  images: Map<ImageId, ImageAsset>;
  settings: ProjectSettings;
  dirty: boolean;
};

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  units: 'meters',
  gridSize: 1,
  gridDivisions: 10,
  snapEnabled: true,
  snapIncrement: 0.25,
  angleSnapDegrees: 15,
  modellingProfile: 'general',
  symmetry: {
    x: false,
    y: false,
    z: false,
    radialEnabled: false,
    radialAxis: 'y',
    radialCount: 8,
    liveMirror: true,
    mergeTolerance: 0.001,
  },
};

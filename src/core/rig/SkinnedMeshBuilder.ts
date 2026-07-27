import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  type Material,
} from 'three';
import type { MaterialAsset } from '@/core/document/types';
import type { EditableMesh, VertexId } from '@/core/mesh/types';
import type { Armature, BoneId, SkinBinding } from '@/core/rig/types';
import type { RenderAssetResolver } from '@/renderer/MeshRenderAdapter';
import { buildSkinnedMeshMaterials } from '@/core/rig/rigMeshDisplay';
import { editableMeshToRenderData } from '@/renderer/MeshRenderAdapter';
import {
  boneWorldMatrix,
  invertMat4Affine,
  multiplyMat4,
  orderedBoneIds,
  restBoneLocalTransforms,
  type Mat4,
} from '@/core/rig/boneMatrices';
import { sampledLocalTransforms } from '@/core/rig/keyframes';
import type { AnimationClip } from '@/core/rig/types';

export type RigMeshBuildOptions = {
  materials?: MaterialAsset[];
  assets?: RenderAssetResolver;
};

export type RigSkinnedMesh = {
  mesh: SkinnedMesh;
  skeleton: Skeleton;
  bones: Bone[];
  boneIndex: Map<BoneId, number>;
  renderVertexIds: VertexId[];
  baseMaterials: Material | Material[];
  weightPaintMaterial: MeshStandardMaterial;
};

function applySkinAttributes(
  rigMesh: RigSkinnedMesh,
  binding: SkinBinding,
): void {
  const skinIndices = rigMesh.mesh.geometry.getAttribute('skinIndex') as BufferAttribute | undefined;
  const skinWeights = rigMesh.mesh.geometry.getAttribute('skinWeight') as BufferAttribute | undefined;
  if (!skinIndices || !skinWeights) return;

  for (let corner = 0; corner < rigMesh.renderVertexIds.length; corner += 1) {
    const vertexId = rigMesh.renderVertexIds[corner]!;
    const influences = binding.vertexWeights.get(vertexId) ?? [];
    for (let slot = 0; slot < 4; slot += 1) {
      const influence = influences[slot];
      skinIndices.array[corner * 4 + slot] = influence ? rigMesh.boneIndex.get(influence.boneId) ?? 0 : 0;
      skinWeights.array[corner * 4 + slot] = influence?.weight ?? 0;
    }
  }
  skinIndices.needsUpdate = true;
  skinWeights.needsUpdate = true;
}

function updateInverseBindMatrices(
  rigMesh: RigSkinnedMesh,
  armature: Armature,
): void {
  const restLocals = restBoneLocalTransforms(armature);
  const restCache = new Map<BoneId, Mat4>();
  const boneIds = orderedBoneIds(armature);

  for (let index = 0; index < boneIds.length; index += 1) {
    const boneId = boneIds[index]!;
    const world = boneWorldMatrix(armature, boneId, restLocals, restCache);
    rigMesh.skeleton.boneInverses[index]!.fromArray(invertMat4Affine(world));
    const bone = armature.bones.get(boneId);
    const parentId = bone?.parentId;
    const parentWorld = parentId ? boneWorldMatrix(armature, parentId, restLocals, restCache) : null;
    const local = parentWorld ? multiplyMat4(invertMat4Affine(parentWorld), world) : world;
    rigMesh.bones[index]!.matrix.fromArray(local);
    rigMesh.bones[index]!.matrixWorldNeedsUpdate = true;
  }
  rigMesh.skeleton.calculateInverses();
}

export function refreshSkinnedMeshBinding(
  rigMesh: RigSkinnedMesh,
  binding: SkinBinding,
  armature: Armature,
): void {
  applySkinAttributes(rigMesh, binding);
  updateInverseBindMatrices(rigMesh, armature);
  rigMesh.skeleton.update();
  rigMesh.mesh.computeBoundingSphere();
}

export function buildSkinnedMesh(
  editable: EditableMesh,
  binding: SkinBinding,
  armature: Armature,
  options: RigMeshBuildOptions = {},
): RigSkinnedMesh {
  const renderData = editableMeshToRenderData(editable);
  const geometry = renderData.geometry.clone();
  const maxSlot = renderData.materialGroups.reduce((max, group) => Math.max(max, group.materialSlot), 0);
  const boneIds = orderedBoneIds(armature);
  const boneIndex = new Map<BoneId, number>(boneIds.map((id, index) => [id, index]));

  const skinIndices = new Float32Array(renderData.renderVertexIds.length * 4);
  const skinWeights = new Float32Array(renderData.renderVertexIds.length * 4);

  for (let corner = 0; corner < renderData.renderVertexIds.length; corner += 1) {
    const vertexId = renderData.renderVertexIds[corner]!;
    const influences = binding.vertexWeights.get(vertexId) ?? [];
    for (let slot = 0; slot < 4; slot += 1) {
      const influence = influences[slot];
      skinIndices[corner * 4 + slot] = influence ? boneIndex.get(influence.boneId) ?? 0 : 0;
      skinWeights[corner * 4 + slot] = influence?.weight ?? 0;
    }
  }

  geometry.setAttribute('skinIndex', new BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(skinWeights, 4));

  const restLocals = restBoneLocalTransforms(armature);
  const restCache = new Map<BoneId, Mat4>();
  const inverseBindMatrices: Matrix4[] = [];

  const threeBones: Bone[] = boneIds.map((boneId, index) => {
    const bone = new Bone();
    bone.name = armature.bones.get(boneId)?.name ?? boneId;
    const world = boneWorldMatrix(armature, boneId, restLocals, restCache);
    const parentId = armature.bones.get(boneId)?.parentId;
    const parentWorld = parentId ? boneWorldMatrix(armature, parentId, restLocals, restCache) : null;
    const local = parentWorld ? multiplyMat4(invertMat4Affine(parentWorld), world) : world;
    bone.matrix.fromArray(local);
    bone.matrixAutoUpdate = false;
    inverseBindMatrices[index] = new Matrix4().fromArray(invertMat4Affine(world));
    return bone;
  });

  for (let index = 0; index < threeBones.length; index += 1) {
    const boneId = boneIds[index]!;
    const parentId = armature.bones.get(boneId)?.parentId;
    const parentIndex = parentId ? boneIndex.get(parentId) : undefined;
    if (parentIndex != null) threeBones[parentIndex]!.add(threeBones[index]!);
  }

  const skeleton = new Skeleton(threeBones, inverseBindMatrices);
  const baseMaterials = buildSkinnedMeshMaterials(
    options.materials ?? [],
    options.assets ?? { textures: new Map(), images: new Map() },
    maxSlot + 1,
  );
  const weightPaintMaterial = new MeshStandardMaterial({
    color: 0x8ea0b8,
    flatShading: true,
    metalness: 0.05,
    roughness: 0.75,
    vertexColors: true,
  });
  const mesh = new SkinnedMesh(geometry, baseMaterials);
  for (const boneId of armature.rootBoneIds) {
    const rootIndex = boneIndex.get(boneId);
    if (rootIndex != null) mesh.add(threeBones[rootIndex]!);
  }
  mesh.bind(skeleton);

  return {
    mesh,
    skeleton,
    bones: threeBones,
    boneIndex,
    renderVertexIds: renderData.renderVertexIds,
    baseMaterials,
    weightPaintMaterial,
  };
}

export function updateSkinnedMeshPose(
  rigMesh: RigSkinnedMesh,
  armature: Armature,
  clip: AnimationClip | null,
  time: number,
): void {
  const locals = sampledLocalTransforms(armature, clip, time);
  const worldCache = new Map<BoneId, Mat4>();
  const boneIds = orderedBoneIds(armature);

  for (let index = 0; index < boneIds.length; index += 1) {
    const boneId = boneIds[index]!;
    const world = boneWorldMatrix(armature, boneId, locals, worldCache);
    const parentId = armature.bones.get(boneId)?.parentId;
    const parentWorld = parentId ? boneWorldMatrix(armature, parentId, locals, worldCache) : null;
    const local = parentWorld ? multiplyMat4(invertMat4Affine(parentWorld), world) : world;
    const bone = rigMesh.bones[index]!;
    bone.matrix.fromArray(local);
    bone.matrixWorldNeedsUpdate = true;
  }

  rigMesh.skeleton.update();
  rigMesh.mesh.computeBoundingSphere();
}

export function applyWeightPaintColors(
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

export { clearWeightPaintColors } from '@/core/rig/rigMeshDisplay';

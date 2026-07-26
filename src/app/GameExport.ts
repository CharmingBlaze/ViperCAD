import { Group, Mesh, Scene, type Material, type Object3D, type Texture } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bakeAtlasTilesForExport } from '@/app/AtlasGltfBake';
import type { ModelDocument, ObjectId } from '@/core/document/types';
import { EXPORT_PROFILES, type ExportProfile } from '@/app/GameExportProfiles';
import {
  editableMeshToRenderData,
  materialAssetToThree,
} from '@/renderer/MeshRenderAdapter';

/** Export the complete editable scene as a game-ready binary glTF. */
export async function exportDocumentGlb(
  document: ModelDocument,
  profile: ExportProfile = EXPORT_PROFILES.godot,
): Promise<ArrayBuffer> {
  const scene = new Scene();
  scene.name = document.name;
  const exportRoot = new Group();
  exportRoot.name = `${document.name}_Root`;
  const unitScale = document.settings.units === 'centimeters' ? 0.01 : 1;
  exportRoot.scale.setScalar(unitScale * profile.scale);
  if (profile.upAxis === 'z') exportRoot.rotation.x = -Math.PI / 2;
  exportRoot.userData = { viperUnits: document.settings.units, metersPerUnit: unitScale, exportProfile: profile.id };
  scene.add(exportRoot);
  const nodes = new Map<ObjectId, Object3D>();
  const disposableMaterials: Material[] = [];
  const disposableTextures: Texture[] = [];

  for (const object of document.objects.values()) {
    if (!profile.includeColliders && object.metadata.gameRole === 'collision') continue;
    if (profile.onlyVisible && !object.visible) continue;
    const meshData = object.meshId ? document.meshes.get(object.meshId) : null;
    let node: Object3D;
    if (meshData) {
      // Bake viewport atlas-tile wraps; strip custom attrs Blender cannot use.
      const exportMesh = bakeAtlasTilesForExport(meshData);
      const render = editableMeshToRenderData(exportMesh);
      render.geometry.deleteAttribute('atlasTileRect');
      const assets = { textures: document.textures, images: document.images };
      const materials = object.materialSlotIds
        .map((id) => document.materials.get(id))
        .filter((material) => !!material)
        .map((material) => materialAssetToThree(
          profile.textureFiltering === 'material'
            ? material
            : { ...material, textureFiltering: profile.textureFiltering },
          assets,
          { forGltfExport: true },
        ));
      disposableMaterials.push(...materials);
      for (const material of materials) {
        if (material.map) disposableTextures.push(material.map);
      }
      node = new Mesh(render.geometry, materials.length === 1 ? materials[0] : materials);
    } else {
      node = new Group();
    }
    node.name = object.name;
    node.visible = object.visible;
    node.position.set(
      object.transform.position.x,
      object.transform.position.y,
      object.transform.position.z,
    );
    node.rotation.set(
      object.transform.rotation.x,
      object.transform.rotation.y,
      object.transform.rotation.z,
    );
    node.scale.set(object.transform.scale.x, object.transform.scale.y, object.transform.scale.z);
    node.userData = {
      ...object.metadata,
      viperId: object.id,
      role: object.metadata.gameRole ?? 'geometry',
      collision: object.metadata.collision ?? 'none',
    };
    nodes.set(object.id, node);
  }

  for (const object of document.objects.values()) {
    const node = nodes.get(object.id);
    if (!node) continue;
    const parent = object.parentId ? nodes.get(object.parentId) : null;
    (parent ?? exportRoot).add(node);
  }

  try {
    return await new Promise<ArrayBuffer>((resolve, reject) => {
      new GLTFExporter().parse(
        scene,
        (result) => {
          if (result instanceof ArrayBuffer) resolve(result);
          else reject(new Error('GLB exporter returned JSON instead of binary data'));
        },
        (error) => reject(error),
        {
          binary: true,
          onlyVisible: profile.onlyVisible,
          trs: true,
          includeCustomExtensions: true,
        },
      );
    });
  } finally {
    for (const node of nodes.values()) {
      if (node instanceof Mesh) node.geometry.dispose();
    }
    for (const material of disposableMaterials) material.dispose();
    for (const texture of disposableTextures) texture.dispose();
  }
}

export type GlbRoundTripReport = {
  errors: string[];
  meshes: number;
  triangles: number;
  materials: number;
};

/** Parses the generated GLB again before download to catch corrupt or empty exports. */
export async function validateGlbRoundTrip(buffer: ArrayBuffer): Promise<GlbRoundTripReport> {
  try {
    const gltf = await new Promise<Awaited<ReturnType<GLTFLoader['parseAsync']>>>((resolve, reject) => {
      new GLTFLoader().parse(buffer, '', resolve, reject);
    });
    let meshes = 0;
    let triangles = 0;
    const materials = new Set<Material>();
    gltf.scene.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      meshes += 1;
      const positionCount = node.geometry.getAttribute('position')?.count ?? 0;
      triangles += Math.floor((node.geometry.index?.count ?? positionCount) / 3);
      const nodeMaterials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of nodeMaterials) materials.add(material);
    });
    return {
      errors: meshes > 0 && triangles === 0 ? ['Round-trip validation found meshes with no triangles.'] : [],
      meshes,
      triangles,
      materials: materials.size,
    };
  } catch (error) {
    return {
      errors: [error instanceof Error ? `GLB round-trip failed: ${error.message}` : 'GLB round-trip failed.'],
      meshes: 0,
      triangles: 0,
      materials: 0,
    };
  }
}

export { EXPORT_PROFILES } from '@/app/GameExportProfiles';
export type { ExportProfile } from '@/app/GameExportProfiles';

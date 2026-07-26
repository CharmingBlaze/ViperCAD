import { Mesh as ThreeMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { v2 } from '@/core/math/Vec2';
import { v3 } from '@/core/math/Vec3';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import type { EditableMesh } from '@/core/mesh/types';

/** Imports mesh geometry from GLB or self-contained glTF. Node transforms are baked into vertices. */
export async function importGltf(data: ArrayBuffer): Promise<EditableMesh[]> {
  const gltf = await new Promise<Awaited<ReturnType<GLTFLoader['parseAsync']>>>((resolve, reject) => {
    new GLTFLoader().parse(data, '', resolve, reject);
  });
  gltf.scene.updateMatrixWorld(true);
  const imported: EditableMesh[] = [];
  gltf.scene.traverse((node) => {
    if (!(node instanceof ThreeMesh)) return;
    const geometry = node.geometry;
    const positions = geometry.getAttribute('position');
    if (!positions || positions.count < 3) return;
    const uvs = geometry.getAttribute('uv');
    const indices = geometry.index
      ? Array.from(geometry.index.array, Number)
      : Array.from({ length: positions.count }, (_, index) => index);
    const builder = new MeshBuilder(node.name || `glTF Mesh ${imported.length + 1}`, true);
    const vertices = Array.from({ length: positions.count }, (_, index) => {
      const point = new Vector3(positions.getX(index), positions.getY(index), positions.getZ(index));
      point.applyMatrix4(node.matrixWorld);
      return builder.vertex(v3(point.x, point.y, point.z));
    });
    const materialSlotForTriangle = (triangleOffset: number) => {
      const group = geometry.groups.find((item: { start: number; count: number; materialIndex?: number }) =>
        triangleOffset >= item.start && triangleOffset < item.start + item.count,
      );
      return group?.materialIndex ?? 0;
    };
    builder.setMaterialSlotCount(Math.max(1, geometry.groups.length, Array.isArray(node.material) ? node.material.length : 1));
    for (let offset = 0; offset + 2 < indices.length; offset += 3) {
      const ids = [indices[offset]!, indices[offset + 1]!, indices[offset + 2]!] as const;
      builder.tri(
        vertices[ids[0]]!,
        vertices[ids[1]]!,
        vertices[ids[2]]!,
        uvs ? ids.map((index) => v2(uvs.getX(index), uvs.getY(index))) : undefined,
        materialSlotForTriangle(offset),
      );
    }
    imported.push(builder.build());
  });
  if (!imported.length) throw new Error('The glTF file contains no importable mesh geometry.');
  return imported;
}

import { Matrix4, Vector3 } from 'three';
import Module from 'manifold-3d';
import { v3 } from '@/core/math/Vec3';
import { faceVertexIds } from '@/core/mesh/EditableMesh';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import { triangulateFace } from '@/core/mesh/Triangulation';
import type { EditableMesh } from '@/core/mesh/types';

export type BooleanOp = 'difference' | 'union' | 'intersection';

let wasmInstance: any = null;
let wasmPromise: Promise<any> | null = null;

/**
 * Initializes and returns the singleton manifold-3d WASM instance.
 */
export async function getManifoldWasm(): Promise<any> {
  if (wasmInstance) return wasmInstance;
  if (!wasmPromise) {
    wasmPromise = (async () => {
      const init = (Module as any).default || Module;
      const mod = await init();
      mod.setup();
      wasmInstance = mod;
      return mod;
    })();
  }
  return wasmPromise;
}

/**
 * Converts a ViperCAD EditableMesh to a Manifold.Mesh structure in local or world space.
 */
export function editableMeshToManifoldMesh(mesh: EditableMesh, transformMatrix?: Matrix4): any {
  const vertProperties: number[] = [];
  const triVerts: number[] = [];

  // Map each VertexId to its continuous index in the vertProperties array
  const vertexIdToIndex = new Map<string, number>();

  let currentIndex = 0;
  for (const vertex of mesh.vertices.values()) {
    let p = new Vector3(vertex.position.x, vertex.position.y, vertex.position.z);
    if (transformMatrix) {
      p = p.applyMatrix4(transformMatrix);
    }
    vertProperties.push(p.x, p.y, p.z);
    vertexIdToIndex.set(vertex.id, currentIndex);
    currentIndex++;
  }

  // Triangulate every face and extract index triples
  for (const face of mesh.faces.values()) {
    const vIds = faceVertexIds(mesh, face.id);
    const tri = triangulateFace(mesh, face.id);
    for (const [i0, i1, i2] of tri.triangles) {
      const vid0 = vIds[i0]!;
      const vid1 = vIds[i1]!;
      const vid2 = vIds[i2]!;
      triVerts.push(
        vertexIdToIndex.get(vid0)!,
        vertexIdToIndex.get(vid1)!,
        vertexIdToIndex.get(vid2)!,
      );
    }
  }

  return {
    vertProperties: new Float32Array(vertProperties),
    triVerts: new Uint32Array(triVerts),
    numProp: 3,
  };
}

/**
 * Converts a Manifold instance back into an EditableMesh.
 */
export function manifoldToEditableMesh(manifold: any, name = 'Solid'): EditableMesh {
  const mMesh = manifold.getMesh();
  const numProps = mMesh.numProp || 3;
  const vertProps = mMesh.vertProperties;
  const triVerts = mMesh.triVerts;

  const builder = new MeshBuilder(name, false);
  const vertexHandles: ReturnType<typeof builder.vertex>[] = [];

  for (let i = 0; i < vertProps.length; i += numProps) {
    const x = vertProps[i]!;
    const y = vertProps[i + 1]!;
    const z = vertProps[i + 2]!;
    vertexHandles.push(builder.vertex(v3(x, y, z)));
  }

  for (let i = 0; i < triVerts.length; i += 3) {
    const a = triVerts[i]!;
    const b = triVerts[i + 1]!;
    const c = triVerts[i + 2]!;
    builder.tri(vertexHandles[a]!, vertexHandles[b]!, vertexHandles[c]!);
  }

  const resultMesh = builder.build();
  resultMesh.metadata = resultMesh.metadata ?? {};
  resultMesh.metadata.isSolid = 'true';
  resultMesh.metadata.manifold = 'true';
  return resultMesh;
}

/**
 * Executes a solid boolean operation on two or more EditableMeshes.
 */
export async function executeSolidBoolean(
  op: BooleanOp,
  target: EditableMesh,
  cutters: EditableMesh[],
  targetMatrix: Matrix4,
  cutterMatrices: Matrix4[],
  resultName = 'Solid_Result',
): Promise<EditableMesh> {
  const wasm = await getManifoldWasm();
  const { Manifold } = wasm;

  const targetManifoldMesh = editableMeshToManifoldMesh(target, targetMatrix);
  let resultManifold = new Manifold(targetManifoldMesh);

  for (let i = 0; i < cutters.length; i++) {
    const cutterMesh = cutters[i]!;
    const cutterMatrix = cutterMatrices[i] ?? new Matrix4();
    const cManifoldMesh = editableMeshToManifoldMesh(cutterMesh, cutterMatrix);
    const cutterManifold = new Manifold(cManifoldMesh);

    switch (op) {
      case 'difference':
        resultManifold = resultManifold.subtract(cutterManifold);
        break;
      case 'union':
        resultManifold = resultManifold.add(cutterManifold);
        break;
      case 'intersection':
        resultManifold = resultManifold.intersect(cutterManifold);
        break;
    }
  }

  return manifoldToEditableMesh(resultManifold, resultName);
}

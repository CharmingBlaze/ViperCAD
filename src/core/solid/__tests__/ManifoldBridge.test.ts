import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { buildCylinder } from '@/core/mesh/builders/CylinderBuilder';
import {
  editableMeshToManifoldMesh,
  executeSolidBoolean,
  getManifoldWasm,
  manifoldToEditableMesh,
} from '../ManifoldBridge';

describe('ManifoldBridge', () => {
  it('loads the manifold-3d WASM module cleanly', async () => {
    const wasm = await getManifoldWasm();
    expect(wasm).toBeDefined();
    expect(wasm.Manifold).toBeDefined();
  });

  it('converts an EditableMesh to Manifold mesh and back', async () => {
    const box = buildBox({ width: 10, height: 10, depth: 10 });
    const mMesh = editableMeshToManifoldMesh(box);
    expect(mMesh.vertProperties.length).toBe(8 * 3); // 8 vertices * 3
    expect(mMesh.triVerts.length).toBe(12 * 3); // 12 triangles * 3

    const wasm = await getManifoldWasm();
    const manifold = new wasm.Manifold(mMesh);
    const convertedMesh = manifoldToEditableMesh(manifold, 'ConvertedBox');

    expect(convertedMesh.vertices.size).toBe(8);
    expect(convertedMesh.faces.size).toBe(12); // Manifold returns triangulated faces
    expect(convertedMesh.metadata?.manifold).toBe('true');
  });

  it('executes a Difference boolean (Box with a cylindrical hole)', async () => {
    const box = buildBox({ width: 10, height: 10, depth: 10, centered: true });
    const cylinder = buildCylinder({
      radius: 2,
      height: 14,
      radialSegments: 16,
      name: 'Drill',
    });

    const result = await executeSolidBoolean(
      'difference',
      box,
      [cylinder],
      new Matrix4(),
      [new Matrix4()],
      'DrilledBox',
    );

    expect(result.vertices.size).toBeGreaterThan(8);
    expect(result.faces.size).toBeGreaterThan(12);
    expect(result.metadata?.manifold).toBe('true');
  });

  it('executes a Union boolean fusing two overlapping boxes', async () => {
    const boxA = buildBox({ width: 10, height: 10, depth: 10, centered: true });
    const boxB = buildBox({ width: 10, height: 10, depth: 10, centered: true });
    const offsetMatrix = new Matrix4().makeTranslation(new Vector3(5, 0, 0));

    const result = await executeSolidBoolean(
      'union',
      boxA,
      [boxB],
      new Matrix4(),
      [offsetMatrix],
      'FusedBox',
    );

    expect(result.vertices.size).toBeGreaterThan(8);
    expect(result.metadata?.manifold).toBe('true');
  });

  it('executes an Intersection boolean', async () => {
    const boxA = buildBox({ width: 10, height: 10, depth: 10, centered: true });
    const boxB = buildBox({ width: 10, height: 10, depth: 10, centered: true });
    const offsetMatrix = new Matrix4().makeTranslation(new Vector3(5, 0, 0));

    const result = await executeSolidBoolean(
      'intersection',
      boxA,
      [boxB],
      new Matrix4(),
      [offsetMatrix],
      'IntersectBox',
    );

    expect(result.vertices.size).toBeGreaterThan(0);
    expect(result.faces.size).toBeGreaterThan(0);
  });
});

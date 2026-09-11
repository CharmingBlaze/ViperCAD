import { describe, expect, it } from 'vitest';
import { commitMeshObject } from '@/core/document/ModelDocument';
import { EditorSession } from '@/core/editor/EditorSession';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { buildCylinder } from '@/core/mesh/builders/CylinderBuilder';
import { applySolidBoolean } from '../BooleanOperations';

describe('BooleanOperations (applySolidBoolean)', () => {
  it('cuts a cylinder hole into a box and supports undo/redo', async () => {
    const session = new EditorSession();
    const boxMesh = buildBox({ width: 10, height: 10, depth: 10, centered: true });
    const cylMesh = buildCylinder({ radius: 2, height: 14, radialSegments: 16 });

    const boxObj = commitMeshObject(session.document, boxMesh, { name: 'TargetBox' });
    const cylObj = commitMeshObject(session.document, cylMesh, { name: 'CutterCylinder' });

    expect(session.document.objects.size).toBe(2);

    const result = await applySolidBoolean(
      session.document,
      session.history,
      session.selection,
      boxObj.objectId,
      [cylObj.objectId],
      'difference',
      { keepCutters: false },
    );

    expect(result.ok).toBe(true);
    expect(session.document.objects.size).toBe(1); // Cutter was removed

    const targetObj = session.document.objects.get(boxObj.objectId)!;
    const modifiedMesh = session.document.meshes.get(targetObj.meshId!)!;
    // Watertight hole creates more vertices than the original 8
    expect(modifiedMesh.vertices.size).toBeGreaterThan(8);

    // Test Undo
    session.history.undo();
    expect(session.document.objects.size).toBe(2);
    expect(session.document.objects.has(cylObj.objectId)).toBe(true);

    // Test Redo
    session.history.redo();
    expect(session.document.objects.size).toBe(1);
    expect(session.document.objects.has(cylObj.objectId)).toBe(false);
  });

  it('fuses two boxes with Union and optionally keeps cutters', async () => {
    const session = new EditorSession();
    const boxA = buildBox({ width: 10, height: 10, depth: 10, centered: true });
    const boxB = buildBox({ width: 10, height: 10, depth: 10, centered: true });

    const objA = commitMeshObject(session.document, boxA, { name: 'BoxA' });
    const objB = commitMeshObject(session.document, boxB, { name: 'BoxB' });

    // Move BoxB slightly
    const bObj = session.document.objects.get(objB.objectId)!;
    bObj.transform.position.x = 5;

    const result = await applySolidBoolean(
      session.document,
      session.history,
      session.selection,
      objA.objectId,
      [objB.objectId],
      'union',
      { keepCutters: true },
    );

    expect(result.ok).toBe(true);
    // Both objects still exist since keepCutters was true
    expect(session.document.objects.size).toBe(2);

    const targetObj = session.document.objects.get(objA.objectId)!;
    const modifiedMesh = session.document.meshes.get(targetObj.meshId!)!;
    expect(modifiedMesh.metadata?.manifold).toBe('true');
  });

  it('fails gracefully when cutter is missing', async () => {
    const session = new EditorSession();
    const boxMesh = buildBox({ width: 10, height: 10, depth: 10 });
    const boxObj = commitMeshObject(session.document, boxMesh, { name: 'TargetBox' });

    const result = await applySolidBoolean(
      session.document,
      session.history,
      session.selection,
      boxObj.objectId,
      ['non_existent_id'],
      'difference',
    );

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/valid cutter/i);
  });
});

import { describe, expect, it } from 'vitest';
import { EditorSession } from '@/core/editor/EditorSession';
import { combineMeshObjects } from '@/core/editor/GameAssetTools';
import { CombineMeshesTool } from '@/core/tools/CombineMeshesTool';
import { commitMeshObject } from '@/core/document/ModelDocument';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';

describe('CombineMeshesTool', () => {
  it('joins two selected mesh objects', () => {
    const session = new EditorSession();
    const context = session.context();
    const tool = session.tools.get('combine-meshes') as CombineMeshesTool;
    const a = commitMeshObject(session.document, new MeshBuilder('A').build(), { name: 'A' });
    const b = commitMeshObject(session.document, new MeshBuilder('B').build(), { name: 'B' });
    context.selection.selectObjects([a.objectId, b.objectId], 'replace');
    const result = tool.combineSelection(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(session.document.objects.size).toBe(1);
      expect(session.document.objects.get(result.objectId)?.name).toBe('Combined Mesh');
    }
  });

  it('combines all root mesh objects when nothing is selected', () => {
    const session = new EditorSession();
    commitMeshObject(session.document, new MeshBuilder('A').build(), { name: 'A' });
    commitMeshObject(session.document, new MeshBuilder('B').build(), { name: 'B' });
    const result = combineMeshObjects(session.document, []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sourceCount).toBe(2);
      expect(session.document.objects.size).toBe(1);
    }
  });

  it('reports a helpful message when only one mesh exists', () => {
    const session = new EditorSession();
    commitMeshObject(session.document, new MeshBuilder('A').build(), { name: 'A' });
    const result = combineMeshObjects(session.document, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/two mesh objects/i);
  });
});

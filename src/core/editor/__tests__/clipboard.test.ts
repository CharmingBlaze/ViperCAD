import { beforeEach, describe, expect, it } from 'vitest';
import {
  clipboardKind,
  commitCopySelection,
  commitPasteClipboard,
  hasClipboard,
} from '@/core/editor/Clipboard';
import { EditorSession } from '@/core/editor/EditorSession';
import { commitMeshObject } from '@/core/document/ModelDocument';
import { resetIdCounter } from '@/core/ids/IdService';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';

beforeEach(() => resetIdCounter(1));

describe('clipboard copy / paste', () => {
  it('copies and pastes a selected object with undo', () => {
    const session = new EditorSession();
    const mesh = buildBox({ width: 1, height: 1, depth: 1, name: 'Box' });
    const { objectId } = commitMeshObject(session.document, mesh, { name: 'Box' });
    session.selection.setMode('object');
    session.selection.selectObjects([objectId], 'replace');

    expect(hasClipboard()).toBe(false);
    expect(commitCopySelection(session)).toBe(true);
    expect(hasClipboard()).toBe(true);
    expect(clipboardKind()).toBe('objects');

    expect(commitPasteClipboard(session)).toBe(true);
    expect(session.document.objects.size).toBe(2);
    const pastedId = [...session.selection.state.selectedObjectIds][0]!;
    expect(pastedId).not.toBe(objectId);
    const pasted = session.document.objects.get(pastedId)!;
    expect(pasted.transform.position.x).toBeCloseTo(
      session.document.objects.get(objectId)!.transform.position.x + 0.5,
    );

    expect(session.undo()).toBe(true);
    expect(session.document.objects.size).toBe(1);
    expect(session.document.objects.has(pastedId)).toBe(false);

    expect(session.redo()).toBe(true);
    expect(session.document.objects.size).toBe(2);
    expect(session.document.objects.has(pastedId)).toBe(true);
  });

  it('copies selected faces and pastes them as a new object', () => {
    const session = new EditorSession();
    const mesh = buildBox({ width: 1, height: 1, depth: 1, name: 'Box' });
    const { objectId, meshId } = commitMeshObject(session.document, mesh, { name: 'Box' });
    const sourceMesh = session.document.meshes.get(meshId)!;
    const faceId = [...sourceMesh.faces.keys()][0]!;

    session.selection.setMode('face');
    session.selection.state.activeObjectId = objectId;
    session.selection.selectFaces([faceId], 'replace');

    expect(commitCopySelection(session)).toBe(true);
    expect(clipboardKind()).toBe('faces');
    expect(sourceMesh.faces.size).toBe(6);

    expect(commitPasteClipboard(session)).toBe(true);
    expect(session.document.objects.size).toBe(2);
    const pastedId = [...session.selection.state.selectedObjectIds][0]!;
    const pasted = session.document.objects.get(pastedId)!;
    const pastedMesh = session.document.meshes.get(pasted.meshId!)!;
    expect(pastedMesh.faces.size).toBe(1);
    expect(session.document.meshes.get(meshId)!.faces.size).toBe(6);

    expect(session.undo()).toBe(true);
    expect(session.document.objects.size).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { beginVertexBezier } from '@/app/VertexBezierHotkey';
import { readCurveOperation } from '@/core/curves/CurveOperation';
import { commitMeshObject, createEmptyDocument } from '@/core/document/ModelDocument';
import { EditorSession } from '@/core/editor/EditorSession';
import { buildBox } from '@/core/mesh/builders';
import { validateMeshFull } from '@/core/mesh/Validation';
import { WorkspaceController } from '@/workspace/WorkspaceController';

describe('beginVertexBezier', () => {
  it('prepares the same mesh for curved Bézier editing and does not spawn a tube', () => {
    const document = createEmptyDocument();
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId } = commitMeshObject(document, mesh, { name: 'Box' });
    const session = new EditorSession(document);
    session.selection.selectObjects([objectId], 'replace');
    const workspace = new WorkspaceController();
    const result = beginVertexBezier(session, workspace);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.enabled).toBe(true);
    expect(session.document.objects.size).toBe(1);
    expect(readCurveOperation(session.document.objects.get(objectId)?.metadata.curveOperation)).toBeNull();
    expect(workspace.vertexBezierEdit?.segments.length).toBe(12);
    expect(mesh.vertices.size).toBeGreaterThan(8);
    expect(validateMeshFull(mesh).ok).toBe(true);
  });

  it('toggles the overlay off on the same object', () => {
    const document = createEmptyDocument();
    const { objectId } = commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }));
    const session = new EditorSession(document);
    session.selection.selectObjects([objectId], 'replace');
    const workspace = new WorkspaceController();
    expect(beginVertexBezier(session, workspace)).toEqual({ ok: true, enabled: true });
    expect(beginVertexBezier(session, workspace)).toEqual({ ok: true, enabled: false });
    expect(workspace.vertexBezierEdit).toBeNull();
  });

  it('does not create a default tube when the scene is empty', () => {
    const session = new EditorSession();
    const workspace = new WorkspaceController();
    const result = beginVertexBezier(session, workspace);
    expect(result.ok).toBe(false);
    expect(session.document.objects.size).toBe(0);
  });
});

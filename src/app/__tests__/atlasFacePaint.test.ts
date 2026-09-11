import { describe, expect, it } from 'vitest';
import { endAtlasFacePaintStroke, paintAtlasFace } from '@/app/atlasFacePaint';
import { commitMeshObject } from '@/core/document/ModelDocument';
import { EditorSession } from '@/core/editor/EditorSession';
import { createImageAssetFromPixels, createTextureAsset } from '@/core/image/PixelEditor';
import { faceCornerIds } from '@/core/mesh/EditableMesh';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { WorkspaceController } from '@/workspace/WorkspaceController';

describe('atlas face paint', () => {
  it('stamps multiple faces in one undo and can hint a down edge', () => {
    const session = new EditorSession();
    const workspace = new WorkspaceController();
    const image = createImageAssetFromPixels(session.document, 'Atlas', 16, 16, new Uint8ClampedArray(16 * 16 * 4));
    const texture = createTextureAsset(session.document, image, 'Atlas Tex');
    workspace.patchTexture({
      activeImageId: image.id,
      activeTextureId: texture.id,
      atlasTileWidth: 16,
      atlasTileHeight: 16,
      atlasStretchU: true,
      atlasStretchV: true,
      atlasHintDown: true,
    });
    const { objectId } = commitMeshObject(session.document, buildBox({ width: 1, height: 1, depth: 1 }));
    const mesh = session.document.meshes.get(session.document.objects.get(objectId)!.meshId!)!;
    const [first, second] = [...mesh.faces.keys()];
    expect(paintAtlasFace(session, workspace, objectId, first!)).toBe(true);
    expect(paintAtlasFace(session, workspace, objectId, second!)).toBe(true);
    const layerId = mesh.defaultUvLayerId!;
    const firstUvs = faceCornerIds(mesh, first!).map((id) => mesh.faceCorners.get(id)!.uvs.get(layerId)!);
    expect(firstUvs.length).toBeGreaterThan(0);
    expect(endAtlasFacePaintStroke(session)).toBe(true);
    expect(session.history.canUndo()).toBe(true);
    session.undo();
    const undone = faceCornerIds(mesh, first!).map((id) => mesh.faceCorners.get(id)!.uvs.get(layerId)!);
    expect(undone).not.toEqual(firstUvs);
  });
});

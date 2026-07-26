import { addObjectToDocument, createSceneObject, removeObject } from '@/core/document/ModelDocument';
import type { ModelDocument, ObjectId, SceneObject } from '@/core/document/types';
import { isGroupObject, topmostObjectIds } from '@/core/editor/Hierarchy';
import type { CommandHistory } from '@/core/history/CommandHistory';
import { createId } from '@/core/ids/IdService';
import { cloneTransform, type Transform } from '@/core/math/Transform';
import { v3 } from '@/core/math/Vec3';
import { cloneMeshPreserveIds, faceCornerIds, faceVertexIds } from '@/core/mesh/EditableMesh';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import type { EditableMesh, FaceId, MeshId } from '@/core/mesh/types';
import { cloneSelection, type SelectionManager } from '@/core/selection/SelectionManager';

type ObjectClipboardNode = {
  name: string;
  transform: SceneObject['transform'];
  visible: boolean;
  locked: boolean;
  materialSlotIds: string[];
  metadata: Record<string, string>;
  mesh: EditableMesh | null;
  children: ObjectClipboardNode[];
};

type FacesClipboardEntry = {
  name: string;
  transform: Transform;
  materialSlotIds: string[];
  mesh: EditableMesh;
};

type ClipboardPayload =
  | { kind: 'objects'; roots: ObjectClipboardNode[] }
  | { kind: 'faces'; entry: FacesClipboardEntry };

type ClipboardSession = {
  document: ModelDocument;
  selection: SelectionManager;
  history: CommandHistory;
  requestRedraw: () => void;
};

type PastedItem = {
  object: SceneObject;
  mesh: EditableMesh | null;
  meshId: MeshId | null;
};

let clipboard: ClipboardPayload | null = null;
let pasteGeneration = 0;

function resolveCopyObjectIds(session: ClipboardSession): ObjectId[] {
  const selected = [...session.selection.state.selectedObjectIds];
  if (selected.length) return selected;
  const active = session.selection.state.activeObjectId;
  return active ? [active] : [];
}

function snapshotObjectTree(doc: ModelDocument, objectId: ObjectId): ObjectClipboardNode | null {
  const src = doc.objects.get(objectId);
  if (!src) return null;
  const mesh = src.meshId ? doc.meshes.get(src.meshId) : null;
  return {
    name: src.name,
    transform: cloneTransform(src.transform),
    visible: src.visible,
    locked: src.locked,
    materialSlotIds: [...src.materialSlotIds],
    metadata: { ...src.metadata },
    mesh: mesh ? cloneMeshPreserveIds(mesh) : null,
    children: src.childIds
      .map((childId) => snapshotObjectTree(doc, childId))
      .filter((node): node is ObjectClipboardNode => !!node),
  };
}

/** Build an independent mesh from selected faces (shared topology within the selection). */
export function extractFacesMesh(
  sourceMesh: EditableMesh,
  faceIds: Iterable<FaceId>,
  name = 'Faces',
): EditableMesh | null {
  const selected = [...new Set(faceIds)].filter((id) => sourceMesh.faces.has(id));
  if (!selected.length) return null;

  const builder = new MeshBuilder(name, true);
  builder.setMaterialSlotCount(sourceMesh.materialSlotCount);
  const vertexMap = new Map<string, ReturnType<typeof builder.vertex>>();
  for (const faceId of selected) {
    const face = sourceMesh.faces.get(faceId)!;
    const oldVertices = faceVertexIds(sourceMesh, faceId);
    const newVertices = oldVertices.map((vertexId) => {
      let mapped = vertexMap.get(vertexId);
      if (!mapped) {
        const point = sourceMesh.vertices.get(vertexId)!.position;
        mapped = builder.vertex(v3(point.x, point.y, point.z));
        vertexMap.set(vertexId, mapped);
      }
      return mapped;
    });
    const uvs = faceCornerIds(sourceMesh, faceId).map((cornerId) => {
      const corner = sourceMesh.faceCorners.get(cornerId)!;
      return sourceMesh.defaultUvLayerId
        ? (corner.uvs.get(sourceMesh.defaultUvLayerId) ?? { x: 0, y: 0 })
        : { x: 0, y: 0 };
    });
    builder.ngon(newVertices, uvs, face.materialSlot);
  }
  return builder.build();
}

function materializeObjectTree(
  doc: ModelDocument,
  node: ObjectClipboardNode,
  parentId: ObjectId | null,
  offset: number,
  isRoot: boolean,
  created: PastedItem[],
): ObjectId {
  let meshId: MeshId | null = null;
  let mesh: EditableMesh | null = null;
  if (node.mesh) {
    mesh = cloneMeshPreserveIds(node.mesh);
    mesh.id = createId('mesh');
    mesh.name = `${node.mesh.name || node.name}_copy`;
    doc.meshes.set(mesh.id, mesh);
    meshId = mesh.id;
  }
  const object = createSceneObject(
    isRoot ? `${node.name}_copy` : node.name,
    meshId,
    [...node.materialSlotIds],
  );
  object.transform = cloneTransform(node.transform);
  if (isRoot) {
    object.transform.position = {
      x: object.transform.position.x + offset,
      y: object.transform.position.y,
      z: object.transform.position.z,
    };
  }
  object.visible = node.visible;
  object.locked = node.locked;
  object.metadata = { ...node.metadata };
  object.parentId = parentId;
  addObjectToDocument(doc, object);
  created.push({
    object: {
      ...object,
      childIds: [],
      materialSlotIds: [...object.materialSlotIds],
      transform: cloneTransform(object.transform),
      metadata: { ...object.metadata },
    },
    mesh: mesh ? cloneMeshPreserveIds(mesh) : null,
    meshId,
  });
  const childIds: ObjectId[] = [];
  for (const child of node.children) {
    childIds.push(materializeObjectTree(doc, child, object.id, 0, false, created));
  }
  object.childIds = childIds;
  const stored = created.find((item) => item.object.id === object.id);
  if (stored) stored.object.childIds = [...childIds];
  return object.id;
}

function materializeFacesEntry(doc: ModelDocument, entry: FacesClipboardEntry, offset: number): PastedItem {
  const mesh = cloneMeshPreserveIds(entry.mesh);
  mesh.id = createId('mesh');
  mesh.name = `${entry.name}_copy`;
  doc.meshes.set(mesh.id, mesh);
  const object = createSceneObject(`${entry.name}_copy`, mesh.id, [...entry.materialSlotIds]);
  object.transform = cloneTransform(entry.transform);
  object.transform.position = {
    x: object.transform.position.x + offset,
    y: object.transform.position.y,
    z: object.transform.position.z,
  };
  addObjectToDocument(doc, object);
  return {
    object: {
      ...object,
      childIds: [...object.childIds],
      materialSlotIds: [...object.materialSlotIds],
      transform: cloneTransform(object.transform),
      metadata: { ...object.metadata },
    },
    mesh: cloneMeshPreserveIds(mesh),
    meshId: mesh.id,
  };
}

function restorePastedItem(doc: ModelDocument, item: PastedItem): void {
  if (item.mesh && item.meshId) {
    doc.meshes.set(item.meshId, cloneMeshPreserveIds(item.mesh));
  }
  doc.objects.set(item.object.id, {
    ...item.object,
    childIds: [...item.object.childIds],
    materialSlotIds: [...item.object.materialSlotIds],
    transform: cloneTransform(item.object.transform),
    metadata: { ...item.object.metadata },
  });
  if (item.object.parentId) {
    const parent = doc.objects.get(item.object.parentId);
    if (parent && !parent.childIds.includes(item.object.id)) {
      parent.childIds.push(item.object.id);
    }
  } else if (!doc.rootObjectIds.includes(item.object.id)) {
    doc.rootObjectIds.push(item.object.id);
  }
}

function pasteCreatedItems(
  session: ClipboardSession,
  created: PastedItem[],
  rootIds: ObjectId[],
  beforeSelection: ReturnType<typeof cloneSelection>,
  undoName: string,
): boolean {
  if (!created.length) return false;

  session.selection.setMode('object');
  session.selection.selectObjects(rootIds, 'replace');
  const afterSelection = cloneSelection(session.selection.state);
  let applied = true;

  session.history.execute({
    name: undoName,
    execute: () => {
      if (applied) return;
      // Parents before children (created is DFS preorder).
      for (const item of created) restorePastedItem(session.document, item);
      session.selection.state = cloneSelection(afterSelection);
      session.document.dirty = true;
      applied = true;
      session.requestRedraw();
    },
    undo: () => {
      for (const rootId of rootIds) {
        removeObject(session.document, rootId, true);
      }
      session.selection.state = cloneSelection(beforeSelection);
      session.document.dirty = true;
      applied = false;
      session.requestRedraw();
    },
  });

  session.document.dirty = true;
  session.requestRedraw();
  return true;
}

function resolvePasteParentId(session: ClipboardSession): ObjectId | null {
  const activeId = session.selection.state.activeObjectId;
  const active = activeId ? session.document.objects.get(activeId) : null;
  if (active && isGroupObject(active)) return active.id;
  if (session.selection.state.selectedObjectIds.size === 1) {
    const onlyId = [...session.selection.state.selectedObjectIds][0]!;
    const only = session.document.objects.get(onlyId);
    if (only && isGroupObject(only)) return only.id;
  }
  return null;
}

/** Copy the current object or face selection into the editor clipboard. */
export function commitCopySelection(session: ClipboardSession): boolean {
  const mode = session.selection.state.mode;

  if (mode === 'face' && session.selection.state.selectedFaceIds.size > 0) {
    const objectId = session.selection.state.activeObjectId;
    const object = objectId ? session.document.objects.get(objectId) : null;
    const sourceMesh = object?.meshId ? session.document.meshes.get(object.meshId) : null;
    if (!object || !sourceMesh) return false;
    const fragment = extractFacesMesh(
      sourceMesh,
      session.selection.state.selectedFaceIds,
      `${object.name}_faces`,
    );
    if (!fragment) return false;
    clipboard = {
      kind: 'faces',
      entry: {
        name: `${object.name}_faces`,
        transform: cloneTransform(object.transform),
        materialSlotIds: [...object.materialSlotIds],
        mesh: fragment,
      },
    };
    pasteGeneration = 0;
    return true;
  }

  const ids = topmostObjectIds(session.document, resolveCopyObjectIds(session));
  if (!ids.length) return false;
  const roots = ids
    .map((id) => snapshotObjectTree(session.document, id))
    .filter((node): node is ObjectClipboardNode => !!node);
  if (!roots.length) return false;
  clipboard = { kind: 'objects', roots };
  pasteGeneration = 0;
  return true;
}

export function hasClipboard(): boolean {
  return clipboard !== null && (clipboard.kind === 'objects' ? clipboard.roots.length > 0 : true);
}

export function clipboardKind(): 'objects' | 'faces' | null {
  return clipboard?.kind ?? null;
}

/** Paste clipboard objects (including group trees) or face components, with undo. */
export function commitPasteClipboard(session: ClipboardSession): boolean {
  if (!clipboard) return false;
  pasteGeneration += 1;
  const offset = 0.5 * pasteGeneration;
  const beforeSelection = cloneSelection(session.selection.state);

  if (clipboard.kind === 'faces') {
    const created = [materializeFacesEntry(session.document, clipboard.entry, offset)];
    return pasteCreatedItems(
      session,
      created,
      created.map((item) => item.object.id),
      beforeSelection,
      'Paste Faces',
    );
  }

  const pasteParentId = resolvePasteParentId(session);
  const created: PastedItem[] = [];
  const rootIds: ObjectId[] = [];
  for (const root of clipboard.roots) {
    rootIds.push(
      materializeObjectTree(session.document, root, pasteParentId, offset, true, created),
    );
  }
  return pasteCreatedItems(
    session,
    created,
    rootIds,
    beforeSelection,
    rootIds.length === 1 ? 'Paste Object' : 'Paste Objects',
  );
}

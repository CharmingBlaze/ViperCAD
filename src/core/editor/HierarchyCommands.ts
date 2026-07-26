import { createSceneObject, addObjectToDocument } from '@/core/document/ModelDocument';
import type { ObjectId } from '@/core/document/types';
import type { EditorSession } from '@/core/editor/EditorSession';
import { groupObjects, ungroupObject } from '@/core/editor/GameAssetTools';
import { isGroupObject, topmostObjectIds } from '@/core/editor/Hierarchy';
import { cloneTransform } from '@/core/math/Transform';
import { cloneSelection } from '@/core/selection/SelectionManager';

type HierarchySession = Pick<EditorSession, 'document' | 'selection' | 'history' | 'requestRedraw'>;

/** Group the current object selection (Ctrl+G). Returns the new group id. */
export function commitGroupSelection(session: HierarchySession, name = 'Group'): ObjectId | null {
  const ids = topmostObjectIds(session.document, session.selection.state.selectedObjectIds);
  if (ids.length < 1) return null;

  const beforeSelection = cloneSelection(session.selection.state);
  let groupId = groupObjects(session.document, ids, name);
  let memberIds = [...(session.document.objects.get(groupId)?.childIds ?? ids)];
  session.selection.setMode('object');
  session.selection.selectObjects([groupId], 'replace');
  const afterSelection = cloneSelection(session.selection.state);
  let applied = true;

  session.history.execute({
    name: 'Group Objects',
    execute: () => {
      if (applied) return;
      groupId = groupObjects(session.document, memberIds, name);
      memberIds = [...(session.document.objects.get(groupId)?.childIds ?? memberIds)];
      session.selection.state = cloneSelection(afterSelection);
      session.selection.selectObjects([groupId], 'replace');
      session.document.dirty = true;
      applied = true;
      session.requestRedraw();
    },
    undo: () => {
      if (!applied || !session.document.objects.has(groupId)) return;
      memberIds = ungroupObject(session.document, groupId);
      session.selection.state = cloneSelection(beforeSelection);
      session.document.dirty = true;
      applied = false;
      session.requestRedraw();
    },
  });

  session.document.dirty = true;
  session.requestRedraw();
  return groupId;
}

/** Ungroup the active/selected group container (Ctrl+Shift+G). */
export function commitUngroupSelection(session: HierarchySession): ObjectId[] | null {
  const candidates = [
    session.selection.state.activeObjectId,
    ...session.selection.state.selectedObjectIds,
  ].filter((id): id is ObjectId => !!id);

  let groupId: ObjectId | null = null;
  for (const id of candidates) {
    const object = session.document.objects.get(id);
    if (object && isGroupObject(object) && object.childIds.length > 0) {
      groupId = id;
      break;
    }
  }
  if (!groupId) return null;

  const group = session.document.objects.get(groupId)!;
  const beforeSelection = cloneSelection(session.selection.state);
  const groupSnap = {
    name: group.name,
    parentId: group.parentId,
    transform: cloneTransform(group.transform),
    metadata: { ...group.metadata },
    visible: group.visible,
    locked: group.locked,
    materialSlotIds: [...group.materialSlotIds],
    childIds: [...group.childIds],
  };
  const childLocal = group.childIds.map((id) => ({
    id,
    transform: cloneTransform(session.document.objects.get(id)!.transform),
  }));

  let children = ungroupObject(session.document, groupId);
  session.selection.setMode('object');
  session.selection.selectObjects(children, 'replace');
  const afterSelection = cloneSelection(session.selection.state);
  let applied = true;
  let liveGroupId = groupId;

  session.history.execute({
    name: 'Ungroup',
    execute: () => {
      if (applied) return;
      if (!session.document.objects.has(liveGroupId)) return;
      children = ungroupObject(session.document, liveGroupId);
      session.selection.state = cloneSelection(afterSelection);
      session.document.dirty = true;
      applied = true;
      session.requestRedraw();
    },
    undo: () => {
      if (!applied) return;
      // Rebuild the group and restore child locals under it.
      const rebuilt = createSceneObject(groupSnap.name);
      rebuilt.parentId = groupSnap.parentId;
      rebuilt.transform = cloneTransform(groupSnap.transform);
      rebuilt.metadata = { ...groupSnap.metadata, prefab: 'true' };
      rebuilt.visible = groupSnap.visible;
      rebuilt.locked = groupSnap.locked;
      rebuilt.materialSlotIds = [...groupSnap.materialSlotIds];
      addObjectToDocument(session.document, rebuilt);
      liveGroupId = rebuilt.id;

      for (const snap of childLocal) {
        const child = session.document.objects.get(snap.id);
        if (!child) continue;
        if (child.parentId) {
          const parent = session.document.objects.get(child.parentId);
          if (parent) parent.childIds = parent.childIds.filter((id) => id !== snap.id);
        } else {
          session.document.rootObjectIds = session.document.rootObjectIds.filter((id) => id !== snap.id);
        }
        child.parentId = rebuilt.id;
        child.transform = cloneTransform(snap.transform);
        rebuilt.childIds.push(snap.id);
      }
      session.selection.state = cloneSelection(beforeSelection);
      session.document.dirty = true;
      applied = false;
      session.requestRedraw();
    },
  });

  session.document.dirty = true;
  session.requestRedraw();
  return children;
}

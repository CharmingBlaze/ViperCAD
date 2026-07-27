import { beforeEach, describe, expect, it } from 'vitest';
import {
  commitCopySelection,
  commitPasteClipboard,
} from '@/core/editor/Clipboard';
import { groupObjects } from '@/core/editor/GameAssetTools';
import {
  enterGroupFocus,
  exitGroupFocus,
  isObjectInFocusScope,
} from '@/core/editor/GroupFocus';
import {
  commitGroupSelection,
  commitUngroupSelection,
} from '@/core/editor/HierarchyCommands';
import {
  getObjectWorldTransform,
  isGroupObject,
  reparentObject,
  topmostObjectIds,
} from '@/core/editor/Hierarchy';
import { EditorSession } from '@/core/editor/EditorSession';
import { commitMeshObject } from '@/core/document/ModelDocument';
import { resetIdCounter } from '@/core/ids/IdService';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';

beforeEach(() => resetIdCounter(1));

function twoBoxes() {
  const session = new EditorSession();
  const a = commitMeshObject(session.document, buildBox({ width: 1, height: 1, depth: 1, name: 'A' }), {
    name: 'A',
  });
  const b = commitMeshObject(session.document, buildBox({ width: 1, height: 1, depth: 1, name: 'B' }), {
    name: 'B',
  });
  session.document.objects.get(b.objectId)!.transform.position.x = 2;
  return { session, a, b };
}

describe('object groups', () => {
  it('groups selected objects and shows them under a group container', () => {
    const { session, a, b } = twoBoxes();
    session.selection.setMode('object');
    session.selection.selectObjects([a.objectId, b.objectId], 'replace');

    const groupId = commitGroupSelection(session, 'Props');
    expect(groupId).toBeTruthy();
    const group = session.document.objects.get(groupId!)!;
    expect(isGroupObject(group)).toBe(true);
    expect(group.childIds).toEqual([a.objectId, b.objectId]);
    expect(session.document.rootObjectIds).toEqual([groupId]);
    expect(getObjectWorldTransform(session.document, b.objectId).position.x).toBeCloseTo(2);
  });

  it('copies and pastes a full group tree', () => {
    const { session, a, b } = twoBoxes();
    const groupId = groupObjects(session.document, [a.objectId, b.objectId], 'Bundle');
    session.selection.setMode('object');
    session.selection.selectObjects([groupId], 'replace');

    expect(commitCopySelection(session)).toBe(true);
    expect(commitPasteClipboard(session)).toBe(true);

    const pastedRoot = [...session.selection.state.selectedObjectIds][0]!;
    const pasted = session.document.objects.get(pastedRoot)!;
    expect(isGroupObject(pasted)).toBe(true);
    expect(pasted.childIds.length).toBe(2);
    expect(session.document.objects.size).toBe(6); // 2 originals + group + 2 copies + pasted group
  });

  it('reparents via hierarchy helper and filters topmost selection', () => {
    const { session, a, b } = twoBoxes();
    const groupId = groupObjects(session.document, [a.objectId], 'Holder');
    expect(reparentObject(session.document, b.objectId, groupId)).toBe(true);
    expect(session.document.objects.get(b.objectId)!.parentId).toBe(groupId);
    expect(topmostObjectIds(session.document, [groupId, a.objectId, b.objectId])).toEqual([groupId]);
  });

  it('ungroups and supports undo', () => {
    const { session, a, b } = twoBoxes();
    session.selection.selectObjects([a.objectId, b.objectId], 'replace');
    const groupId = commitGroupSelection(session)!;
    session.selection.selectObjects([groupId], 'replace');
    const children = commitUngroupSelection(session);
    expect(children?.sort()).toEqual([a.objectId, b.objectId].sort());
    expect(session.document.objects.has(groupId)).toBe(false);

    expect(session.undo()).toBe(true);
    expect([...session.document.objects.values()].some((object) => isGroupObject(object))).toBe(true);
  });

  it('moves a selected group and children follow in world space', () => {
    const { session, a, b } = twoBoxes();
    session.selection.selectObjects([a.objectId, b.objectId], 'replace');
    const groupId = commitGroupSelection(session)!;
    const beforeB = getObjectWorldTransform(session.document, b.objectId).position.x;

    session.selection.selectObjects([groupId], 'replace');
    const group = session.document.objects.get(groupId)!;
    group.transform.position.x += 3;
    session.document.dirty = true;

    expect(getObjectWorldTransform(session.document, a.objectId).position.x).toBeCloseTo(3);
    expect(getObjectWorldTransform(session.document, b.objectId).position.x).toBeCloseTo(beforeB + 3);
  });

  it('scopes selection to a focused group', () => {
    const { session, a, b } = twoBoxes();
    const groupId = groupObjects(session.document, [a.objectId], 'Interior');
    session.selection.selectObjects([b.objectId], 'replace');
    expect(enterGroupFocus(session, groupId)).toBe(true);
    expect(isObjectInFocusScope(session.document, a.objectId, session.focusGroupId)).toBe(true);
    expect(isObjectInFocusScope(session.document, b.objectId, session.focusGroupId)).toBe(false);
    session.selection.selectObjects([b.objectId], 'replace');
    expect(session.selection.state.selectedObjectIds.has(b.objectId)).toBe(false);
    expect(exitGroupFocus(session)).toBe(true);
    expect(session.focusGroupId).toBeNull();
  });
});

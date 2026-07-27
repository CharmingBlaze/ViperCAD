import type { ModelDocument, ObjectId } from '@/core/document/types';
import {
  collectDescendantIds,
  findGroupAncestor,
  isGroupObject,
} from '@/core/editor/Hierarchy';
import type { EditorSession } from '@/core/editor/EditorSession';

/** Object ids selectable while a group is focused (focus root + descendants). */
export function collectFocusScopeIds(
  document: ModelDocument,
  focusGroupId: ObjectId | null,
): Set<ObjectId> | null {
  if (!focusGroupId) return null;
  const group = document.objects.get(focusGroupId);
  if (!group || !isGroupObject(group)) return null;
  const scope = new Set<ObjectId>([focusGroupId]);
  for (const id of collectDescendantIds(document, focusGroupId)) {
    scope.add(id);
  }
  return scope;
}

export function isObjectInFocusScope(
  document: ModelDocument,
  objectId: ObjectId,
  focusGroupId: ObjectId | null,
): boolean {
  if (!focusGroupId) return true;
  const scope = collectFocusScopeIds(document, focusGroupId);
  return scope ? scope.has(objectId) : true;
}

/** Ordered group ids from document root down to the focused group. */
export function getFocusGroupChain(
  document: ModelDocument,
  focusGroupId: ObjectId | null,
): ObjectId[] {
  if (!focusGroupId) return [];
  const chain: ObjectId[] = [];
  let current: ObjectId | null = focusGroupId;
  while (current) {
    chain.unshift(current);
    const parentId: ObjectId | null = document.objects.get(current)?.parentId ?? null;
    if (!parentId) break;
    const parent = document.objects.get(parentId);
    if (!parent || !isGroupObject(parent)) break;
    current = parentId;
  }
  return chain;
}

export function getFocusBreadcrumb(
  document: ModelDocument,
  documentName: string,
  focusGroupId: ObjectId | null,
): string[] {
  const names = getFocusGroupChain(document, focusGroupId).map(
    (id) => document.objects.get(id)?.name ?? 'Group',
  );
  return [documentName, ...names];
}

export function syncFocusScopeFilter(session: EditorSession): void {
  const focusId = session.focusGroupId;
  if (!focusId) {
    session.selection.objectScopeFilter = null;
    return;
  }
  session.selection.objectScopeFilter = (objectId) =>
    isObjectInFocusScope(session.document, objectId, focusId);
}

export function pruneSelectionToFocusScope(session: EditorSession): void {
  syncFocusScopeFilter(session);
  const focusId = session.focusGroupId;
  if (!focusId) return;
  const scope = collectFocusScopeIds(session.document, focusId);
  if (!scope) {
    session.focusGroupId = null;
    return;
  }
  const selected = [...session.selection.state.selectedObjectIds].filter((id) => scope.has(id));
  session.selection.selectObjects(selected, 'replace');
  const active = session.selection.state.activeObjectId;
  if (active && !scope.has(active)) {
    session.selection.selectObjects(selected.length ? [selected[selected.length - 1]!] : [], 'replace');
  }
}

export function enterGroupFocus(session: EditorSession, groupId: ObjectId): boolean {
  const group = session.document.objects.get(groupId);
  if (!group || !isGroupObject(group)) return false;
  session.focusGroupId = groupId;
  pruneSelectionToFocusScope(session);
  session.requestRedraw();
  return true;
}

/** Move focus up one group level, or clear focus at the document root. */
export function exitGroupFocus(session: EditorSession): boolean {
  if (!session.focusGroupId) return false;
  const parentId = session.document.objects.get(session.focusGroupId)?.parentId ?? null;
  const parent = parentId ? session.document.objects.get(parentId) : null;
  if (parent && isGroupObject(parent)) {
    session.focusGroupId = parentId;
  } else {
    session.focusGroupId = null;
  }
  pruneSelectionToFocusScope(session);
  session.requestRedraw();
  return true;
}

export function exitToDocumentRoot(session: EditorSession): boolean {
  if (!session.focusGroupId) return false;
  session.focusGroupId = null;
  pruneSelectionToFocusScope(session);
  session.requestRedraw();
  return true;
}

/** Enter focus on the nearest group ancestor of a picked object. */
export function enterGroupFocusFromPick(session: EditorSession, objectId: ObjectId): boolean {
  const groupId = findGroupAncestor(session.document, objectId);
  if (!groupId) {
    const object = session.document.objects.get(objectId);
    if (object && isGroupObject(object)) return enterGroupFocus(session, objectId);
    return false;
  }
  return enterGroupFocus(session, groupId);
}

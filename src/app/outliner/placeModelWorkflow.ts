import type { EditorSession } from '@/core/editor/EditorSession';
import type { DocumentId } from '@/core/document/types';
import { getViperDocument } from '@/core/document/ViperProject';
import {
  commitPlaceModelInLevel,
  listPlaceableModelIds,
  modelHasPlaceableGeometry,
  openLevelForPlacement,
} from '@/core/editor/ModelInstances';
import { viewportEngine } from '@/app/viewportEngine';
import { pushToast } from '@/app/Toast';

type PlaceOptions = {
  onRefresh: () => void;
  onPlaced?: () => void;
};

export function placeModelQuick(
  session: EditorSession,
  modelDocumentId: DocumentId,
  { onRefresh, onPlaced }: PlaceOptions,
): boolean {
  const modelDoc = getViperDocument(session.project, modelDocumentId);
  if (!modelHasPlaceableGeometry(modelDoc)) {
    pushToast(`Add geometry to ${modelDoc.name} first`, 'error');
    return false;
  }

  if (session.document.kind !== 'level') {
    const levelId = openLevelForPlacement(session);
    if (!levelId) {
      pushToast('Create a Level first', 'error');
      return false;
    }
    pushToast(`Switched to ${getViperDocument(session.project, levelId).name}`, 'info');
    onRefresh();
  }

  const instanceId = commitPlaceModelInLevel(session, modelDocumentId);
  if (!instanceId) return false;

  session.tools.setActive('select', session.context());
  pushToast(`Placed ${modelDoc.name} — use G to move`, 'success');
  onRefresh();
  onPlaced?.();
  return true;
}

export function startPlaceModelInViewport(
  session: EditorSession,
  modelDocumentId: DocumentId,
  { onRefresh, onPlaced }: PlaceOptions,
): boolean {
  const modelDoc = getViperDocument(session.project, modelDocumentId);
  if (!modelHasPlaceableGeometry(modelDoc)) {
    pushToast(`Add geometry to ${modelDoc.name} first`, 'error');
    return false;
  }

  if (session.document.kind !== 'level') {
    const levelId = openLevelForPlacement(session);
    if (!levelId) {
      pushToast('Create a Level first', 'error');
      return false;
    }
    pushToast(`Switched to ${getViperDocument(session.project, levelId).name}`, 'info');
    onRefresh();
  }

  session.tools.setActive('select', session.context());
  viewportEngine.setModelPlacement({
    modelDocumentId,
    modelName: modelDoc.name,
    onPlaced: () => {
      pushToast(`Placed ${modelDoc.name}`, 'success');
      onRefresh();
      onPlaced?.();
    },
  });
  pushToast(`Click in the viewport to place ${modelDoc.name} · Esc to cancel`, 'info');
  return true;
}

export function getPlaceableModels(session: EditorSession) {
  return listPlaceableModelIds(session.project).map((id) => getViperDocument(session.project, id));
}

import type { EditorSession } from '@/core/editor/EditorSession';
import { getViperDocument } from '@/core/document/ViperProject';
import { modelHasPlaceableGeometry } from '@/core/editor/ModelInstances';
import { openDocumentTab } from '@/app/DocumentTabs';
import {
  getPlaceableModels,
  placeModelQuick,
  startPlaceModelInViewport,
} from '@/app/outliner/placeModelWorkflow';
import { pushToast } from '@/app/Toast';

type Props = {
  session: EditorSession;
  onRefresh: () => void;
  onPlaced?: () => void;
  compact?: boolean;
};

export function PlaceModelPanel({ session, onRefresh, onPlaced, compact = false }: Props) {
  const editingLevel = session.document.kind === 'level';
  const placeable = getPlaceableModels(session);
  const emptyModels = session.project.modelDocumentIds.filter(
    (id) => !modelHasPlaceableGeometry(getViperDocument(session.project, id), session.project),
  );

  const goToLevel = () => {
    const levelId = session.project.levelDocumentIds[0];
    if (!levelId) {
      pushToast('Create a Level first', 'error');
      return;
    }
    openDocumentTab(session, levelId);
    onRefresh();
  };

  const editModel = (modelId: string) => {
    openDocumentTab(session, modelId);
    onRefresh();
  };

  if (!editingLevel) {
    return (
      <div className={`place-model-panel${compact ? ' is-compact' : ''}`}>
        <p className="place-model-lead">Place models into a Level scene.</p>
        <button type="button" className="place-model-primary" onClick={goToLevel}>
          Open {getViperDocument(session.project, session.project.levelDocumentIds[0]!)?.name ?? 'Level'}
        </button>
      </div>
    );
  }

  return (
    <div className={`place-model-panel${compact ? ' is-compact' : ''}`}>
      <div className="place-model-head">
        <strong>Add to {session.document.name}</strong>
        {!compact && (
          <span className="place-model-sub">Place linked copies — edits to the Model update all copies.</span>
        )}
      </div>

      {placeable.length === 0 ? (
        <div className="place-model-empty">
          <p>No models with geometry yet.</p>
          {emptyModels[0] && (
            <button type="button" className="place-model-secondary" onClick={() => editModel(emptyModels[0]!)}>
              Edit {getViperDocument(session.project, emptyModels[0]!).name}
            </button>
          )}
        </div>
      ) : (
        <ul className="place-model-list">
          {placeable.map((doc) => (
            <li key={doc.id} className="place-model-card">
              <div className="place-model-card-info">
                <span className="place-model-card-name">{doc.name}</span>
                {!compact && (
                  <button type="button" className="place-model-link" onClick={() => editModel(doc.id)}>
                    Edit model
                  </button>
                )}
              </div>
              <div className="place-model-card-actions">
                <button
                  type="button"
                  className="place-model-primary"
                  onClick={() => placeModelQuick(session, doc.id, { onRefresh, onPlaced })}
                >
                  Place
                </button>
                <button
                  type="button"
                  className="place-model-secondary"
                  title="Click in the 3D view to choose position"
                  onClick={() => startPlaceModelInViewport(session, doc.id, { onRefresh, onPlaced })}
                >
                  Click…
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

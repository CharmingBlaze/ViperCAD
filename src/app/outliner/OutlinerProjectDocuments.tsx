import type { EditorSession } from '@/core/editor/EditorSession';
import type { DocumentId } from '@/core/document/types';
import { getViperDocument } from '@/core/document/ViperProject';
import { modelHasPlaceableGeometry } from '@/core/editor/ModelInstances';
import {
  deleteProjectDocument,
  openProjectDocument,
  renameProjectDocument,
} from '@/app/outliner/documentActions';
import { placeModelQuick, startPlaceModelInViewport } from '@/app/outliner/placeModelWorkflow';

export function OutlinerDocumentRow({
  session,
  documentId,
  kind,
  onRefresh,
  onPlaced,
}: {
  session: EditorSession;
  documentId: DocumentId;
  kind: 'model' | 'level';
  onRefresh: () => void;
  onPlaced?: () => void;
}) {
  const { project } = session;
  const editingLevel = session.document.kind === 'level';
  const doc = getViperDocument(project, documentId);
  const isActive = session.documentId === documentId;
  const hasGeometry = kind === 'model' && modelHasPlaceableGeometry(doc);

  return (
    <li className={`outliner-doc-row${isActive ? ' is-active' : ''}`}>
      <button
        type="button"
        className="outliner-doc-open"
        title={`Open ${doc.name}`}
        onClick={() => openProjectDocument(session, documentId, onRefresh)}
        onDoubleClick={() => {
          if (kind === 'model' && editingLevel && hasGeometry) {
            placeModelQuick(session, documentId, { onRefresh, onPlaced });
          } else {
            openProjectDocument(session, documentId, onRefresh);
          }
        }}
      >
        <span className="outliner-doc-kind">{kind === 'model' ? 'M' : 'L'}</span>
        <span className="outliner-doc-name">{doc.name}</span>
        {kind === 'model' && !hasGeometry ? (
          <span className="outliner-doc-badge">empty</span>
        ) : null}
        {doc.dirty ? <span className="outliner-doc-dirty">•</span> : null}
        {isActive ? <span className="outliner-doc-active">open</span> : null}
      </button>
      <div className="outliner-doc-actions">
        {kind === 'model' && editingLevel && hasGeometry ? (
          <>
            <button
              type="button"
              className="outliner-doc-place"
              onClick={() => placeModelQuick(session, documentId, { onRefresh, onPlaced })}
            >
              Place
            </button>
            <button
              type="button"
              className="outliner-icon"
              title="Click in viewport to place"
              aria-label={`Click to place ${doc.name}`}
              onClick={() => startPlaceModelInViewport(session, documentId, { onRefresh, onPlaced })}
            >
              ⊕
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="outliner-icon"
          title="Rename"
          aria-label={`Rename ${doc.name}`}
          onClick={() => renameProjectDocument(session, documentId, onRefresh)}
        >
          ✎
        </button>
        <button
          type="button"
          className="outliner-icon danger"
          title="Delete"
          aria-label={`Delete ${doc.name}`}
          onClick={() => deleteProjectDocument(session, documentId, kind, onRefresh)}
        >
          ×
        </button>
      </div>
    </li>
  );
}

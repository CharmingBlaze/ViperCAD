import { useEffect, useRef, useState } from 'react';
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
import { writeModelDrag } from '@/app/outliner/modelDrag';

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
  const hasGeometry = kind === 'model' && modelHasPlaceableGeometry(doc, session.project);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(doc.name);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const skipCommitRef = useRef(false);

  useEffect(() => {
    if (!renaming) setDraftName(doc.name);
  }, [doc.name, renaming]);

  useEffect(() => {
    if (!renaming) return;
    const input = nameInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [renaming]);

  const commitRename = () => {
    if (skipCommitRef.current) {
      skipCommitRef.current = false;
      setDraftName(doc.name);
      setRenaming(false);
      return;
    }
    if (!renaming) return;
    const next = draftName.trim() || doc.name;
    setRenaming(false);
    setDraftName(next);
    renameProjectDocument(session, documentId, next, onRefresh);
  };

  const cancelRename = () => {
    skipCommitRef.current = true;
    nameInputRef.current?.blur();
  };

  const beginRename = () => {
    skipCommitRef.current = false;
    setDraftName(doc.name);
    setRenaming(true);
  };

  return (
    <li
      className={`outliner-doc-row${isActive ? ' is-active' : ''}${renaming ? ' is-renaming' : ''}${hasGeometry ? ' is-draggable' : ''}`}
      draggable={kind === 'model' && hasGeometry && !renaming}
      onDragStart={(event) => {
        if (kind !== 'model' || !hasGeometry || renaming) {
          event.preventDefault();
          return;
        }
        writeModelDrag(event.dataTransfer, documentId, doc.name);
      }}
    >
      {renaming ? (
        <div className="outliner-doc-open is-renaming">
          <span className="outliner-doc-kind">{kind === 'model' ? 'M' : 'L'}</span>
          <input
            ref={nameInputRef}
            className="outliner-doc-name-input"
            aria-label={`Rename ${doc.name}`}
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={commitRename}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                cancelRename();
              }
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          className="outliner-doc-open"
          draggable={false}
          title={hasGeometry ? `Open ${doc.name} · drag row into the viewport to place` : `Open ${doc.name}`}
          onClick={() => openProjectDocument(session, documentId, onRefresh)}
          onDoubleClick={(event) => {
            event.preventDefault();
            beginRename();
          }}
        >
          <span className="outliner-doc-kind">{kind === 'model' ? 'M' : 'L'}</span>
          <span className="outliner-doc-name">{doc.name}</span>
          {hasGeometry ? <span className="outliner-doc-drag" aria-hidden>⋮⋮</span> : null}
          {kind === 'model' && !hasGeometry ? (
            <span className="outliner-doc-badge">empty</span>
          ) : null}
          {doc.dirty ? <span className="outliner-doc-dirty">•</span> : null}
          {isActive ? <span className="outliner-doc-active">open</span> : null}
        </button>
      )}
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
          disabled={renaming}
          onClick={(event) => {
            event.stopPropagation();
            beginRename();
          }}
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

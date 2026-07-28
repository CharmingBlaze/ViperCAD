import { useEffect, useRef, useState } from 'react';
import type { EditorSession } from '@/core/editor/EditorSession';
import type { DocumentId } from '@/core/document/types';
import { getViperDocument } from '@/core/document/ViperProject';
import { filterDocumentIds } from '@/app/outliner/documentNavigation';
import { pushToast } from '@/app/Toast';

type OutlinerTab = 'scene' | 'assets' | 'models' | 'levels';

type Props = {
  session: EditorSession;
  onRefresh: () => void;
  onBrowseOutliner?: (tab: OutlinerTab) => void;
};

export function DocumentTabs({ session, onRefresh, onBrowseOutliner }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const activeId = session.projectEditor.activeDocumentId;
  const openIds = [...session.projectEditor.openDocuments.keys()];
  const levelIds = filterDocumentIds(session.project, session.project.levelDocumentIds, query);
  const modelIds = filterDocumentIds(session.project, session.project.modelDocumentIds, query);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    searchRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!activeId) return null;
  const activeDoc = getViperDocument(session.project, activeId);

  const switchTo = (documentId: DocumentId) => {
    session.openDocument(documentId);
    onRefresh();
    setOpen(false);
  };

  const closeDoc = (documentId: DocumentId, event: React.MouseEvent) => {
    event.stopPropagation();
    session.closeDocument(documentId);
    onRefresh();
  };

  const browse = (tab: OutlinerTab) => {
    onBrowseOutliner?.(tab);
    setOpen(false);
  };

  const createDoc = (kind: 'model' | 'level') => {
    const { project, projectEditor } = session;
    const id = kind === 'model'
      ? projectEditor.newModel(`Model ${project.modelDocumentIds.length + 1}`)
      : projectEditor.newLevel(`Level ${project.levelDocumentIds.length + 1}`);
    session.openDocument(id);
    onRefresh();
    pushToast(
      kind === 'model'
        ? 'New Model — build reusable assets here'
        : 'New Level — compose your environment here',
      'success',
    );
    setOpen(false);
  };

  const row = (documentId: DocumentId) => {
    const doc = getViperDocument(session.project, documentId);
    const isActive = documentId === activeId;
    const isOpen = session.projectEditor.openDocuments.has(documentId);
    const kindLabel = doc.kind === 'model' ? 'Model' : 'Level';
    return (
      <button
        key={documentId}
        type="button"
        className={`doc-switcher-item${isActive ? ' is-active' : ''}`}
        onClick={() => switchTo(documentId)}
      >
        <span className="doc-switcher-item-kind">{doc.kind === 'model' ? 'M' : 'L'}</span>
        <span className="doc-switcher-item-body">
          <span className="doc-switcher-item-name">{doc.name}</span>
          {!isOpen ? <span className="doc-switcher-item-hint">Not open</span> : null}
        </span>
        {doc.dirty ? <span className="doc-switcher-item-dirty" aria-label="Unsaved">•</span> : null}
        {isActive ? <span className="doc-switcher-item-check">✓</span> : null}
        {isOpen && openIds.length > 1 && (
          <span
            role="button"
            tabIndex={0}
            className="doc-switcher-item-close"
            aria-label={`Close ${doc.name}`}
            onClick={(event) => closeDoc(documentId, event)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                closeDoc(documentId, event as unknown as React.MouseEvent);
              }
            }}
          >
            ×
          </span>
        )}
        <span className="sr-only">{kindLabel}</span>
      </button>
    );
  };

  const hasResults = levelIds.length > 0 || modelIds.length > 0;

  return (
    <div className="doc-switcher" ref={rootRef}>
      <button
        type="button"
        className={`doc-switcher-trigger${open ? ' is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title={`${activeDoc.kind === 'model' ? 'Model' : 'Level'}: ${activeDoc.name}`}
      >
        <span className="doc-switcher-kind">{activeDoc.kind === 'model' ? 'M' : 'L'}</span>
        <span className="doc-switcher-name">{activeDoc.name}</span>
        {activeDoc.dirty ? <span className="doc-switcher-dirty" aria-label="Unsaved">•</span> : null}
        <span className="doc-switcher-chevron" aria-hidden>▾</span>
      </button>

      {open && (
        <div className="doc-switcher-menu" role="listbox" aria-label="Switch document">
          <div className="doc-switcher-toolbar">
            <input
              ref={searchRef}
              type="search"
              className="doc-switcher-search"
              placeholder="Search models and levels…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search documents"
            />
            <div className="doc-switcher-create-row">
              <button type="button" className="doc-switcher-create" onClick={() => createDoc('model')}>
                + Model
              </button>
              <button type="button" className="doc-switcher-create" onClick={() => createDoc('level')}>
                + Level
              </button>
            </div>
          </div>

          {!hasResults && (
            <p className="doc-switcher-empty">No documents match “{query.trim()}”</p>
          )}

          {levelIds.length > 0 && (
            <section>
              <header>
                Levels
                <span className="doc-switcher-count">{levelIds.length}</span>
              </header>
              {levelIds.map((id) => row(id))}
            </section>
          )}

          {modelIds.length > 0 && (
            <section>
              <header>
                Models
                <span className="doc-switcher-count">{modelIds.length}</span>
              </header>
              {modelIds.map((id) => row(id))}
            </section>
          )}

          {onBrowseOutliner && (
            <section className="doc-switcher-footer">
              <button type="button" className="doc-switcher-link" onClick={() => browse('levels')}>
                Browse Levels in Outliner ({session.project.levelDocumentIds.length})
              </button>
              <button type="button" className="doc-switcher-link" onClick={() => browse('models')}>
                Browse Models in Outliner ({session.project.modelDocumentIds.length})
              </button>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

export function openDocumentTab(session: EditorSession, documentId: DocumentId): void {
  session.openDocument(documentId);
}

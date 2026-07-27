import { useMemo, useState } from 'react';
import type { EditorSession } from '@/core/editor/EditorSession';
import { filterDocumentIds } from '@/app/outliner/documentNavigation';
import { createProjectDocument } from '@/app/outliner/documentActions';
import { OutlinerDocumentRow } from '@/app/outliner/OutlinerProjectDocuments';

type Props = {
  session: EditorSession;
  kind: 'model' | 'level';
  onRefresh: () => void;
  onPlaced?: () => void;
};

export function OutlinerDocumentList({ session, kind, onRefresh, onPlaced }: Props) {
  const [query, setQuery] = useState('');
  const { project } = session;
  const documentIds = kind === 'model' ? project.modelDocumentIds : project.levelDocumentIds;
  const filteredIds = useMemo(
    () => filterDocumentIds(project, documentIds, query),
    [project, documentIds, query],
  );
  const kindLabel = kind === 'model' ? 'Model' : 'Level';
  const kindPlural = kind === 'model' ? 'models' : 'levels';
  const hint = kind === 'model'
    ? 'Reusable assets — open to edit geometry'
    : 'Environment scenes — open to compose your level';

  return (
    <div className="outliner-doc-panel">
      <div className="outliner-doc-intro">
        <p className="outliner-doc-intro-text">{hint}</p>
      </div>
      <div className="outliner-doc-toolbar">
        <div className="outliner-doc-toolbar-main">
          <input
            type="search"
            className="outliner-doc-search"
            placeholder={`Search ${kindPlural}…`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={`Search ${kindPlural}`}
          />
          <button
            type="button"
            className="outliner-doc-create"
            onClick={() => createProjectDocument(session, kind, onRefresh)}
          >
            + New {kindLabel}
          </button>
        </div>
        <p className="outliner-doc-meta">
          {query.trim()
            ? `${filteredIds.length} of ${documentIds.length} ${kindPlural}`
            : `${documentIds.length} ${kindPlural}`}
        </p>
      </div>
      <ul className="outliner-doc-list">
        {filteredIds.length === 0 ? (
          <li className="outliner-doc-empty">
            {query.trim()
              ? `No ${kindPlural} match “${query.trim()}”`
              : `No ${kindPlural} yet — create one above`}
          </li>
        ) : filteredIds.map((documentId) => (
          <OutlinerDocumentRow
            key={documentId}
            session={session}
            documentId={documentId}
            kind={kind}
            onRefresh={onRefresh}
            onPlaced={onPlaced}
          />
        ))}
      </ul>
    </div>
  );
}

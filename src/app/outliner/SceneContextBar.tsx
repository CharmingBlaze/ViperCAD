import type { EditorSession } from '@/core/editor/EditorSession';

type OutlinerTab = 'models' | 'levels';

type Props = {
  session: EditorSession;
  onBrowseTab: (tab: OutlinerTab) => void;
};

export function SceneContextBar({ session, onBrowseTab }: Props) {
  const doc = session.document;
  const kindLabel = doc.kind === 'model' ? 'Model' : 'Level';
  const objectCount = session.document.objects.size;

  return (
    <div className="scene-context-bar">
      <div className="scene-context-main">
        <span className="scene-context-kind" title={kindLabel}>
          {doc.kind === 'model' ? 'M' : 'L'}
        </span>
        <div className="scene-context-copy">
          <span className="scene-context-name">{doc.name}</span>
          <span className="scene-context-meta">
            {kindLabel} · {objectCount} object{objectCount === 1 ? '' : 's'}
            {doc.dirty ? ' · unsaved' : ''}
          </span>
        </div>
      </div>
      <div className="scene-context-nav">
        <button type="button" className="scene-context-link" onClick={() => onBrowseTab('levels')}>
          Levels
        </button>
        <button type="button" className="scene-context-link" onClick={() => onBrowseTab('models')}>
          Models
        </button>
      </div>
    </div>
  );
}

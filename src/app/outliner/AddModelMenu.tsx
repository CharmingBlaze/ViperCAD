import { useEffect, useRef, useState } from 'react';
import type { EditorSession } from '@/core/editor/EditorSession';
import { openDocumentTab } from '@/app/DocumentTabs';
import {
  getPlaceableModels,
  placeModelQuick,
  startPlaceModelInViewport,
} from '@/app/outliner/placeModelWorkflow';

type OutlinerTab = 'models' | 'levels';

type Props = {
  session: EditorSession;
  onRefresh: () => void;
  onPlaced?: () => void;
  onBrowseTab: (tab: OutlinerTab) => void;
};

export function AddModelMenu({ session, onRefresh, onPlaced, onBrowseTab }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const placeable = getPlaceableModels(session);

  useEffect(() => {
    if (!open) return;
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

  if (session.document.kind !== 'level') return null;

  if (placeable.length === 0) {
    return (
      <button
        type="button"
        className="scene-toolbar-btn"
        onClick={() => onBrowseTab('models')}
      >
        Create a Model
      </button>
    );
  }

  return (
    <div className="add-model-menu" ref={rootRef}>
      <button
        type="button"
        className={`scene-toolbar-btn scene-toolbar-btn-primary${open ? ' is-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        + Add Model
      </button>
      {open && (
        <div className="add-model-menu-dropdown" role="menu">
          {placeable.map((doc) => (
            <div key={doc.id} className="add-model-menu-item" role="none">
              <button
                type="button"
                className="add-model-menu-name"
                role="menuitem"
                onClick={() => {
                  openDocumentTab(session, doc.id);
                  onRefresh();
                  setOpen(false);
                }}
              >
                {doc.name}
              </button>
              <div className="add-model-menu-actions">
                <button
                  type="button"
                  className="add-model-menu-action"
                  onClick={() => {
                    placeModelQuick(session, doc.id, { onRefresh, onPlaced });
                    setOpen(false);
                  }}
                >
                  Place
                </button>
                <button
                  type="button"
                  className="add-model-menu-action"
                  title="Click in viewport to choose position"
                  onClick={() => {
                    startPlaceModelInViewport(session, doc.id, { onRefresh, onPlaced });
                    setOpen(false);
                  }}
                >
                  Click…
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

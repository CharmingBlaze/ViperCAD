import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditorSession } from '@/core/editor/EditorSession';
import {
  commitGroupSelection,
  commitUngroupSelection,
} from '@/core/editor/HierarchyCommands';
import {
  duplicateObjectSubtree,
  isGroupObject,
  reparentObject,
} from '@/core/editor/Hierarchy';
import { removeObject } from '@/core/document/ModelDocument';
import type { ObjectId } from '@/core/document/types';

type Props = {
  session: EditorSession;
  onClose: () => void;
  onRefresh: () => void;
};

type DragState = { pointerId: number; offsetX: number; offsetY: number };

export function FloatingOutliner({ session, onClose, onRefresh }: Props) {
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState({ x: 18, y: 92 });
  const [collapsed, setCollapsed] = useState<Set<ObjectId>>(() => new Set());
  const [dragObjectId, setDragObjectId] = useState<ObjectId | null>(null);
  const [dropTargetId, setDropTargetId] = useState<ObjectId | null>(null);
  const drag = useRef<DragState | null>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const width = panel.current?.offsetWidth ?? 300;
      const height = panel.current?.offsetHeight ?? 42;
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - width, event.clientX - current.offsetX)),
        y: Math.max(48, Math.min(window.innerHeight - height, event.clientY - current.offsetY)),
      });
    };
    const end = (event: PointerEvent) => {
      if (drag.current?.pointerId === event.pointerId) drag.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
  }, []);

  const groupCount = useMemo(() => {
    let count = 0;
    for (const object of session.document.objects.values()) {
      if (isGroupObject(object)) count += 1;
    }
    return count;
  }, [session.document.objects, session.document.dirty]);

  const touch = () => {
    session.document.dirty = true;
    session.requestRedraw();
    onRefresh();
  };

  const select = (objectId: ObjectId, event?: React.MouseEvent) => {
    const object = session.document.objects.get(objectId);
    if (!object || object.locked) return;
    session.tools.setActive('select', session.context());
    session.selection.setMode('object');
    const additive = !!event && (event.ctrlKey || event.metaKey);
    const range = !!event && event.shiftKey;
    if (range && session.selection.state.activeObjectId) {
      // Shift: add without clearing (simple multi-select).
      session.selection.selectObjects([objectId], 'add');
    } else if (additive) {
      const already = session.selection.state.selectedObjectIds.has(objectId);
      session.selection.selectObjects([objectId], already ? 'remove' : 'add');
    } else {
      session.selection.selectObjects([objectId], 'replace');
    }
    session.requestRedraw();
    onRefresh();
  };

  const toggleCollapsed = (objectId: ObjectId) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(objectId)) next.delete(objectId);
      else next.add(objectId);
      return next;
    });
  };

  const canGroup = session.selection.state.selectedObjectIds.size >= 1;
  const canUngroup = [...session.selection.state.selectedObjectIds].some((id) =>
    isGroupObject(session.document.objects.get(id)),
  );

  const rows = (ids: ObjectId[], depth = 0): React.ReactNode =>
    ids.map((id) => {
      const object = session.document.objects.get(id);
      if (!object) return null;
      const selected = session.selection.state.selectedObjectIds.has(id);
      const group = isGroupObject(object);
      const hasChildren = object.childIds.length > 0;
      const isCollapsed = collapsed.has(id);
      const isDropTarget = dropTargetId === id && dragObjectId !== id;

      return (
        <div key={id} className="outliner-node">
          <div
            className={[
              'outliner-row',
              selected ? 'is-selected' : '',
              object.locked ? 'is-locked' : '',
              group ? 'is-group' : '',
              isDropTarget ? 'is-drop-target' : '',
              dragObjectId === id ? 'is-dragging' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ paddingLeft: 4 + depth * 12 }}
            draggable={!object.locked}
            onDragStart={(event) => {
              event.dataTransfer.setData('text/vipercad-object', id);
              event.dataTransfer.effectAllowed = 'move';
              setDragObjectId(id);
            }}
            onDragEnd={() => {
              setDragObjectId(null);
              setDropTargetId(null);
            }}
            onDragOver={(event) => {
              if (!dragObjectId || dragObjectId === id) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDropTargetId(id);
            }}
            onDragLeave={() => {
              if (dropTargetId === id) setDropTargetId(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const sourceId = event.dataTransfer.getData('text/vipercad-object') || dragObjectId;
              setDragObjectId(null);
              setDropTargetId(null);
              if (!sourceId || sourceId === id) return;
              if (reparentObject(session.document, sourceId, id)) {
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  next.delete(id);
                  return next;
                });
                select(sourceId);
                touch();
              }
            }}
            onClick={(event) => select(id, event)}
          >
            <button
              type="button"
              className={`outliner-icon outliner-twist${hasChildren ? '' : ' is-leaf'}`}
              title={hasChildren ? (isCollapsed ? 'Expand' : 'Collapse') : undefined}
              aria-label={hasChildren ? (isCollapsed ? 'Expand' : 'Collapse') : 'Leaf'}
              disabled={!hasChildren}
              onClick={(event) => {
                event.stopPropagation();
                if (hasChildren) toggleCollapsed(id);
              }}
            >
              {hasChildren ? (isCollapsed ? '▸' : '▾') : '·'}
            </button>
            <button
              type="button"
              className="outliner-icon"
              title={object.visible ? 'Hide object' : 'Show object'}
              aria-label={object.visible ? `Hide ${object.name}` : `Show ${object.name}`}
              onClick={(event) => {
                event.stopPropagation();
                object.visible = !object.visible;
                touch();
              }}
            >
              {object.visible ? '●' : '○'}
            </button>
            <span className={`outliner-kind${group ? ' is-group' : ''}`} title={group ? 'Group' : 'Object'}>
              {group ? 'Grp' : '◈'}
            </span>
            <input
              className="outliner-name"
              aria-label={`Object name ${object.name}`}
              value={object.name}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => {
                object.name = event.target.value;
                touch();
              }}
            />
            <button
              type="button"
              className={`outliner-icon${object.locked ? ' is-active' : ''}`}
              title={object.locked ? 'Unlock object' : 'Lock object'}
              aria-label={object.locked ? `Unlock ${object.name}` : `Lock ${object.name}`}
              onClick={(event) => {
                event.stopPropagation();
                object.locked = !object.locked;
                touch();
              }}
            >
              {object.locked ? 'L' : 'U'}
            </button>
            <button
              type="button"
              className="outliner-icon"
              title={group ? 'Duplicate group' : 'Duplicate object'}
              aria-label={`Duplicate ${object.name}`}
              onClick={(event) => {
                event.stopPropagation();
                const copyId = duplicateObjectSubtree(session.document, id, true);
                select(copyId);
                touch();
              }}
            >
              +
            </button>
            <button
              type="button"
              className="outliner-icon danger"
              title="Delete object"
              aria-label={`Delete ${object.name}`}
              onClick={(event) => {
                event.stopPropagation();
                removeObject(session.document, id);
                session.selection.prune(session.document);
                touch();
              }}
            >
              ×
            </button>
          </div>
          {hasChildren && !isCollapsed && rows(object.childIds, depth + 1)}
        </div>
      );
    });

  return (
    <aside
      ref={panel}
      className={`floating-outliner${minimized ? ' is-minimized' : ''}`}
      style={{ left: position.x, top: position.y }}
      aria-label="Scene outliner"
      onDragOver={(event) => {
        if (!dragObjectId) return;
        // Allow dropping onto empty body / root.
        if ((event.target as HTMLElement).closest('.outliner-row')) return;
        event.preventDefault();
        setDropTargetId(null);
      }}
      onDrop={(event) => {
        if (!dragObjectId) return;
        if ((event.target as HTMLElement).closest('.outliner-row')) return;
        event.preventDefault();
        const sourceId = dragObjectId;
        setDragObjectId(null);
        setDropTargetId(null);
        if (reparentObject(session.document, sourceId, null)) {
          select(sourceId);
          touch();
        }
      }}
    >
      <header
        className="outliner-header"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          const rect = panel.current?.getBoundingClientRect();
          drag.current = {
            pointerId: event.pointerId,
            offsetX: event.clientX - (rect?.left ?? position.x),
            offsetY: event.clientY - (rect?.top ?? position.y),
          };
        }}
      >
        <div>
          <strong>Scene</strong>
          <span>
            {session.document.objects.size} objects
            {groupCount ? ` · ${groupCount} groups` : ''}
          </span>
        </div>
        <div className="outliner-actions">
          <button
            type="button"
            className="outliner-icon"
            aria-label="Group selection"
            title="Group (Ctrl+G)"
            disabled={!canGroup}
            onClick={() => {
              if (commitGroupSelection(session)) touch();
            }}
          >
            G
          </button>
          <button
            type="button"
            className="outliner-icon"
            aria-label="Ungroup selection"
            title="Ungroup (Ctrl+Shift+G)"
            disabled={!canUngroup}
            onClick={() => {
              if (commitUngroupSelection(session)) touch();
            }}
          >
            ↗
          </button>
          <button
            type="button"
            className="outliner-icon"
            aria-label={minimized ? 'Restore outliner' : 'Minimize outliner'}
            title={minimized ? 'Restore' : 'Minimize'}
            onClick={() => setMinimized((value) => !value)}
          >
            {minimized ? '□' : '–'}
          </button>
          <button
            type="button"
            className="outliner-icon danger"
            aria-label="Close outliner"
            title="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </header>
      {!minimized && (
        <div className="outliner-body">
          {session.document.rootObjectIds.length
            ? rows(session.document.rootObjectIds)
            : <p className="outliner-empty">No objects yet</p>}
        </div>
      )}
    </aside>
  );
}

import { useEffect, useRef, useState } from 'react';
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
  const [renamingId, setRenamingId] = useState<ObjectId | null>(null);
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

  let groupCount = 0;
  for (const object of session.document.objects.values()) {
    if (isGroupObject(object)) groupCount += 1;
  }

  const visibleObjectIds: ObjectId[] = [];
  const collectVisible = (ids: ObjectId[]) => {
    for (const id of ids) {
      const object = session.document.objects.get(id);
      if (!object) continue;
      visibleObjectIds.push(id);
      if (object.childIds.length > 0 && !collapsed.has(id)) collectVisible(object.childIds);
    }
  };
  collectVisible(session.document.rootObjectIds);

  const touch = () => {
    session.document.dirty = true;
    session.requestRedraw();
    onRefresh();
  };

  const select = (objectId: ObjectId, event?: React.MouseEvent) => {
    const object = session.document.objects.get(objectId);
    if (!object) return;
    session.tools.setActive('select', session.context());
    session.selection.setMode('object');
    const additive = !!event && (event.ctrlKey || event.metaKey);
    const range = !!event && event.shiftKey;
    if (range && session.selection.state.activeObjectId) {
      const anchor = visibleObjectIds.indexOf(session.selection.state.activeObjectId);
      const target = visibleObjectIds.indexOf(objectId);
      if (anchor >= 0 && target >= 0) {
        const rangeIds = visibleObjectIds.slice(
          Math.min(anchor, target),
          Math.max(anchor, target) + 1,
        );
        session.selection.selectObjects(rangeIds, additive ? 'add' : 'replace');
      } else {
        session.selection.selectObjects([objectId], additive ? 'add' : 'replace');
      }
    } else if (additive) {
      const already = session.selection.state.selectedObjectIds.has(objectId);
      session.selection.selectObjects([objectId], already ? 'remove' : 'add');
    } else {
      session.selection.selectObjects([objectId], 'replace');
    }
    session.requestRedraw();
    onRefresh();
  };

  const moveKeyboardSelection = (objectId: ObjectId, direction: -1 | 1) => {
    const current = visibleObjectIds.indexOf(objectId);
    const nextId = visibleObjectIds[Math.max(0, Math.min(visibleObjectIds.length - 1, current + direction))];
    if (!nextId || nextId === objectId) return;
    select(nextId);
    requestAnimationFrame(() => {
      panel.current
        ?.querySelector<HTMLElement>(`[data-outliner-object="${CSS.escape(nextId)}"]`)
        ?.focus();
    });
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
      const active = session.selection.state.activeObjectId === id;
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
              active ? 'is-active' : '',
              object.locked ? 'is-locked' : '',
              group ? 'is-group' : '',
              isDropTarget ? 'is-drop-target' : '',
              dragObjectId === id ? 'is-dragging' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ paddingLeft: 5 + depth * 16 }}
            role="treeitem"
            aria-selected={selected}
            aria-level={depth + 1}
            data-outliner-object={id}
            tabIndex={active || (!session.selection.state.activeObjectId && visibleObjectIds[0] === id) ? 0 : -1}
            title={`${object.name} · click to select · Ctrl add/remove · Shift range`}
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
            onKeyDown={(event) => {
              if ((event.target as HTMLElement).closest('input, button, select, textarea')) return;
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                moveKeyboardSelection(id, 1);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                moveKeyboardSelection(id, -1);
              } else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                select(id);
              } else if (event.key === 'ArrowRight' && hasChildren && isCollapsed) {
                event.preventDefault();
                toggleCollapsed(id);
              } else if (event.key === 'ArrowLeft' && hasChildren && !isCollapsed) {
                event.preventDefault();
                toggleCollapsed(id);
              }
            }}
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
              readOnly={renamingId !== id}
              onClick={(event) => {
                event.stopPropagation();
                select(id, event);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                select(id, event);
                setRenamingId(id);
                const input = event.currentTarget;
                requestAnimationFrame(() => {
                  input.focus();
                  input.select();
                });
              }}
              onFocus={(event) => {
                if (!session.selection.state.selectedObjectIds.has(id)) select(id);
                if (renamingId === id) event.currentTarget.select();
              }}
              onBlur={() => setRenamingId((current) => current === id ? null : current)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') {
                  setRenamingId(null);
                  event.currentTarget.blur();
                }
              }}
              onChange={(event) => {
                if (renamingId !== id) return;
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
            {session.selection.state.selectedObjectIds.size
              ? ` · ${session.selection.state.selectedObjectIds.size} selected`
              : ''}
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
        <div className="outliner-body" role="tree" aria-label="Scene objects">
          {session.document.rootObjectIds.length
            ? rows(session.document.rootObjectIds)
            : <p className="outliner-empty">No objects yet</p>}
        </div>
      )}
    </aside>
  );
}

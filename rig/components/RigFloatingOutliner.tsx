import { useEffect, useRef, useState } from 'react';
import { isGroupObject } from '@/core/document/SceneObjectKind';
import { buildBoneTree } from '@/core/rig/boneTree';
import { readRigDocumentSettings } from '@/core/rig/RigDocument';
import type { BoneId } from '@/core/rig/types';
import type { ObjectId, SceneObject } from '@/core/document/types';
import {
  listSceneCameras,
  sceneObjectKindLabel,
  type RigLightType,
} from '../scene/RigSceneAssets';
import type { RigSession } from '../RigSession';
import type { RigWorkspace } from '../RigWorkspace';
import { RIG_CAMERA_PANE } from '../RigWorkspace';

type OutlinerTab = 'scene' | 'rig';

type Props = {
  session: RigSession;
  workspace: RigWorkspace;
  onClose: () => void;
  onRefresh: () => void;
};

type DragState = { pointerId: number; offsetX: number; offsetY: number };

export function RigFloatingOutliner({ session, workspace, onClose, onRefresh }: Props) {
  const [tab, setTab] = useState<OutlinerTab>('scene');
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState(() => ({
    x: 12,
    y: Math.max(52, window.innerHeight - 360),
  }));
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [dragObjectId, setDragObjectId] = useState<ObjectId | null>(null);
  const [dropTargetId, setDropTargetId] = useState<ObjectId | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const drag = useRef<DragState | null>(null);
  const panel = useRef<HTMLElement>(null);

  const source = session.getSourceModel();
  const settings = readRigDocumentSettings(session.rigDocument);
  const armature = settings.armatureId ? session.project.armatures.get(settings.armatureId) : null;
  const boneTree = armature ? buildBoneTree(armature) : [];

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

  const visibleObjectIds: ObjectId[] = [];
  const collectVisible = (ids: ObjectId[]) => {
    for (const id of ids) {
      const object = source?.objects.get(id);
      if (!object) continue;
      visibleObjectIds.push(id);
      if (object.childIds.length > 0 && !collapsed.has(id)) collectVisible(object.childIds);
    }
  };
  if (source) collectVisible(source.rootObjectIds);

  const touch = () => {
    session.notify();
    onRefresh();
  };

  const selectObject = (objectId: ObjectId, event?: React.MouseEvent) => {
    if (!source) return;
    const object = source.objects.get(objectId);
    if (!object) return;
    const additive = !!event && (event.ctrlKey || event.metaKey);
    const range = !!event && event.shiftKey;
    if (range && session.selectedObjectId) {
      const anchor = visibleObjectIds.indexOf(session.selectedObjectId);
      const target = visibleObjectIds.indexOf(objectId);
      if (anchor >= 0 && target >= 0) {
        if (!additive) session.selectObject(objectId);
      } else {
        session.selectObject(objectId);
      }
    } else if (additive && session.selectedObjectId === objectId) {
      session.selectObject(null);
    } else {
      session.selectObject(objectId);
    }
    touch();
  };

  const selectBone = (boneId: BoneId) => {
    session.selectBone(boneId);
    touch();
  };

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const lookThrough = (objectId: ObjectId) => {
    workspace.setCameraPaneLookThrough(objectId);
    session.selectObject(objectId);
    touch();
  };

  const sceneRows = (ids: ObjectId[], depth = 0): React.ReactNode =>
    ids.map((id) => {
      const object = source!.objects.get(id);
      if (!object) return null;
      const selected = session.selectedObjectId === id;
      const group = isGroupObject(object);
      const hasChildren = object.childIds.length > 0;
      const isCollapsed = collapsed.has(id);
      const isDropTarget = dropTargetId === id && dragObjectId !== id;
      const lookThroughActive = workspace.getLookThroughCamera(RIG_CAMERA_PANE) === id;

      return (
        <div key={id} className="outliner-node">
          <div
            className={[
              'outliner-row',
              selected ? 'is-selected' : '',
              selected ? 'is-active' : '',
              object.locked ? 'is-locked' : '',
              group ? 'is-group' : '',
              isDropTarget ? 'is-drop-target' : '',
              dragObjectId === id ? 'is-dragging' : '',
              lookThroughActive ? 'is-camera-view' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ paddingLeft: 5 + depth * 16 }}
            role="treeitem"
            aria-selected={selected}
            data-outliner-object={id}
            draggable={!object.locked}
            onDragStart={(event) => {
              event.dataTransfer.setData('text/viperrig-object', id);
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
              const sourceId = event.dataTransfer.getData('text/viperrig-object') || dragObjectId;
              setDragObjectId(null);
              setDropTargetId(null);
              if (!sourceId || sourceId === id) return;
              if (session.reparentSceneObject(sourceId, id)) {
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  next.delete(id);
                  return next;
                });
                session.selectObject(sourceId);
                touch();
              }
            }}
            onClick={(event) => selectObject(id, event)}
            onDoubleClick={(event) => {
              event.stopPropagation();
              if (object.kind === 'camera') lookThrough(id);
            }}
          >
            <button
              type="button"
              className={`outliner-icon outliner-twist${hasChildren ? '' : ' is-leaf'}`}
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
              onClick={(event) => {
                event.stopPropagation();
                session.setSceneObjectVisible(id, !object.visible);
                touch();
              }}
            >
              {object.visible ? '●' : '○'}
            </button>
            <span className={`outliner-kind${group ? ' is-group' : ''}`} title={object.kind}>
              {sceneObjectKindLabel(object)}
            </span>
            <input
              className="outliner-name"
              value={object.name}
              readOnly={renamingId !== id}
              onClick={(event) => {
                event.stopPropagation();
                selectObject(id, event);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                selectObject(id, event);
                setRenamingId(id);
                requestAnimationFrame(() => {
                  event.currentTarget.focus();
                  event.currentTarget.select();
                });
              }}
              onBlur={() => setRenamingId((current) => (current === id ? null : current))}
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
                session.renameSceneObject(id, event.target.value);
                touch();
              }}
            />
            <div className="outliner-row-actions">
              {object.kind === 'camera' && (
                <button
                  type="button"
                  className={`outliner-icon${lookThroughActive ? ' is-active' : ''}`}
                  title="Use as animation camera"
                  onClick={(event) => {
                    event.stopPropagation();
                    lookThrough(id);
                  }}
                >
                  ▶
                </button>
              )}
              <button
                type="button"
                className={`outliner-icon${object.locked ? ' is-active' : ''}`}
                title={object.locked ? 'Unlock' : 'Lock'}
                onClick={(event) => {
                  event.stopPropagation();
                  session.setSceneObjectLocked(id, !object.locked);
                  touch();
                }}
              >
                {object.locked ? 'L' : 'U'}
              </button>
              <button
                type="button"
                className="outliner-icon danger"
                title="Delete object"
                onClick={(event) => {
                  event.stopPropagation();
                  workspace.clearLookThroughCamera(id);
                  session.deleteSceneObject(id);
                  touch();
                }}
              >
                ×
              </button>
            </div>
          </div>
          {hasChildren && !isCollapsed && sceneRows(object.childIds, depth + 1)}
        </div>
      );
    });

  const boneRows = (): React.ReactNode =>
    boneTree.map(({ bone, depth }) => {
      const selected = session.selectedBoneId === bone.id;
      const childIds = [...armature!.bones.values()].filter((b) => b.parentId === bone.id).map((b) => b.id);
      const hasChildren = childIds.length > 0;
      const isCollapsed = collapsed.has(bone.id);
      return (
        <div key={bone.id} className="outliner-node">
          <div
            className={['outliner-row', selected ? 'is-selected is-active' : ''].filter(Boolean).join(' ')}
            style={{ paddingLeft: 5 + depth * 16 }}
            onClick={() => selectBone(bone.id)}
          >
            <button
              type="button"
              className={`outliner-icon outliner-twist${hasChildren ? '' : ' is-leaf'}`}
              disabled={!hasChildren}
              onClick={(event) => {
                event.stopPropagation();
                if (hasChildren) toggleCollapsed(bone.id);
              }}
            >
              {hasChildren ? (isCollapsed ? '▸' : '▾') : '·'}
            </button>
            <span className="outliner-kind" title="Bone">Bn</span>
            <span className="outliner-name outliner-name-static">{bone.name}</span>
          </div>
        </div>
      );
    });

  const addLight = (lightType: RigLightType) => {
    session.addLight(lightType);
    touch();
  };

  return (
    <aside
      ref={panel}
      className={`floating-outliner${minimized ? ' is-minimized' : ''}`}
      style={{ left: position.x, top: position.y, width: minimized ? undefined : 300 }}
      aria-label="Outliner"
      onDragOver={(event) => {
        if (!dragObjectId) return;
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
        if (session.reparentSceneObject(sourceId, null)) {
          session.selectObject(sourceId);
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
          <strong>Outliner</strong>
          {source && tab === 'scene' && <span>{source.name}</span>}
        </div>
        <div className="outliner-actions">
          <button
            type="button"
            className="outliner-icon"
            aria-label={minimized ? 'Restore outliner' : 'Minimize outliner'}
            onClick={() => setMinimized((value) => !value)}
          >
            {minimized ? '□' : '–'}
          </button>
          <button type="button" className="outliner-icon danger" aria-label="Close outliner" onClick={onClose}>
            ×
          </button>
        </div>
      </header>

      {!minimized && (
        <nav className="outliner-tabs" aria-label="Outliner views">
          {([
            ['scene', 'Scene', null],
            ['rig', 'Rig', armature?.bones.size ?? 0],
          ] as const).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              className={`outliner-tab${tab === id ? ' is-active' : ''}`}
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
              {typeof count === 'number' ? <span className="outliner-tab-count">{count}</span> : null}
            </button>
          ))}
        </nav>
      )}

      {!minimized && tab === 'scene' && (
        <div className="outliner-scene-panel">
          <div className="scene-toolbar">
            <div className="scene-toolbar-group">
              <button
                type="button"
                className="scene-toolbar-btn"
                disabled={!source}
                onClick={() => {
                  session.addCamera();
                  touch();
                }}
              >
                + Camera
              </button>
              <button
                type="button"
                className="scene-toolbar-btn"
                disabled={!source}
                onClick={() => addLight('directional')}
              >
                + Sun
              </button>
              <button
                type="button"
                className="scene-toolbar-btn"
                disabled={!source}
                onClick={() => addLight('point')}
              >
                + Point
              </button>
            </div>
          </div>
          <div className="outliner-body" role="tree">
            {!source ? (
              <p className="outliner-empty">Link a ViperCAD model to populate the scene.</p>
            ) : source.rootObjectIds.length === 0 ? (
              <p className="outliner-empty">Empty scene — add cameras, lights, or meshes from ViperCAD.</p>
            ) : (
              sceneRows(source.rootObjectIds)
            )}
          </div>
        </div>
      )}

      {!minimized && tab === 'rig' && (
        <div className="outliner-body" role="tree">
          {!armature ? (
            <p className="outliner-empty">Run Quick setup to create an armature.</p>
          ) : (
            boneRows()
          )}
        </div>
      )}
    </aside>
  );
}

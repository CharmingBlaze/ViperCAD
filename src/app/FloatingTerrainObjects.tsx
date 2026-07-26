import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { EditorSession } from '@/core/editor/EditorSession';
import { activeTerrain } from '@/core/terrain/Terrain';
import {
  buildTerrainPresetMesh,
  groundObjectToTerrain,
  projectTerrainPropSources,
  repairTerrainPresetSources,
  snapshotPlacedTransforms,
  restorePlacedTransforms,
  TERRAIN_PROP_PRESETS,
  terrainPlacedObjects,
  type TerrainPropPreset,
} from '@/core/terrain/TerrainProps';
import {
  TerrainObjectTool,
  type TerrainObjectBrushMode,
  type TerrainObjectPlacementMode,
} from '@/core/tools/TerrainObjectTool';
import { faceVertexIds } from '@/core/mesh/EditableMesh';
import type { EditableMesh } from '@/core/mesh/types';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import {
  MODEL_IMPORT_FILES,
  openNativeFile,
} from '@/app/platform/FileDialogs';
import { importTerrainLibraryFile } from '@/core/terrain/TerrainObjectLibrary';

type Props = {
  session: EditorSession;
  workspace: WorkspaceController;
  onClose: () => void;
  onRefresh: () => void;
};

type DragState = { pointerId: number; offsetX: number; offsetY: number };

export function FloatingTerrainObjects({
  session,
  workspace,
  onClose,
  onRefresh,
}: Props) {
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState({ x: 18, y: 94 });
  const [objectSearch, setObjectSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const drag = useRef<DragState | null>(null);
  const panel = useRef<HTMLElement>(null);
  const objectTool = session.tools.get('terrain-object') as TerrainObjectTool;
  const terrains = [...session.document.objects.values()].filter(
    (object) => object.metadata.terrain === 'true',
  );
  const terrain = activeTerrain(session) ?? (() => {
    const selected = session.selection.state.activeObjectId
      ? session.document.objects.get(session.selection.state.activeObjectId)
      : null;
    const owner = selected?.metadata.terrainOwnerId
      ? session.document.objects.get(selected.metadata.terrainOwnerId)
      : null;
    const object = owner?.metadata.terrain === 'true' ? owner : terrains[0];
    const mesh = object?.meshId ? session.document.meshes.get(object.meshId) : null;
    return object && mesh ? { object, mesh } : null;
  })();
  const projectSources = projectTerrainPropSources(session.document);
  const visibleProjectSources = projectSources.filter((object) =>
    object.name.toLocaleLowerCase().includes(objectSearch.trim().toLocaleLowerCase()),
  );
  const placedObjects = terrainPlacedObjects(session.document, terrain?.object.id);
  const presetMeshes = useMemo(
    () => new Map(TERRAIN_PROP_PRESETS.map((preset) => [
      preset.id,
      buildTerrainPresetMesh(preset.id),
    ])),
    [],
  );
  const selectedBrushLabel = objectTool.usePreset
    ? TERRAIN_PROP_PRESETS.find((preset) => preset.id === objectTool.preset)?.label ?? 'Tree'
    : objectTool.sourceObjectId
      ? session.document.objects.get(objectTool.sourceObjectId)?.name ?? 'Project object'
      : 'Choose an object';

  useEffect(() => {
    if (!repairTerrainPresetSources(session.document)) return;
    session.requestRedraw();
    onRefresh();
  }, [session, session.document.id, onRefresh]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const width = panel.current?.offsetWidth ?? 286;
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

  const prepareObjectTool = (mode: TerrainObjectBrushMode) => {
    if (!terrain) return;
    objectTool.setTerrain(terrain.object.id, session.context());
    objectTool.setMode(mode, session.context());
    session.selection.setMode('object');
    session.selection.selectObjects([terrain.object.id], 'replace');
    session.tools.setActive('terrain-object', session.context());
    session.requestRedraw();
    onRefresh();
  };

  const choosePreset = (preset: TerrainPropPreset) => {
    if (!terrain) return;
    objectTool.setTerrain(terrain.object.id, session.context());
    objectTool.setPreset(preset, session.context());
    if (objectTool.mode === 'erase') objectTool.setMode('place', session.context());
    prepareObjectTool(objectTool.mode);
  };

  const chooseProjectObject = (objectId: string) => {
    if (!terrain) return;
    objectTool.setTerrain(terrain.object.id, session.context());
    objectTool.setSourceObject(objectId, session.context());
    if (objectTool.mode === 'erase') objectTool.setMode('place', session.context());
    prepareObjectTool(objectTool.mode);
  };

  const selectLevelObjects = () => {
    session.tools.setActive('select', session.context());
    session.selection.setMode('object');
    session.selection.selectObjects(placedObjects.map((object) => object.id), 'replace');
    session.requestRedraw();
    onRefresh();
  };

  const importObject = async () => {
    setImporting(true);
    setImportNote(null);
    try {
      const selected = await openNativeFile({ types: MODEL_IMPORT_FILES });
      if (!selected) return;
      const objects = await importTerrainLibraryFile(session.document, selected.file);
      const first = objects[0];
      if (first) chooseProjectObject(first.id);
      setObjectSearch('');
      setImportNote(
        `${objects.length} object${objects.length === 1 ? '' : 's'} added from ${selected.file.name}`,
      );
      session.requestRedraw();
      onRefresh();
    } catch (error) {
      setImportNote(error instanceof Error ? error.message : 'Could not import this model');
    } finally {
      setImporting(false);
    }
  };

  return (
    <aside
      ref={panel}
      className={`floating-scene-objects${minimized ? ' is-minimized' : ''}`}
      style={{ left: position.x, top: position.y }}
      aria-label="Terrain scene objects"
    >
      <header
        className="scene-objects-header"
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
          <strong>Scene Objects</strong>
          <span>{placedObjects.length} placed</span>
        </div>
        <div className="outliner-actions">
          <button
            type="button"
            className="outliner-icon"
            aria-label={minimized ? 'Restore Scene Objects' : 'Minimize Scene Objects'}
            title={minimized ? 'Restore' : 'Minimize'}
            onClick={() => setMinimized((value) => !value)}
          >
            {minimized ? '□' : '–'}
          </button>
          <button
            type="button"
            className="outliner-icon danger"
            aria-label="Close Scene Objects"
            title="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </header>
      {!minimized && (
        <div className="scene-objects-body">
          {!terrain ? (
            <p className="outliner-empty">Create a terrain to place scene objects.</p>
          ) : (
            <>
              <section className="uv-section">
                <div className="terrain-object-modes">
                  {([
                    ['place', 'Place'],
                    ['scatter', 'Scatter'],
                    ['erase', 'Erase'],
                  ] as [TerrainObjectBrushMode, string][]).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      className={`tool${session.tools.getActive() === objectTool && objectTool.mode === mode ? ' is-active' : ''}`}
                      aria-pressed={session.tools.getActive() === objectTool && objectTool.mode === mode}
                      onClick={() => prepareObjectTool(mode)}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`tool${session.tools.getActive()?.id === 'select' ? ' is-active' : ''}`}
                    onClick={() => {
                      session.tools.setActive('select', session.context());
                      session.selection.setMode('object');
                      session.requestRedraw();
                      onRefresh();
                    }}
                  >
                    Select / edit
                  </button>
                </div>
                <p className="terrain-active-brush">
                  Brush object <strong>{selectedBrushLabel}</strong>
                </p>
                {objectTool.mode !== 'erase' && (
                  <div className="terrain-placement-settings">
                    <label className="uv-field">
                      <span>Place on</span>
                      <select
                        className="uv-select"
                        value={objectTool.placementMode}
                        onChange={(event) => {
                          objectTool.placementMode = event.target.value as TerrainObjectPlacementMode;
                          objectTool.revision += 1;
                          session.requestRedraw();
                          onRefresh();
                        }}
                      >
                        <option value="terrain">Terrain surface</option>
                        <option value="base">Terrain base plane</option>
                      </select>
                    </label>
                    <label className="uv-field">
                      <span>Height offset</span>
                      <input
                        className="uv-text"
                        type="number"
                        step={0.1}
                        value={objectTool.heightOffset}
                        onChange={(event) => {
                          objectTool.heightOffset = Number(event.target.value) || 0;
                          objectTool.revision += 1;
                          onRefresh();
                        }}
                      />
                    </label>
                    <p className="uv-hint">
                      Terrain surface follows mountains and valleys with automatic contact clearance.
                      Offset raises or sinks objects further.
                    </p>
                  </div>
                )}
                <label className="uv-field">
                  <span>Find an object</span>
                  <input
                    className="uv-text"
                    type="search"
                    value={objectSearch}
                    placeholder="Search project objects"
                    onChange={(event) => setObjectSearch(event.target.value)}
                  />
                </label>

                <span className="uv-field-label">Starter objects</span>
                <div className="terrain-object-library">
                  {TERRAIN_PROP_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`terrain-object-card${objectTool.usePreset && objectTool.preset === preset.id ? ' is-selected' : ''}`}
                      onClick={() => choosePreset(preset.id)}
                      title={preset.description}
                    >
                      <MeshPreview mesh={presetMeshes.get(preset.id)!} />
                      <span>{preset.label}</span>
                    </button>
                  ))}
                </div>

                <div className="terrain-project-library-heading">
                  <span className="uv-field-label">Your model objects</span>
                  <div className="terrain-library-actions">
                    <button
                      type="button"
                      className="tool terrain-model-link"
                      disabled={importing}
                      onClick={() => void importObject()}
                    >
                      {importing ? 'Importing…' : 'Import…'}
                    </button>
                    <button
                      type="button"
                      className="tool terrain-model-link"
                      onClick={() => {
                        session.tools.setActive('select', session.context());
                        workspace.setShellMode('model');
                        onRefresh();
                      }}
                    >
                      Model new
                    </button>
                  </div>
                </div>
                <p className="uv-hint terrain-import-hint">
                  Add OBJ, glTF, or GLB models directly to this library.
                </p>
                {importNote && <p className="uv-meta terrain-import-note">{importNote}</p>}
                {visibleProjectSources.length ? (
                  <div className="terrain-object-library">
                    {visibleProjectSources.map((object) => {
                      const mesh = object.meshId
                        ? session.document.meshes.get(object.meshId)
                        : null;
                      return (
                        <button
                          key={object.id}
                          type="button"
                          className={`terrain-object-card${!objectTool.usePreset && objectTool.sourceObjectId === object.id ? ' is-selected' : ''}`}
                          onClick={() => chooseProjectObject(object.id)}
                          title={`Use ${object.name} as a level brush`}
                        >
                          {mesh && <MeshPreview mesh={mesh} />}
                          <span>{object.name}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : projectSources.length ? (
                  <p className="uv-hint">No project objects match “{objectSearch}”.</p>
                ) : (
                  <p className="uv-hint">
                    Build or import an object in Model, then it appears here automatically.
                  </p>
                )}

                {objectTool.mode !== 'place' && (
                  <>
                    <label className="uv-field">
                      <span>Brush radius <b className="uv-field-value">{objectTool.radius.toFixed(1)}</b></span>
                      <input
                        className="uv-range"
                        type="range"
                        min={0.5}
                        max={20}
                        step={0.25}
                        value={objectTool.radius}
                        onChange={(event) => {
                          objectTool.setRadius(Number(event.target.value), session.context());
                          onRefresh();
                        }}
                      />
                    </label>
                    {objectTool.mode === 'scatter' && (
                      <>
                        <label className="uv-field">
                          <span>Objects per stamp <b className="uv-field-value">{objectTool.density}</b></span>
                          <input
                            className="uv-range"
                            type="range"
                            min={1}
                            max={20}
                            step={1}
                            value={objectTool.density}
                            onChange={(event) => {
                              objectTool.density = Number(event.target.value);
                              objectTool.revision += 1;
                              onRefresh();
                            }}
                          />
                        </label>
                        <label className="uv-field">
                          <span>Minimum spacing <b className="uv-field-value">{objectTool.spacing.toFixed(1)}</b></span>
                          <input
                            className="uv-range"
                            type="range"
                            min={0.25}
                            max={8}
                            step={0.25}
                            value={objectTool.spacing}
                            onChange={(event) => {
                              objectTool.spacing = Number(event.target.value);
                              objectTool.revision += 1;
                              onRefresh();
                            }}
                          />
                        </label>
                        <label className="uv-field">
                          <span>Scale variation <b className="uv-field-value">{Math.round(objectTool.randomScale * 100)}%</b></span>
                          <input
                            className="uv-range"
                            type="range"
                            min={0}
                            max={0.75}
                            step={0.05}
                            value={objectTool.randomScale}
                            onChange={(event) => {
                              objectTool.randomScale = Number(event.target.value);
                              objectTool.revision += 1;
                              onRefresh();
                            }}
                          />
                        </label>
                        <label className="uv-check">
                          <input
                            type="checkbox"
                            checked={objectTool.randomYaw}
                            onChange={(event) => {
                              objectTool.randomYaw = event.target.checked;
                              objectTool.revision += 1;
                              onRefresh();
                            }}
                          />
                          Random rotation
                        </label>
                        <label className="uv-check">
                          <input
                            type="checkbox"
                            checked={objectTool.alignToSlope}
                            onChange={(event) => {
                              objectTool.alignToSlope = event.target.checked;
                              objectTool.revision += 1;
                              onRefresh();
                            }}
                          />
                          Align to slope
                        </label>
                      </>
                    )}
                  </>
                )}
                <div className="uv-btn-grid uv-btn-grid-2">
                  <button
                    type="button"
                    className="tool"
                    disabled={!placedObjects.length}
                    onClick={selectLevelObjects}
                  >
                    Select all placed
                  </button>
                  <button
                    type="button"
                    className="tool"
                    onClick={() => prepareObjectTool('erase')}
                  >
                    Brush erase
                  </button>
                  <button
                    type="button"
                    className="tool"
                    disabled={!terrain || !placedObjects.length}
                    onClick={() => {
                      if (!terrain) return;
                      const selected = [...session.selection.state.selectedObjectIds];
                      const targets = selected.length
                        ? placedObjects.filter((object) => selected.includes(object.id))
                        : placedObjects;
                      if (!targets.length) return;
                      const before = snapshotPlacedTransforms(session.document, terrain.object.id);
                      for (const object of targets) {
                        groundObjectToTerrain(session.document, object.id, terrain.object.id, {
                          alignToSlope: objectTool.alignToSlope,
                        });
                      }
                      const after = snapshotPlacedTransforms(session.document, terrain.object.id);
                      let applied = true;
                      session.history.execute({
                        name: 'Re-ground Level Objects',
                        execute: () => {
                          if (applied) return;
                          restorePlacedTransforms(session.document, after);
                          session.document.dirty = true;
                          session.requestRedraw();
                          applied = true;
                        },
                        undo: () => {
                          restorePlacedTransforms(session.document, before);
                          session.document.dirty = true;
                          session.requestRedraw();
                          applied = false;
                        },
                      });
                      session.requestRedraw();
                      onRefresh();
                    }}
                  >
                    Re-ground selection
                  </button>
                </div>
                <p className="uv-hint">
                  Place with a click, paint groups with Scatter, or erase with a red brush.
                  Select / edit makes every item a normal Viper object.
                </p>
              </section>
            </>
          )}
        </div>
      )}
    </aside>
  );
}

function MeshPreview({ mesh }: { mesh: EditableMesh }) {
  const polygons = (() => {
    const projected = new Map<string, { x: number; y: number; depth: number }>();
    for (const vertex of mesh.vertices.values()) {
      const { x, y, z } = vertex.position;
      projected.set(vertex.id, {
        x: (x - z) * 0.78,
        y: -y + (x + z) * 0.34,
        depth: x + z - y * 0.12,
      });
    }
    const points = [...projected.values()];
    if (!points.length) return [];
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const scale = Math.min(
      54 / Math.max(0.001, maxX - minX),
      40 / Math.max(0.001, maxY - minY),
    );
    const centreX = (minX + maxX) / 2;
    const centreY = (minY + maxY) / 2;
    return [...mesh.faces.values()]
      .slice(0, 120)
      .map((face, index) => {
        const facePoints = faceVertexIds(mesh, face.id)
          .map((id) => projected.get(id))
          .filter((point): point is NonNullable<typeof point> => !!point);
        return {
          key: face.id,
          depth:
            facePoints.reduce((sum, point) => sum + point.depth, 0) /
            Math.max(1, facePoints.length),
          shade: 35 + (index % 4) * 8,
          points: facePoints
            .map(
              (point) =>
                `${36 + (point.x - centreX) * scale},${27 + (point.y - centreY) * scale}`,
            )
            .join(' '),
        };
      })
      .sort((a, b) => a.depth - b.depth);
  })();

  return (
    <svg className="terrain-object-preview" viewBox="0 0 72 54" aria-hidden>
      {polygons.map((polygon) => (
        <polygon
          key={polygon.key}
          points={polygon.points}
          style={{ '--preview-shade': `${polygon.shade}%` } as CSSProperties}
        />
      ))}
    </svg>
  );
}

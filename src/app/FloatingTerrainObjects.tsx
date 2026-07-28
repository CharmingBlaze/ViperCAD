import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { EditorSession } from '@/core/editor/EditorSession';
import { activeTerrain } from '@/core/terrain/Terrain';
import {
  groundObjectToTerrain,
  snapshotPlacedTransforms,
  restorePlacedTransforms,
  terrainPlacedObjects,
} from '@/core/terrain/TerrainProps';
import {
  carveTerrainSplinePath,
  generateRiverWaterMesh,
} from '@/core/terrain/SplineCarve';
import { autoPaintTerrainMesh } from '@/core/terrain/TerrainAutoPaint';
import {
  getTerrainLayerStack,
  addTerrainLayer,
  removeTerrainLayer,
  paintTerrainLayerAtPosition,
} from '@/core/terrain/TerrainLayers';
import {
  generateBuildingMesh,
  generateRoadGridMesh,
  getOrCreateBuildingMaterial,
} from '@/core/level/CityGenerator';
import { buildBridgeMesh, carveCaveTunnel, generateWaterfallMesh } from '@/core/level/InfrastructureBuilder';
import { FloatingSkyboxEditor } from '@/app/FloatingSkyboxEditor';
import { commitMeshObject } from '@/core/document/ModelDocument';
import { v3 } from '@/core/math/Vec3';
import { faceVertexIds } from '@/core/mesh/EditableMesh';
import type { EditableMesh } from '@/core/mesh/types';
import {
  listPlaceableModelIds,
  makeModelInstanceUnique,
  modelDocumentBaseOffset,
  modelDocumentPlacementRadius,
} from '@/core/editor/ModelInstances';
import { getViperDocument } from '@/core/document/ViperProject';
import { writeModelDrag } from '@/app/outliner/modelDrag';

type Props = {
  session: EditorSession;
  onClose: () => void;
  onOpenOutliner: () => void;
  onRefresh: () => void;
};

type DragState = { pointerId: number; offsetX: number; offsetY: number };
type ScatterLayer = {
  name: string;
  modelDocumentId: string;
  density: number;
  radius: number;
  spacing: number;
  randomScale: number;
  randomYaw: boolean;
  seed: number;
  collisionPadding: number;
  maskEnabled: boolean;
  minimumHeight: number;
  maximumHeight: number;
  maximumSlopeDegrees: number;
};

export function FloatingTerrainObjects({
  session,
  onClose,
  onOpenOutliner,
  onRefresh,
}: Props) {
  const [minimized, setMinimized] = useState(false);
  const [showSkyboxEditor, setShowSkyboxEditor] = useState(false);
  const [activeLayerIndex, setActiveLayerIndex] = useState(0);
  const [position, setPosition] = useState({ x: 18, y: 94 });
  const [objectSearch, setObjectSearch] = useState('');
  const [layerName, setLayerName] = useState('Scatter layer');
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
  const outlinerModels = listPlaceableModelIds(session.project).map((documentId) =>
    getViperDocument(session.project, documentId),
  );
  const modelDocumentKey = session.project.modelDocumentIds.join('|');
  const visibleOutlinerModels = outlinerModels.filter((document) =>
    document.name.toLocaleLowerCase().includes(objectSearch.trim().toLocaleLowerCase()),
  );
  const placedObjects = terrainPlacedObjects(session.document, terrain?.object.id);
  const linkedPlaced = placedObjects.filter((object) => object.kind === 'instance');
  const missingLinked = linkedPlaced.filter(
    (object) =>
      !object.instanceSourceModelId ||
      !session.project.documents.has(object.instanceSourceModelId),
  );
  const scatterLayers = readScatterLayers(terrain?.object.metadata.terrainScatterLayers);
  const selectedBrushLabel = objectTool.sourceModelDocumentId
    ? session.project.documents.get(objectTool.sourceModelDocumentId)?.name ?? 'Choose a model'
    : 'Choose a model';

  useEffect(() => {
    if (
      objectTool.sourceModelDocumentId &&
      !session.project.documents.has(objectTool.sourceModelDocumentId)
    ) {
      objectTool.clearSource(session.context());
      onRefresh();
    }
  }, [modelDocumentKey, objectTool, onRefresh, session]);

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

  const chooseOutlinerModel = (documentId: string) => {
    if (!terrain) return;
    const model = getViperDocument(session.project, documentId);
    objectTool.setTerrain(terrain.object.id, session.context());
    objectTool.setSourceModel(
      documentId,
      model.name,
      modelDocumentBaseOffset(session.project, documentId),
      modelDocumentPlacementRadius(session.project, documentId),
      session.context(),
    );
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

  const saveScatterLayer = () => {
    if (!terrain || !objectTool.sourceModelDocumentId) return;
    const layer: ScatterLayer = {
      name: layerName.trim() || `Scatter layer ${scatterLayers.length + 1}`,
      modelDocumentId: objectTool.sourceModelDocumentId,
      density: objectTool.density,
      radius: objectTool.radius,
      spacing: objectTool.spacing,
      randomScale: objectTool.randomScale,
      randomYaw: objectTool.randomYaw,
      seed: objectTool.scatterSeed,
      collisionPadding: objectTool.collisionPadding,
      maskEnabled: objectTool.maskEnabled,
      minimumHeight: objectTool.minimumHeight,
      maximumHeight: objectTool.maximumHeight,
      maximumSlopeDegrees: objectTool.maximumSlopeDegrees,
    };
    const next = [...scatterLayers.filter((item) => item.name !== layer.name), layer];
    terrain.object.metadata.terrainScatterLayers = JSON.stringify(next);
    session.document.dirty = true;
    onRefresh();
  };

  const loadScatterLayer = (index: number) => {
    const layer = scatterLayers[index];
    if (!layer || !session.project.documents.has(layer.modelDocumentId)) return;
    chooseOutlinerModel(layer.modelDocumentId);
    objectTool.density = layer.density;
    objectTool.radius = layer.radius;
    objectTool.spacing = layer.spacing;
    objectTool.randomScale = layer.randomScale;
    objectTool.randomYaw = layer.randomYaw;
    objectTool.scatterSeed = layer.seed;
    objectTool.collisionPadding = layer.collisionPadding;
    objectTool.maskEnabled = layer.maskEnabled;
    objectTool.minimumHeight = layer.minimumHeight;
    objectTool.maximumHeight = layer.maximumHeight;
    objectTool.maximumSlopeDegrees = layer.maximumSlopeDegrees;
    objectTool.setMode('scatter', session.context());
    setLayerName(layer.name);
    onRefresh();
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
                    {objectTool.mode === 'place' ? (
                      <label className="uv-check terrain-stack-models">
                        <input
                          type="checkbox"
                          checked={objectTool.stackModels}
                          onChange={(event) => {
                            objectTool.stackModels = event.target.checked;
                            objectTool.revision += 1;
                            session.requestRedraw();
                            onRefresh();
                          }}
                        />
                        Stack on placed models
                      </label>
                    ) : null}
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
                    <label className="uv-field">
                      <span>Rotation · {Math.round(objectTool.placementYaw * 180 / Math.PI)}°</span>
                      <input
                        className="uv-range"
                        type="range"
                        min={-180}
                        max={180}
                        step={5}
                        value={objectTool.placementYaw * 180 / Math.PI}
                        onChange={(event) => {
                          objectTool.placementYaw = Number(event.target.value) * Math.PI / 180;
                          objectTool.revision += 1;
                          session.requestRedraw();
                          onRefresh();
                        }}
                      />
                    </label>
                    <label className="uv-field">
                      <span>Scale · {objectTool.placementScale.toFixed(2)}</span>
                      <input
                        className="uv-range"
                        type="range"
                        min={0.1}
                        max={4}
                        step={0.05}
                        value={objectTool.placementScale}
                        onChange={(event) => {
                          objectTool.placementScale = Number(event.target.value);
                          objectTool.revision += 1;
                          session.requestRedraw();
                          onRefresh();
                        }}
                      />
                    </label>
                    <p className="uv-hint">
                      {objectTool.stackModels && objectTool.mode === 'place'
                        ? 'Hover a placed model to put the next model on top. Empty terrain still places normally.'
                        : 'Terrain surface follows mountains and valleys with automatic contact clearance. Offset raises or sinks objects further.'}
                    </p>
                  </div>
                )}
                <label className="uv-field">
                  <span>Find an object</span>
                  <input
                    className="uv-text"
                    type="search"
                    value={objectSearch}
                    placeholder="Search Outliner models"
                    onChange={(event) => setObjectSearch(event.target.value)}
                  />
                </label>

                <div className="terrain-project-library-heading">
                  <span className="uv-field-label">Outliner models</span>
                  <button
                    type="button"
                    className="tool terrain-model-link"
                    onClick={onOpenOutliner}
                  >
                    Open Outliner
                  </button>
                </div>
                <p className="uv-hint terrain-import-hint">
                  The same reusable models shown in the Outliner.
                </p>
                {visibleOutlinerModels.length ? (
                  <div className="terrain-object-library">
                    {visibleOutlinerModels.map((model) => {
                      const previewObject = [...model.objects.values()].find(
                        (object) => object.visible && object.meshId,
                      );
                      const mesh = previewObject?.meshId
                        ? session.project.meshes.get(previewObject.meshId)
                        : null;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          className={`terrain-object-card${objectTool.sourceModelDocumentId === model.id ? ' is-selected' : ''}`}
                          draggable
                          onDragStart={(event) =>
                            writeModelDrag(event.dataTransfer, model.id, model.name)
                          }
                          onClick={() => chooseOutlinerModel(model.id)}
                          title={`Select ${model.name} or drag it onto the terrain`}
                        >
                          {mesh && <MeshPreview mesh={mesh} />}
                          <span>{model.name}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : outlinerModels.length ? (
                  <p className="uv-hint">No Outliner models match “{objectSearch}”.</p>
                ) : (
                  <p className="uv-hint">
                    Create a reusable Model in the Outliner, then it appears here automatically.
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
                        <label className="uv-field">
                          <span>Scatter seed</span>
                          <input
                            className="uv-text"
                            type="number"
                            min={1}
                            step={1}
                            value={objectTool.scatterSeed}
                            onChange={(event) => {
                              objectTool.scatterSeed = Math.max(1, Math.round(Number(event.target.value) || 1));
                              objectTool.revision += 1;
                              onRefresh();
                            }}
                          />
                        </label>
                      </>
                    )}
                  </>
                )}

                {objectTool.mode !== 'erase' && (
                  <div className="terrain-placement-settings">
                    <div className="simple-texture-card-heading">
                      <strong>PLACEMENT MASK</strong>
                      <span>Height, slope, and overlap rules</span>
                    </div>
                    <label className="uv-check">
                      <input
                        type="checkbox"
                        checked={objectTool.collisionAvoidance}
                        onChange={(event) => {
                          objectTool.collisionAvoidance = event.target.checked;
                          objectTool.revision += 1;
                          onRefresh();
                        }}
                      />
                      Avoid overlaps
                    </label>
                    <label className="uv-field">
                      <span>Collision padding · {objectTool.collisionPadding.toFixed(2)}</span>
                      <input
                        className="uv-range"
                        type="range"
                        min={0}
                        max={4}
                        step={0.05}
                        value={objectTool.collisionPadding}
                        onChange={(event) => {
                          objectTool.collisionPadding = Number(event.target.value);
                          objectTool.revision += 1;
                          onRefresh();
                        }}
                      />
                    </label>
                    <label className="uv-check">
                      <input
                        type="checkbox"
                        checked={objectTool.maskEnabled}
                        onChange={(event) => {
                          objectTool.maskEnabled = event.target.checked;
                          objectTool.revision += 1;
                          onRefresh();
                        }}
                      />
                      Restrict by terrain
                    </label>
                    {objectTool.maskEnabled && (
                      <>
                        <div className="uv-btn-grid uv-btn-grid-2">
                          <label className="uv-field">
                            <span>Minimum height</span>
                            <input className="uv-text" type="number" value={objectTool.minimumHeight} onChange={(event) => { objectTool.minimumHeight = Number(event.target.value); objectTool.revision += 1; onRefresh(); }} />
                          </label>
                          <label className="uv-field">
                            <span>Maximum height</span>
                            <input className="uv-text" type="number" value={objectTool.maximumHeight} onChange={(event) => { objectTool.maximumHeight = Number(event.target.value); objectTool.revision += 1; onRefresh(); }} />
                          </label>
                        </div>
                        <label className="uv-field">
                          <span>Maximum slope · {Math.round(objectTool.maximumSlopeDegrees)}°</span>
                          <input className="uv-range" type="range" min={0} max={90} step={1} value={objectTool.maximumSlopeDegrees} onChange={(event) => { objectTool.maximumSlopeDegrees = Number(event.target.value); objectTool.revision += 1; onRefresh(); }} />
                        </label>
                      </>
                    )}
                  </div>
                )}

                {objectTool.mode === 'scatter' && (
                  <div className="terrain-placement-settings">
                    <div className="simple-texture-card-heading">
                      <strong>SCATTER LAYERS</strong>
                      <span>Reusable editable settings</span>
                    </div>
                    {scatterLayers.length > 0 && (
                      <select
                        className="uv-select"
                        defaultValue=""
                        onChange={(event) => loadScatterLayer(Number(event.target.value))}
                      >
                        <option value="" disabled>Load layer…</option>
                        {scatterLayers.map((layer, index) => (
                          <option key={`${layer.name}-${index}`} value={index}>{layer.name}</option>
                        ))}
                      </select>
                    )}
                    <div className="uv-btn-grid uv-btn-grid-2">
                      <input
                        className="uv-text"
                        value={layerName}
                        onChange={(event) => setLayerName(event.target.value)}
                        aria-label="Scatter layer name"
                      />
                      <button
                        type="button"
                        className="tool"
                        disabled={!objectTool.sourceModelDocumentId}
                        onClick={saveScatterLayer}
                      >
                        Save layer
                      </button>
                    </div>
                  </div>
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
                {linkedPlaced.length > 0 && (
                  <div className="terrain-placement-settings">
                    <div className="simple-texture-card-heading">
                      <strong>LINKED MODELS</strong>
                      <span>
                        {linkedPlaced.length} linked
                        {missingLinked.length ? ` · ${missingLinked.length} missing source` : ' · sources healthy'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="tool"
                      disabled={
                        ![...session.selection.state.selectedObjectIds].some((id) =>
                          linkedPlaced.some((object) => object.id === id),
                        )
                      }
                      onClick={() => {
                        const selected = [...session.selection.state.selectedObjectIds];
                        const madeUnique = selected
                          .filter((id) => linkedPlaced.some((object) => object.id === id))
                          .map((id) => makeModelInstanceUnique(session, id))
                          .filter((id): id is string => !!id);
                        if (madeUnique.length) {
                          session.selection.selectObjects(madeUnique, 'replace');
                          session.requestRedraw();
                          onRefresh();
                        }
                      }}
                    >
                      Make selection unique
                    </button>
                    <p className="uv-hint">
                      Linked copies follow edits to their Outliner model. Make unique to edit one copy on its own.
                    </p>
                  </div>
                )}
                {(() => {
                  const t = activeTerrain(session);
                  if (!t) return null;
                  const layers = getTerrainLayerStack(t.mesh);
                  const activeLayer = layers[activeLayerIndex] ?? layers[0];

                  return (
                    <div className="terrain-action-card">
                      <div className="simple-texture-card-heading">
                        <strong>TERRAIN MATERIAL LAYERS</strong>
                        <span>Multi-layer texture splatmap stack</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        {layers.map((layer, idx) => (
                          <div
                            key={layer.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '0.35rem 0.5rem',
                              borderRadius: '4px',
                              backgroundColor: idx === activeLayerIndex ? '#222d3d' : '#141820',
                              border: `1px solid ${idx === activeLayerIndex ? '#3b82f6' : '#262d3a'}`,
                              cursor: 'pointer',
                            }}
                            onClick={() => setActiveLayerIndex(idx)}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <div
                                style={{
                                  width: '12px',
                                  height: '12px',
                                  borderRadius: '3px',
                                  backgroundColor: layer.color,
                                  border: '1px solid #475569',
                                }}
                              />
                              <span style={{ fontSize: '0.75rem', fontWeight: idx === activeLayerIndex ? 600 : 400, color: '#f1f5f9' }}>
                                {layer.name}
                              </span>
                            </div>
                            <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                              {layer.tiling}x Tiling
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="terrain-action-grid" style={{ marginTop: '0.2rem' }}>
                        <button
                          type="button"
                          className="terrain-action-btn"
                          onClick={() => {
                            addTerrainLayer(t.mesh);
                            session.document.dirty = true;
                            onRefresh();
                          }}
                        >
                          Add Material Layer
                        </button>
                        <button
                          type="button"
                          className="terrain-action-btn"
                          disabled={layers.length <= 1}
                          onClick={() => {
                            if (activeLayer) {
                              removeTerrainLayer(t.mesh, activeLayer.id);
                              setActiveLayerIndex(0);
                              session.document.dirty = true;
                              onRefresh();
                            }
                          }}
                        >
                          Remove Layer
                        </button>
                        <button
                          type="button"
                          className="terrain-action-btn primary full-width"
                          onClick={() => {
                            paintTerrainLayerAtPosition(t.mesh, v3(0, 0, 0), activeLayerIndex, 10, 0.7);
                            session.document.dirty = true;
                            session.requestRedraw();
                            onRefresh();
                          }}
                        >
                          Paint {activeLayer?.name ?? 'Layer'} onto Center
                        </button>
                      </div>
                      <p className="uv-hint">
                        Select an active layer to paint texture splatmaps, adjust tiling scale, or add custom layers.
                      </p>
                    </div>
                  );
                })()}

                <div className="terrain-action-card">
                  <div className="simple-texture-card-heading">
                    <strong>RIVERS, LAKES & PATHS</strong>
                    <span>Spline carving & water mesh ribbons</span>
                  </div>
                  <div className="terrain-action-grid">
                    <button
                      type="button"
                      className="terrain-action-btn primary"
                      onClick={() => {
                        const terrain = activeTerrain(session.document);
                        if (!terrain) return;
                        const w = terrain.heightmap.width;
                        const d = terrain.heightmap.depth;
                        const splinePoints = [
                          v3(-w * 0.4, 0, -d * 0.35),
                          v3(-w * 0.15, -0.5, -d * 0.1),
                          v3(w * 0.1, -1.0, d * 0.15),
                          v3(w * 0.4, -1.5, d * 0.4),
                        ];

                        carveTerrainSplinePath(terrain.mesh, splinePoints, {
                          width: 4.5,
                          depth: 1.8,
                          mode: 'river',
                        });

                        const riverMesh = generateRiverWaterMesh(splinePoints, 4.5);
                        commitMeshObject(session.document, riverMesh, { name: 'River Water Ribbon' });
                        session.document.dirty = true;
                        session.requestRedraw();
                        onRefresh();
                      }}
                    >
                      Carve River
                    </button>
                    <button
                      type="button"
                      className="terrain-action-btn"
                      onClick={() => {
                        const terrain = activeTerrain(session.document);
                        if (!terrain) return;
                        const w = terrain.heightmap.width;
                        const d = terrain.heightmap.depth;
                        const pathPoints = [
                          v3(-w * 0.35, 0.2, d * 0.35),
                          v3(-w * 0.1, 0.2, d * 0.1),
                          v3(w * 0.2, 0.2, -d * 0.15),
                          v3(w * 0.35, 0.2, -d * 0.35),
                        ];

                        carveTerrainSplinePath(terrain.mesh, pathPoints, {
                          width: 3.2,
                          mode: 'road',
                        });

                        session.document.dirty = true;
                        session.requestRedraw();
                        onRefresh();
                      }}
                    >
                      Carve Path
                    </button>
                  </div>
                  <p className="uv-hint">
                    Carves smooth U-shaped riverbeds with conforming water ribbons or flattens roads.
                  </p>
                </div>

                <div className="terrain-action-card">
                  <div className="simple-texture-card-heading">
                    <strong>CITY, ROADS, BRIDGES & CAVES</strong>
                    <span>Procedural level generation & terrain auto-painting</span>
                  </div>
                  <div className="terrain-action-grid">
                    <button
                      type="button"
                      className="terrain-action-btn primary"
                      onClick={() => {
                        const terrain = activeTerrain(session.document);
                        if (terrain) {
                          autoPaintTerrainMesh(terrain.mesh, { cliffMinAngleDeg: 35, snowMinHeight: 7.5 });
                          session.document.dirty = true;
                          session.requestRedraw();
                          onRefresh();
                        }
                      }}
                    >
                      Auto-Paint
                    </button>
                    <button
                      type="button"
                      className="terrain-action-btn"
                      onClick={() => {
                        const building = generateBuildingMesh({ floors: 6, style: 'skyscraper', width: 7, depth: 7 });
                        const matId = getOrCreateBuildingMaterial(session.document);
                        commitMeshObject(session.document, building, { name: 'Skyscraper Building', materialId: matId });
                        session.document.dirty = true;
                        session.requestRedraw();
                        onRefresh();
                      }}
                    >
                      Add Building
                    </button>
                    <button
                      type="button"
                      className="terrain-action-btn"
                      onClick={() => {
                        const { roadMesh } = generateRoadGridMesh(2, 2, 16, 4);
                        commitMeshObject(session.document, roadMesh, { name: 'City Roads & Sidewalks' });
                        session.document.dirty = true;
                        session.requestRedraw();
                        onRefresh();
                      }}
                    >
                      Add Road Grid
                    </button>
                    <button
                      type="button"
                      className="terrain-action-btn"
                      onClick={() => {
                        const bridge = buildBridgeMesh(v3(-12, 0.5, 0), v3(12, 0.5, 0), { width: 3.5, archHeight: 1.2 });
                        commitMeshObject(session.document, bridge, { name: 'Girder Bridge' });
                        session.document.dirty = true;
                        session.requestRedraw();
                        onRefresh();
                      }}
                    >
                      Add Bridge
                    </button>
                    <button
                      type="button"
                      className="terrain-action-btn"
                      onClick={() => {
                        const terrain = activeTerrain(session.document);
                        if (terrain) {
                          carveCaveTunnel(terrain.mesh, v3(0, 1, 0), 4, 12);
                          session.document.dirty = true;
                          session.requestRedraw();
                          onRefresh();
                        }
                      }}
                    >
                      Carve Cave
                    </button>
                    <button
                      type="button"
                      className="terrain-action-btn"
                      onClick={() => {
                        const waterfall = generateWaterfallMesh(v3(0, 8, 0), v3(0, 0, 0), 4.5);
                        commitMeshObject(session.document, waterfall, { name: 'Waterfall Mesh' });
                        session.document.dirty = true;
                        session.requestRedraw();
                        onRefresh();
                      }}
                    >
                      Add Waterfall
                    </button>
                    <button
                      type="button"
                      className="terrain-action-btn primary full-width"
                      style={{ marginTop: '0.2rem' }}
                      onClick={() => setShowSkyboxEditor(true)}
                    >
                      Skybox & Skysphere Maker
                    </button>
                  </div>
                  <p className="uv-hint">
                    1-Click Auto-Paint, procedural city buildings, roads, bridges, caves, waterfalls & skyboxes.
                  </p>
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
      {showSkyboxEditor && (
        <FloatingSkyboxEditor session={session} onClose={() => setShowSkyboxEditor(false)} />
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

function readScatterLayers(raw: string | undefined): ScatterLayer[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ScatterLayer[];
    return Array.isArray(parsed)
      ? parsed.filter(
          (layer) =>
            !!layer &&
            typeof layer.name === 'string' &&
            typeof layer.modelDocumentId === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

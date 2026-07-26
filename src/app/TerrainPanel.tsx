import {
  useEffect,
  useRef,
  useState,
} from 'react';
import { MaterialEditor } from '@/app/MaterialEditor';
import type { EditorSession } from '@/core/editor/EditorSession';
import { bumpPositions } from '@/core/mesh/EditableMesh';
import { cloneVec3 } from '@/core/math/Vec3';
import {
  activeTerrain,
  applyTerrainTileRepeat,
  createTerrain,
  resampleTerrain,
  terrainHeightRange,
} from '@/core/terrain/Terrain';
import {
  TerrainSculptTool,
  type TerrainBrushMode,
  type TerrainFalloff,
} from '@/core/tools/TerrainSculptTool';
import {
  reprojectTerrainPlacedObjects,
  restorePlacedTransforms,
  snapshotPlacedTransforms,
  terrainPlacedObjects,
} from '@/core/terrain/TerrainProps';
import { gameReadiness } from '@/app/GameExportProfiles';
import {
  generateConvexCollider,
  generateMeshCollider,
} from '@/core/editor/GameAssetTools';
import { pushToast } from '@/app/Toast';
import {
  applyHeightmap,
  type HeightmapChannel,
  type HeightmapMode,
} from '@/core/terrain/Heightmap';
import { decodeImageFile } from '@/core/image/ImageImport';
import { importImageFile } from '@/core/image/ImageImport';
import { createImageAssetFromPixels } from '@/core/image/PixelEditor';
import { IMAGE_FILES, openNativeFile } from '@/app/platform/FileDialogs';
import type { ImageAsset } from '@/core/document/types';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import {
  generateHeightmap,
  HEIGHTMAP_GENERATOR_LABELS,
  type HeightmapGeneratorKind,
} from '@/core/terrain/HeightmapGenerator';
import { TerrainFeatureTool } from '@/core/tools/TerrainFeatureTool';
import {
  commitLakeWithCarve,
  commitOceanWithCarve,
  type TerrainFeatureKind,
} from '@/core/terrain/TerrainFeatures';

type Props = {
  session: EditorSession;
  workspace: WorkspaceController;
  onRefresh: () => void;
  onOpenSceneObjects: () => void;
  sceneObjectsOpen: boolean;
};

type TerrainPanelTab = 'terrain' | 'sculpt' | 'height' | 'surface' | 'water' | 'objects';

export function TerrainPanel({
  session,
  workspace,
  onRefresh,
  onOpenSceneObjects,
  sceneObjectsOpen,
}: Props) {
  const [activeTab, setActiveTab] = useState<TerrainPanelTab>('terrain');
  const [size, setSize] = useState(20);
  const [resolution, setResolution] = useState(32);
  const [tileRepeat, setTileRepeat] = useState(8);
  const [heightmapImageId, setHeightmapImageId] = useState('');
  const [heightmapStrength, setHeightmapStrength] = useState(8);
  const [heightmapOffset, setHeightmapOffset] = useState(0);
  const [heightmapMode, setHeightmapMode] = useState<HeightmapMode>('replace');
  const [heightmapChannel, setHeightmapChannel] = useState<HeightmapChannel>('luminance');
  const [heightmapInvert, setHeightmapInvert] = useState(false);
  const [heightmapFlipX, setHeightmapFlipX] = useState(false);
  const [heightmapFlipY, setHeightmapFlipY] = useState(false);
  const [heightmapReprojectObjects, setHeightmapReprojectObjects] = useState(true);
  const [heightmapBusy, setHeightmapBusy] = useState(false);
  const [heightmapNote, setHeightmapNote] = useState<string | null>(null);
  const [generatorKind, setGeneratorKind] = useState<HeightmapGeneratorKind>('island');
  const [generatorSize, setGeneratorSize] = useState(256);
  const [generatorSeed, setGeneratorSeed] = useState(1337);
  const [generatorScale, setGeneratorScale] = useState(4);
  const [generatorOctaves, setGeneratorOctaves] = useState(5);
  const [generatorRoughness, setGeneratorRoughness] = useState(0.5);
  const [featureTextureId, setFeatureTextureId] = useState('');
  const [featureWidth, setFeatureWidth] = useState(2);
  const [featureOffset, setFeatureOffset] = useState(0.04);
  const [featureTextureScale, setFeatureTextureScale] = useState(2);
  const [waterLevel, setWaterLevel] = useState(0.1);
  const [waterSize, setWaterSize] = useState(4);
  const [naturalShoreline, setNaturalShoreline] = useState(true);
  const [waterOpacity, setWaterOpacity] = useState(0.78);
  const [waterAnimated, setWaterAnimated] = useState(true);
  const [waterFlowSpeed, setWaterFlowSpeed] = useState(0.14);
  const [carveTerrain, setCarveTerrain] = useState(true);
  const [carveDepth, setCarveDepth] = useState(0.9);
  const [featureNote, setFeatureNote] = useState<string | null>(null);
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
  const tool = session.tools.get('terrain-sculpt') as TerrainSculptTool;
  const featureTool = session.tools.get('terrain-feature') as TerrainFeatureTool;
  const placedObjects = terrainPlacedObjects(session.document, terrain?.object.id);
  const projectImages = [...session.document.images.values()];
  const effectiveHeightmapId =
    heightmapImageId ||
    terrain?.object.metadata.heightmapImageId ||
    '';
  const heightmapImage = effectiveHeightmapId
    ? session.document.images.get(effectiveHeightmapId) ?? null
    : null;
  const heights = terrain ? terrainHeightRange(terrain.mesh) : { min: 0, max: 0 };

  const activateTerrain = (objectId: string) => {
    session.selection.setMode('object');
    session.selection.selectObjects([objectId], 'replace');
    session.tools.setActive('terrain-sculpt', session.context());
    session.requestRedraw();
    onRefresh();
  };

  const create = () => {
    const created = createTerrain(session, { size, resolution, tileRepeat });
    activateTerrain(created.objectId);
    setActiveTab('sculpt');
  };

  const importHeightmap = async () => {
    setHeightmapBusy(true);
    setHeightmapNote(null);
    try {
      const selected = await openNativeFile({ types: IMAGE_FILES });
      if (!selected) return;
      const decoded = await decodeImageFile(selected.file, 512);
      const name = selected.file.name.replace(/\.[^.]+$/, '') || 'Heightmap';
      const image = createImageAssetFromPixels(
        session.document,
        `${name} Heightmap`,
        decoded.width,
        decoded.height,
        decoded.pixels,
      );
      setHeightmapImageId(image.id);
      setHeightmapNote(
        decoded.scaled
          ? `Imported ${decoded.sourceWidth}×${decoded.sourceHeight} → ${decoded.width}×${decoded.height}`
          : `Imported ${decoded.width}×${decoded.height}`,
      );
      session.requestRedraw();
      onRefresh();
    } catch (error) {
      setHeightmapNote(error instanceof Error ? error.message : 'Could not import heightmap');
    } finally {
      setHeightmapBusy(false);
    }
  };

  const applySelectedHeightmap = () => {
    if (!terrain || !heightmapImage) return;
    const applied = applyHeightmap(
      session,
      terrain.object.id,
      heightmapImage,
      {
        strength: heightmapStrength,
        offset: heightmapOffset,
        mode: heightmapMode,
        channel: heightmapChannel,
        invert: heightmapInvert,
        flipHorizontal: heightmapFlipX,
        flipVertical: heightmapFlipY,
        reprojectObjects: heightmapReprojectObjects,
      },
    );
    setHeightmapNote(
      applied
        ? `${heightmapImage.name} applied · Ctrl+Z to restore`
        : 'Could not apply this heightmap',
    );
    onRefresh();
  };

  const createGeneratedHeightmap = (seed = generatorSeed) => {
    const generated = generateHeightmap({
      kind: generatorKind,
      size: generatorSize,
      seed,
      featureScale: generatorScale,
      octaves: generatorOctaves,
      roughness: generatorRoughness,
    });
    const label = HEIGHTMAP_GENERATOR_LABELS[generatorKind];
    const image = createImageAssetFromPixels(
      session.document,
      `${label} ${seed} Heightmap`,
      generated.width,
      generated.height,
      generated.pixels,
    );
    setGeneratorSeed(seed);
    setHeightmapImageId(image.id);
    setHeightmapNote(`${label} generated · adjust height settings, then apply`);
    session.requestRedraw();
    onRefresh();
  };

  const editAllHeights = (
    name: string,
    mutate: (values: number[], resolution: number) => number[],
  ) => {
    if (!terrain) return;
    const mesh = terrain.mesh;
    const terrainObjectId = terrain.object.id;
    const ids = [...mesh.vertices.keys()];
    const before = new Map(ids.map((id) => [id, cloneVec3(mesh.vertices.get(id)!.position)]));
    const beforeProps = snapshotPlacedTransforms(session.document, terrainObjectId);
    const gridResolution = Number(terrain.object.metadata.terrainResolution) || Math.round(Math.sqrt(ids.length)) - 1;
    const next = mutate(ids.map((id) => mesh.vertices.get(id)!.position.y), gridResolution);
    ids.forEach((id, index) => { mesh.vertices.get(id)!.position.y = next[index] ?? 0; });
    bumpPositions(mesh);
    reprojectTerrainPlacedObjects(session.document, terrainObjectId);
    const after = new Map(ids.map((id) => [id, cloneVec3(mesh.vertices.get(id)!.position)]));
    const afterProps = snapshotPlacedTransforms(session.document, terrainObjectId);
    let applied = true;
    const restore = (snapshot: typeof before, props: typeof beforeProps) => {
      for (const [id, position] of snapshot) {
        const vertex = mesh.vertices.get(id);
        if (vertex) vertex.position = cloneVec3(position);
      }
      restorePlacedTransforms(session.document, props);
      bumpPositions(mesh);
      session.document.dirty = true;
      session.requestRedraw();
    };
    session.history.execute({
      name,
      execute: () => {
        if (applied) return;
        restore(after, afterProps);
        applied = true;
      },
      undo: () => {
        restore(before, beforeProps);
        applied = false;
      },
    });
    session.document.dirty = true;
    session.requestRedraw();
    onRefresh();
  };

  const openPaint = () => {
    if (!terrain) return;
    session.tools.setActive('select', session.context());
    session.selection.setMode('face');
    session.selection.selectFaces([...terrain.mesh.faces.keys()], 'replace');
    workspace.patchTexture({
      uvPanelTab: 'paint',
      uvPointerMode: false,
      paintMode3D: true,
      activeRightEditor: 'combined',
    });
    workspace.setShellMode('texture');
    session.requestRedraw();
    onRefresh();
  };

  const openTiles = () => {
    if (!terrain) return;
    session.tools.setActive('select', session.context());
    session.selection.setMode('face');
    session.selection.selectFaces([...terrain.mesh.faces.keys()], 'replace');
    workspace.patchTexture({
      uvPanelTab: 'tiles',
      uvPointerMode: true,
      paintMode3D: false,
      activeRightEditor: 'combined',
    });
    workspace.setShellMode('texture');
    session.requestRedraw();
    onRefresh();
  };

  const activateFeatureBrush = (kind: 'river' | 'path') => {
    if (!terrain) return;
    featureTool.configure(kind, terrain.object.id, session.context());
    featureTool.width = featureWidth;
    featureTool.surfaceOffset = featureOffset;
    featureTool.textureScale = featureTextureScale;
    featureTool.textureId = featureTextureId || null;
    featureTool.opacity = kind === 'river' ? waterOpacity : 1;
    featureTool.animated = kind === 'river' && waterAnimated;
    featureTool.flowSpeed = waterFlowSpeed;
    featureTool.carveTerrain = carveTerrain;
    featureTool.carveDepth = carveDepth;
    session.selection.setMode('object');
    session.selection.selectObjects([terrain.object.id], 'replace');
    session.tools.setActive('terrain-feature', session.context());
    setFeatureNote(
      carveTerrain
        ? kind === 'river'
          ? 'Drag a river — release carves a channel and fills it with water.'
          : 'Drag a path — release wears a trail into the terrain.'
        : `Drag a ${kind} over the terrain. Release to finish (carve off).`,
    );
    session.requestRedraw();
    onRefresh();
  };

  const addWaterBody = (kind: Extract<TerrainFeatureKind, 'lake' | 'ocean'>) => {
    if (!terrain) return;
    const terrainSize = Number(terrain.object.metadata.terrainSize) || 20;
    const style = {
      textureId: featureTextureId || null,
      opacity: waterOpacity,
      animated: waterAnimated,
      flowSpeed: waterFlowSpeed,
      textureScale: featureTextureScale,
    };
    if (kind === 'lake') {
      commitLakeWithCarve(session, terrain.object.id, {
        radius: waterSize,
        waterLevel,
        carveDepth,
        carve: carveTerrain,
        shorelineVariation: naturalShoreline ? 0.12 : 0,
        style,
      });
      setFeatureNote(
        carveTerrain
          ? 'Lake carved into the terrain · water sits in the basin.'
          : 'Lake created · use Move to position or resize it.',
      );
    } else {
      commitOceanWithCarve(session, terrain.object.id, {
        size: Math.max(waterSize, terrainSize * 1.35),
        waterLevel,
        carveDepth: Math.max(0.25, carveDepth * 0.65),
        carve: carveTerrain,
        style,
      });
      setFeatureNote(
        carveTerrain
          ? 'Ocean bed carved · water plane fills the shoreline.'
          : 'Ocean created · use Move to position or resize it.',
      );
    }
    onRefresh();
  };

  const importFeatureTexture = async () => {
    setFeatureNote(null);
    try {
      const selected = await openNativeFile({ types: IMAGE_FILES });
      if (!selected) return;
      const imported = await importImageFile(session.document, selected.file, {
        name: selected.file.name.replace(/\.[^.]+$/, '') || 'Terrain feature',
      });
      setFeatureTextureId(imported.textureId);
      setFeatureNote(`${selected.file.name} is ready for water and paths.`);
      session.requestRedraw();
      onRefresh();
    } catch (error) {
      setFeatureNote(error instanceof Error ? error.message : 'Could not import texture');
    }
  };

  return (
    <aside className="app-inspector terrain-panel" aria-label="Terrain editor">
      <header className="app-inspector-header">
        <span className="uv-panel-kicker">Workspace</span>
        <strong>Terrain</strong>
        <p>
          {terrain
            ? `${terrain.object.name} · ${terrain.mesh.vertices.size.toLocaleString()} vertices`
            : 'Create or select terrain'}
        </p>
      </header>
      <nav className="terrain-panel-tabs" aria-label="Terrain tools">
        {([
          ['terrain', 'Terrain'],
          ['sculpt', 'Sculpt'],
          ['height', 'Height'],
          ['surface', 'Surface'],
          ['water', 'Water'],
          ['objects', 'Objects'],
        ] as [TerrainPanelTab, string][]).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            className={activeTab === tab ? 'is-active' : ''}
            aria-selected={activeTab === tab}
            disabled={!terrain && tab !== 'terrain'}
            onClick={() => setActiveTab(tab)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="uv-panel-body">
        <section className="uv-section terrain-hero" hidden={activeTab !== 'terrain'}>
          <h3 className="uv-section-title">Terrain asset</h3>
          {terrains.length > 0 && (
            <label className="uv-field">
              <span>Active terrain</span>
              <select
                className="uv-select"
                value={terrain?.object.id ?? ''}
                onChange={(event) => activateTerrain(event.target.value)}
              >
                <option value="" disabled>Select terrain…</option>
                {terrains.map((object) => (
                  <option key={object.id} value={object.id}>{object.name}</option>
                ))}
              </select>
            </label>
          )}
          <div className="uv-btn-grid uv-btn-grid-2">
            <label className="uv-field">
              <span>World size</span>
              <input className="uv-text" type="number" min={1} max={1000} value={size} onChange={(event) => setSize(Number(event.target.value))} />
            </label>
            <label className="uv-field">
              <span>Resolution</span>
              <select className="uv-select" value={resolution} onChange={(event) => setResolution(Number(event.target.value))}>
                {[8, 16, 32, 48, 64, 96, 128].map((value) => <option key={value} value={value}>{value} × {value}</option>)}
              </select>
            </label>
          </div>
          <button type="button" className="tool primary uv-btn-block" onClick={create}>
            Create new terrain
          </button>
          <p className="uv-hint">Creates an editable game mesh with a paint-ready 256×256 terrain material.</p>
        </section>

        {terrain && (
          <>
            <section className="uv-section terrain-objects-launcher" hidden={activeTab !== 'objects'}>
              <div className="terrain-section-heading">
                <h3 className="uv-section-title">Level objects</h3>
                <span className="terrain-count">{placedObjects.length} placed</span>
              </div>
              <button
                type="button"
                className="tool primary uv-btn-block"
                disabled={sceneObjectsOpen}
                onClick={onOpenSceneObjects}
              >
                {sceneObjectsOpen ? 'Scene Objects is open' : 'Open Scene Objects'}
              </button>
              <p className="uv-hint">
                The movable Scene Objects window contains object previews, placement,
                scatter, erase, and selection controls.
              </p>
            </section>

            <section className="uv-section" hidden={activeTab !== 'sculpt'}>
              <h3 className="uv-section-title">Sculpt</h3>
              <div className="terrain-brush-grid">
                {([
                  ['raise', 'Raise'],
                  ['lower', 'Lower'],
                  ['smooth', 'Smooth'],
                  ['flatten', 'Flatten'],
                  ['noise', 'Noise'],
                ] as [TerrainBrushMode, string][]).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className={`tool${session.tools.getActive() === tool && tool.mode === mode ? ' is-active' : ''}`}
                    aria-pressed={session.tools.getActive() === tool && tool.mode === mode}
                    onClick={() => {
                      tool.setMode(mode, session.context());
                      session.tools.setActive('terrain-sculpt', session.context());
                      onRefresh();
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="uv-field">
                <span>Brush radius <b className="uv-field-value">{tool.radius.toFixed(1)}</b></span>
                <input className="uv-range" type="range" min={0.25} max={20} step={0.25} value={tool.radius} onChange={(event) => { tool.setRadius(Number(event.target.value), session.context()); onRefresh(); }} />
              </label>
              <label className="uv-field">
                <span>Strength <b className="uv-field-value">{tool.strength.toFixed(2)}</b></span>
                <input className="uv-range" type="range" min={0.01} max={2} step={0.01} value={tool.strength} onChange={(event) => { tool.setStrength(Number(event.target.value), session.context()); onRefresh(); }} />
              </label>
              <label className="uv-field">
                <span>Falloff</span>
                <select className="uv-select" value={tool.falloff} onChange={(event) => { tool.falloff = event.target.value as TerrainFalloff; tool.revision += 1; onRefresh(); }}>
                  <option value="smooth">Smooth</option>
                  <option value="linear">Linear</option>
                  <option value="sharp">Sharp</option>
                </select>
              </label>
              {tool.mode === 'flatten' && (
                <>
                  <label className="uv-field">
                    <span>Flatten height</span>
                    <input className="uv-text" type="number" step={0.1} value={tool.flattenHeight} onChange={(event) => { tool.flattenHeight = Number(event.target.value); onRefresh(); }} />
                  </label>
                  <p className="uv-hint">Alt+click samples height from the terrain surface.</p>
                </>
              )}
              <p className="uv-hint">LMB drag sculpts · Shift inverts raise/lower/noise · wheel changes brush size · RMB orbits camera.</p>
            </section>

            <section className="uv-section" hidden={activeTab !== 'sculpt'}>
              <h3 className="uv-section-title">Shape operations</h3>
              <div className="uv-btn-grid uv-btn-grid-2">
                <button type="button" className="tool" onClick={() => editAllHeights('Flatten Terrain', (values) => values.map(() => tool.flattenHeight))}>Flatten all</button>
                <button type="button" className="tool" onClick={() => editAllHeights('Smooth Terrain', smoothGrid)}>Smooth all</button>
                <button type="button" className="tool" onClick={() => editAllHeights('Noise Terrain', (values, res) => values.map((value, i) => value + pseudoNoise(i % (res + 1), Math.floor(i / (res + 1))) * tool.strength))}>Add noise</button>
                <button type="button" className="tool" onClick={() => editAllHeights('Erode Terrain', (values, res) => smoothGrid(smoothGrid(values, res), res))}>Soft erosion</button>
              </div>
              <p className="uv-meta">Height {heights.min.toFixed(2)} to {heights.max.toFixed(2)}</p>
            </section>

            <section className="uv-section terrain-heightmap-section" hidden={activeTab !== 'height'}>
              <h3 className="uv-section-title">Heightmap</h3>
              <details className="terrain-heightmap-generator" open>
                <summary>Generate a heightmap</summary>
                <div className="terrain-generator-body">
                  <label className="uv-field">
                    <span>Terrain style</span>
                    <select
                      className="uv-select"
                      value={generatorKind}
                      onChange={(event) => setGeneratorKind(event.target.value as HeightmapGeneratorKind)}
                    >
                      {(Object.entries(HEIGHTMAP_GENERATOR_LABELS) as [HeightmapGeneratorKind, string][]).map(
                        ([kind, label]) => <option key={kind} value={kind}>{label}</option>,
                      )}
                    </select>
                  </label>
                  <div className="uv-btn-grid uv-btn-grid-2">
                    <label className="uv-field">
                      <span>Map resolution</span>
                      <select
                        className="uv-select"
                        value={generatorSize}
                        onChange={(event) => setGeneratorSize(Number(event.target.value))}
                      >
                        {[64, 128, 256, 512].map((value) => (
                          <option key={value} value={value}>{value}×{value}</option>
                        ))}
                      </select>
                    </label>
                    <label className="uv-field">
                      <span>Seed</span>
                      <input
                        className="uv-text"
                        type="number"
                        step={1}
                        value={generatorSeed}
                        onChange={(event) => setGeneratorSeed(Math.round(Number(event.target.value)))}
                      />
                    </label>
                  </div>
                  <label className="uv-field">
                    <span>Feature scale <b className="uv-field-value">{generatorScale.toFixed(1)}</b></span>
                    <input
                      className="uv-range"
                      type="range"
                      min={0.5}
                      max={16}
                      step={0.5}
                      value={generatorScale}
                      onChange={(event) => setGeneratorScale(Number(event.target.value))}
                    />
                  </label>
                  <label className="uv-field">
                    <span>Detail octaves <b className="uv-field-value">{generatorOctaves}</b></span>
                    <input
                      className="uv-range"
                      type="range"
                      min={1}
                      max={8}
                      step={1}
                      value={generatorOctaves}
                      onChange={(event) => setGeneratorOctaves(Number(event.target.value))}
                    />
                  </label>
                  <label className="uv-field">
                    <span>Roughness <b className="uv-field-value">{generatorRoughness.toFixed(2)}</b></span>
                    <input
                      className="uv-range"
                      type="range"
                      min={0.1}
                      max={0.9}
                      step={0.05}
                      value={generatorRoughness}
                      onChange={(event) => setGeneratorRoughness(Number(event.target.value))}
                    />
                  </label>
                  <div className="uv-btn-grid uv-btn-grid-2">
                    <button
                      type="button"
                      className="tool primary"
                      onClick={() => createGeneratedHeightmap()}
                    >
                      Generate
                    </button>
                    <button
                      type="button"
                      className="tool"
                      onClick={() => createGeneratedHeightmap(Math.floor(Math.random() * 999_999_999) + 1)}
                    >
                      Reroll seed
                    </button>
                  </div>
                  <p className="uv-hint">
                    Generate creates a reusable project image. The seed makes results repeatable.
                  </p>
                </div>
              </details>
              <label className="uv-field">
                <span>Height image</span>
                <select
                  className="uv-select"
                  value={effectiveHeightmapId}
                  onChange={(event) => {
                    setHeightmapImageId(event.target.value);
                    setHeightmapNote(null);
                  }}
                >
                  <option value="">Choose an image…</option>
                  {projectImages.map((image) => (
                    <option key={image.id} value={image.id}>
                      {image.name} ({image.width}×{image.height})
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="tool uv-btn-block"
                disabled={heightmapBusy}
                onClick={() => void importHeightmap()}
              >
                {heightmapBusy ? 'Importing…' : 'Import heightmap…'}
              </button>
              {heightmapImage && <HeightmapPreview image={heightmapImage} />}
              <div className="uv-btn-grid uv-btn-grid-2">
                <label className="uv-field">
                  <span>Apply mode</span>
                  <select
                    className="uv-select"
                    value={heightmapMode}
                    onChange={(event) => setHeightmapMode(event.target.value as HeightmapMode)}
                  >
                    <option value="replace">Replace heights</option>
                    <option value="add">Add detail</option>
                  </select>
                </label>
                <label className="uv-field">
                  <span>Read channel</span>
                  <select
                    className="uv-select"
                    value={heightmapChannel}
                    onChange={(event) => setHeightmapChannel(event.target.value as HeightmapChannel)}
                  >
                    <option value="luminance">Brightness</option>
                    <option value="red">Red</option>
                    <option value="green">Green</option>
                    <option value="blue">Blue</option>
                    <option value="alpha">Alpha</option>
                  </select>
                </label>
              </div>
              <div className="uv-btn-grid uv-btn-grid-2">
                <label className="uv-field">
                  <span>Height strength</span>
                  <input
                    className="uv-text"
                    type="number"
                    step={0.25}
                    value={heightmapStrength}
                    onChange={(event) => setHeightmapStrength(Number(event.target.value))}
                  />
                </label>
                <label className="uv-field">
                  <span>Base offset</span>
                  <input
                    className="uv-text"
                    type="number"
                    step={0.25}
                    value={heightmapOffset}
                    onChange={(event) => setHeightmapOffset(Number(event.target.value))}
                  />
                </label>
              </div>
              <div className="terrain-heightmap-options">
                <label className="uv-check">
                  <input type="checkbox" checked={heightmapInvert} onChange={(event) => setHeightmapInvert(event.target.checked)} />
                  Invert
                </label>
                <label className="uv-check">
                  <input type="checkbox" checked={heightmapFlipX} onChange={(event) => setHeightmapFlipX(event.target.checked)} />
                  Flip horizontal
                </label>
                <label className="uv-check">
                  <input type="checkbox" checked={heightmapFlipY} onChange={(event) => setHeightmapFlipY(event.target.checked)} />
                  Flip vertical
                </label>
                <label className="uv-check">
                  <input
                    type="checkbox"
                    checked={heightmapReprojectObjects}
                    onChange={(event) => setHeightmapReprojectObjects(event.target.checked)}
                  />
                  Keep level objects grounded
                </label>
              </div>
              <button
                type="button"
                className="tool primary uv-btn-block"
                disabled={!heightmapImage}
                onClick={applySelectedHeightmap}
              >
                Apply heightmap
              </button>
              {heightmapNote && <p className="uv-meta">{heightmapNote}</p>}
              <p className="uv-hint">
                White creates high ground and black creates low ground. Add detail layers the map over existing sculpting.
              </p>
            </section>

            <section className="uv-section" hidden={activeTab !== 'surface'}>
              <h3 className="uv-section-title">Surface &amp; tiles</h3>
              <label className="uv-field">
                <span>Texture repeat</span>
                <input
                  className="uv-text"
                  type="number"
                  min={1}
                  max={128}
                  value={Number(terrain.object.metadata.terrainTileRepeat) || tileRepeat}
                  onChange={(event) => {
                    const repeat = Math.max(1, Math.min(128, Number(event.target.value)));
                    setTileRepeat(repeat);
                    terrain.object.metadata.terrainTileRepeat = String(repeat);
                    applyTerrainTileRepeat(terrain.mesh, repeat);
                    session.document.dirty = true;
                    session.requestRedraw();
                    onRefresh();
                  }}
                />
              </label>
              <div className="uv-btn-grid uv-btn-grid-2">
                <button type="button" className="tool primary" onClick={openPaint}>Paint terrain</button>
                <button type="button" className="tool primary" onClick={openTiles}>Use 2D tiles</button>
              </div>
              <p className="uv-hint">Paint directly in 3D, edit the terrain material, or use an atlas and tile tools in UV / Pixel.</p>
            </section>

            {activeTab === 'surface' && <MaterialEditor session={session} compact />}

            <section className="uv-section terrain-water-section" hidden={activeTab !== 'water'}>
              <div className="terrain-section-heading">
                <h3 className="uv-section-title">Water &amp; paths</h3>
                <span className="terrain-count">
                  {[...session.document.objects.values()].filter(
                    (object) => !!object.metadata.terrainFeature &&
                      object.metadata.terrainOwnerId === terrain.object.id,
                  ).length} features
                </span>
              </div>
              <p className="uv-hint">
                Rivers, paths, and lakes carve soft depressions into the heightmap; water fills the cut.
              </p>
              <label className="uv-check">
                <input
                  type="checkbox"
                  checked={carveTerrain}
                  onChange={(event) => {
                    setCarveTerrain(event.target.checked);
                    featureTool.carveTerrain = event.target.checked;
                  }}
                />
                Carve terrain under rivers &amp; paths
              </label>
              <label className="uv-field">
                <span>Carve depth <b className="uv-field-value">{carveDepth.toFixed(1)}</b></span>
                <input
                  className="uv-range"
                  type="range"
                  min={0.1}
                  max={6}
                  step={0.1}
                  value={carveDepth}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setCarveDepth(value);
                    featureTool.carveDepth = value;
                  }}
                />
              </label>
              <div className="terrain-feature-choice">
                <button
                  type="button"
                  className={`tool primary${session.tools.getActive() === featureTool && featureTool.kind === 'river' ? ' is-active' : ''}`}
                  onClick={() => activateFeatureBrush('river')}
                >
                  Draw river
                </button>
                <button
                  type="button"
                  className={`tool${session.tools.getActive() === featureTool && featureTool.kind === 'path' ? ' is-active' : ''}`}
                  onClick={() => activateFeatureBrush('path')}
                >
                  Draw path
                </button>
              </div>
              <label className="uv-field">
                <span>Width <b className="uv-field-value">{featureWidth.toFixed(1)}</b></span>
                <input
                  className="uv-range"
                  type="range"
                  min={0.1}
                  max={30}
                  step={0.1}
                  value={featureWidth}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setFeatureWidth(value);
                    featureTool.width = value;
                    featureTool.revision += 1;
                    onRefresh();
                  }}
                />
              </label>
              <div className="uv-btn-grid uv-btn-grid-2">
                <label className="uv-field">
                  <span>Surface offset</span>
                  <input
                    className="uv-text"
                    type="number"
                    step={0.01}
                    value={featureOffset}
                    onChange={(event) => {
                      const value = Number(event.target.value) || 0;
                      setFeatureOffset(value);
                      featureTool.surfaceOffset = value;
                    }}
                  />
                </label>
                <label className="uv-field">
                  <span>Texture length</span>
                  <input
                    className="uv-text"
                    type="number"
                    min={0.1}
                    step={0.25}
                    value={featureTextureScale}
                    onChange={(event) => {
                      const value = Math.max(0.1, Number(event.target.value) || 0.1);
                      setFeatureTextureScale(value);
                      featureTool.textureScale = value;
                    }}
                  />
                </label>
              </div>
              <div className="terrain-feature-texture-row">
                <label className="uv-field">
                  <span>Water / path texture</span>
                  <select
                    className="uv-select"
                    value={featureTextureId}
                    onChange={(event) => {
                      setFeatureTextureId(event.target.value);
                      featureTool.textureId = event.target.value || null;
                    }}
                  >
                    <option value="">Use material colour</option>
                    {[...session.document.textures.values()].map((texture) => (
                      <option key={texture.id} value={texture.id}>{texture.name}</option>
                    ))}
                  </select>
                </label>
                <button type="button" className="tool" onClick={() => void importFeatureTexture()}>
                  Import…
                </button>
              </div>
              <details className="terrain-water-settings" open>
                <summary>Water appearance &amp; animation</summary>
                <div className="terrain-generator-body">
                  <label className="uv-field">
                    <span>Transparency <b className="uv-field-value">{Math.round(waterOpacity * 100)}%</b></span>
                    <input
                      className="uv-range"
                      type="range"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={waterOpacity}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setWaterOpacity(value);
                        featureTool.opacity = value;
                      }}
                    />
                  </label>
                  <label className="uv-check">
                    <input
                      type="checkbox"
                      checked={waterAnimated}
                      onChange={(event) => {
                        setWaterAnimated(event.target.checked);
                        featureTool.animated = event.target.checked;
                      }}
                    />
                    Animate flowing texture
                  </label>
                  <label className="uv-field">
                    <span>Flow speed <b className="uv-field-value">{waterFlowSpeed.toFixed(2)}</b></span>
                    <input
                      className="uv-range"
                      type="range"
                      min={-1}
                      max={1}
                      step={0.02}
                      value={waterFlowSpeed}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setWaterFlowSpeed(value);
                        featureTool.flowSpeed = value;
                      }}
                    />
                  </label>
                </div>
              </details>
              <h3 className="uv-section-title terrain-water-body-title">Still water</h3>
              <div className="uv-btn-grid uv-btn-grid-2">
                <label className="uv-field">
                  <span>Water level</span>
                  <input className="uv-text" type="number" step={0.25} value={waterLevel} onChange={(event) => setWaterLevel(Number(event.target.value) || 0)} />
                </label>
                <label className="uv-field">
                  <span>Lake radius / size</span>
                  <input className="uv-text" type="number" min={0.1} step={0.5} value={waterSize} onChange={(event) => setWaterSize(Math.max(0.1, Number(event.target.value) || 0.1))} />
                </label>
              </div>
              <div className="uv-btn-grid uv-btn-grid-2">
                <label className="uv-field">
                  <span>Shoreline</span>
                  <select
                    className="uv-select"
                    value={naturalShoreline ? 'natural' : 'round'}
                    onChange={(event) => setNaturalShoreline(event.target.value === 'natural')}
                  >
                    <option value="natural">Natural</option>
                    <option value="round">Round</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="tool terrain-auto-water-level"
                  onClick={() => {
                    const range = heights.max - heights.min;
                    setWaterLevel(heights.min + Math.max(0.08, range * 0.14));
                    setFeatureNote('Water level placed just above the terrain lowlands.');
                  }}
                >
                  Find lowlands
                </button>
              </div>
              <div className="uv-btn-grid uv-btn-grid-2">
                <button type="button" className="tool primary" onClick={() => addWaterBody('lake')}>Add lake</button>
                <button type="button" className="tool primary" onClick={() => addWaterBody('ocean')}>Add ocean</button>
              </div>
              {featureNote && <p className="uv-meta terrain-feature-note">{featureNote}</p>}
              <p className="uv-hint">
                River/path: LMB drag · wheel changes width · release carves the trail · Ctrl+Z undoes feature and terrain together.
              </p>
            </section>

            <section className="uv-section terrain-output-summary" hidden={activeTab !== 'terrain'}>
              <h3 className="uv-section-title">Game output</h3>
              {(() => {
                const stats = gameReadiness(session.document);
                return (
                  <>
                    <p className="uv-meta">
                      {stats.objects} export object{stats.objects === 1 ? '' : 's'}
                      {' · '}
                      {stats.triangles.toLocaleString()} tris
                      {' · '}
                      {stats.collisionObjects} collider{stats.collisionObjects === 1 ? '' : 's'}
                    </p>
                    {stats.hiddenLibraryObjects > 0 && (
                      <p className="uv-hint">
                        {stats.hiddenLibraryObjects} library/palette source
                        {stats.hiddenLibraryObjects === 1 ? '' : 's'} omitted from engine export.
                      </p>
                    )}
                  </>
                );
              })()}
              <label className="uv-field">
                <span>Resample resolution</span>
                <select
                  className="uv-select"
                  value={Number(terrain.object.metadata.terrainResolution) || resolution}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (!resampleTerrain(session, terrain.object.id, next)) {
                      pushToast('Resolution unchanged', 'info');
                    } else {
                      pushToast(`Terrain resampled to ${next}×${next}`, 'success');
                    }
                    onRefresh();
                  }}
                >
                  {[8, 16, 32, 48, 64, 96, 128].map((value) => (
                    <option key={value} value={value}>{value} × {value}</option>
                  ))}
                </select>
              </label>
              <div className="uv-btn-grid uv-btn-grid-2">
                <button
                  type="button"
                  className="tool"
                  onClick={() => {
                    try {
                      const id = generateMeshCollider(session.document, terrain.object.id);
                      session.selection.selectObjects([id], 'replace');
                      pushToast('Mesh collider created', 'success');
                      session.requestRedraw();
                      onRefresh();
                    } catch (error) {
                      pushToast(error instanceof Error ? error.message : 'Collider failed', 'error');
                    }
                  }}
                >
                  Mesh collider
                </button>
                <button
                  type="button"
                  className="tool"
                  onClick={() => {
                    try {
                      const id = generateConvexCollider(session.document, terrain.object.id);
                      session.selection.selectObjects([id], 'replace');
                      pushToast('Convex collider created', 'success');
                      session.requestRedraw();
                      onRefresh();
                    } catch (error) {
                      pushToast(error instanceof Error ? error.message : 'Collider failed', 'error');
                    }
                  }}
                >
                  Convex collider
                </button>
              </div>
              <p className="uv-hint">Editable mesh · GLB / OBJ ready · terrain metadata included.</p>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}

function smoothGrid(values: number[], resolution: number): number[] {
  const side = resolution + 1;
  return values.map((value, index) => {
    const x = index % side;
    const z = Math.floor(index / side);
    let sum = value;
    let count = 1;
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= side || nz >= side) continue;
      sum += values[nz * side + nx] ?? value;
      count += 1;
    }
    return sum / count;
  });
}

function pseudoNoise(x: number, z: number): number {
  const value = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

function HeightmapPreview({ image }: { image: ImageAsset }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.putImageData(
      new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height),
      0,
      0,
    );
  }, [image]);
  return (
    <figure className="terrain-heightmap-preview">
      <canvas ref={canvasRef} />
      <figcaption>{image.width}×{image.height} · brightness preview</figcaption>
    </figure>
  );
}

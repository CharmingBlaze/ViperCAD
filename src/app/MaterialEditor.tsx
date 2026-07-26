import { useEffect, useState } from 'react';
import {
  assignMaterialToObject,
  countMaterialUsers,
  createMaterial,
  getObjectMaterialId,
} from '@/core/document/ModelDocument';
import type { MaterialId } from '@/core/document/types';
import type { EditorSession } from '@/core/editor/EditorSession';
import { importImageFile } from '@/core/image/ImageImport';
import {
  clampImageSize,
  createImageAsset,
  createTextureAsset,
  IMAGE_SIZE_LIMITS,
  IMAGE_SIZE_PRESETS,
} from '@/core/image/PixelEditor';
import { resolveActiveTexture } from '@/core/texture/resolveActiveTexture';
import { IMAGE_FILES, openNativeFile } from '@/app/platform/FileDialogs';

type Props = {
  session: EditorSession;
  /** Compact layout for the UV inspector tab. */
  compact?: boolean;
};

type SizePreset = (typeof IMAGE_SIZE_PRESETS)[number] | 'custom';

/**
 * Per-object materials: assign an existing asset, or create a new one for the selection.
 */
export function MaterialEditor({ session, compact = false }: Props) {
  const doc = session.document;
  const selection = session.selection.state;
  const activeObjectId = selection.activeObjectId;
  const activeObject = activeObjectId ? doc.objects.get(activeObjectId) : null;
  const objectMaterialId = activeObject ? getObjectMaterialId(activeObject) : null;

  const ctx = resolveActiveTexture(doc, selection);
  const [materialId, setMaterialId] = useState<MaterialId | null>(
    objectMaterialId ?? ctx.materialId,
  );
  const [sizePreset, setSizePreset] = useState<SizePreset>(64);
  const [customW, setCustomW] = useState(64);
  const [customH, setCustomH] = useState(64);
  const [importBusy, setImportBusy] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);

  useEffect(() => {
    if (objectMaterialId) setMaterialId(objectMaterialId);
    else if (ctx.materialId) setMaterialId(ctx.materialId);
  }, [objectMaterialId, ctx.materialId, activeObjectId]);

  const materials = [...doc.materials.values()];
  const textures = [...doc.textures.values()];
  const material = materialId ? doc.materials.get(materialId) : null;
  const users = materialId ? countMaterialUsers(doc, materialId) : 0;
  const isOnObject = !!activeObject && objectMaterialId === materialId;

  const touch = () => {
    doc.dirty = true;
    session.requestRedraw();
  };

  const selectMaterial = (id: MaterialId) => {
    setMaterialId(id);
  };

  /** Pick an existing material and put it on the selected object. */
  const assignExistingToObject = (id: MaterialId) => {
    setMaterialId(id);
    if (!activeObjectId) return;
    if (assignMaterialToObject(doc, activeObjectId, id)) touch();
  };

  const createForObject = () => {
    if (!activeObjectId || !activeObject) return;
    const mat = createMaterial(doc, {
      assignToObjectId: activeObjectId,
      name: uniqueObjectMaterialName(doc, activeObject.name),
    });
    setMaterialId(mat.id);
    session.requestRedraw();
  };

  const createShared = () => {
    const mat = createMaterial(doc, { name: `Material ${doc.materials.size + 1}` });
    setMaterialId(mat.id);
    session.requestRedraw();
  };

  const rename = (name: string) => {
    if (!material) return;
    material.name = name;
    touch();
  };

  const setColourHex = (hex: string) => {
    if (!material) return;
    const [r, g, b] = hexToRgb01(hex);
    material.baseColour = { x: r, y: g, z: b };
    touch();
  };

  const setTexture = (textureId: string) => {
    if (!material) return;
    material.baseColourTextureId = textureId === '' ? null : textureId;
    touch();
  };

  const mapSize = (): { w: number; h: number } => {
    if (sizePreset === 'custom') {
      return { w: clampImageSize(customW), h: clampImageSize(customH) };
    }
    return { w: sizePreset, h: sizePreset };
  };

  const createBlankTexture = () => {
    if (!material) return;
    const { w, h } = mapSize();
    const fill = [
      Math.round(material.baseColour.x * 255),
      Math.round(material.baseColour.y * 255),
      Math.round(material.baseColour.z * 255),
      255,
    ] as const;
    const image = createImageAsset(doc, `${material.name} Map`, w, h, fill);
    const texture = createTextureAsset(doc, image, `${material.name} Map ${w}×${h}`);
    material.baseColourTextureId = texture.id;
    setImportNote(null);
    touch();
  };

  const importTexture = async (file: File | undefined) => {
    if (!material || !file) return;
    setImportBusy(true);
    setImportNote(null);
    try {
      const result = await importImageFile(doc, file);
      material.baseColourTextureId = result.textureId;
      setImportNote(
        result.scaled
          ? `Imported ${result.sourceWidth}×${result.sourceHeight} → ${result.width}×${result.height}`
          : `Imported ${result.width}×${result.height}`,
      );
      touch();
    } catch (err) {
      setImportNote(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImportBusy(false);
    }
  };

  const chooseTextureFile = async () => {
    try {
      const selected = await openNativeFile({ types: IMAGE_FILES });
      if (selected) await importTexture(selected.file);
    } catch (error) {
      setImportNote(error instanceof Error ? error.message : 'Could not open image');
    }
  };

  const rootClass = compact ? 'material-editor is-compact' : 'material-editor';

  return (
    <div className={rootClass}>
      {!compact && (
        <header className="material-editor-header">
          <span className="uv-panel-kicker">Assets</span>
          <strong>Material</strong>
        </header>
      )}

      <section className="uv-section">
        <h3 className="uv-section-title">Object</h3>
        {activeObject ? (
          <>
            <p className="uv-meta material-object-name">{activeObject.name}</p>
            <label className="uv-field">
              <span>Material on object</span>
              <select
                className="uv-select"
                aria-label="Material on selected object"
                value={objectMaterialId ?? ''}
                onChange={(e) => {
                  const id = e.target.value;
                  if (id) assignExistingToObject(id);
                }}
              >
                {!materials.length && <option value="">No materials</option>}
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {countMaterialUsers(doc, m.id) > 1 ? ' (shared)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="tool primary uv-btn-block" onClick={createForObject}>
              New material for object
            </button>
            <p className="uv-hint">
              Pick an existing material, or create a unique one for this object.
            </p>
          </>
        ) : (
          <p className="uv-hint">Select an object to assign or create a material for it.</p>
        )}
      </section>

      <section className="uv-section">
        <h3 className="uv-section-title">Library</h3>
        <label className="uv-field">
          <span>Edit material</span>
          <select
            className="uv-select"
            aria-label="Edit material"
            value={material?.id ?? ''}
            onChange={(e) => selectMaterial(e.target.value)}
          >
            {!materials.length && <option value="">No materials</option>}
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <div className="material-actions-row">
          <button type="button" className="tool uv-btn-block" onClick={createShared}>
            New in library
          </button>
          {activeObject && material && !isOnObject && (
            <button
              type="button"
              className="tool primary uv-btn-block"
              onClick={() => assignExistingToObject(material.id)}
            >
              Use on object
            </button>
          )}
        </div>
        {material && (
          <p className="uv-meta">
            Used by {users} object{users === 1 ? '' : 's'}
            {isOnObject ? ' · on selection' : ''}
          </p>
        )}
      </section>

      {material && (
        <>
          <section className="uv-section">
            <h3 className="uv-section-title">Properties</h3>
            <label className="uv-field">
              <span>Name</span>
              <input
                className="uv-text"
                aria-label="Material name"
                value={material.name}
                onChange={(e) => rename(e.target.value)}
              />
            </label>
            <label className="uv-field">
              <span>Base colour</span>
              <div className="material-color-row">
                <input
                  type="color"
                  aria-label="Base colour"
                  value={rgb01ToHex(material.baseColour.x, material.baseColour.y, material.baseColour.z)}
                  onChange={(e) => setColourHex(e.target.value)}
                />
                <span className="uv-meta">
                  {Math.round(material.baseColour.x * 255)}, {Math.round(material.baseColour.y * 255)},{' '}
                  {Math.round(material.baseColour.z * 255)}
                </span>
              </div>
            </label>
            <label className="uv-check">
              <input
                type="checkbox"
                checked={material.flatShaded}
                onChange={(e) => {
                  material.flatShaded = e.target.checked;
                  touch();
                }}
              />
              Flat shaded
            </label>
          </section>

          <section className="uv-section">
            <h3 className="uv-section-title">Texture</h3>
            <label className="uv-field">
              <span>Base map</span>
              <select
                className="uv-select"
                aria-label="Base colour texture"
                value={material.baseColourTextureId ?? ''}
                onChange={(e) => setTexture(e.target.value)}
              >
                <option value="">None (colour only)</option>
                {textures.map((t) => {
                  const img = doc.images.get(t.imageAssetId);
                  const dim = img ? ` (${img.width}×${img.height})` : '';
                  return (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {dim}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="uv-field">
              <span>New map size</span>
              <select
                className="uv-select"
                aria-label="New map size"
                value={sizePreset}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'custom') {
                    setSizePreset('custom');
                  } else {
                    const n = Number(v) as (typeof IMAGE_SIZE_PRESETS)[number];
                    setSizePreset(n);
                    setCustomW(n);
                    setCustomH(n);
                  }
                }}
              >
                {IMAGE_SIZE_PRESETS.map((n) => (
                  <option key={n} value={n}>
                    {n}×{n}
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </select>
            </label>
            {sizePreset === 'custom' && (
              <div className="material-size-row">
                <label className="uv-field">
                  <span>Width</span>
                  <input
                    className="uv-text"
                    type="number"
                    min={IMAGE_SIZE_LIMITS.min}
                    max={IMAGE_SIZE_LIMITS.max}
                    value={customW}
                    onChange={(e) => setCustomW(clampImageSize(Number(e.target.value)))}
                  />
                </label>
                <label className="uv-field">
                  <span>Height</span>
                  <input
                    className="uv-text"
                    type="number"
                    min={IMAGE_SIZE_LIMITS.min}
                    max={IMAGE_SIZE_LIMITS.max}
                    value={customH}
                    onChange={(e) => setCustomH(clampImageSize(Number(e.target.value)))}
                  />
                </label>
              </div>
            )}
            <button type="button" className="tool uv-btn-block" onClick={createBlankTexture}>
              {(() => {
                const { w, h } = mapSize();
                return `New ${w}×${h} map`;
              })()}
            </button>
            <button
              type="button"
              className="tool uv-btn-block"
              disabled={importBusy}
              onClick={() => void chooseTextureFile()}
            >
              {importBusy ? 'Importing…' : 'Import image…'}
            </button>
            <p className="uv-hint">
              {importNote ??
                `PNG/JPEG/WebP · max ${IMAGE_SIZE_LIMITS.max}px (larger images scale down)`}
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function uniqueObjectMaterialName(
  doc: { materials: Map<string, { name: string }> },
  objectName: string,
): string {
  const base = `${objectName} Material`;
  if (![...doc.materials.values()].some((m) => m.name === base)) return base;
  let i = 2;
  while ([...doc.materials.values()].some((m) => m.name === `${base} ${i}`)) i += 1;
  return `${base} ${i}`;
}

function rgb01ToHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

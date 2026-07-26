import { useEffect, useState } from 'react';
import {
  assignMaterialToObject,
  countMaterialUsers,
  createMaterial,
  getObjectMaterialId,
} from '@/core/document/ModelDocument';
import type { MaterialAsset, MaterialId, MaterialShadingModel } from '@/core/document/types';
import type { EditorSession } from '@/core/editor/EditorSession';
import { importImageFile } from '@/core/image/ImageImport';
import {
  clampImageSize,
  createImageAsset,
  createTextureAsset,
  IMAGE_SIZE_LIMITS,
  IMAGE_SIZE_PRESETS,
} from '@/core/image/PixelEditor';
import {
  applyMaterialPreset,
  MATERIAL_PRESETS,
} from '@/core/material/MaterialPresets';
import { resolveActiveTexture } from '@/core/texture/resolveActiveTexture';
import { IMAGE_FILES, openNativeFile } from '@/app/platform/FileDialogs';

type Props = {
  session: EditorSession;
  /** Compact layout for the UV inspector tab. */
  compact?: boolean;
};

type SizePreset = (typeof IMAGE_SIZE_PRESETS)[number] | 'custom';

type TextureSlotKey =
  | 'baseColourTextureId'
  | 'normalTextureId'
  | 'roughnessTextureId'
  | 'metallicTextureId'
  | 'emissiveTextureId';

const TEXTURE_SLOTS: { key: TextureSlotKey; label: string }[] = [
  { key: 'baseColourTextureId', label: 'Base colour map' },
  { key: 'normalTextureId', label: 'Normal map' },
  { key: 'roughnessTextureId', label: 'Roughness map' },
  { key: 'metallicTextureId', label: 'Metallic map' },
  { key: 'emissiveTextureId', label: 'Emissive map' },
];

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
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (objectMaterialId) setMaterialId(objectMaterialId);
    else if (ctx.materialId) setMaterialId(ctx.materialId);
  }, [objectMaterialId, ctx.materialId, activeObjectId]);

  const materials = [...doc.materials.values()];
  const textures = [...doc.textures.values()];
  const material = materialId ? doc.materials.get(materialId) : null;
  const users = materialId ? countMaterialUsers(doc, materialId) : 0;
  const isOnObject = !!activeObject && objectMaterialId === materialId;
  const isPhysical =
    !!material &&
    !material.unlit &&
    material.shadingModel !== 'unlit' &&
    (material.shadingModel === 'physical' ||
      material.transmission > 0.01 ||
      material.clearcoat > 0.01);

  const touch = () => {
    doc.dirty = true;
    session.requestRedraw();
  };

  const patchMaterial = (patch: Partial<MaterialAsset>) => {
    if (!material) return;
    Object.assign(material, patch);
    material.presetId = null;
    touch();
  };

  const selectMaterial = (id: MaterialId) => {
    setMaterialId(id);
  };

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

  const applyPreset = (presetId: string) => {
    if (!material) return;
    applyMaterialPreset(material, presetId);
    touch();
  };

  const setShadingModel = (model: MaterialShadingModel) => {
    if (!material) return;
    material.shadingModel = model;
    material.unlit = model === 'unlit';
    material.presetId = null;
    touch();
  };

  const setColourHex = (hex: string) => {
    if (!material) return;
    const [r, g, b] = hexToRgb01(hex);
    material.baseColour = { x: r, y: g, z: b };
    material.presetId = null;
    touch();
  };

  const setEmissiveHex = (hex: string) => {
    if (!material) return;
    const [r, g, b] = hexToRgb01(hex);
    material.emissive = { x: r, y: g, z: b };
    material.presetId = null;
    touch();
  };

  const setTextureSlot = (key: TextureSlotKey, textureId: string) => {
    if (!material) return;
    material[key] = textureId === '' ? null : textureId;
    material.presetId = null;
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
    material.presetId = null;
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
      material.presetId = null;
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
            <h3 className="uv-section-title">Presets</h3>
            <label className="uv-field">
              <span>Quick preset</span>
              <select
                className="uv-select"
                aria-label="Material preset"
                value={material.presetId ?? ''}
                onChange={(e) => {
                  if (e.target.value) applyPreset(e.target.value);
                }}
              >
                <option value="">Custom</option>
                {MATERIAL_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="uv-btn-grid uv-btn-grid-3 material-preset-grid">
              {MATERIAL_PRESETS.filter((preset) =>
                ['default', 'metal-chrome', 'metal-gold', 'glass-clear', 'glass-frosted', 'plastic-glossy', 'rubber', 'neon-blue', 'pixel-unlit', 'water', 'ceramic', 'foliage-cutout'].includes(
                  preset.id,
                ),
              ).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`tool${material.presetId === preset.id ? ' is-active' : ''}`}
                  onClick={() => applyPreset(preset.id)}
                  aria-pressed={material.presetId === preset.id}
                >
                  {preset.label.replace(' · ', '\n').split('\n').slice(-1)[0]}
                </button>
              ))}
            </div>
          </section>

          <section className="uv-section">
            <h3 className="uv-section-title">Properties</h3>
            <label className="uv-field">
              <span>Name</span>
              <input
                className="uv-text"
                aria-label="Material name"
                value={material.name}
                onChange={(e) => {
                  material.name = e.target.value;
                  touch();
                }}
              />
            </label>
            <label className="uv-field">
              <span>Shading</span>
              <select
                className="uv-select"
                aria-label="Shading model"
                value={material.shadingModel}
                onChange={(e) => setShadingModel(e.target.value as MaterialShadingModel)}
              >
                <option value="lit">Lit · Standard PBR</option>
                <option value="physical">Physical · Glass / clearcoat</option>
                <option value="unlit">Unlit · Pixel / flat colour</option>
              </select>
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
            {!material.unlit && material.shadingModel !== 'unlit' && (
              <>
                <label className="uv-field">
                  <span>Roughness</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={material.roughness}
                    onChange={(e) => patchMaterial({ roughness: Number(e.target.value) })}
                  />
                  <span className="uv-meta">{material.roughness.toFixed(2)}</span>
                </label>
                <label className="uv-field">
                  <span>Metallic</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={material.metallic}
                    onChange={(e) => patchMaterial({ metallic: Number(e.target.value) })}
                  />
                  <span className="uv-meta">{material.metallic.toFixed(2)}</span>
                </label>
                <label className="uv-field">
                  <span>Clearcoat</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={material.clearcoat}
                    onChange={(e) => patchMaterial({ clearcoat: Number(e.target.value) })}
                  />
                  <span className="uv-meta">{material.clearcoat.toFixed(2)}</span>
                </label>
                {isPhysical && (
                  <>
                    <label className="uv-field">
                      <span>Transmission</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={material.transmission}
                        onChange={(e) => patchMaterial({ transmission: Number(e.target.value) })}
                      />
                      <span className="uv-meta">{material.transmission.toFixed(2)}</span>
                    </label>
                    <label className="uv-field">
                      <span>Index of refraction</span>
                      <input
                        className="uv-text"
                        type="number"
                        min={1}
                        max={2.5}
                        step={0.01}
                        value={material.ior}
                        onChange={(e) => patchMaterial({ ior: Number(e.target.value) })}
                      />
                    </label>
                  </>
                )}
              </>
            )}
            {!material.unlit && material.shadingModel !== 'unlit' && (
              <>
                <label className="uv-field">
                  <span>Emissive colour</span>
                  <div className="material-color-row">
                    <input
                      type="color"
                      aria-label="Emissive colour"
                      value={rgb01ToHex(material.emissive.x, material.emissive.y, material.emissive.z)}
                      onChange={(e) => setEmissiveHex(e.target.value)}
                    />
                    <span className="uv-meta">
                      {Math.round(material.emissive.x * 255)}, {Math.round(material.emissive.y * 255)},{' '}
                      {Math.round(material.emissive.z * 255)}
                    </span>
                  </div>
                </label>
                <label className="uv-field">
                  <span>Emissive intensity</span>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={0.05}
                    value={material.emissiveIntensity}
                    onChange={(e) => patchMaterial({ emissiveIntensity: Number(e.target.value) })}
                  />
                  <span className="uv-meta">{material.emissiveIntensity.toFixed(2)}</span>
                </label>
              </>
            )}
            <label className="uv-field">
              <span>Opacity</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={material.opacity}
                onChange={(e) => patchMaterial({ opacity: Number(e.target.value) })}
              />
              <span className="uv-meta">{material.opacity.toFixed(2)}</span>
            </label>
            <label className="uv-field">
              <span>Alpha mode</span>
              <select
                className="uv-select"
                aria-label="Alpha mode"
                value={material.alphaMode}
                onChange={(e) =>
                  patchMaterial({ alphaMode: e.target.value as 'opaque' | 'mask' | 'blend' })
                }
              >
                <option value="opaque">Opaque</option>
                <option value="mask">Mask / cutout</option>
                <option value="blend">Blend / transparent</option>
              </select>
            </label>
            {material.alphaMode === 'mask' && (
              <label className="uv-field">
                <span>Alpha cutoff</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={material.alphaCutoff}
                  onChange={(e) => patchMaterial({ alphaCutoff: Number(e.target.value) })}
                />
                <span className="uv-meta">{material.alphaCutoff.toFixed(2)}</span>
              </label>
            )}
            <div className="uv-btn-grid uv-btn-grid-2">
              <label className="uv-check">
                <input
                  type="checkbox"
                  checked={material.flatShaded}
                  onChange={(e) => patchMaterial({ flatShaded: e.target.checked })}
                />
                Flat shaded
              </label>
              <label className="uv-check">
                <input
                  type="checkbox"
                  checked={material.doubleSided}
                  onChange={(e) => patchMaterial({ doubleSided: e.target.checked })}
                />
                Double sided
              </label>
            </div>
          </section>

          <section className="uv-section">
            <h3 className="uv-section-title">Texture maps</h3>
            {TEXTURE_SLOTS.map(({ key, label }) => (
              <label className="uv-field" key={key}>
                <span>{label}</span>
                <select
                  className="uv-select"
                  aria-label={label}
                  value={material[key] ?? ''}
                  onChange={(e) => setTextureSlot(key, e.target.value)}
                >
                  <option value="">None</option>
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
            ))}
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
                return `New ${w}×${h} base map`;
              })()}
            </button>
            <button
              type="button"
              className="tool uv-btn-block"
              disabled={importBusy}
              onClick={() => void chooseTextureFile()}
            >
              {importBusy ? 'Importing…' : 'Import base map…'}
            </button>
            <p className="uv-hint">
              {importNote ??
                `PNG/JPEG/WebP · max ${IMAGE_SIZE_LIMITS.max}px (larger images scale down)`}
            </p>
          </section>

          <details
            className="draw-details"
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
          >
            <summary>Advanced surface options</summary>
            <label className="uv-field">
              <span>Clearcoat roughness</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={material.clearcoatRoughness}
                onChange={(e) => patchMaterial({ clearcoatRoughness: Number(e.target.value) })}
              />
              <span className="uv-meta">{material.clearcoatRoughness.toFixed(2)}</span>
            </label>
            <label className="uv-field">
              <span>Texture filtering</span>
              <select
                className="uv-select"
                value={material.textureFiltering}
                onChange={(e) =>
                  patchMaterial({ textureFiltering: e.target.value as 'nearest' | 'linear' })
                }
              >
                <option value="nearest">Nearest · pixel art</option>
                <option value="linear">Linear · smooth</option>
              </select>
            </label>
            <label className="uv-field">
              <span>Texture wrapping</span>
              <select
                className="uv-select"
                value={material.textureWrapping}
                onChange={(e) =>
                  patchMaterial({ textureWrapping: e.target.value as 'repeat' | 'clamp' })
                }
              >
                <option value="repeat">Repeat</option>
                <option value="clamp">Clamp</option>
              </select>
            </label>
          </details>
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

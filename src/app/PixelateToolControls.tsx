import { useEffect, useMemo, useRef, useState } from 'react';
import type { ImageAsset, MaterialAsset } from '@/core/document/types';
import type { EditorSession } from '@/core/editor/EditorSession';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import {
  applyPixelateToImage,
  applyPixelateToImages,
  listMaterialMapEntries,
  PIXELATE_BLOCK_PRESETS,
  pixelateModeLabel,
  pixelatePixels,
  type MaterialMapSlot,
  type PixelateMode,
} from '@/core/image/ImageFilters';

type Props = {
  session: EditorSession;
  workspace?: WorkspaceController;
  image?: ImageAsset | null;
  material?: MaterialAsset | null;
  hint?: string;
  showAllMapsAction?: boolean;
};

const ALL_MAP_SLOTS: MaterialMapSlot[] = ['base', 'normal', 'roughness', 'metallic', 'emissive'];

function normalizePixelateMode(value: unknown): PixelateMode {
  if (value === 'center' || value === 'mosaic') return value;
  return 'average';
}

function drawPreview(
  canvas: HTMLCanvasElement,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
}

export function PixelateToolControls({
  session,
  workspace,
  image,
  material,
  hint,
  showAllMapsAction = false,
}: Props) {
  const [localBlockSize, setLocalBlockSize] = useState(4);
  const [localMode, setLocalMode] = useState<PixelateMode>('average');
  const [selectedSlots, setSelectedSlots] = useState<Set<MaterialMapSlot>>(() => new Set(ALL_MAP_SLOTS));
  const beforeCanvasRef = useRef<HTMLCanvasElement>(null);
  const afterCanvasRef = useRef<HTMLCanvasElement>(null);

  const blockSize = workspace?.texture.pixelateBlockSize ?? localBlockSize;
  const mode = workspace ? normalizePixelateMode(workspace.texture.pixelateMode) : localMode;

  const setBlockSize = (value: number) => {
    const next = Math.max(1, Math.min(64, Math.round(value)));
    if (workspace) workspace.patchTexture({ pixelateBlockSize: next });
    else setLocalBlockSize(next);
  };

  const setMode = (value: PixelateMode) => {
    if (workspace) workspace.patchTexture({ pixelateMode: value });
    else setLocalMode(value);
  };

  const mapEntries = material ? listMaterialMapEntries(session.document, material) : [];
  const previewImage = image ?? mapEntries[0]?.image ?? null;

  useEffect(() => {
    if (!showAllMapsAction || !mapEntries.length) return;
    setSelectedSlots(new Set(mapEntries.map((entry) => entry.slot)));
  }, [showAllMapsAction, material?.id, mapEntries.length]);

  const previewPixels = useMemo(() => {
    if (!previewImage) return null;
    return pixelatePixels(
      previewImage.pixels,
      previewImage.width,
      previewImage.height,
      blockSize,
      mode,
    );
  }, [previewImage, previewImage?.revision, blockSize, mode]);

  useEffect(() => {
    if (!previewImage) return;
    const beforeCanvas = beforeCanvasRef.current;
    const afterCanvas = afterCanvasRef.current;
    if (!beforeCanvas || !afterCanvas) return;
    drawPreview(beforeCanvas, previewImage.pixels, previewImage.width, previewImage.height);
    if (previewPixels) {
      drawPreview(afterCanvas, previewPixels, previewImage.width, previewImage.height);
    }
  }, [previewImage, previewPixels]);

  const toggleSlot = (slot: MaterialMapSlot) => {
    setSelectedSlots((current) => {
      const next = new Set(current);
      if (next.has(slot)) {
        if (next.size <= 1) return current;
        next.delete(slot);
      } else {
        next.add(slot);
      }
      return next;
    });
  };

  const selectedImages = mapEntries
    .filter((entry) => selectedSlots.has(entry.slot))
    .map((entry) => entry.image);

  const pixelateActive = () => {
    if (!image) return;
    applyPixelateToImage(session, image, blockSize, material, mode);
  };

  const pixelateSelectedMaps = () => {
    if (!selectedImages.length) return;
    applyPixelateToImages(session, selectedImages, blockSize, material, mode);
  };

  const previewChanged = previewImage && previewPixels
    ? previewPixels.some((value, index) => value !== previewImage.pixels[index])
    : false;

  return (
    <section className="uv-section pixelate-editor">
      <h3 className="uv-section-title">Pixelate</h3>

      {previewImage && (
        <div className="pixelate-preview-grid">
          <figure className="pixelate-preview-card">
            <figcaption>Before</figcaption>
            <canvas ref={beforeCanvasRef} className="pixelate-preview-canvas" />
          </figure>
          <figure className="pixelate-preview-card">
            <figcaption>After</figcaption>
            <canvas ref={afterCanvasRef} className="pixelate-preview-canvas" />
          </figure>
        </div>
      )}

      <div className="pixelate-presets">
        {PIXELATE_BLOCK_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`pixelate-preset-btn${blockSize === preset.size ? ' is-active' : ''}`}
            onClick={() => setBlockSize(preset.size)}
          >
            <strong>{preset.label}</strong>
            <span>{preset.size}px</span>
          </button>
        ))}
      </div>

      <label className="uv-field">
        <span>Block size</span>
        <input
          className="uv-range"
          type="range"
          min={1}
          max={64}
          value={blockSize}
          onChange={(event) => setBlockSize(Number(event.target.value))}
        />
        <input
          className="uv-text pixelate-block-input"
          type="number"
          min={1}
          max={64}
          value={blockSize}
          onChange={(event) => setBlockSize(Number(event.target.value))}
        />
        <span className="uv-field-value">px</span>
      </label>

      <label className="uv-field">
        <span>Mode</span>
        <select
          className="uv-select"
          value={mode}
          onChange={(event) => setMode(normalizePixelateMode(event.target.value))}
        >
          <option value="average">Block average</option>
          <option value="center">Center sample</option>
          <option value="mosaic">Mosaic tiles</option>
        </select>
      </label>

      <p className="uv-meta pixelate-mode-hint">
        {mode === 'average' && 'Smooth block colours by averaging texels inside each square.'}
        {mode === 'center' && 'Uses the centre texel of each block for a sharper retro look.'}
        {mode === 'mosaic' && 'Builds fixed tile cells first, then fills each block with one colour.'}
      </p>

      <button
        type="button"
        className="tool primary uv-btn-block"
        disabled={!image || !previewChanged}
        onClick={pixelateActive}
      >
        {image ? 'Apply pixelate to texture' : 'Select a texture map'}
      </button>

      {showAllMapsAction && mapEntries.length > 0 && (
        <>
          <div className="pixelate-map-picker">
            <strong>Material maps</strong>
            {mapEntries.map((entry) => (
              <label key={entry.slot} className="pixelate-map-option">
                <input
                  type="checkbox"
                  checked={selectedSlots.has(entry.slot)}
                  onChange={() => toggleSlot(entry.slot)}
                />
                <span>{entry.label}</span>
                <span className="uv-meta">{entry.image.width}×{entry.image.height}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            className="tool uv-btn-block"
            disabled={selectedImages.length === 0}
            onClick={pixelateSelectedMaps}
          >
            Apply to {selectedImages.length} selected map{selectedImages.length === 1 ? '' : 's'}
          </button>
        </>
      )}

      <p className="uv-hint">
        {hint ?? (previewImage
          ? `Live preview uses ${pixelateModeLabel(mode).toLowerCase()}. Sets filtering to nearest for crisp pixels.`
          : 'Assign or create a texture map first.')}
      </p>
    </section>
  );
}

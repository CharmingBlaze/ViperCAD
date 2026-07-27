import { useEffect, useRef, useState } from 'react';
import type { ImageAsset, MaterialAsset } from '@/core/document/types';
import type { EditorSession } from '@/core/editor/EditorSession';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import {
  applyGradientToImage,
  applyGradientToMaterialBaseMap,
  DEFAULT_MATERIAL_GRADIENT,
  gradientPreviewCss,
  hexToRgbBytes,
  MATERIAL_GRADIENT_PRESETS,
  normalizeGradientSettings,
  rgbBytesToHex,
  sampleGradientHex,
  sortGradientStops,
  type GradientStop,
  type MaterialGradientSettings,
} from '@/core/image/GradientGenerator';

type Props = {
  session: EditorSession;
  workspace?: WorkspaceController;
  image?: ImageAsset | null;
  material?: MaterialAsset | null;
  mapWidth?: number;
  mapHeight?: number;
  hint?: string;
};

function readWorkspaceSettings(workspace: WorkspaceController): MaterialGradientSettings {
  return normalizeGradientSettings({
    type: workspace.texture.gradientType,
    angle: workspace.texture.gradientAngle,
    stops: workspace.texture.gradientStops,
  });
}

export function GradientToolControls(props: Props) {
  const {
    session,
    workspace,
    image,
    material,
    mapWidth = 64,
    mapHeight = 64,
    hint,
  } = props;

  const [localSettings, setLocalSettings] = useState<MaterialGradientSettings>(DEFAULT_MATERIAL_GRADIENT);
  const [selectedStop, setSelectedStop] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ index: number; pointerId: number } | null>(null);

  const activeSettings = workspace ? readWorkspaceSettings(workspace) : localSettings;
  const normalized = normalizeGradientSettings(activeSettings);
  const stops = normalized.stops;
  const safeSelected = Math.max(0, Math.min(selectedStop, stops.length - 1));
  const currentStop = stops[safeSelected]!;

  useEffect(() => {
    if (selectedStop >= stops.length) {
      setSelectedStop(Math.max(0, stops.length - 1));
    }
  }, [selectedStop, stops.length]);

  const patchSettings = (next: MaterialGradientSettings) => {
    const normalizedNext = normalizeGradientSettings(next);
    if (workspace) {
      workspace.patchTexture({
        gradientType: normalizedNext.type,
        gradientAngle: normalizedNext.angle,
        gradientStops: normalizedNext.stops,
      });
      return;
    }
    setLocalSettings(normalizedNext);
  };

  const updateStop = (index: number, patch: Partial<GradientStop>, sort = true) => {
    const nextStops = stops.map((stop, stopIndex) =>
      stopIndex === index ? { ...stop, ...patch } : stop,
    );
    patchSettings({
      ...normalized,
      stops: sort ? sortGradientStops(nextStops) : nextStops,
    });
  };

  const addStopAt = (position: number) => {
    if (stops.length >= 8) return;
    const color = sampleGradientHex(stops, position / 100);
    const nextStops = sortGradientStops([
      ...stops,
      { color, position, opacity: 100 },
    ]);
    patchSettings({ ...normalized, stops: nextStops });
    setSelectedStop(nextStops.findIndex((stop) => Math.abs(stop.position - position) < 0.01));
  };

  const removeSelectedStop = () => {
    if (stops.length <= 2) return;
    const nextStops = stops.filter((_, index) => index !== safeSelected);
    patchSettings({ ...normalized, stops: nextStops });
    setSelectedStop(Math.max(0, safeSelected - 1));
  };

  const applyGradient = () => {
    if (image) {
      applyGradientToImage(session, image, normalized, material);
      return;
    }
    if (material) {
      applyGradientToMaterialBaseMap(session, material, mapWidth, mapHeight, normalized);
    }
  };

  const beginDragStop = (index: number, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedStop(index);
    dragRef.current = { index, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onBarPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.gradient-stop-handle')) return;
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;
    const position = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
    addStopAt(position);
  };

  const onBarPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;
    const position = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
    updateStop(drag.index, { position }, false);
  };

  const endDrag = (event: React.PointerEvent) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      patchSettings({ ...normalized, stops: sortGradientStops(stops) });
      dragRef.current = null;
    }
  };

  const [red, green, blue] = hexToRgbBytes(currentStop.color);

  return (
    <section className="uv-section gradient-editor">
      <h3 className="uv-section-title">Gradient</h3>

      <div
        ref={barRef}
        className="gradient-editor-bar"
        style={{ background: gradientPreviewCss(normalized) }}
        onPointerDown={onBarPointerDown}
        onPointerMove={onBarPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {stops.map((stop, index) => (
          <button
            key={`${stop.color}-${stop.position}-${index}`}
            type="button"
            className={`gradient-stop-handle${index === safeSelected ? ' is-selected' : ''}`}
            style={{
              left: `${stop.position}%`,
              background: stop.color,
            }}
            title={`Stop ${index + 1}`}
            onPointerDown={(event) => beginDragStop(index, event)}
            onClick={(event) => {
              event.stopPropagation();
              setSelectedStop(index);
            }}
          />
        ))}
      </div>

      <div className="gradient-presets">
        {MATERIAL_GRADIENT_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="gradient-preset-btn"
            title={`Use ${preset.label} preset`}
            style={{ background: gradientPreviewCss(preset.settings) }}
            onClick={() => {
              patchSettings(preset.settings);
              setSelectedStop(0);
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <label className="uv-field">
        <span>Type</span>
        <select
          className="uv-select"
          value={normalized.type}
          onChange={(event) =>
            patchSettings({
              ...normalized,
              type: event.target.value === 'radial' ? 'radial' : 'linear',
            })
          }
        >
          <option value="linear">Linear</option>
          <option value="radial">Radial</option>
        </select>
      </label>

      {normalized.type === 'linear' && (
        <label className="uv-field">
          <span>Angle</span>
          <input
            className="uv-range"
            type="range"
            min={-180}
            max={180}
            value={normalized.angle}
            onChange={(event) =>
              patchSettings({ ...normalized, angle: Number(event.target.value) })
            }
          />
          <span className="uv-field-value">{normalized.angle}°</span>
        </label>
      )}

      <div className="gradient-stop-editor">
        <div className="gradient-stop-editor-head">
          <strong>Stop {safeSelected + 1}</strong>
          <button
            type="button"
            className="tool"
            disabled={stops.length <= 2}
            onClick={removeSelectedStop}
          >
            Remove
          </button>
        </div>

        <label className="uv-field">
          <span>Position</span>
          <input
            className="uv-text"
            type="number"
            min={0}
            max={100}
            value={Math.round(currentStop.position)}
            onChange={(event) =>
              updateStop(safeSelected, { position: Number(event.target.value) })
            }
          />
          <span className="uv-field-value">%</span>
        </label>

        <label className="uv-field">
          <span>Colour</span>
          <div className="material-color-row">
            <input
              type="color"
              value={currentStop.color}
              onChange={(event) => updateStop(safeSelected, { color: event.target.value })}
            />
            <span className="uv-meta">{currentStop.color.toUpperCase()}</span>
          </div>
        </label>

        <label className="uv-field">
          <span>Opacity</span>
          <input
            className="uv-range"
            type="range"
            min={0}
            max={100}
            value={currentStop.opacity}
            onChange={(event) =>
              updateStop(safeSelected, { opacity: Number(event.target.value) })
            }
          />
          <span className="uv-field-value">{Math.round(currentStop.opacity)}%</span>
        </label>

        <div className="gradient-rgb-sliders">
          {([
            ['R', red, 0],
            ['G', green, 1],
            ['B', blue, 2],
          ] as const).map(([label, value, channel]) => (
            <label key={label} className="gradient-rgb-row">
              <span>{label}</span>
              <input
                className="uv-range"
                type="range"
                min={0}
                max={255}
                value={value}
                onChange={(event) => {
                  const next = [red, green, blue] as [number, number, number];
                  next[channel] = Number(event.target.value);
                  updateStop(safeSelected, { color: rgbBytesToHex(next[0], next[1], next[2]) });
                }}
              />
              <input
                className="uv-text gradient-rgb-value"
                type="number"
                min={0}
                max={255}
                value={value}
                onChange={(event) => {
                  const next = [red, green, blue] as [number, number, number];
                  next[channel] = Number(event.target.value);
                  updateStop(safeSelected, { color: rgbBytesToHex(next[0], next[1], next[2]) });
                }}
              />
            </label>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="tool primary uv-btn-block"
        disabled={!image && !material}
        onClick={applyGradient}
      >
        {image ? 'Apply gradient to texture' : 'Create gradient base map'}
      </button>
      {!image && material && (
        <p className="uv-meta">
          New map size: {mapWidth}×{mapHeight}
        </p>
      )}
      <p className="uv-hint">
        {hint ?? (image || material
          ? 'Click the bar to add stops. Drag handles to move them. Edit colour, opacity, and RGB for the selected stop.'
          : 'Select a material or open a texture map first.')}
      </p>
    </section>
  );
}

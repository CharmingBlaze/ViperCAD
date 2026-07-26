import { useState } from 'react';
import type { EditorSession } from '@/core/editor/EditorSession';
import { importImageFile } from '@/core/image/ImageImport';
import { IMAGE_FILES, openNativeFile } from '@/app/platform/FileDialogs';
import type {
  CurveTipStyle,
  SimpleTextureMode,
  SimpleTextureSettings,
} from '@/core/curves/SimpleTexture';
import type { CurveStyle } from '@/core/curves/CurveOperation';
import { SimpleTextureMappingEditor } from '@/app/inspector/SimpleTextureMappingEditor';
import { useTexturePreviewUrl } from '@/app/inspector/useTexturePreviewUrl';

type Props = {
  session: EditorSession;
  settings: SimpleTextureSettings;
  activeStyle: CurveStyle;
  selectionLabel?: string;
  onChange: (settings: SimpleTextureSettings) => void;
  onStyleChange: (style: CurveStyle) => void;
  onClose: () => void;
};

const SHAPES: { style: CurveStyle; label: string; hint: string }[] = [
  { style: 'hair', label: 'Smooth ribbon', hint: 'Dense flowing hair path' },
  { style: 'hair-strip', label: 'Low-poly strip', hint: 'Crisp game-ready hair card' },
  { style: 'rounded-hair', label: 'Rounded strand', hint: 'Soft tapered tube strand' },
];

export function SimpleTextureDialog({
  session,
  settings,
  activeStyle,
  selectionLabel,
  onChange,
  onStyleChange,
  onClose,
}: Props) {
  const [note, setNote] = useState<string | null>(null);
  const patch = (next: Partial<SimpleTextureSettings>) => onChange({ ...settings, ...next });
  const imageUrl = useTexturePreviewUrl(session, settings.textureId);

  const importImage = async () => {
    try {
      const selected = await openNativeFile({ types: IMAGE_FILES });
      if (!selected) return;
      const imported = await importImageFile(session.document, selected.file);
      patch({ mode: 'image', textureId: imported.textureId });
      setNote(
        imported.scaled
          ? `Imported and fitted to ${imported.width} × ${imported.height}`
          : `Imported ${imported.width} × ${imported.height}`,
      );
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Could not import image');
    }
  };

  const modeLabel =
    settings.mode === 'color' ? 'Current color' : settings.mode === 'gradient' ? 'Gradient' : 'Image';
  const shapeLabel = selectionLabel ??
    SHAPES.find((shape) => shape.style === activeStyle)?.label ??
    activeStyle.replaceAll('-', ' ');
  const previewShape = selectionLabel?.toLowerCase().includes('lathe') ? 'lathe' : activeStyle;
  const selectedTexture = settings.textureId
    ? session.document.textures.get(settings.textureId)
    : null;
  const previewBackground =
    settings.mode === 'gradient'
      ? `linear-gradient(${settings.gradientAngle}deg, ${settings.gradientStart}, ${settings.gradientEnd})`
      : settings.mode === 'image' && imageUrl
        ? `url("${imageUrl}")`
        : `linear-gradient(${settings.color}, ${settings.color})`;
  const useThemeAccent = () => {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    patch({ mode: 'color', color: /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#ff8c28' });
  };

  return (
    <div className="app-modal-backdrop simple-texture-backdrop" onMouseDown={onClose}>
      <div
        className="app-modal app-modal-wide simple-texture-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="simple-texture-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="simple-texture-header">
          <div>
            <h2 id="simple-texture-title">Simple Texture</h2>
            <p>Shape, color, texture, and mapping for curve strokes.</p>
          </div>
          <button type="button" className="simple-texture-close" aria-label="Close Simple Texture" onClick={onClose}>
            ×
          </button>
        </header>

        <section className="simple-texture-preview-section">
          <div className="simple-texture-section-heading">
            <div><strong>Live preview</strong><span>Updates as you edit</span></div>
            <span className="simple-texture-live">● LIVE</span>
          </div>
          <div className="simple-texture-preview">
            <div className="simple-texture-grid" />
            <div
              className={`simple-texture-strand is-${settings.tipStyle} style-${previewShape}`}
              style={{
                backgroundImage: previewBackground,
                backgroundSize: `${100 / settings.repeatAcross}% ${100 / settings.repeatAlong}%`,
                backgroundPosition: `${50 + settings.offsetAcross * 25}% ${50 - settings.offsetAlong * 25}%`,
                filter: `brightness(${settings.brightness}) contrast(${1 + settings.shadowDetail * 0.3})`,
                opacity: settings.opacity,
              }}
            />
            <span className="simple-texture-preview-caption">
              {shapeLabel} · {modeLabel}
              {selectedTexture ? ` · ${selectedTexture.name}` : ''}
              {' · '}{settings.repeatAcross}× across · {settings.repeatAlong}× along
            </span>
          </div>
          <div className="simple-texture-shapes">
            {SHAPES.map((shape) => (
              <button
                key={shape.style}
                type="button"
                className={activeStyle === shape.style ? 'is-active' : ''}
                title={shape.hint}
                onClick={() => onStyleChange(shape.style)}
              >
                {shape.label}
              </button>
            ))}
          </div>
          <div className="simple-texture-tips" role="group" aria-label="Stroke tip style">
            {(['pointed', 'square'] as CurveTipStyle[]).map((tip) => (
              <button
                key={tip}
                type="button"
                className={settings.tipStyle === tip ? 'is-active' : ''}
                onClick={() => patch({ tipStyle: tip })}
              >
                {tip === 'pointed' ? 'Pointed tips' : 'Square tips'}
              </button>
            ))}
          </div>
        </section>

        <div className="simple-texture-columns">
          <section className="simple-texture-panel">
            <div className="simple-texture-section-heading">
              <div><strong>Appearance</strong><span>Color source</span></div>
            </div>
            <div className="simple-texture-mode-tabs">
              {(['color', 'gradient', 'image'] as SimpleTextureMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={settings.mode === mode ? 'is-active' : ''}
                  onClick={() => patch({ mode })}
                >
                  {mode === 'image' ? 'Image' : mode[0]!.toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>

            {settings.mode === 'color' && (
              <>
                <label className="simple-texture-color">
                  <span>Stroke color</span>
                  <input type="color" value={settings.color} onChange={(event) => patch({ color: event.target.value })} />
                  <code>{settings.color.toUpperCase()}</code>
                </label>
                <button type="button" className="tool simple-texture-theme-color" onClick={useThemeAccent}>
                  Use Viper theme accent
                </button>
              </>
            )}
            {settings.mode === 'gradient' && (
              <div className="simple-texture-gradient">
                <label><span>Start</span><input type="color" value={settings.gradientStart} onChange={(event) => patch({ gradientStart: event.target.value })} /></label>
                <label><span>End</span><input type="color" value={settings.gradientEnd} onChange={(event) => patch({ gradientEnd: event.target.value })} /></label>
                <label className="uv-field"><span>Angle</span><input className="uv-text" type="number" min={-360} max={360} value={settings.gradientAngle} onChange={(event) => patch({ gradientAngle: Number(event.target.value) })} /></label>
              </div>
            )}
            {settings.mode === 'image' && (
              <div className="simple-texture-image">
                <button type="button" className="tool primary" onClick={importImage}>Import image…</button>
                <select
                  className="uv-select"
                  aria-label="Project texture"
                  value={settings.textureId ?? ''}
                  onChange={(event) => patch({ textureId: event.target.value || null })}
                >
                  <option value="">Choose a project texture</option>
                  {[...session.document.textures.values()].map((texture) => (
                    <option key={texture.id} value={texture.id}>{texture.name}</option>
                  ))}
                </select>
                {note && <p className="simple-texture-note">{note}</p>}
              </div>
            )}

            <Slider label="Brightness" value={settings.brightness} min={0.1} max={2} step={0.05} suffix={`${settings.brightness.toFixed(2)}×`} onChange={(brightness) => patch({ brightness })} />
            <Slider label="Shadow detail" value={settings.shadowDetail} min={0} max={1} step={0.05} suffix={`${Math.round(settings.shadowDetail * 100)}%`} onChange={(shadowDetail) => patch({ shadowDetail })} />
            <Slider label="Opacity" value={settings.opacity} min={0} max={1} step={0.05} suffix={`${Math.round(settings.opacity * 100)}%`} onChange={(opacity) => patch({ opacity })} />
          </section>

          <section className="simple-texture-panel">
            <div className="simple-texture-section-heading">
              <div><strong>Texture mapping</strong><span>Curve-aware UV controls</span></div>
            </div>
            <label className="uv-field">
              <span>Edges</span>
              <select className="uv-select" value={settings.wrapping} onChange={(event) => patch({ wrapping: event.target.value as 'repeat' | 'clamp' })}>
                <option value="repeat">Repeat</option>
                <option value="clamp">Clamp to edge</option>
              </select>
            </label>
            <div className="simple-texture-repeat">
              <label className="uv-field"><span>Repeat along</span><input className="uv-text" type="number" min={0.1} max={32} step={0.5} value={settings.repeatAlong} onChange={(event) => patch({ repeatAlong: Number(event.target.value) })} /></label>
              <label className="uv-field"><span>Repeat across</span><input className="uv-text" type="number" min={0.1} max={32} step={0.5} value={settings.repeatAcross} onChange={(event) => patch({ repeatAcross: Number(event.target.value) })} /></label>
            </div>
            <SimpleTextureMappingEditor
              session={session}
              settings={settings}
              onChange={patch}
            />
            <p className="uv-hint">
              Drag the texture to position it. Use edge or corner handles to resize, and the top handle to rotate.
              Along follows the curve; across wraps around the profile.
            </p>
          </section>
        </div>

        <footer className="simple-texture-footer">
          <button type="button" className="tool" onClick={() => patch({
            mode: 'color',
            brightness: 1,
            shadowDetail: 0.4,
            opacity: 1,
            wrapping: 'repeat',
            repeatAlong: 1,
            repeatAcross: 1,
            offsetAlong: 0,
            offsetAcross: 0,
            rotation: 0,
            flipAlong: false,
            flipAcross: false,
          })}>Smart preset</button>
          <button type="button" className="tool primary" onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="simple-texture-slider">
      <span><b>{label}</b><output>{suffix}</output></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

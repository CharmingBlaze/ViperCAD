import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { EditorSession } from '@/core/editor/EditorSession';
import type { SimpleTextureSettings } from '@/core/curves/SimpleTexture';
import { useTexturePreviewUrl } from '@/app/inspector/useTexturePreviewUrl';

type Props = {
  session: EditorSession;
  settings: SimpleTextureSettings;
  onChange: (patch: Partial<SimpleTextureSettings>) => void;
};

type Handle = 'move' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw' | 'rotate';
type Drag = {
  handle: Handle;
  startX: number;
  startY: number;
  settings: SimpleTextureSettings;
};

const HANDLES: Exclude<Handle, 'move' | 'rotate'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function SimpleTextureMappingEditor({ session, settings, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const imageUrl = useTexturePreviewUrl(session, settings.textureId);

  const background =
    settings.mode === 'gradient'
      ? `linear-gradient(${settings.gradientAngle}deg, ${settings.gradientStart}, ${settings.gradientEnd})`
      : settings.mode === 'image' && imageUrl
        ? `url("${imageUrl}")`
        : `linear-gradient(${settings.color}, ${settings.color})`;
  const width = Math.max(12, Math.min(180, 118 / settings.repeatAcross));
  const height = Math.max(12, Math.min(180, 118 / settings.repeatAlong));
  const left = 50 + settings.offsetAcross * 32;
  const top = 50 - settings.offsetAlong * 32;

  const begin = (event: ReactPointerEvent, handle: Handle) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      handle,
      startX: event.clientX,
      startY: event.clientY,
      settings: { ...settings },
    };
  };

  const move = (event: ReactPointerEvent) => {
    const active = drag.current;
    const rect = host.current?.getBoundingClientRect();
    if (!active || !rect) return;
    const dx = (event.clientX - active.startX) / Math.max(1, rect.width);
    const dy = (event.clientY - active.startY) / Math.max(1, rect.height);
    if (active.handle === 'move') {
      onChange({
        offsetAcross: clamp(active.settings.offsetAcross + dx * 3, -8, 8),
        offsetAlong: clamp(active.settings.offsetAlong - dy * 3, -8, 8),
      });
      return;
    }
    if (active.handle === 'rotate') {
      const centreX = rect.left + rect.width * (0.5 + active.settings.offsetAcross * 0.32);
      const centreY = rect.top + rect.height * (0.5 - active.settings.offsetAlong * 0.32);
      const angle = Math.atan2(event.clientY - centreY, event.clientX - centreX) * 180 / Math.PI + 90;
      onChange({ rotation: normalizeAngle(angle) });
      return;
    }
    const horizontal = active.handle.includes('e')
      ? dx
      : active.handle.includes('w')
        ? -dx
        : 0;
    const vertical = active.handle.includes('s')
      ? dy
      : active.handle.includes('n')
        ? -dy
        : 0;
    const acrossSize = clamp(1 / active.settings.repeatAcross + horizontal * 2.4, 0.04, 4);
    const alongSize = clamp(1 / active.settings.repeatAlong + vertical * 2.4, 0.04, 4);
    onChange({
      ...(horizontal !== 0 ? { repeatAcross: clamp(1 / acrossSize, 0.1, 32) } : {}),
      ...(vertical !== 0 ? { repeatAlong: clamp(1 / alongSize, 0.1, 32) } : {}),
    });
  };

  const finish = () => {
    drag.current = null;
  };

  return (
    <>
      <div
        ref={host}
        className="simple-texture-map-editor"
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <div className="simple-texture-map-checker" />
        <div
          className="simple-texture-map-transform"
          style={{
            left: `${left}%`,
            top: `${top}%`,
            width,
            height,
            transform: `translate(-50%, -50%) rotate(${settings.rotation}deg)`,
          }}
          onPointerDown={(event) => begin(event, 'move')}
        >
          <div
            className="simple-texture-map-image"
            style={{
              backgroundImage: background,
              transform: `scale(${settings.flipAcross ? -1 : 1}, ${settings.flipAlong ? -1 : 1})`,
              filter: `brightness(${settings.brightness}) contrast(${1 + settings.shadowDetail * 0.3})`,
              opacity: settings.opacity,
            }}
          />
          {HANDLES.map((handle) => (
            <button
              key={handle}
              type="button"
              aria-label={`Resize texture ${handle}`}
              className={`simple-texture-map-handle is-${handle}`}
              onPointerDown={(event) => begin(event, handle)}
            />
          ))}
          <span className="simple-texture-map-rotate-line" />
          <button
            type="button"
            aria-label="Rotate texture"
            className="simple-texture-map-rotate"
            onPointerDown={(event) => begin(event, 'rotate')}
          />
        </div>
        <span className="simple-texture-map-label">UV · drag to move · edge handles resize</span>
      </div>
      <div className="simple-texture-map-toolbar">
        <button type="button" className="tool" onClick={() => onChange({ offsetAcross: 0, offsetAlong: 0 })}>Centre</button>
        <button type="button" className="tool" onClick={() => onChange({ repeatAcross: 1, repeatAlong: 1 })}>Fit 1:1</button>
        <button type="button" className={`tool${settings.flipAcross ? ' is-active' : ''}`} onClick={() => onChange({ flipAcross: !settings.flipAcross })}>Flip X</button>
        <button type="button" className={`tool${settings.flipAlong ? ' is-active' : ''}`} onClick={() => onChange({ flipAlong: !settings.flipAlong })}>Flip Y</button>
      </div>
      <div className="simple-texture-map-values">
        <label className="uv-field">
          <span>Move X</span>
          <input className="uv-text" type="number" step={0.05} value={round(settings.offsetAcross)} onChange={(event) => onChange({ offsetAcross: Number(event.target.value) })} />
        </label>
        <label className="uv-field">
          <span>Move Y</span>
          <input className="uv-text" type="number" step={0.05} value={round(settings.offsetAlong)} onChange={(event) => onChange({ offsetAlong: Number(event.target.value) })} />
        </label>
        <label className="uv-field">
          <span>Rotation</span>
          <input className="uv-text" type="number" min={-180} max={180} step={1} value={round(settings.rotation)} onChange={(event) => onChange({ rotation: Number(event.target.value) })} />
        </label>
      </div>
    </>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function normalizeAngle(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

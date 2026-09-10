import { useState, useRef, type CSSProperties } from 'react';
import type { EditorSession } from '@/core/editor/EditorSession';
import {
  getDocumentLighting,
  updateDocumentLighting,
  LIGHTING_PRESETS,
  type LevelLightingPresetId,
} from '@/core/level/LevelLighting';

type Props = {
  session: EditorSession;
  onClose: () => void;
  onRefresh: () => void;
};

type DragState = { pointerId: number; offsetX: number; offsetY: number };

export function FloatingLightingEditor({ session, onClose, onRefresh }: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [lighting, setLighting] = useState(() => getDocumentLighting(session.document));

  const applyUpdate = (updates: Partial<typeof lighting>) => {
    const updated = updateDocumentLighting(session.document, updates);
    setLighting(updated);
    session.document.dirty = true;
    session.requestRedraw();
    onRefresh();
  };

  const applyPreset = (presetId: LevelLightingPresetId) => {
    const preset = LIGHTING_PRESETS[presetId];
    if (preset) {
      applyUpdate({ ...preset.config, preset: presetId });
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select, label')) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      pointerId: e.pointerId,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.left = `${Math.max(10, Math.min(window.innerWidth - 340, e.clientX - dragRef.current.offsetX))}px`;
    panel.style.top = `${Math.max(10, Math.min(window.innerHeight - 500, e.clientY - dragRef.current.offsetY))}px`;
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragRef.current && dragRef.current.pointerId === e.pointerId) {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      dragRef.current = null;
    }
  };

  const cardStyle: CSSProperties = {
    position: 'fixed',
    top: '75px',
    right: '340px',
    width: '320px',
    maxHeight: '85vh',
    overflowY: 'auto',
    backgroundColor: '#0b1329',
    border: '1px solid #1e293b',
    borderRadius: '10px',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.4)',
    color: '#f8fafc',
    zIndex: 110,
    padding: '0.85rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.65rem',
    userSelect: 'none',
  };

  return (
    <section
      ref={panelRef}
      style={cardStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #1e293b', paddingBottom: '0.4rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <strong style={{ fontSize: '0.85rem', letterSpacing: '0.04em' }}>LEVEL LIGHTING & ATMOSPHERE</strong>
        </div>
        <button
          type="button"
          style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1rem' }}
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      {/* Lighting Presets */}
      <div>
        <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>
          LIGHTING ENVIRONMENT PRESETS
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem' }}>
          {(Object.keys(LIGHTING_PRESETS) as LevelLightingPresetId[]).map((key) => {
            const p = LIGHTING_PRESETS[key];
            const isActive = lighting.preset === key;
            return (
              <button
                key={key}
                type="button"
                className={`uv-button small${isActive ? ' primary' : ''}`}
                style={{
                  fontSize: '0.68rem',
                  padding: '0.3rem 0.4rem',
                  textAlign: 'left',
                  backgroundColor: isActive ? '#2563eb' : '#1e293b',
                  color: '#f8fafc',
                  border: `1px solid ${isActive ? '#60a5fa' : '#334155'}`,
                }}
                onClick={() => applyPreset(key)}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sun / Directional Light Settings */}
      <div className="terrain-placement-settings" style={{ padding: '0.5rem', backgroundColor: '#0f172a', borderRadius: '6px', border: '1px solid #1e293b' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#38bdf8' }}>Primary Sun Light</span>
          <label style={{ fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={lighting.sunEnabled}
              onChange={(e) => applyUpdate({ sunEnabled: e.target.checked })}
            />
            Enabled
          </label>
        </div>

        {lighting.sunEnabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>Sun Color & Intensity</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <input
                  type="color"
                  value={lighting.sunColor}
                  style={{ width: '20px', height: '20px', border: 'none', background: 'none', cursor: 'pointer' }}
                  onChange={(e) => applyUpdate({ sunColor: e.target.value })}
                />
                <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>{lighting.sunIntensity.toFixed(2)}x</span>
              </div>
            </div>

            <label className="uv-field">
              <span>Sun Intensity</span>
              <input
                className="uv-range"
                type="range"
                min={0}
                max={3}
                step={0.05}
                value={lighting.sunIntensity}
                onChange={(e) => applyUpdate({ sunIntensity: Number(e.target.value) })}
              />
            </label>

            <label className="uv-field">
              <span>Sun Azimuth Angle · {lighting.sunAzimuth}°</span>
              <input
                className="uv-range"
                type="range"
                min={0}
                max={360}
                step={5}
                value={lighting.sunAzimuth}
                onChange={(e) => applyUpdate({ sunAzimuth: Number(e.target.value) })}
              />
            </label>

            <label className="uv-field">
              <span>Sun Elevation Angle · {lighting.sunElevation}°</span>
              <input
                className="uv-range"
                type="range"
                min={5}
                max={90}
                step={2}
                value={lighting.sunElevation}
                onChange={(e) => applyUpdate({ sunElevation: Number(e.target.value) })}
              />
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.68rem', color: '#cbd5e1', cursor: 'pointer', marginTop: '0.2rem' }}>
              <input
                type="checkbox"
                checked={lighting.sunShadows}
                onChange={(e) => applyUpdate({ sunShadows: e.target.checked })}
              />
              Cast Directional Shadows
            </label>
          </div>
        )}
      </div>

      {/* Sky & Ambient Light Settings */}
      <div className="terrain-placement-settings" style={{ padding: '0.5rem', backgroundColor: '#0f172a', borderRadius: '6px', border: '1px solid #1e293b' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#818cf8', display: 'block', marginBottom: '0.35rem' }}>
          Sky & Ambient Light
        </span>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', marginBottom: '0.35rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>Sky Light</span>
            <input
              type="color"
              value={lighting.skyColor}
              style={{ width: '20px', height: '20px', border: 'none', background: 'none', cursor: 'pointer' }}
              onChange={(e) => applyUpdate({ skyColor: e.target.value })}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>Ground Light</span>
            <input
              type="color"
              value={lighting.groundColor}
              style={{ width: '20px', height: '20px', border: 'none', background: 'none', cursor: 'pointer' }}
              onChange={(e) => applyUpdate({ groundColor: e.target.value })}
            />
          </div>
        </div>

        <label className="uv-field">
          <span>Ambient Intensity · {lighting.ambientIntensity.toFixed(2)}</span>
          <input
            className="uv-range"
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={lighting.ambientIntensity}
            onChange={(e) => applyUpdate({ ambientIntensity: Number(e.target.value) })}
          />
        </label>
      </div>

      {/* Volumetric Fog Settings */}
      <div className="terrain-placement-settings" style={{ padding: '0.5rem', backgroundColor: '#0f172a', borderRadius: '6px', border: '1px solid #1e293b' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1' }}>Atmosphere & Fog</span>
          <label style={{ fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={lighting.fogEnabled}
              onChange={(e) => applyUpdate({ fogEnabled: e.target.checked })}
            />
            Enabled
          </label>
        </div>

        {lighting.fogEnabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>Fog Color</span>
              <input
                type="color"
                value={lighting.fogColor}
                style={{ width: '20px', height: '20px', border: 'none', background: 'none', cursor: 'pointer' }}
                onChange={(e) => applyUpdate({ fogColor: e.target.value })}
              />
            </div>

            <label className="uv-field">
              <span>Fog Density · {lighting.fogDensity.toFixed(3)}</span>
              <input
                className="uv-range"
                type="range"
                min={0.001}
                max={0.08}
                step={0.001}
                value={lighting.fogDensity}
                onChange={(e) => applyUpdate({ fogDensity: Number(e.target.value) })}
              />
            </label>
          </div>
        )}
      </div>

      {/* Exposure / Tone Mapping */}
      <div className="terrain-placement-settings" style={{ padding: '0.5rem', backgroundColor: '#0f172a', borderRadius: '6px', border: '1px solid #1e293b' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#facc15', display: 'block', marginBottom: '0.35rem' }}>
          Exposure & Tone Mapping
        </span>
        <label className="uv-field">
          <span>Camera Exposure · {lighting.exposure.toFixed(2)} EV</span>
          <input
            className="uv-range"
            type="range"
            min={0.3}
            max={2.5}
            step={0.05}
            value={lighting.exposure}
            onChange={(e) => applyUpdate({ exposure: Number(e.target.value) })}
          />
        </label>
      </div>

      <p className="uv-hint" style={{ fontSize: '0.65rem', margin: 0, color: '#94a3b8' }}>
        Level lighting parameters automatically save to your .viper document and sync across viewport renders.
      </p>
    </section>
  );
}

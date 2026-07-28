import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { EditorSession } from '@/core/editor/EditorSession';
import {
  DEFAULT_SKY_PARAMS,
  SKY_PRESETS,
  generateSkysphereMesh,
  renderProceduralSkyCanvas,
  type SkyPreset,
  type SkyboxParams,
} from '@/core/skybox/SkyboxGenerator';
import { commitMeshObject } from '@/core/document/ModelDocument';

export function FloatingSkyboxEditor({
  session,
  onClose,
}: {
  session: EditorSession;
  onClose: () => void;
}) {
  const [params, setParams] = useState<SkyboxParams>(DEFAULT_SKY_PARAMS);
  const [customImage, setCustomImage] = useState<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Floating Window Drag & Resize State
  const [position, setPosition] = useState({ x: 120, y: 80 });
  const [size, setSize] = useState({ width: 440, height: 580 });
  const isDraggingRef = useRef(false);
  const isResizingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, windowX: 0, windowY: 0, w: 0, h: 0 });

  // Draw procedural or custom sky canvas whenever parameters or image changes
  useEffect(() => {
    if (canvasRef.current) {
      renderProceduralSkyCanvas(canvasRef.current, params, customImage);
    }
  }, [params, customImage]);

  const handleImageFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const src = event.target?.result as string;
      if (!src) return;
      const img = new Image();
      img.onload = () => {
        setCustomImage(img);
        if (canvasRef.current) {
          renderProceduralSkyCanvas(canvasRef.current, params, img);
        }
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  // Window drag handlers
  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      windowX: position.x,
      windowY: position.y,
      w: size.width,
      h: size.height,
    };

    const handleMouseMove = (me: MouseEvent) => {
      if (isDraggingRef.current) {
        const dx = me.clientX - dragStartRef.current.x;
        const dy = me.clientY - dragStartRef.current.y;
        setPosition({
          x: Math.max(10, dragStartRef.current.windowX + dx),
          y: Math.max(10, dragStartRef.current.windowY + dy),
        });
      } else if (isResizingRef.current) {
        const dx = me.clientX - dragStartRef.current.x;
        const dy = me.clientY - dragStartRef.current.y;
        setSize({
          width: Math.max(340, dragStartRef.current.w + dx),
          height: Math.max(400, dragStartRef.current.h + dy),
        });
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      isResizingRef.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    isResizingRef.current = true;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      windowX: position.x,
      windowY: position.y,
      w: size.width,
      h: size.height,
    };

    const handleMouseMove = (me: MouseEvent) => {
      if (isResizingRef.current) {
        const dx = me.clientX - dragStartRef.current.x;
        const dy = me.clientY - dragStartRef.current.y;
        setSize({
          width: Math.max(340, dragStartRef.current.w + dx),
          height: Math.max(400, dragStartRef.current.h + dy),
        });
      }
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const applyPreset = (presetName: SkyPreset) => {
    const p = SKY_PRESETS[presetName];
    setParams((prev) => ({
      ...prev,
      ...p,
      preset: presetName,
    }));
  };

  const applySkyboxToScene = () => {
    const skysphere = generateSkysphereMesh(600, 24);
    commitMeshObject(session.document, skysphere, { name: `Skysphere (${params.preset})` });
    session.document.dirty = true;
    session.requestRedraw();
  };

  const containerStyle: CSSProperties = {
    position: 'fixed',
    left: `${position.x}px`,
    top: `${position.y}px`,
    width: `${size.width}px`,
    height: `${size.height}px`,
    zIndex: 9999,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#181a20',
    color: '#e0e6ed',
    borderRadius: '8px',
    border: '1px solid #323846',
    boxShadow: '0 12px 32px rgba(0,0,0,0.65)',
    userSelect: 'none',
    overflow: 'hidden',
  };

  return (
    <div style={containerStyle}>
      {/* Header bar (Draggable) */}
      <div
        onMouseDown={handleHeaderMouseDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.5rem 0.75rem',
          backgroundColor: '#222630',
          borderBottom: '1px solid #323846',
          cursor: 'grab',
          fontWeight: 600,
          fontSize: '0.85rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>SKYBOX & SKYSPHERE MAKER</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#a0aec0',
            cursor: 'pointer',
            fontSize: '0.8rem',
            fontWeight: 600,
          }}
          title="Close Panel"
        >
          Close
        </button>
      </div>

      {/* Content Body */}
      <div style={{ flex: 1, padding: '0.75rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {/* Live Sky Preview Canvas */}
        <div style={{ width: '100%', height: '110px', borderRadius: '6px', overflow: 'hidden', border: '1px solid #323846', backgroundColor: '#000' }}>
          <canvas ref={canvasRef} width={400} height={110} style={{ width: '100%', height: '100%', display: 'block' }} />
        </div>

        {/* Preset Selector */}
        <div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600, marginBottom: '0.3rem' }}>ATMOSPHERIC PRESETS</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.3rem' }}>
            <button
              type="button"
              className={`tool ${params.preset === 'sunny' ? 'primary' : ''}`}
              onClick={() => applyPreset('sunny')}
              title="Sunny Day"
            >
              Day
            </button>
            <button
              type="button"
              className={`tool ${params.preset === 'sunset' ? 'primary' : ''}`}
              onClick={() => applyPreset('sunset')}
              title="Golden Sunset"
            >
              Sunset
            </button>
            <button
              type="button"
              className={`tool ${params.preset === 'night' ? 'primary' : ''}`}
              onClick={() => applyPreset('night')}
              title="Starry Night"
            >
              Night
            </button>
            <button
              type="button"
              className={`tool ${params.preset === 'overcast' ? 'primary' : ''}`}
              onClick={() => applyPreset('overcast')}
              title="Overcast Stormy"
            >
              Storm
            </button>
            <button
              type="button"
              className={`tool ${params.preset === 'scifi' ? 'primary' : ''}`}
              onClick={() => applyPreset('scifi')}
              title="Sci-Fi Nebula"
            >
              Sci-Fi
            </button>
          </div>
        </div>

        {/* Atmosphere & Colors */}
        <div className="terrain-placement-settings" style={{ margin: 0 }}>
          <div className="simple-texture-card-heading">
            <strong>SUN & ATMOSPHERE LIGHTING</strong>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <label className="uv-field">
              <span>Sun Azimuth · {Math.round(params.sunAzimuth)}°</span>
              <input
                className="uv-range"
                type="range"
                min={0}
                max={360}
                value={params.sunAzimuth}
                onChange={(e) => setParams((p) => ({ ...p, sunAzimuth: Number(e.target.value) }))}
              />
            </label>
            <label className="uv-field">
              <span>Sun Elevation · {Math.round(params.sunElevation)}°</span>
              <input
                className="uv-range"
                type="range"
                min={-30}
                max={90}
                value={params.sunElevation}
                onChange={(e) => setParams((p) => ({ ...p, sunElevation: Number(e.target.value) }))}
              />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.4rem', marginTop: '0.4rem' }}>
            <label className="uv-field">
              <span>Zenith Color</span>
              <input
                type="color"
                value={params.zenithColor}
                onChange={(e) => setParams((p) => ({ ...p, zenithColor: e.target.value }))}
                style={{ width: '100%', height: '24px', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
              />
            </label>
            <label className="uv-field">
              <span>Horizon Color</span>
              <input
                type="color"
                value={params.horizonColor}
                onChange={(e) => setParams((p) => ({ ...p, horizonColor: e.target.value }))}
                style={{ width: '100%', height: '24px', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
              />
            </label>
            <label className="uv-field">
              <span>Ground Color</span>
              <input
                type="color"
                value={params.groundColor}
                onChange={(e) => setParams((p) => ({ ...p, groundColor: e.target.value }))}
                style={{ width: '100%', height: '24px', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
              />
            </label>
          </div>
        </div>

        {/* Clouds & Stars */}
        <div className="terrain-placement-settings" style={{ margin: 0 }}>
          <div className="simple-texture-card-heading">
            <strong>CLOUDS & STARS</strong>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <label className="uv-field">
              <span>Clouds · {(params.cloudDensity * 100).toFixed(0)}%</span>
              <input
                className="uv-range"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={params.cloudDensity}
                onChange={(e) => setParams((p) => ({ ...p, cloudDensity: Number(e.target.value) }))}
              />
            </label>
            <label className="uv-field">
              <span>Stars · {(params.starIntensity * 100).toFixed(0)}%</span>
              <input
                className="uv-range"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={params.starIntensity}
                onChange={(e) => setParams((p) => ({ ...p, starIntensity: Number(e.target.value) }))}
              />
            </label>
          </div>
        </div>

        {/* Custom Image Import Section */}
        <div className="terrain-placement-settings" style={{ margin: 0 }}>
          <div className="simple-texture-card-heading">
            <strong>CUSTOM SKY IMAGE TEXTURE</strong>
          </div>
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleImageFileSelect}
          />
          <div style={{ display: 'grid', gridTemplateColumns: customImage ? '1fr 1fr' : '1fr', gap: '0.4rem' }}>
            <button
              type="button"
              className="tool"
              style={{ fontWeight: 600 }}
              onClick={() => fileInputRef.current?.click()}
            >
              Import 360 Sky Image...
            </button>
            {customImage && (
              <button
                type="button"
                className="tool"
                onClick={() => {
                  setCustomImage(null);
                  if (canvasRef.current) {
                    renderProceduralSkyCanvas(canvasRef.current, params);
                  }
                }}
              >
                Reset to Procedural
              </button>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <button
            type="button"
            className="tool primary"
            style={{ fontWeight: 600, padding: '0.5rem' }}
            onClick={applySkyboxToScene}
          >
            Generate & Apply Skysphere to Viewport
          </button>
        </div>
      </div>

      {/* Resize Handle at bottom right */}
      <div
        onMouseDown={handleResizeMouseDown}
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: '14px',
          height: '14px',
          cursor: 'nwse-resize',
          backgroundImage: 'linear-gradient(135deg, transparent 50%, #64748b 50%)',
        }}
        title="Resize Window"
      />
    </div>
  );
}

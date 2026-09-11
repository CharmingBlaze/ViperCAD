import { useState } from 'react';
import { FloatingPanel } from '@/app/FloatingPanel';
import { BlenderIcon } from '@/components/BlenderIcon';

export type FloatingUvToolsPanelProps = {
  hasSelection: boolean;
  selectedFaceCount: number;
  hasClipboard: boolean;
  clipboardCount: number;
  onFlipHorizontal: () => void;
  onFlipVertical: () => void;
  onRotateDegrees: (degrees: number) => void;
  onCopyUvs: () => void;
  onPasteUvs: () => void;
  onPasteAndFlipH: () => void;
  onPasteAndFlipV: () => void;
  onMirrorToOppositeSide: () => void;
  onAlign?: (mode: 'left' | 'center-u' | 'right' | 'top' | 'center-v' | 'bottom') => void;
  onPixelSnap?: () => void;
  onClose: () => void;
};

export function FloatingUvToolsPanel({
  hasSelection,
  selectedFaceCount,
  hasClipboard,
  clipboardCount,
  onFlipHorizontal,
  onFlipVertical,
  onRotateDegrees,
  onCopyUvs,
  onPasteUvs,
  onPasteAndFlipH,
  onPasteAndFlipV,
  onMirrorToOppositeSide,
  onAlign,
  onPixelSnap,
  onClose,
}: FloatingUvToolsPanelProps) {
  const [customAngle, setCustomAngle] = useState(45);

  return (
    <FloatingPanel
      title={selectedFaceCount > 0 ? `UV Quick Tools (${selectedFaceCount} faces)` : 'UV Quick Tools'}
      storageKey="vipercad.uv_quick_tools_pos"
      defaultPosition={{ x: 380, y: 110 }}
      defaultSize={{ width: 280 }}
      onClose={onClose}
    >
      <div className="uv-floating-tools-content" style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
        {/* Flip & Orient Section */}
        <div className="uv-quick-section">
          <div className="uv-quick-section-title" style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted, #888)', marginBottom: '0.35rem' }}>
            Flip & Orient
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem' }}>
            <button
              type="button"
              className="tool primary"
              disabled={!hasSelection}
              onClick={onFlipHorizontal}
              title="Flip selection horizontally across U axis (Shift+H)"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 500 }}
            >
              <BlenderIcon name="arrow_leftright" size={14} />
              Flip H
            </button>
            <button
              type="button"
              className="tool primary"
              disabled={!hasSelection}
              onClick={onFlipVertical}
              title="Flip selection vertically across V axis (Shift+V)"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 500 }}
            >
              <span style={{ display: 'inline-flex', transform: 'rotate(90deg)' }}>
                <BlenderIcon name="arrow_leftright" size={14} />
              </span>
              Flip V
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.25rem', marginTop: '0.35rem' }}>
            <button
              type="button"
              className="tool"
              disabled={!hasSelection}
              onClick={() => onRotateDegrees(-90)}
              title="Rotate -90° counter-clockwise"
            >
              −90°
            </button>
            <button
              type="button"
              className="tool"
              disabled={!hasSelection}
              onClick={() => onRotateDegrees(90)}
              title="Rotate +90° clockwise"
            >
              +90°
            </button>
            <button
              type="button"
              className="tool"
              disabled={!hasSelection}
              onClick={() => onRotateDegrees(180)}
              title="Rotate 180° upside-down"
            >
              180°
            </button>
            <button
              type="button"
              className="tool"
              disabled={!hasSelection}
              onClick={() => onRotateDegrees(customAngle)}
              title={`Rotate ${customAngle}°`}
            >
              +{customAngle}°
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.35rem' }}>
            <input
              type="number"
              className="uv-text"
              value={customAngle}
              onChange={(e) => setCustomAngle(Number(e.target.value) || 0)}
              style={{ width: '65px', padding: '2px 6px', fontSize: '0.8rem' }}
              aria-label="Custom rotation angle in degrees"
            />
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted, #888)' }}>deg</span>
            <button
              type="button"
              className="tool"
              disabled={!hasSelection}
              onClick={() => onRotateDegrees(customAngle)}
              style={{ flex: 1 }}
            >
              Rotate
            </button>
          </div>
        </div>

        {/* Cross-Side UV Copy & Mirror Section */}
        <div className="uv-quick-section" style={{ borderTop: '1px solid var(--border-subtle, #333)', paddingTop: '0.5rem' }}>
          <div className="uv-quick-section-title" style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted, #888)', marginBottom: '0.35rem' }}>
            Cross-Side UV Transfer
          </div>
          <button
            type="button"
            className="tool"
            disabled={!hasSelection}
            onClick={onCopyUvs}
            title="Copy UV layout of selected faces to clipboard (Ctrl+Shift+C)"
            style={{ width: '100%', marginBottom: '0.35rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <BlenderIcon name="duplicate" size={13} />
            {hasClipboard ? `Copy UVs (${clipboardCount} face${clipboardCount === 1 ? '' : 's'} in clipboard)` : 'Copy Selected UVs'}
          </button>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem', marginBottom: '0.35rem' }}>
            <button
              type="button"
              className="tool"
              disabled={!hasClipboard || !hasSelection}
              onClick={onPasteAndFlipH}
              title="Paste copied UVs onto selected faces flipped horizontally (U axis)"
              style={{ fontWeight: 500 }}
            >
              Paste & Flip H
            </button>
            <button
              type="button"
              className="tool"
              disabled={!hasClipboard || !hasSelection}
              onClick={onPasteAndFlipV}
              title="Paste copied UVs onto selected faces flipped vertically (V axis)"
            >
              Paste & Flip V
            </button>
          </div>

          <button
            type="button"
            className="tool"
            disabled={!hasClipboard || !hasSelection}
            onClick={onPasteUvs}
            title="Paste copied UVs directly without flipping (Ctrl+Shift+V)"
            style={{ width: '100%', marginBottom: '0.35rem' }}
          >
            Paste In-Place
          </button>

          <button
            type="button"
            className="tool"
            disabled={!hasSelection}
            onClick={onMirrorToOppositeSide}
            title="Automatically finds symmetrical faces across the center X plane (like the opposite car door or wing) and mirrors UVs to them"
            style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: '0.8rem' }}
          >
            <BlenderIcon name="mod_mirror" size={14} />
            Mirror UVs to Opposite Side (±X)
          </button>
        </div>

        {/* Alignment & Texel Snap Section */}
        {onAlign && (
          <div className="uv-quick-section" style={{ borderTop: '1px solid var(--border-subtle, #333)', paddingTop: '0.5rem' }}>
            <div className="uv-quick-section-title" style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted, #888)', marginBottom: '0.35rem' }}>
              Align
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.25rem', marginBottom: '0.25rem' }}>
              <button type="button" className="tool" disabled={!hasSelection} onClick={() => onAlign('left')} title="Align to Left (U=0)">Left</button>
              <button type="button" className="tool" disabled={!hasSelection} onClick={() => onAlign('center-u')} title="Align Center U">Center U</button>
              <button type="button" className="tool" disabled={!hasSelection} onClick={() => onAlign('right')} title="Align to Right (U=1)">Right</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.25rem', marginBottom: '0.35rem' }}>
              <button type="button" className="tool" disabled={!hasSelection} onClick={() => onAlign('bottom')} title="Align to Bottom (V=0)">Bottom</button>
              <button type="button" className="tool" disabled={!hasSelection} onClick={() => onAlign('center-v')} title="Align Center V">Center V</button>
              <button type="button" className="tool" disabled={!hasSelection} onClick={() => onAlign('top')} title="Align to Top (V=1)">Top</button>
            </div>
            {onPixelSnap && (
              <button
                type="button"
                className="tool"
                disabled={!hasSelection}
                onClick={onPixelSnap}
                title="Snap selected UV points to nearest pixel texel"
                style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <BlenderIcon name="snap_increment" size={13} />
                Snap to Pixels
              </button>
            )}
          </div>
        )}
      </div>
    </FloatingPanel>
  );
}

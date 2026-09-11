import { useEffect, useState } from 'react';
import { BlenderIcon } from '@/components/BlenderIcon';
import {
  applyWorkspaceTheme,
  DEFAULT_WORKSPACE_THEME,
  THEME_CATEGORIES,
  WORKSPACE_THEMES,
  type WorkspaceThemeId,
} from '@/app/theme/themeTokens';
import {
  formatSensitivity,
  getAppPreferences,
  patchAppPreferences,
  resetAppPreferences,
  SENSITIVITY_MAX,
  SENSITIVITY_MIN,
  subscribeAppPreferences,
  type AppPreferences,
  type RenderQualityId,
} from '@/app/preferences/appPreferences';

type SectionId = 'appearance' | 'navigation' | 'display' | 'recovery';

const SECTIONS: ReadonlyArray<{ id: SectionId; label: string; icon: 'color' | 'view3d' | 'image' | 'recover_last' }> = [
  { id: 'appearance', label: 'Appearance', icon: 'color' },
  { id: 'navigation', label: 'Navigation', icon: 'view3d' },
  { id: 'display', label: 'Display', icon: 'image' },
  { id: 'recovery', label: 'Recovery', icon: 'recover_last' },
];

const QUALITY_OPTIONS: ReadonlyArray<{ id: RenderQualityId; label: string; hint: string }> = [
  { id: 'performance', label: 'Performance', hint: 'Lower pixel density for slower machines' },
  { id: 'balanced', label: 'Balanced', hint: 'Default viewport sharpness' },
  { id: 'high', label: 'High', hint: 'Sharper viewport on high-DPI displays' },
];

type Props = {
  themeId: WorkspaceThemeId;
  onThemeId: (id: WorkspaceThemeId) => void;
  promptRecoveryOnStartup: boolean;
  onTogglePromptRecovery: (value: boolean) => void;
  displayTextures: boolean;
  onToggleDisplayTextures: (value: boolean) => void;
  drawOnSurfaces: boolean;
  onToggleDrawOnSurfaces: (value: boolean) => void;
  onOpenRecovery: () => void;
  onClose: () => void;
};

export function AppPropertiesDialog({
  themeId,
  onThemeId,
  promptRecoveryOnStartup,
  onTogglePromptRecovery,
  displayTextures,
  onToggleDisplayTextures,
  drawOnSurfaces,
  onToggleDrawOnSurfaces,
  onOpenRecovery,
  onClose,
}: Props) {
  const [section, setSection] = useState<SectionId>('appearance');
  const [prefs, setPrefs] = useState<AppPreferences>(() => getAppPreferences());

  useEffect(() => subscribeAppPreferences(setPrefs), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const patch = (partial: Partial<AppPreferences>) => {
    setPrefs(patchAppPreferences(partial));
  };

  const resetDefaults = () => {
    onThemeId(applyWorkspaceTheme(DEFAULT_WORKSPACE_THEME));
    setPrefs(resetAppPreferences());
  };

  return (
    <div
      className="app-modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="app-modal properties-modal" role="dialog" aria-labelledby="properties-title">
        <div className="app-modal-header">
          <div className="properties-title-row">
            <BlenderIcon name="properties" size={17} />
            <h2 id="properties-title">Properties</h2>
          </div>
          <button
            type="button"
            className="tool recovery-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
            title="Close"
          >
            <BlenderIcon name="panel_close" size={12} />
          </button>
        </div>

        <div className="properties-layout">
          <nav className="properties-nav" aria-label="Properties sections">
            {SECTIONS.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`properties-nav-item${section === item.id ? ' is-active' : ''}`}
                aria-current={section === item.id ? 'page' : undefined}
                onClick={() => setSection(item.id)}
              >
                <BlenderIcon name={item.icon} size={14} />
                {item.label}
              </button>
            ))}
          </nav>

          <div className="properties-body">
            {section === 'appearance' && (
              <section className="properties-section">
                <h3>Workspace theme</h3>
                <p>Colour of menus, inspectors, the 3D viewport, grid, and gizmos.</p>
                {THEME_CATEGORIES.map((category) => (
                  <div key={category.id} className="properties-theme-group">
                    <h4>{category.label}</h4>
                    <div className="properties-theme-grid">
                      {WORKSPACE_THEMES.filter((theme) => theme.category === category.id).map((theme) => (
                        <button
                          type="button"
                          key={theme.id}
                          className={`properties-theme-card${themeId === theme.id ? ' is-selected' : ''}`}
                          aria-pressed={themeId === theme.id}
                          onClick={() => onThemeId(applyWorkspaceTheme(theme.id))}
                        >
                          <span className="properties-theme-preview" aria-hidden>
                            <i className="properties-theme-swatch is-bg" style={{ background: theme.palette.bg }} />
                            <i className="properties-theme-swatch is-panel" style={{ background: theme.palette.horizon }} />
                            <i className="properties-theme-swatch is-accent" style={{ background: theme.palette.accent }} />
                          </span>
                          <span>{theme.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            )}

            {section === 'navigation' && (
              <section className="properties-section">
                <h3>Camera speed</h3>
                <p>Slower values track the pointer more closely. These apply to orbit, zoom, and pan in every 3D view.</p>
                <SensitivitySlider
                  label="Orbit"
                  value={prefs.orbitSensitivity}
                  onChange={(orbitSensitivity) => patch({ orbitSensitivity })}
                />
                <SensitivitySlider
                  label="Zoom"
                  value={prefs.zoomSensitivity}
                  onChange={(zoomSensitivity) => patch({ zoomSensitivity })}
                />
                <SensitivitySlider
                  label="Mouse wheel zoom"
                  value={prefs.wheelZoomSensitivity}
                  onChange={(wheelZoomSensitivity) => patch({ wheelZoomSensitivity })}
                />
                <SensitivitySlider
                  label="Pan"
                  value={prefs.panSensitivity}
                  onChange={(panSensitivity) => patch({ panSensitivity })}
                />
                <label className="recovery-toggle-label">
                  <input
                    type="checkbox"
                    checked={prefs.invertOrbitY}
                    onChange={(event) => patch({ invertOrbitY: event.target.checked })}
                  />
                  <span className="recovery-toggle-title">Invert orbit up / down</span>
                </label>
                <label className="recovery-toggle-label">
                  <input
                    type="checkbox"
                    checked={prefs.invertZoom}
                    onChange={(event) => patch({ invertZoom: event.target.checked })}
                  />
                  <span className="recovery-toggle-title">Invert zoom</span>
                </label>
              </section>
            )}

            {section === 'display' && (
              <section className="properties-section">
                <h3>Viewport quality</h3>
                <p>Pixel density of the 3D view. Lower is smoother on heavy scenes.</p>
                <div className="properties-choice-row" role="radiogroup" aria-label="Viewport quality">
                  {QUALITY_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      className={`properties-choice${prefs.renderQuality === option.id ? ' is-selected' : ''}`}
                      aria-pressed={prefs.renderQuality === option.id}
                      title={option.hint}
                      onClick={() => patch({ renderQuality: option.id })}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <h3>Shading</h3>
                <label className="recovery-toggle-label">
                  <input
                    type="checkbox"
                    checked={displayTextures}
                    onChange={(event) => onToggleDisplayTextures(event.target.checked)}
                  />
                  <span className="recovery-toggle-title">Display textures</span>
                </label>
                <p className="recovery-toggle-desc">Show material maps in the modelling view.</p>
                <label className="recovery-toggle-label">
                  <input
                    type="checkbox"
                    checked={drawOnSurfaces}
                    onChange={(event) => onToggleDrawOnSurfaces(event.target.checked)}
                  />
                  <span className="recovery-toggle-title">Draw on surfaces</span>
                </label>
                <p className="recovery-toggle-desc">Click-drag create tools sit on the hit mesh or terrain.</p>
              </section>
            )}

            {section === 'recovery' && (
              <section className="properties-section">
                <h3>Autosave</h3>
                <label className="recovery-toggle-label">
                  <input
                    type="checkbox"
                    checked={promptRecoveryOnStartup}
                    onChange={(event) => onTogglePromptRecovery(event.target.checked)}
                  />
                  <span className="recovery-toggle-title">Prompt for recovery on startup</span>
                </label>
                <p className="recovery-toggle-desc">
                  When enabled, ViperCAD offers to restore autosaved sessions after a crash.
                </p>
                <div className="properties-inline-actions">
                  <button type="button" className="tool" onClick={onOpenRecovery}>
                    Open recovery history
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>

        <div className="app-modal-actions">
          <button type="button" className="tool" onClick={resetDefaults}>
            Reset to defaults
          </button>
          <button type="button" className="tool primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function SensitivitySlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="properties-slider">
      <span className="properties-slider-meta">
        <span>{label}</span>
        <span>{formatSensitivity(value)}</span>
      </span>
      <input
        type="range"
        min={SENSITIVITY_MIN}
        max={SENSITIVITY_MAX}
        step={0.05}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

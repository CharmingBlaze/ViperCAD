import {
  createDefaultLayoutState,
  DEFAULT_SPLITS,
  normalizeShadingMode,
  type CameraSnapshot,
  type ViewId,
  type ViewportLayoutState,
  type WorkspacePreferences,
} from './types';

const STORAGE_KEY = 'vipercad.workspace.v1';

const DEFAULT_CAMERAS: Record<ViewId, CameraSnapshot> = {
  persp: {
    // Blender-style three-quarter user view (mapped to Viper's Y-up world).
    position: [7, 5, 7],
    target: [0, 0, 0],
    up: [0, 1, 0],
    fov: 50,
    orthoHeight: 8,
    zoom: 1,
  },
  top: {
    position: [0, 12, 0],
    target: [0, 0, 0],
    up: [0, 0, -1],
    fov: 45,
    orthoHeight: 8,
    zoom: 1,
  },
  front: {
    position: [0, 0, 12],
    target: [0, 0, 0],
    up: [0, 1, 0],
    fov: 45,
    orthoHeight: 8,
    zoom: 1,
  },
  right: {
    position: [12, 0, 0],
    target: [0, 0, 0],
    up: [0, 1, 0],
    fov: 45,
    orthoHeight: 8,
    zoom: 1,
  },
};

export function defaultPreferences(): WorkspacePreferences {
  const layout = createDefaultLayoutState();
  return {
    version: 2,
    layout,
    viewportNavToolsVisible: true,
    viewports: {
      persp: {
        camera: { ...DEFAULT_CAMERAS.persp, position: [...DEFAULT_CAMERAS.persp.position] as [number, number, number], target: [0, 0, 0], up: [0, 1, 0] },
        shadingMode: 'material',
        gridVisible: true,
        xRay: false,
      },
      top: {
        camera: { ...DEFAULT_CAMERAS.top, position: [...DEFAULT_CAMERAS.top.position] as [number, number, number], target: [0, 0, 0], up: [0, 0, -1] },
        shadingMode: 'material',
        gridVisible: true,
        xRay: false,
      },
      front: {
        camera: { ...DEFAULT_CAMERAS.front, position: [...DEFAULT_CAMERAS.front.position] as [number, number, number], target: [0, 0, 0], up: [0, 1, 0] },
        shadingMode: 'material',
        gridVisible: true,
        xRay: false,
      },
      right: {
        camera: { ...DEFAULT_CAMERAS.right, position: [...DEFAULT_CAMERAS.right.position] as [number, number, number], target: [0, 0, 0], up: [0, 1, 0] },
        shadingMode: 'material',
        gridVisible: true,
        xRay: false,
      },
    },
  };
}

export function loadWorkspacePreferences(): WorkspacePreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPreferences();
    const parsed = JSON.parse(raw) as Omit<WorkspacePreferences, 'version'> & { version?: number };
    if ((parsed.version !== 1 && parsed.version !== 2) || !parsed.layout?.splits) {
      return defaultPreferences();
    }

    const base = defaultPreferences();
    return {
      version: 2,
      layout: {
        ...createDefaultLayoutState(),
        ...parsed.layout,
        splits: {
          horizontal: parsed.layout.splits.horizontal ?? DEFAULT_SPLITS.horizontal,
          upperVertical: parsed.layout.splits.upperVertical ?? DEFAULT_SPLITS.upperVertical,
          lowerVertical: parsed.layout.splits.lowerVertical ?? DEFAULT_SPLITS.lowerVertical,
        },
        hoveredViewportId: null,
        // Restore as quad; maximized on load is confusing across window sizes.
        mode: 'quad',
        maximizedViewportId: null,
      },
      viewportNavToolsVisible: parsed.viewportNavToolsVisible ?? true,
      viewports: {
        persp: {
          ...base.viewports.persp,
          ...parsed.viewports?.persp,
          camera: startupCamera('persp'),
          shadingMode: normalizeShadingMode(parsed.viewports?.persp?.shadingMode),
        },
        top: {
          ...base.viewports.top,
          ...parsed.viewports?.top,
          camera: startupCamera('top'),
          shadingMode: normalizeShadingMode(parsed.viewports?.top?.shadingMode),
        },
        front: {
          ...base.viewports.front,
          ...parsed.viewports?.front,
          camera: startupCamera('front'),
          shadingMode: normalizeShadingMode(parsed.viewports?.front?.shadingMode),
        },
        right: {
          ...base.viewports.right,
          ...parsed.viewports?.right,
          camera: startupCamera('right'),
          shadingMode: normalizeShadingMode(parsed.viewports?.right?.shadingMode),
        },
      },
    };
  } catch {
    return defaultPreferences();
  }
}

/** Fresh camera snapshot used on every application launch. */
export function startupCamera(viewId: ViewId): CameraSnapshot {
  const fallback = DEFAULT_CAMERAS[viewId];
  return {
    ...fallback,
    position: [...fallback.position],
    target: [...fallback.target],
    up: [...fallback.up],
  };
}

export function saveWorkspacePreferences(prefs: WorkspacePreferences): void {
  try {
    const toSave: WorkspacePreferences = {
      ...prefs,
      layout: {
        ...prefs.layout,
        mode: 'quad',
        maximizedViewportId: null,
        hoveredViewportId: null,
      } satisfies ViewportLayoutState,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    // Ignore quota / private mode.
  }
}

export { DEFAULT_CAMERAS };

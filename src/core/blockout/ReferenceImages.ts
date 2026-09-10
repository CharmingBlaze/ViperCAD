export type ReferenceImageView = 'front' | 'side' | 'persp';

export type ReferenceImageConfig = {
  id: string;
  name: string;
  url: string;
  view: ReferenceImageView;
  visible: boolean;
  opacity: number;
  posX: number;
  posY: number;
  posZ: number;
  scale: number;
  aspectRatio: number;
  flipX: boolean;
  flipY: boolean;
  locked: boolean;
  /** Scene object that carries this blueprint (gizmos, outliner, lock). */
  objectId?: string;
};

export type BlockoutReferenceState = {
  front: ReferenceImageConfig | null;
  side: ReferenceImageConfig | null;
  showInPersp: boolean;
  revision: number;
};

export function createDefaultReferenceImage(
  url: string,
  view: 'front' | 'side',
  name = 'Reference Image',
  aspectRatio = 1.0,
): ReferenceImageConfig {
  return {
    id: `ref-${view}-${Date.now()}`,
    name,
    url,
    view,
    visible: true,
    opacity: 0.65,
    posX: 0,
    posY: 1.0, // Center at 1 unit height by default
    posZ: 0,
    scale: 2.0, // 2 units tall (standard reference human/prop scale)
    aspectRatio: Math.max(0.01, aspectRatio),
    flipX: false,
    flipY: false,
    locked: false,
  };
}

/** Which blueprint planes to draw for a viewport. */
export function referencePlanesForPane(
  paneId: 'top' | 'front' | 'right' | 'persp' | string | null,
  state: BlockoutReferenceState,
): { front: boolean; side: boolean } {
  const front = Boolean(state.front?.visible && state.front.url);
  const side = Boolean(state.side?.visible && state.side.url);
  if (paneId === 'front') return { front, side: false };
  if (paneId === 'right') return { front: false, side };
  if (paneId === 'persp') return { front: state.showInPersp && front, side: state.showInPersp && side };
  return { front: false, side: false };
}

export function createEmptyBlockoutReferenceState(): BlockoutReferenceState {
  return {
    front: null,
    side: null,
    showInPersp: true,
    revision: 0,
  };
}

/** Compute plane dimensions: width = scale * aspectRatio, height = scale */
export function getReferenceImageDimensions(config: ReferenceImageConfig): { width: number; height: number } {
  const height = Math.max(0.001, config.scale);
  const width = Math.max(0.001, height * config.aspectRatio);
  return { width, height };
}

/**
 * Calibrate reference image scale using two points clicked on the blueprint and a real-world distance in meters.
 */
export function calibrateReferenceScale(
  currentScale: number,
  measuredDistance: number,
  targetRealWorldDistance: number,
): number {
  if (measuredDistance <= 0.0001 || targetRealWorldDistance <= 0.0001) {
    return currentScale;
  }
  const ratio = targetRealWorldDistance / measuredDistance;
  return Math.max(0.01, Math.min(100.0, currentScale * ratio));
}

/**
 * Align reference image so that its bottom edge sits directly at Y = 0 (ground level).
 */
export function snapReferenceToGround(config: ReferenceImageConfig): void {
  const height = Math.max(0.001, config.scale);
  config.posY = height / 2;
}

/**
 * Center reference image horizontally on X = 0 (for Front view) or Z = 0 (for Side view).
 */
export function centerReferenceHorizontally(config: ReferenceImageConfig): void {
  if (config.view === 'front') {
    config.posX = 0;
  } else if (config.view === 'side') {
    config.posZ = 0;
  }
}

import type { ViewId } from '@/workspace/types';

export const NAV_DRAG_THRESHOLD_PX = 5;

export type NavGestureKind = 'orbit' | 'pan' | 'zoom';
export type PointerButtonKind = 'primary' | 'secondary' | 'middle' | 'other';

export type NavMoveResult =
  | { phase: 'pending' }
  | { phase: 'nav'; kind: NavGestureKind; dx: number; dy: number; paneId: ViewId };

export type NavEndResult =
  | { phase: 'click'; button: 'primary' | 'secondary'; paneId: ViewId }
  | { phase: 'ended'; kind: NavGestureKind; paneId: ViewId };

type ActiveGesture = {
  pointerId: number;
  paneId: ViewId;
  button: PointerButtonKind;
  kind: 'pending-primary' | 'pending-secondary' | NavGestureKind;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  isPerspective: boolean;
};

export function classifyPointerButton(button: number): PointerButtonKind {
  if (button === 0) return 'primary';
  if (button === 1) return 'middle';
  // Right mouse, pen barrel, and some eraser mappings.
  if (button === 2 || button === 5) return 'secondary';
  return 'other';
}

/**
 * Returns true if a pointer event comes from a stylus pen with its barrel/secondary button pressed.
 * Detects button 2, button 5, buttons bit 1 (secondary), and buttons bit 5 (W3C pen barrel button).
 */
export function isStylusButtonEvent(e: {
  pointerType?: string;
  button?: number;
  buttons?: number;
}): boolean {
  if (e.pointerType !== 'pen') return false;
  const btn = e.button ?? -1;
  const btns = e.buttons ?? 0;
  return btn === 2 || btn === 5 || (btns & 2) !== 0 || (btns & 32) !== 0;
}

export function primaryNavKind(isPerspective: boolean): NavGestureKind {
  return isPerspective ? 'orbit' : 'pan';
}

export function classifyWheel(
  deltaX: number,
  deltaY: number,
  ctrlKey: boolean,
  shiftKey = false,
): { type: 'zoom'; delta: number } | { type: 'pan'; dx: number; dy: number } {
  if (ctrlKey) return { type: 'zoom', delta: deltaY };
  if (shiftKey) return { type: 'pan', dx: deltaX, dy: deltaY };
  if (Math.abs(deltaX) > Math.abs(deltaY) * 1.25 && Math.abs(deltaX) > 0.5) {
    return { type: 'pan', dx: deltaX, dy: deltaY };
  }
  return { type: 'zoom', delta: deltaY };
}

/**
 * Shared mouse / laptop camera chords for every 3D workspace.
 * MMB always navigates; Alt+LMB emulates MMB when a tool owns LMB.
 * Unmodified MMB/Alt orbits in perspective and pans in locked ortho views.
 */
export function modifierNavKind(
  button: PointerButtonKind,
  mods: { altKey: boolean; shiftKey: boolean; ctrlKey: boolean },
  options: { altEmulatesMiddle?: boolean; isPerspective?: boolean } = {},
): NavGestureKind | null {
  const altEmulatesMiddle = options.altEmulatesMiddle ?? true;
  const isPerspective = options.isPerspective ?? true;
  const emulateMiddle =
    button === 'middle' || (altEmulatesMiddle && button === 'primary' && mods.altKey);
  if (!emulateMiddle) return null;
  if (mods.ctrlKey) return 'zoom';
  if (mods.shiftKey) return 'pan';
  return isPerspective ? 'orbit' : 'pan';
}

/** LightWave 2D image / UV view: Alt or MMB pans; Ctrl+Alt / Ctrl+MMB zooms. */
export function canvasNavKind(
  button: PointerButtonKind,
  mods: { altKey: boolean; shiftKey: boolean; ctrlKey: boolean },
): 'pan' | 'zoom' | null {
  const emulateMiddle = button === 'middle' || (button === 'primary' && mods.altKey);
  if (!emulateMiddle) return null;
  if (mods.ctrlKey) return 'zoom';
  return 'pan';
}

/** @deprecated Use modifierNavKind — kept for UV 3D tests that assume perspective. */
export function texturePreviewNavKind(
  button: PointerButtonKind,
  mods: { altKey: boolean; shiftKey: boolean; ctrlKey: boolean },
  altEmulatesMiddle = true,
): NavGestureKind | null {
  return modifierNavKind(button, mods, { altEmulatesMiddle, isPerspective: true });
}

/** Normalize wheel ticks so laptop trackpads and mouse notches share a range. */
export function wheelZoomPixels(deltaY: number, deltaMode: number): number {
  let dy = deltaY;
  if (deltaMode === 1) dy *= 16;
  if (deltaMode === 2) dy *= 800;
  return Math.max(-120, Math.min(120, dy));
}

export function navCursor(kind: NavGestureKind | 'select'): string {
  if (kind === 'pan') return 'move';
  if (kind === 'zoom') return 'ns-resize';
  if (kind === 'select') return 'crosshair';
  return 'grabbing';
}

/**
 * Shared pointer / stylus / trackpad camera gestures.
 * Tools and gizmos still own the pointer when they begin first; this engine
 * only claims leftover primary clicks (click = select, drag = orbit/pan).
 */
export class ViewportInputEngine {
  private active: ActiveGesture | null = null;

  get navigating(): boolean {
    const kind = this.active?.kind;
    return kind === 'orbit' || kind === 'pan' || kind === 'zoom';
  }

  get pending(): boolean {
    const kind = this.active?.kind;
    return kind === 'pending-primary' || kind === 'pending-secondary';
  }

  get paneId(): ViewId | null {
    return this.active?.paneId ?? null;
  }

  beginPrimary(pointerId: number, paneId: ViewId, x: number, y: number, isPerspective: boolean): void {
    this.active = {
      pointerId,
      paneId,
      button: 'primary',
      kind: 'pending-primary',
      startX: x,
      startY: y,
      lastX: x,
      lastY: y,
      isPerspective,
    };
  }

  beginSecondary(pointerId: number, paneId: ViewId, x: number, y: number, isPerspective: boolean): void {
    this.active = {
      pointerId,
      paneId,
      button: 'secondary',
      kind: 'pending-secondary',
      startX: x,
      startY: y,
      lastX: x,
      lastY: y,
      isPerspective,
    };
  }

  beginImmediate(
    kind: NavGestureKind,
    pointerId: number,
    paneId: ViewId,
    x: number,
    y: number,
    isPerspective: boolean,
  ): void {
    this.active = {
      pointerId,
      paneId,
      button: kind === 'zoom' ? 'middle' : kind === 'pan' ? 'secondary' : 'primary',
      kind,
      startX: x,
      startY: y,
      lastX: x,
      lastY: y,
      isPerspective,
    };
  }

  onMove(pointerId: number, x: number, y: number): NavMoveResult | null {
    const gesture = this.active;
    if (!gesture || gesture.pointerId !== pointerId) return null;

    const dx = x - gesture.lastX;
    const dy = y - gesture.lastY;
    gesture.lastX = x;
    gesture.lastY = y;

    if (gesture.kind === 'pending-primary' || gesture.kind === 'pending-secondary') {
      const distance = Math.hypot(x - gesture.startX, y - gesture.startY);
      if (distance < NAV_DRAG_THRESHOLD_PX) return { phase: 'pending' };
      gesture.kind =
        gesture.kind === 'pending-secondary' ? 'pan' : primaryNavKind(gesture.isPerspective);
      return {
        phase: 'nav',
        kind: gesture.kind,
        dx: x - gesture.startX,
        dy: y - gesture.startY,
        paneId: gesture.paneId,
      };
    }

    return { phase: 'nav', kind: gesture.kind, dx, dy, paneId: gesture.paneId };
  }

  onUp(pointerId: number, button: PointerButtonKind): NavEndResult | null {
    const gesture = this.active;
    if (!gesture || gesture.pointerId !== pointerId) return null;
    this.active = null;
    if (gesture.kind === 'pending-primary' && button === 'primary') {
      return { phase: 'click', button: 'primary', paneId: gesture.paneId };
    }
    if (gesture.kind === 'pending-secondary' && button === 'secondary') {
      return { phase: 'click', button: 'secondary', paneId: gesture.paneId };
    }
    if (gesture.kind === 'orbit' || gesture.kind === 'pan' || gesture.kind === 'zoom') {
      return { phase: 'ended', kind: gesture.kind, paneId: gesture.paneId };
    }
    return null;
  }

  cancel(): void {
    this.active = null;
  }

  matches(pointerId: number): boolean {
    return this.active?.pointerId === pointerId;
  }
}

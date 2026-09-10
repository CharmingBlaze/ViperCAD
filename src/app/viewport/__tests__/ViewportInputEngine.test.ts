import { describe, expect, it } from 'vitest';
import {
  classifyPointerButton,
  classifyWheel,
  isStylusButtonEvent,
  navCursor,
  NAV_DRAG_THRESHOLD_PX,
  primaryNavKind,
  modifierNavKind,
  texturePreviewNavKind,
  canvasNavKind,
  ViewportInputEngine,
  wheelZoomPixels,
} from '@/app/viewport/ViewportInputEngine';

describe('ViewportInputEngine mapping', () => {
  it('maps mouse and stylus buttons', () => {
    expect(classifyPointerButton(0)).toBe('primary');
    expect(classifyPointerButton(1)).toBe('middle');
    expect(classifyPointerButton(2)).toBe('secondary');
    expect(classifyPointerButton(5)).toBe('secondary');
  });

  it('detects stylus pen barrel and secondary button events', () => {
    expect(isStylusButtonEvent({ pointerType: 'pen', button: 2 })).toBe(true);
    expect(isStylusButtonEvent({ pointerType: 'pen', button: 5 })).toBe(true);
    expect(isStylusButtonEvent({ pointerType: 'pen', buttons: 2 })).toBe(true);
    expect(isStylusButtonEvent({ pointerType: 'pen', buttons: 32 })).toBe(true);
    expect(isStylusButtonEvent({ pointerType: 'pen', button: 0, buttons: 1 })).toBe(false);
    expect(isStylusButtonEvent({ pointerType: 'mouse', button: 2 })).toBe(false);
    expect(isStylusButtonEvent({ pointerType: 'touch', button: 0 })).toBe(false);
  });

  it('orbits in perspective and pans in orthographic views', () => {
    expect(primaryNavKind(true)).toBe('orbit');
    expect(primaryNavKind(false)).toBe('pan');
  });

  it('maps navCursor gestures to proper CSS cursors including stylus selection', () => {
    expect(navCursor('pan')).toBe('move');
    expect(navCursor('zoom')).toBe('ns-resize');
    expect(navCursor('select')).toBe('crosshair');
    expect(navCursor('orbit')).toBe('grabbing');
  });

  it('treats wheel as zoom and two-finger sideways as pan', () => {
    expect(classifyWheel(0, 80, false)).toEqual({ type: 'zoom', delta: 80 });
    expect(classifyWheel(0, 80, true)).toEqual({ type: 'zoom', delta: 80 });
    expect(classifyWheel(40, 8, false)).toEqual({ type: 'pan', dx: 40, dy: 8 });
    expect(classifyWheel(0, 80, false, true)).toEqual({ type: 'pan', dx: 0, dy: 80 });
  });

  it('clamps wheel ticks', () => {
    expect(wheelZoomPixels(800, 0)).toBe(120);
    expect(wheelZoomPixels(2, 1)).toBe(32);
  });

  it('maps mouse and laptop shortcuts in every 3D workspace', () => {
    const none = { altKey: false, shiftKey: false, ctrlKey: false };
    expect(modifierNavKind('primary', none)).toBeNull();
    expect(modifierNavKind('primary', { ...none, altKey: true }, { altEmulatesMiddle: false })).toBeNull();
    expect(modifierNavKind('middle', none)).toBe('orbit');
    expect(modifierNavKind('middle', none, { isPerspective: false })).toBe('pan');
    expect(modifierNavKind('middle', { ...none, shiftKey: true })).toBe('pan');
    expect(modifierNavKind('middle', { ...none, ctrlKey: true })).toBe('zoom');
    expect(modifierNavKind('primary', { ...none, altKey: true })).toBe('orbit');
    expect(modifierNavKind('primary', { altKey: true, shiftKey: true, ctrlKey: false })).toBe('pan');
    expect(modifierNavKind('primary', { altKey: true, shiftKey: false, ctrlKey: true })).toBe(
      'zoom',
    );
    expect(texturePreviewNavKind('middle', none)).toBe('orbit');
  });

  it('maps LightWave chords on the UV / Paint canvas', () => {
    const none = { altKey: false, shiftKey: false, ctrlKey: false };
    expect(canvasNavKind('primary', none)).toBeNull();
    expect(canvasNavKind('middle', none)).toBe('pan');
    expect(canvasNavKind('primary', { ...none, altKey: true })).toBe('pan');
    expect(canvasNavKind('primary', { altKey: true, shiftKey: true, ctrlKey: false })).toBe('pan');
    expect(canvasNavKind('primary', { altKey: true, shiftKey: false, ctrlKey: true })).toBe('zoom');
    expect(canvasNavKind('middle', { ...none, ctrlKey: true })).toBe('zoom');
  });
});

describe('ViewportInputEngine gestures', () => {
  it('keeps a primary press as a click until the drag threshold', () => {
    const engine = new ViewportInputEngine();
    engine.beginPrimary(1, 'persp', 10, 10, true);
    expect(engine.onMove(1, 12, 11)).toEqual({ phase: 'pending' });
    const ended = engine.onUp(1, 'primary');
    expect(ended).toEqual({ phase: 'click', button: 'primary', paneId: 'persp' });
  });

  it('turns a primary drag into orbit in perspective', () => {
    const engine = new ViewportInputEngine();
    engine.beginPrimary(1, 'persp', 0, 0, true);
    const moved = engine.onMove(1, NAV_DRAG_THRESHOLD_PX + 2, 0);
    expect(moved).toMatchObject({ phase: 'nav', kind: 'orbit', paneId: 'persp' });
    expect(engine.navigating).toBe(true);
    expect(engine.onUp(1, 'primary')).toMatchObject({ phase: 'ended', kind: 'orbit' });
  });

  it('turns a primary drag into pan in orthographic views', () => {
    const engine = new ViewportInputEngine();
    engine.beginPrimary(1, 'top', 0, 0, false);
    expect(engine.onMove(1, 0, NAV_DRAG_THRESHOLD_PX + 1)).toMatchObject({
      phase: 'nav',
      kind: 'pan',
      paneId: 'top',
    });
  });

  it('turns a secondary drag into a screen pan', () => {
    const engine = new ViewportInputEngine();
    engine.beginSecondary(7, 'persp', 4, 4, true);
    expect(engine.onMove(7, 4, 4 + NAV_DRAG_THRESHOLD_PX + 1)).toMatchObject({
      phase: 'nav',
      kind: 'pan',
    });
  });

  it('keeps a secondary press as a click when it does not drag', () => {
    const engine = new ViewportInputEngine();
    engine.beginSecondary(2, 'front', 1, 1, false);
    expect(engine.onUp(2, 'secondary')).toEqual({
      phase: 'click',
      button: 'secondary',
      paneId: 'front',
    });
  });
});

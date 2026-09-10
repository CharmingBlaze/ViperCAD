import { describe, expect, it } from 'vitest';
import { UV_ZOOM_MAX, UV_ZOOM_MIN, zoomCameraAt } from '@/app/uvEditor/uvEditorUtils';

describe('zoomCameraAt', () => {
  it('keeps the cursor world point fixed while zooming continuously', () => {
    const cam = { panX: 40, panY: 20, zoom: 2 };
    const mx = 120;
    const my = 80;
    const beforeX = (mx - cam.panX) / cam.zoom;
    const beforeY = (my - cam.panY) / cam.zoom;
    const next = zoomCameraAt(cam, mx, my, 1.25);
    expect(next.zoom).toBeCloseTo(2.5);
    expect((mx - next.panX) / next.zoom).toBeCloseTo(beforeX);
    expect((my - next.panY) / next.zoom).toBeCloseTo(beforeY);
  });

  it('clamps to the UV zoom range without snapping to discrete steps', () => {
    const cam = { panX: 0, panY: 0, zoom: 1 };
    expect(zoomCameraAt(cam, 10, 10, 0.97).zoom).toBeCloseTo(0.97);
    expect(zoomCameraAt(cam, 10, 10, 0.0001).zoom).toBe(UV_ZOOM_MIN);
    expect(zoomCameraAt({ ...cam, zoom: 200 }, 10, 10, 8).zoom).toBe(UV_ZOOM_MAX);
  });
});

import { describe, expect, it } from 'vitest';
import { SELECTION_COLORS, VERTEX_MARKER_CSS, vertexMarkerDeviceSize } from '@/renderer/SelectionOverlays';

function luminance(color: { r: number; g: number; b: number }): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

describe('selection overlay palette', () => {
  it('keeps idle vertices brighter than near-black', () => {
    expect(luminance(SELECTION_COLORS.topology)).toBeGreaterThan(0.7);
    expect(luminance(SELECTION_COLORS.topologyWire)).toBeGreaterThan(0.35);
  });

  it('uses cyan hover and amber selection so they do not read as the same state', () => {
    expect(SELECTION_COLORS.hover.b).toBeGreaterThan(SELECTION_COLORS.hover.r);
    expect(SELECTION_COLORS.selected.r).toBeGreaterThan(SELECTION_COLORS.selected.b);
    expect(SELECTION_COLORS.faceTintHover.b).toBeGreaterThan(SELECTION_COLORS.faceTintSelected.b);
  });

  it('keeps Blockbench-sized square markers', () => {
    expect(VERTEX_MARKER_CSS.idle).toBeGreaterThanOrEqual(16);
    expect(vertexMarkerDeviceSize(VERTEX_MARKER_CSS.idle)).toBeGreaterThanOrEqual(VERTEX_MARKER_CSS.idle);
  });
});

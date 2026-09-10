import type { ImageAsset } from '@/core/document/types';
import { type Rgba } from '@/core/image/PixelEditor';
import { getPaintPixel, isActivePaintLayerLocked, writePaintPixel } from '@/core/image/PaintLayers';
import type { PixelStrokeRecorder } from '@/core/image/PixelStroke';
import { uvToPixel } from '@/core/texture/uvFromMeshHit';

export type BrushShape = 'square' | 'circle';

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function isDitherPass(x: number, y: number, mode: 'none' | 'checker' | 'bayer4' = 'none'): boolean {
  if (mode === 'none') return true;
  const px = Math.abs(Math.floor(x));
  const py = Math.abs(Math.floor(y));
  if (mode === 'checker') return (px + py) % 2 === 0;
  if (mode === 'bayer4') return (BAYER_4X4[py % 4]![px % 4]! / 16) >= 0.5;
  return true;
}

function matchesRecolor(a: Rgba, b: Rgba, tol = 32): boolean {
  return (
    Math.abs(a[0] - b[0]) <= tol &&
    Math.abs(a[1] - b[1]) <= tol &&
    Math.abs(a[2] - b[2]) <= tol &&
    Math.abs(a[3] - b[3]) <= tol
  );
}

/** Texture-space mirrors of a paint pixel (includes the original). */
export function mirroredPaintPixels(
  width: number,
  height: number,
  point: { x: number; y: number },
  mirrorX: boolean,
  mirrorY: boolean,
): { x: number; y: number }[] {
  const points = [point];
  if (mirrorX) points.push({ x: width - 1 - point.x, y: point.y });
  if (mirrorY) points.push({ x: point.x, y: height - 1 - point.y });
  if (mirrorX && mirrorY) {
    points.push({ x: width - 1 - point.x, y: height - 1 - point.y });
  }
  return [...new Map(points.map((item) => [`${item.x},${item.y}`, item])).values()];
}

/** Stamp a brush centred on pixel (cx, cy). Records into an optional stroke. */
export function stampBrush(
  image: ImageAsset,
  cx: number,
  cy: number,
  size: number,
  colour: Rgba,
  stroke?: PixelStrokeRecorder | null,
  shape: BrushShape = 'square',
  ditherMode: 'none' | 'checker' | 'bayer4' = 'none',
  recolorTarget?: Rgba | null,
): number {
  const s = Math.max(1, Math.round(size));
  const offset = Math.floor((s - 1) / 2);
  const r = s / 2;
  const r2 = r * r;
  if (isActivePaintLayerLocked(image)) return 0;
  let painted = 0;
  for (let dy = 0; dy < s; dy++) {
    for (let dx = 0; dx < s; dx++) {
      if (shape === 'circle') {
        const px = dx + 0.5 - r;
        const py = dy + 0.5 - r;
        if (px * px + py * py > r2) continue;
      }
      const x = cx + dx - offset;
      const y = cy + dy - offset;
      if (!isDitherPass(x, y, ditherMode)) continue;
      const prev = getPaintPixel(image, x, y);
      if (!prev) continue;
      if (recolorTarget && !matchesRecolor(prev, recolorTarget)) continue;

      const next = colour[3] === 255 ? colour : blendOver(prev, colour);
      writePaintPixel(image, x, y, next);
      stroke?.paint(x, y, prev, next);
      painted += 1;
    }
  }
  if (painted) image.revision += 1;
  return painted;
}

/** Bresenham stamp path between two pixel centres. */
export function stampBrushLine(
  image: ImageAsset,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
  colour: Rgba,
  stroke?: PixelStrokeRecorder | null,
  shape: BrushShape = 'square',
  ditherMode: 'none' | 'checker' | 'bayer4' = 'none',
  recolorTarget?: Rgba | null,
): number {
  let painted = 0;
  let dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    painted += stampBrush(image, x, y, size, colour, stroke, shape, ditherMode, recolorTarget);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return painted;
}

/** Stamp at a UV coordinate (V-flipped to image space). */
export function stampBrushUv(
  image: ImageAsset,
  uv: { x: number; y: number },
  size: number,
  colour: Rgba,
  stroke?: PixelStrokeRecorder | null,
  shape: BrushShape = 'square',
  ditherMode: 'none' | 'checker' | 'bayer4' = 'none',
  recolorTarget?: Rgba | null,
): number {
  const p = uvToPixel(image, uv);
  return stampBrush(image, p.x, p.y, size, colour, stroke, shape, ditherMode, recolorTarget);
}

export function brushColourForTool(
  tool: 'pencil' | 'eraser' | 'eyedropper' | 'fill' | 'line' | 'rectangle' | 'ellipse' | 'replace',
  foreground: Rgba,
  background: Rgba,
  useBackground = false,
): Rgba {
  if (tool === 'eraser') return [0, 0, 0, 0];
  return useBackground ? background : foreground;
}

/** Standard source-over blending keeps low-opacity pixel brushes useful. */
function blendOver(destination: Rgba, source: Rgba): Rgba {
  const sa = source[3] / 255;
  const da = destination[3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA < 1e-6) return [0, 0, 0, 0];
  return [
    Math.round((source[0] * sa + destination[0] * da * (1 - sa)) / outA),
    Math.round((source[1] * sa + destination[1] * da * (1 - sa)) / outA),
    Math.round((source[2] * sa + destination[2] * da * (1 - sa)) / outA),
    Math.round(outA * 255),
  ];
}

import type { ImageAsset } from '@/core/document/types';
import { getPixel, type Rgba } from '@/core/image/PixelEditor';
import type { PixelStrokeRecorder } from '@/core/image/PixelStroke';
import { uvToPixel } from '@/core/texture/uvFromMeshHit';

export type BrushShape = 'square' | 'circle';

/** Stamp a brush centred on pixel (cx, cy). Records into an optional stroke. */
export function stampBrush(
  image: ImageAsset,
  cx: number,
  cy: number,
  size: number,
  colour: Rgba,
  stroke?: PixelStrokeRecorder | null,
  shape: BrushShape = 'square',
): number {
  const s = Math.max(1, Math.round(size));
  const offset = Math.floor((s - 1) / 2);
  const r = s / 2;
  const r2 = r * r;
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
      const prev = getPixel(image, x, y);
      if (!prev) continue;
      const i = (y * image.width + x) * 4;
      image.pixels[i] = colour[0];
      image.pixels[i + 1] = colour[1];
      image.pixels[i + 2] = colour[2];
      image.pixels[i + 3] = colour[3];
      stroke?.paint(x, y, prev, colour);
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
    painted += stampBrush(image, x, y, size, colour, stroke, shape);
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
): number {
  const p = uvToPixel(image, uv);
  return stampBrush(image, p.x, p.y, size, colour, stroke, shape);
}

export function brushColourForTool(
  tool: 'pencil' | 'eraser' | 'eyedropper' | 'fill',
  foreground: Rgba,
  background: Rgba,
  useBackground = false,
): Rgba {
  if (tool === 'eraser') return [0, 0, 0, 0];
  return useBackground ? background : foreground;
}

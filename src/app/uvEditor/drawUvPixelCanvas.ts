import type { EditorSession } from '@/core/editor/EditorSession';
import type { ImageAsset } from '@/core/document/types';
import type { EditableMesh, UvLayerId } from '@/core/mesh/types';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import { editorCamera } from '@/workspace/TextureWorkspace';
import { analyseUvs } from '@/core/uv/UvDiagnostics';
import { drawUvOverlay } from './drawUvOverlay';

type Marquee = {
  startUv: { x: number; y: number };
  currentUv: { x: number; y: number };
  startScreenX: number;
  currentScreenX: number;
};

type PixelShapePreview = {
  tool: 'line' | 'rectangle' | 'ellipse';
  start: { x: number; y: number };
  current: { x: number; y: number };
};

type Options = {
  canvas: HTMLCanvasElement;
  host: HTMLDivElement;
  image: ImageAsset | null | undefined;
  session: EditorSession;
  workspace: WorkspaceController;
  uvPointerActive: boolean;
  activeMesh: { mesh: EditableMesh; layerId: UvLayerId } | null;
  hoverPixel: { x: number; y: number } | null;
  marquee: Marquee | null;
  pixelShapePreview?: PixelShapePreview | null;
};

/** Draws the shared UV/image canvas; interaction state remains in the editor controller. */
export function drawUvPixelCanvas(options: Options): void {
  const { canvas, host, image, session, workspace, uvPointerActive, activeMesh, hoverPixel, marquee, pixelShapePreview } = options;
  const width = Math.max(1, Math.floor(host.clientWidth));
  const height = Math.max(1, Math.floor(host.clientHeight));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bufferWidth = Math.max(1, Math.round(width * dpr));
  const bufferHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
    canvas.width = bufferWidth;
    canvas.height = bufferHeight;
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, width, height);
  drawBackground(context, width, height);
  if (!image) {
    drawMessage(context, 'No texture on active material');
    return;
  }
  const camera = editorCamera(workspace.texture);
  const mode = workspace.texture.activeRightEditor;
  const expected = image.width * image.height * 4;
  if (image.pixels.length < expected || image.width < 1 || image.height < 1) {
    drawMessage(context, 'Texture image data is invalid');
    return;
  }
  const offscreen = blitCanvasForImage(image);
  const imageX = camera.panX;
  const imageY = camera.panY;
  const imageWidth = image.width * camera.zoom;
  const imageHeight = image.height * camera.zoom;
  drawArtboard(context, imageX, imageY, imageWidth, imageHeight, width, height, workspace.texture.showUvCheckerboard);
  context.save();
  context.imageSmoothingEnabled = false;
  context.translate(camera.panX, camera.panY);
  context.scale(camera.zoom, camera.zoom);
  context.globalAlpha = mode === 'uv' ? 0.72 : 1;
  context.drawImage(offscreen, 0, 0);
  context.globalAlpha = 1;
  if (workspace.texture.showPixelGrid && camera.zoom >= 8 && mode !== 'uv') {
    drawPixelGrid(context, image.width, image.height, camera.zoom);
  }
  if (workspace.texture.showUvGrid && uvPointerActive && mode !== 'pixel') {
    drawUvGrid(context, image.width, image.height, camera.zoom);
  }
  if (workspace.texture.showUvOverlay && uvPointerActive && mode !== 'pixel' && activeMesh) {
    const diagnostics = analyseUvs(activeMesh.mesh, activeMesh.layerId, image.width, image.height);
    drawUvOverlay(
      context, session, image.width, image.height, camera.zoom, workspace.texture.uvEditMode,
      true, activeMesh.layerId, workspace.texture.uvDiagnosticMode, diagnostics,
    );
  }
  if (!uvPointerActive && (workspace.texture.paintMirrorX || workspace.texture.paintMirrorY)) {
    drawSymmetryGuides(context, image.width, image.height, workspace, camera.zoom);
  }
  if (!uvPointerActive && hoverPixel && mode !== 'uv') {
    drawBrushPreview(context, hoverPixel, workspace, camera.zoom);
  }
  if (pixelShapePreview && mode !== 'uv') drawShapePreview(context, pixelShapePreview, workspace, camera.zoom);
  if (marquee) drawMarquee(context, marquee, image.width, image.height, camera.zoom);
  context.restore();
  context.strokeStyle = uvPointerActive ? 'rgba(20,115,230,0.6)' : 'rgba(255,255,255,0.1)';
  context.lineWidth = 1;
  context.strokeRect(imageX + 0.5, imageY + 0.5, Math.max(0, imageWidth - 1), Math.max(0, imageHeight - 1));
}

function drawShapePreview(context: CanvasRenderingContext2D, shape: PixelShapePreview, workspace: WorkspaceController, zoom: number): void {
  const size = Math.max(1, workspace.texture.brushSize);
  const offset = Math.floor((size - 1) / 2);
  context.save();
  context.strokeStyle = 'rgba(255, 236, 154, 0.96)';
  context.lineWidth = Math.max(1 / zoom, size / 3);
  context.setLineDash([3 / zoom, 2 / zoom]);
  if (shape.tool === 'line') {
    context.beginPath();
    context.moveTo(shape.start.x + 0.5, shape.start.y + 0.5);
    context.lineTo(shape.current.x + 0.5, shape.current.y + 0.5);
    context.stroke();
  } else if (shape.tool === 'rectangle') {
    const x = Math.min(shape.start.x, shape.current.x) - offset;
    const y = Math.min(shape.start.y, shape.current.y) - offset;
    const w = Math.abs(shape.current.x - shape.start.x) + size;
    const h = Math.abs(shape.current.y - shape.start.y) + size;
    context.strokeRect(x, y, w, h);
  } else {
    const cx = (shape.start.x + shape.current.x + 1) / 2;
    const cy = (shape.start.y + shape.current.y + 1) / 2;
    const rx = Math.max(.5, Math.abs(shape.current.x - shape.start.x + 1) / 2);
    const ry = Math.max(.5, Math.abs(shape.current.y - shape.start.y + 1) / 2);
    context.beginPath();
    context.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
}

type ImageBlitCache = {
  imageId: string;
  revision: number;
  canvas: HTMLCanvasElement;
};

let blitCache: ImageBlitCache | null = null;

function blitCanvasForImage(image: ImageAsset): HTMLCanvasElement {
  const reusable =
    blitCache?.canvas &&
    blitCache.canvas.width === image.width &&
    blitCache.canvas.height === image.height
      ? blitCache.canvas
      : document.createElement('canvas');
  if (
    blitCache &&
    blitCache.canvas === reusable &&
    blitCache.imageId === image.id &&
    blitCache.revision === image.revision
  ) {
    return reusable;
  }
  reusable.width = image.width;
  reusable.height = image.height;
  reusable.getContext('2d')!.putImageData(
    new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height),
    0,
    0,
  );
  blitCache = { imageId: image.id, revision: image.revision, canvas: reusable };
  return reusable;
}

function drawBackground(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.fillStyle = '#090d12';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = 'rgba(94, 112, 136, 0.055)';
  context.lineWidth = 1;
  context.beginPath();
  for (let x = 0.5; x < width; x += 32) { context.moveTo(x, 0); context.lineTo(x, height); }
  for (let y = 0.5; y < height; y += 32) { context.moveTo(0, y); context.lineTo(width, y); }
  context.stroke();
}

function drawMessage(context: CanvasRenderingContext2D, message: string): void {
  context.fillStyle = '#7f8796';
  context.font = '13px IBM Plex Sans, sans-serif';
  context.fillText(message, 16, 28);
}

function drawArtboard(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  viewportW: number,
  viewportH: number,
  showCheckerboard = false,
): void {
  context.save();
  context.shadowColor = 'rgba(0,0,0,0.55)';
  context.shadowBlur = 24;
  context.fillStyle = '#111720';
  context.fillRect(x, y, w, h);
  context.restore();
  context.save();
  context.beginPath(); context.rect(x, y, w, h); context.clip();
  const checker = showCheckerboard ? 16 : 10;
  const startX = Math.floor(Math.max(0, x) / checker) * checker;
  const startY = Math.floor(Math.max(0, y) / checker) * checker;
  for (let py = startY; py < Math.min(viewportH, y + h); py += checker) {
    for (let px = startX; px < Math.min(viewportW, x + w); px += checker) {
      const isEven = (Math.floor((px - x) / checker) + Math.floor((py - y) / checker)) % 2 === 0;
      if (showCheckerboard) {
        context.fillStyle = isEven ? '#e0e0e0' : '#808080';
      } else {
        context.fillStyle = isEven ? '#202734' : '#151b24';
      }
      context.fillRect(px, py, checker, checker);
    }
  }
  context.restore();
}

function drawPixelGrid(context: CanvasRenderingContext2D, width: number, height: number, zoom: number): void {
  context.strokeStyle = 'rgba(255,255,255,0.06)';
  context.lineWidth = 1 / zoom;
  context.beginPath();
  for (let x = 0; x <= width; x++) { context.moveTo(x, 0); context.lineTo(x, height); }
  for (let y = 0; y <= height; y++) { context.moveTo(0, y); context.lineTo(width, y); }
  context.stroke();
}

function drawSymmetryGuides(context: CanvasRenderingContext2D, width: number, height: number, workspace: WorkspaceController, zoom: number): void {
  context.save();
  context.strokeStyle = 'rgba(20, 115, 230, 0.45)';
  context.lineWidth = 1 / zoom;
  context.setLineDash([4 / zoom, 3 / zoom]);
  context.beginPath();
  if (workspace.texture.paintMirrorX) {
    const midX = width / 2;
    context.moveTo(midX, 0);
    context.lineTo(midX, height);
  }
  if (workspace.texture.paintMirrorY) {
    const midY = height / 2;
    context.moveTo(0, midY);
    context.lineTo(width, midY);
  }
  context.stroke();
  context.restore();
}

/** A light 16×16 guide remains useful at any zoom, unlike the per-texel grid. */
function drawUvGrid(context: CanvasRenderingContext2D, width: number, height: number, zoom: number): void {
  const divisions = 16;
  context.strokeStyle = 'rgba(101, 177, 255, 0.22)';
  context.lineWidth = 1 / zoom;
  context.beginPath();
  for (let i = 1; i < divisions; i++) {
    const x = (width * i) / divisions;
    const y = (height * i) / divisions;
    context.moveTo(x, 0); context.lineTo(x, height);
    context.moveTo(0, y); context.lineTo(width, y);
  }
  context.stroke();
  context.strokeStyle = 'rgba(131, 204, 255, 0.5)';
  context.strokeRect(0.5 / zoom, 0.5 / zoom, width - 1 / zoom, height - 1 / zoom);
}

function drawBrushPreview(context: CanvasRenderingContext2D, pixel: { x: number; y: number }, workspace: WorkspaceController, zoom: number): void {
  const size = Math.max(1, workspace.texture.brushSize);
  const offset = Math.floor((size - 1) / 2);
  const foreground = workspace.texture.foreground;
  context.fillStyle = workspace.texture.pixelTool === 'eraser' ? 'rgba(255,255,255,0.2)' : `rgba(${foreground[0]},${foreground[1]},${foreground[2]},0.35)`;
  if (workspace.texture.brushShape === 'circle') {
    context.beginPath(); context.arc(pixel.x + 0.5, pixel.y + 0.5, size / 2, 0, Math.PI * 2); context.fill(); context.strokeStyle = 'rgba(255,255,255,0.95)'; context.lineWidth = 1 / zoom; context.stroke();
  } else {
    context.fillRect(pixel.x - offset, pixel.y - offset, size, size); context.strokeStyle = 'rgba(255,255,255,0.95)'; context.lineWidth = 1 / zoom; context.strokeRect(pixel.x - offset, pixel.y - offset, size, size);
  }
}

function drawMarquee(context: CanvasRenderingContext2D, marquee: Marquee, width: number, height: number, zoom: number): void {
  const a = marquee.startUv, b = marquee.currentUv;
  const crossing = marquee.currentScreenX < marquee.startScreenX;
  const x0 = Math.min(a.x, b.x) * width, x1 = Math.max(a.x, b.x) * width;
  const y0 = (1 - Math.max(a.y, b.y)) * height, y1 = (1 - Math.min(a.y, b.y)) * height;
  const lineWidth = 1.25 / zoom;
  context.fillStyle = crossing ? 'rgba(255,170,70,0.14)' : 'rgba(90,170,255,0.14)'; context.fillRect(x0, y0, x1 - x0, y1 - y0);
  context.strokeStyle = crossing ? 'rgba(255,190,100,0.95)' : 'rgba(130,200,255,0.95)'; context.lineWidth = lineWidth;
  context.setLineDash(crossing ? [5 / zoom, 3.5 / zoom] : []); context.strokeRect(x0 + lineWidth * 0.5, y0 + lineWidth * 0.5, Math.max(0, x1 - x0 - lineWidth), Math.max(0, y1 - y0 - lineWidth)); context.setLineDash([]);
}

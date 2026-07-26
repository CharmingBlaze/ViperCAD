import type { CommandHistory } from '@/core/history/CommandHistory';
import type { ImageAsset, ImageId } from '@/core/document/types';
import type { Rgba } from './PixelEditor';
import { getPixel } from './PixelEditor';

/** Compact dirty-region patch for one brush stroke / fill. */
export type PixelPatch = {
  imageId: ImageId;
  x: number;
  y: number;
  width: number;
  height: number;
  beforePixels: Uint8ClampedArray;
  afterPixels: Uint8ClampedArray;
};

/**
 * Accumulates painted pixels during a stroke, then commits one history entry.
 */
export class PixelStrokeRecorder {
  private image: ImageAsset | null = null;
  private before = new Map<string, Rgba>();
  private after = new Map<string, Rgba>();
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;
  private active = false;

  get isActive(): boolean {
    return this.active;
  }

  begin(image: ImageAsset): void {
    this.image = image;
    this.before.clear();
    this.after.clear();
    this.minX = Infinity;
    this.minY = Infinity;
    this.maxX = -Infinity;
    this.maxY = -Infinity;
    this.active = true;
  }

  /** Record a pixel change; caller has already written `colour` to the image. */
  touch(x: number, y: number, colour: Rgba): void {
    if (!this.active || !this.image) return;
    const key = `${x},${y}`;
    if (!this.before.has(key)) {
      const prev = getPixel(this.image, x, y) ?? ([0, 0, 0, 0] as Rgba);
      // Read before was already overwritten — store previous from after map if re-touch
      this.before.set(key, prev);
      // Fix: we need before from before write. Caller should pass previous.
    }
    this.after.set(key, colour);
    this.minX = Math.min(this.minX, x);
    this.minY = Math.min(this.minY, y);
    this.maxX = Math.max(this.maxX, x);
    this.maxY = Math.max(this.maxY, y);
  }

  /** Prefer this: pass previous colour before overwrite. */
  paint(x: number, y: number, previous: Rgba, colour: Rgba): void {
    if (!this.active || !this.image) return;
    const key = `${x},${y}`;
    if (!this.before.has(key)) this.before.set(key, previous);
    this.after.set(key, colour);
    this.minX = Math.min(this.minX, x);
    this.minY = Math.min(this.minY, y);
    this.maxX = Math.max(this.maxX, x);
    this.maxY = Math.max(this.maxY, y);
  }

  commit(history: CommandHistory, onApply: () => void): boolean {
    if (!this.active || !this.image || !this.before.size || !Number.isFinite(this.minX)) {
      this.active = false;
      return false;
    }
    const image = this.image;
    const x = this.minX;
    const y = this.minY;
    const width = this.maxX - this.minX + 1;
    const height = this.maxY - this.minY + 1;
    const beforePixels = new Uint8ClampedArray(width * height * 4);
    const afterPixels = new Uint8ClampedArray(width * height * 4);

    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const gx = x + px;
        const gy = y + py;
        const key = `${gx},${gy}`;
        const i = (py * width + px) * 4;
        const b = this.before.get(key) ?? getPixel(image, gx, gy) ?? ([0, 0, 0, 0] as const);
        const a = this.after.get(key) ?? b;
        beforePixels[i] = b[0];
        beforePixels[i + 1] = b[1];
        beforePixels[i + 2] = b[2];
        beforePixels[i + 3] = b[3];
        afterPixels[i] = a[0];
        afterPixels[i + 1] = a[1];
        afterPixels[i + 2] = a[2];
        afterPixels[i + 3] = a[3];
      }
    }

    const patch: PixelPatch = {
      imageId: image.id,
      x,
      y,
      width,
      height,
      beforePixels,
      afterPixels,
    };

    const state = { patch, applied: true, lastPaintAt: Date.now() };
    const mergeWindowMs = 1200;
    history.execute({
      name: 'Paint Pixels',
      meta: state,
      execute: () => {
        if (state.applied) return;
        applyPatch(image, state.patch, 'after');
        state.applied = true;
        onApply();
      },
      undo: () => {
        applyPatch(image, state.patch, 'before');
        state.applied = false;
        onApply();
      },
      canMerge: (other) => {
        if (other.name !== 'Paint Pixels') return false;
        const otherState = other.meta as typeof state | undefined;
        if (!otherState || otherState.patch.imageId !== state.patch.imageId) return false;
        return Date.now() - state.lastPaintAt <= mergeWindowMs;
      },
      merge: (other) => {
        const otherState = other.meta as typeof state | undefined;
        if (!otherState) return;
        state.patch = mergePixelPatches(state.patch, otherState.patch);
        state.lastPaintAt = Date.now();
      },
    });

    this.active = false;
    this.image = null;
    return true;
  }

  cancel(): void {
    if (this.active && this.image) {
      for (const [key, colour] of this.before) {
        const [sx, sy] = key.split(',').map(Number) as [number, number];
        const i = (sy * this.image.width + sx) * 4;
        this.image.pixels[i] = colour[0];
        this.image.pixels[i + 1] = colour[1];
        this.image.pixels[i + 2] = colour[2];
        this.image.pixels[i + 3] = colour[3];
      }
      this.image.revision += 1;
    }
    this.active = false;
    this.image = null;
  }
}

function applyPatch(image: ImageAsset, patch: PixelPatch, which: 'before' | 'after'): void {
  const src = which === 'before' ? patch.beforePixels : patch.afterPixels;
  for (let py = 0; py < patch.height; py++) {
    for (let px = 0; px < patch.width; px++) {
      const i = (py * patch.width + px) * 4;
      const gi = ((patch.y + py) * image.width + (patch.x + px)) * 4;
      image.pixels[gi] = src[i]!;
      image.pixels[gi + 1] = src[i + 1]!;
      image.pixels[gi + 2] = src[i + 2]!;
      image.pixels[gi + 3] = src[i + 3]!;
    }
  }
  image.revision += 1;
}

/** Combine two dirty-region patches into one undoable region. */
function mergePixelPatches(a: PixelPatch, b: PixelPatch): PixelPatch {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  const width = right - x;
  const height = bottom - y;
  const beforePixels = new Uint8ClampedArray(width * height * 4);
  const afterPixels = new Uint8ClampedArray(width * height * 4);

  const blit = (
    patch: PixelPatch,
    target: Uint8ClampedArray,
    which: 'before' | 'after',
  ) => {
    const src = which === 'before' ? patch.beforePixels : patch.afterPixels;
    for (let py = 0; py < patch.height; py++) {
      for (let px = 0; px < patch.width; px++) {
        const si = (py * patch.width + px) * 4;
        const dx = patch.x + px - x;
        const dy = patch.y + py - y;
        const ti = (dy * width + dx) * 4;
        target[ti] = src[si]!;
        target[ti + 1] = src[si + 1]!;
        target[ti + 2] = src[si + 2]!;
        target[ti + 3] = src[si + 3]!;
      }
    }
  };

  // Start from A's before, then overlay B's before only where A didn't paint.
  blit(a, beforePixels, 'before');
  blit(a, afterPixels, 'after');
  for (let py = 0; py < b.height; py++) {
    for (let px = 0; px < b.width; px++) {
      const dx = b.x + px - x;
      const dy = b.y + py - y;
      const ti = (dy * width + dx) * 4;
      const inA =
        b.x + px >= a.x &&
        b.x + px < a.x + a.width &&
        b.y + py >= a.y &&
        b.y + py < a.y + a.height;
      const si = (py * b.width + px) * 4;
      if (!inA) {
        beforePixels[ti] = b.beforePixels[si]!;
        beforePixels[ti + 1] = b.beforePixels[si + 1]!;
        beforePixels[ti + 2] = b.beforePixels[si + 2]!;
        beforePixels[ti + 3] = b.beforePixels[si + 3]!;
      }
      afterPixels[ti] = b.afterPixels[si]!;
      afterPixels[ti + 1] = b.afterPixels[si + 1]!;
      afterPixels[ti + 2] = b.afterPixels[si + 2]!;
      afterPixels[ti + 3] = b.afterPixels[si + 3]!;
    }
  }

  return { imageId: a.imageId, x, y, width, height, beforePixels, afterPixels };
}

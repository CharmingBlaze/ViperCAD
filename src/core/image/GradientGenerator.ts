import type { ImageAsset, MaterialAsset, ModelDocument } from '@/core/document/types';
import type { EditorSession } from '@/core/editor/EditorSession';
import { createImageAsset, createTextureAsset } from '@/core/image/PixelEditor';

export type MaterialGradientType = 'linear' | 'radial';

export type GradientStop = {
  color: string;
  position: number;
  opacity: number;
};

export type MaterialGradientSettings = {
  type: MaterialGradientType;
  angle: number;
  stops: GradientStop[];
};

export const DEFAULT_MATERIAL_GRADIENT: MaterialGradientSettings = {
  type: 'linear',
  angle: 90,
  stops: [
    { color: '#0030e8', position: 0, opacity: 100 },
    { color: '#ffffff', position: 100, opacity: 100 },
  ],
};

export const MATERIAL_GRADIENT_PRESETS: Array<{
  id: string;
  label: string;
  settings: MaterialGradientSettings;
}> = [
  {
    id: 'gold',
    label: 'Gold',
    settings: {
      type: 'linear',
      angle: 90,
      stops: [
        { color: '#8f4d24', position: 0, opacity: 100 },
        { color: '#f4cf8c', position: 100, opacity: 100 },
      ],
    },
  },
  {
    id: 'sunset',
    label: 'Sunset',
    settings: {
      type: 'linear',
      angle: 135,
      stops: [
        { color: '#2b1055', position: 0, opacity: 100 },
        { color: '#f7797d', position: 100, opacity: 100 },
      ],
    },
  },
  {
    id: 'ocean',
    label: 'Ocean',
    settings: {
      type: 'linear',
      angle: 180,
      stops: [
        { color: '#0f2027', position: 0, opacity: 100 },
        { color: '#2c5364', position: 100, opacity: 100 },
      ],
    },
  },
  {
    id: 'mint',
    label: 'Mint',
    settings: {
      type: 'linear',
      angle: 45,
      stops: [
        { color: '#11998e', position: 0, opacity: 100 },
        { color: '#38ef7d', position: 100, opacity: 100 },
      ],
    },
  },
  {
    id: 'steel',
    label: 'Steel',
    settings: {
      type: 'linear',
      angle: 90,
      stops: [
        { color: '#434343', position: 0, opacity: 100 },
        { color: '#d7d2cc', position: 100, opacity: 100 },
      ],
    },
  },
  {
    id: 'spot',
    label: 'Spot',
    settings: {
      type: 'radial',
      angle: 0,
      stops: [
        { color: '#ffffff', position: 0, opacity: 100 },
        { color: '#1a1a2e', position: 100, opacity: 100 },
      ],
    },
  },
  {
    id: 'sky',
    label: 'Sky',
    settings: {
      type: 'linear',
      angle: 180,
      stops: [
        { color: '#0030e8', position: 0, opacity: 100 },
        { color: '#7ecbff', position: 55, opacity: 100 },
        { color: '#ffffff', position: 100, opacity: 100 },
      ],
    },
  },
];

type LegacyGradientSettings = Partial<MaterialGradientSettings> & {
  start?: string;
  end?: string;
};

export function normalizeHexColor(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function hexToRgbBytes(hex: string): [number, number, number] {
  const value = normalizeHexColor(hex, '#000000').replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

export function rgbBytesToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function hexToRgbNormalized(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgbBytes(hex);
  return [r / 255, g / 255, b / 255];
}

export function normalizeGradientStop(
  stop: Partial<GradientStop>,
  fallback: GradientStop,
): GradientStop {
  return {
    color: normalizeHexColor(stop.color ?? fallback.color, fallback.color),
    position: clampNumber(stop.position, 0, 100, fallback.position),
    opacity: clampNumber(stop.opacity, 0, 100, fallback.opacity),
  };
}

export function normalizeGradientSettings(
  settings: LegacyGradientSettings,
): MaterialGradientSettings {
  const defaults = DEFAULT_MATERIAL_GRADIENT;
  let stops = settings.stops?.length
    ? settings.stops.map((stop, index) =>
      normalizeGradientStop(stop, defaults.stops[index] ?? defaults.stops[defaults.stops.length - 1]!),
    )
    : [
      normalizeGradientStop(
        { color: settings.start, position: 0, opacity: 100 },
        defaults.stops[0]!,
      ),
      normalizeGradientStop(
        { color: settings.end, position: 100, opacity: 100 },
        defaults.stops[defaults.stops.length - 1]!,
      ),
    ];

  stops = sortGradientStops(stops);
  if (stops.length < 2) {
    stops = [...defaults.stops];
  }

  return {
    type: settings.type === 'radial' ? 'radial' : 'linear',
    angle: clampNumber(settings.angle, -360, 360, defaults.angle),
    stops,
  };
}

export function sortGradientStops(stops: GradientStop[]): GradientStop[] {
  return [...stops].sort((a, b) => a.position - b.position || a.color.localeCompare(b.color));
}

export function gradientPreviewCss(settings: MaterialGradientSettings): string {
  const normalized = normalizeGradientSettings(settings);
  const stopsCss = normalized.stops
    .map((stop) => `${stopColorCss(stop)} ${stop.position}%`)
    .join(', ');
  if (normalized.type === 'radial') {
    return `radial-gradient(circle, ${stopsCss})`;
  }
  return `linear-gradient(${normalized.angle}deg, ${stopsCss})`;
}

function stopColorCss(stop: GradientStop): string {
  const [r, g, b] = hexToRgbBytes(stop.color);
  const alpha = clampNumber(stop.opacity, 0, 100, 100) / 100;
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

export function sampleGradientRgba(stops: GradientStop[], t: number): [number, number, number, number] {
  const sorted = sortGradientStops(normalizeGradientSettings({ stops }).stops);
  const clamped = Math.max(0, Math.min(1, t));

  if (clamped <= sorted[0]!.position / 100) {
    return stopToRgba(sorted[0]!);
  }
  const last = sorted[sorted.length - 1]!;
  if (clamped >= last.position / 100) {
    return stopToRgba(last);
  }

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const left = sorted[index]!;
    const right = sorted[index + 1]!;
    const leftT = left.position / 100;
    const rightT = right.position / 100;
    if (clamped >= leftT && clamped <= rightT) {
      const local = rightT === leftT ? 0 : (clamped - leftT) / (rightT - leftT);
      const [lr, lg, lb, la] = stopToRgba(left);
      const [rr, rg, rb, ra] = stopToRgba(right);
      return [
        lr + (rr - lr) * local,
        lg + (rg - lg) * local,
        lb + (rb - lb) * local,
        la + (ra - la) * local,
      ];
    }
  }

  return stopToRgba(last);
}

function stopToRgba(stop: GradientStop): [number, number, number, number] {
  const [r, g, b] = hexToRgbBytes(stop.color);
  return [r, g, b, clampNumber(stop.opacity, 0, 100, 100) / 100 * 255];
}

export function sampleGradientHex(stops: GradientStop[], t: number): string {
  const [r, g, b] = sampleGradientRgba(stops, t);
  return rgbBytesToHex(r, g, b);
}

export function generateGradientPixels(
  width: number,
  height: number,
  settings: MaterialGradientSettings,
): Uint8ClampedArray {
  const normalized = normalizeGradientSettings(settings);
  const result = new Uint8ClampedArray(width * height * 4);

  if (normalized.type === 'radial') {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const nx = width > 1 ? x / (width - 1) : 0.5;
        const ny = height > 1 ? y / (height - 1) : 0.5;
        const dist = Math.hypot(nx - 0.5, ny - 0.5) / Math.hypot(0.5, 0.5);
        writeSample(result, width, x, y, sampleGradientRgba(normalized.stops, dist));
      }
    }
    return result;
  }

  const angle = normalized.angle * Math.PI / 180;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = width > 1 ? x / (width - 1) - 0.5 : 0;
      const ny = height > 1 ? y / (height - 1) - 0.5 : 0;
      const t = Math.max(0, Math.min(1, nx * dx + ny * dy + 0.5));
      writeSample(result, width, x, y, sampleGradientRgba(normalized.stops, t));
    }
  }
  return result;
}

function writeSample(
  buffer: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  rgba: [number, number, number, number],
): void {
  const offset = (y * width + x) * 4;
  buffer[offset] = Math.round(rgba[0]);
  buffer[offset + 1] = Math.round(rgba[1]);
  buffer[offset + 2] = Math.round(rgba[2]);
  buffer[offset + 3] = Math.round(rgba[3]);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function buffersEqual(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function ensureMaterialBaseMapImage(
  doc: ModelDocument,
  material: MaterialAsset,
  width: number,
  height: number,
): ImageAsset {
  if (material.baseColourTextureId) {
    const texture = doc.textures.get(material.baseColourTextureId);
    const image = texture ? doc.images.get(texture.imageAssetId) : null;
    if (image) return image;
  }
  const image = createImageAsset(doc, `${material.name} Map`, width, height, [255, 255, 255, 255]);
  const texture = createTextureAsset(doc, image, `${material.name} Map ${width}×${height}`);
  material.baseColourTextureId = texture.id;
  material.presetId = null;
  return image;
}

export function applyGradientToImage(
  session: EditorSession,
  image: ImageAsset,
  settings: MaterialGradientSettings,
  material?: MaterialAsset | null,
): boolean {
  const normalized = normalizeGradientSettings(settings);
  const before = new Uint8ClampedArray(image.pixels);
  const after = generateGradientPixels(image.width, image.height, normalized);
  if (buffersEqual(before, after)) return false;

  const prevFiltering = material?.textureFiltering;
  let applied = true;

  const apply = () => {
    image.pixels.set(after);
    image.revision += 1;
    if (material) {
      material.textureFiltering = 'linear';
      material.presetId = null;
    }
  };

  const revert = () => {
    image.pixels.set(before);
    image.revision += 1;
    if (material && prevFiltering !== undefined) {
      material.textureFiltering = prevFiltering;
    }
  };

  apply();

  session.history.execute({
    name: normalized.type === 'radial' ? 'Radial Gradient' : `Gradient (${normalized.angle}°)`,
    execute: () => {
      if (applied) return;
      apply();
      applied = true;
      session.requestRedraw();
    },
    undo: () => {
      revert();
      applied = false;
      session.requestRedraw();
    },
  });

  session.document.dirty = true;
  session.requestRedraw();
  return true;
}

export function applyGradientToMaterialBaseMap(
  session: EditorSession,
  material: MaterialAsset,
  width: number,
  height: number,
  settings: MaterialGradientSettings,
): boolean {
  const image = ensureMaterialBaseMapImage(session.document, material, width, height);
  return applyGradientToImage(session, image, settings, material);
}

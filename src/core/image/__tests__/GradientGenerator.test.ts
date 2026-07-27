import { describe, expect, it } from 'vitest';
import {
  generateGradientPixels,
  gradientPreviewCss,
  normalizeGradientSettings,
  sampleGradientHex,
} from '@/core/image/GradientGenerator';

describe('GradientGenerator', () => {
  it('generateGradientPixels fills a horizontal linear gradient', () => {
    const pixels = generateGradientPixels(4, 1, {
      type: 'linear',
      angle: 0,
      stops: [
        { color: '#000000', position: 0, opacity: 100 },
        { color: '#ffffff', position: 100, opacity: 100 },
      ],
    });
    expect(pixels[0]).toBe(0);
    expect(pixels[4]).toBeLessThan(255);
    expect(pixels[12]).toBe(255);
  });

  it('generateGradientPixels supports radial gradients', () => {
    const pixels = generateGradientPixels(3, 3, {
      type: 'radial',
      angle: 0,
      stops: [
        { color: '#ffffff', position: 0, opacity: 100 },
        { color: '#000000', position: 100, opacity: 100 },
      ],
    });
    const center = (1 * 3 + 1) * 4;
    expect(pixels[center]).toBeGreaterThan(pixels[0]!);
    expect(pixels[0]).toBeLessThan(pixels[center]!);
  });

  it('supports multi-stop gradients', () => {
    const stops = [
      { color: '#000000', position: 0, opacity: 100 },
      { color: '#ff0000', position: 60, opacity: 100 },
      { color: '#ffffff', position: 100, opacity: 100 },
    ];
    expect(sampleGradientHex(stops, 0)).toBe('#000000');
    expect(sampleGradientHex(stops, 0.6)).toBe('#ff0000');
    expect(sampleGradientHex(stops, 1)).toBe('#ffffff');
  });

  it('normalizeGradientSettings migrates legacy start/end values', () => {
    const settings = normalizeGradientSettings({
      start: 'bad',
      end: '#112233',
      angle: 999,
      type: 'radial',
    });
    expect(settings.stops[0]?.color).toMatch(/^#/);
    expect(settings.stops[settings.stops.length - 1]?.color).toBe('#112233');
    expect(settings.angle).toBe(360);
    expect(settings.type).toBe('radial');
  });

  it('gradientPreviewCss returns css for linear and radial modes', () => {
    expect(gradientPreviewCss({
      type: 'linear',
      angle: 45,
      stops: [
        { color: '#111111', position: 0, opacity: 100 },
        { color: '#eeeeee', position: 100, opacity: 100 },
      ],
    })).toContain('linear-gradient(45deg');
    expect(gradientPreviewCss({
      type: 'radial',
      angle: 0,
      stops: [
        { color: '#111111', position: 0, opacity: 100 },
        { color: '#eeeeee', position: 100, opacity: 100 },
      ],
    })).toContain('radial-gradient');
  });
});

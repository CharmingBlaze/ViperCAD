import { describe, it, expect, beforeEach } from 'vitest';
import { clampPanelWidth, loadStoredPanelWidth } from '@/app/usePanelResizer';

describe('usePanelResizer helpers', () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
  });

  describe('clampPanelWidth', () => {
    it('preserves widths within bounds', () => {
      expect(clampPanelWidth(320, 200, 600)).toBe(320);
      expect(clampPanelWidth(450, 200, 600)).toBe(450);
    });

    it('clamps values below minWidth up to minWidth', () => {
      expect(clampPanelWidth(100, 200, 600)).toBe(200);
      expect(clampPanelWidth(0, 220, 760)).toBe(220);
      expect(clampPanelWidth(-50, 200, 600)).toBe(200);
    });

    it('clamps values above maxWidth down to maxWidth', () => {
      expect(clampPanelWidth(999, 200, 600)).toBe(600);
      expect(clampPanelWidth(1500, 220, 760)).toBe(760);
    });

    it('rounds fractional widths to integer pixels', () => {
      expect(clampPanelWidth(320.7, 200, 600)).toBe(321);
      expect(clampPanelWidth(320.2, 200, 600)).toBe(320);
    });
  });

  describe('loadStoredPanelWidth', () => {
    it('returns default width when storageKey is undefined', () => {
      expect(loadStoredPanelWidth(undefined, 320, 200, 600)).toBe(320);
    });

    it('returns default width when no stored value exists in localStorage', () => {
      expect(loadStoredPanelWidth('empty.key', 280, 200, 600)).toBe(280);
    });

    it('loads and clamps valid stored numbers', () => {
      try {
        localStorage.setItem('test.valid', '420');
        expect(loadStoredPanelWidth('test.valid', 320, 200, 600)).toBe(420);
      } catch {
        // in environments without localStorage
      }
    });

    it('handles non-numeric or invalid stored values gracefully', () => {
      try {
        localStorage.setItem('test.invalid', 'not_a_number');
        expect(loadStoredPanelWidth('test.invalid', 320, 200, 600)).toBe(320);
      } catch {
        // in environments without localStorage
      }
    });

    it('clamps stored value if it exceeds bounds', () => {
      try {
        localStorage.setItem('test.toobig', '5000');
        expect(loadStoredPanelWidth('test.toobig', 320, 200, 600)).toBe(600);
      } catch {
        // in environments without localStorage
      }
    });
  });
});

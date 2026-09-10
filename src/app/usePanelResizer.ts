import { useState, useRef, useEffect, useCallback } from 'react';

export type UsePanelResizerOptions = {
  storageKey?: string;
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
  side?: 'left' | 'right';
  externalWidth?: number;
  onWidthCommit?: (width: number) => void;
  onBeginResize?: () => void;
  onEndResize?: () => void;
};

export function clampPanelWidth(
  width: number,
  minWidth: number = 200,
  maxWidth: number = 760
): number {
  const maxW =
    typeof window !== 'undefined'
      ? Math.max(minWidth + 100, Math.min(window.innerWidth * 0.7, maxWidth))
      : maxWidth;
  return Math.round(Math.max(minWidth, Math.min(maxW, width)));
}

export function loadStoredPanelWidth(
  storageKey?: string,
  defaultWidth: number = 320,
  minWidth: number = 200,
  maxWidth: number = 760
): number {
  if (storageKey) {
    try {
      if (typeof localStorage !== 'undefined') {
        const val = localStorage.getItem(storageKey);
        if (val) {
          const parsed = Number(val);
          if (!Number.isNaN(parsed) && parsed >= minWidth) {
            return clampPanelWidth(parsed, minWidth, maxWidth);
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return defaultWidth;
}

/**
 * Hook providing smooth, robust, pointer-captured width resizing for docked side panels.
 * Supports localStorage persistence, responsive clamping, double-click reset, left/right side docks, and zero-latency dragging.
 */
export function usePanelResizer({
  storageKey,
  defaultWidth,
  minWidth = 200,
  maxWidth = 760,
  side = 'right',
  externalWidth,
  onWidthCommit,
  onBeginResize,
  onEndResize,
}: UsePanelResizerOptions) {
  const clampWidth = useCallback(
    (w: number) => clampPanelWidth(w, minWidth, maxWidth),
    [minWidth, maxWidth]
  );

  const loadInitialWidth = useCallback(() => {
    if (externalWidth !== undefined) {
      return clampWidth(externalWidth);
    }
    return loadStoredPanelWidth(storageKey, defaultWidth, minWidth, maxWidth);
  }, [externalWidth, storageKey, clampWidth, defaultWidth, minWidth, maxWidth]);

  const [width, setWidth] = useState<number>(loadInitialWidth);
  const [isResizing, setIsResizing] = useState(false);
  const isDragging = useRef(false);
  const widthRef = useRef(width);
  widthRef.current = width;
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Sync with external width if supplied (e.g. workspace preferences)
  useEffect(() => {
    if (externalWidth !== undefined && !isDragging.current) {
      setWidth(clampWidth(externalWidth));
    }
  }, [externalWidth, clampWidth]);

  const saveWidth = useCallback(
    (committedWidth: number) => {
      if (storageKey) {
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(storageKey, String(committedWidth));
          }
        } catch {
          // ignore
        }
      }
      onWidthCommit?.(committedWidth);
    },
    [storageKey, onWidthCommit]
  );

  const calculateWidth = useCallback(
    (clientX: number) => {
      if (!containerRef.current) return widthRef.current;
      const rect = containerRef.current.getBoundingClientRect();
      const rawWidth = side === 'left' ? clientX - rect.left : rect.right - clientX;
      return clampWidth(rawWidth);
    },
    [side, clampWidth]
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      isDragging.current = true;
      setIsResizing(true);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      onBeginResize?.();
    },
    [onBeginResize]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging.current || !containerRef.current) return;
      const next = calculateWidth(event.clientX);
      setWidth(next);
      widthRef.current = next;
    },
    [calculateWidth]
  );

  const finishDrag = useCallback(
    (event?: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging.current) return;
      if (event) {
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          // ignore
        }
      }
      isDragging.current = false;
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      saveWidth(widthRef.current);
      onEndResize?.();
    },
    [saveWidth, onEndResize]
  );

  const onDoubleClick = useCallback(() => {
    const next = defaultWidth;
    setWidth(next);
    widthRef.current = next;
    saveWidth(next);
  }, [defaultWidth, saveWidth]);

  // Window fallbacks in case pointer capture is unsupported or cancelled
  useEffect(() => {
    const onWindowMove = (e: PointerEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const next = calculateWidth(e.clientX);
      setWidth(next);
      widthRef.current = next;
    };

    const onWindowUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        setIsResizing(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        saveWidth(widthRef.current);
        onEndResize?.();
      }
    };

    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowUp);
    return () => {
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onWindowUp);
    };
  }, [calculateWidth, saveWidth, onEndResize]);

  return {
    width,
    setWidth,
    isResizing,
    containerRef,
    resizerProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishDrag,
      onPointerCancel: finishDrag,
      onDoubleClick,
    },
    resetWidth: onDoubleClick,
  };
}

import { marqueeModeFromDrag, normalizeScreenRect } from '@/core/selection/MarqueeSelect';

export type OverlayMarquee = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type OverlayPointer = Pick<PointerEvent, 'clientX' | 'clientY'>;

/** Owns transient DOM chrome drawn over the WebGL canvas. */
export class ViewportInteractionOverlay {
  private host: HTMLElement | null = null;
  private marquee: HTMLDivElement | null = null;
  private snap: HTMLDivElement | null = null;

  attach(host: HTMLElement): void {
    if (this.host === host) return;
    this.detach();
    this.host = host;
  }

  detach(): void {
    this.marquee?.remove();
    this.snap?.remove();
    this.marquee = null;
    this.snap = null;
    this.host = null;
  }

  updateSnap(event: OverlayPointer | null, label: string): void {
    const element = this.ensureSnap();
    if (!element) return;
    if (!event || label === 'none') {
      element.style.display = 'none';
      return;
    }
    const hostRect = this.host?.getBoundingClientRect();
    if (!hostRect) return;
    element.textContent = label;
    element.dataset.snap = label.replace(/\s+/g, '-');
    element.style.display = 'block';
    element.style.left = `${event.clientX - hostRect.left}px`;
    element.style.top = `${event.clientY - hostRect.top}px`;
  }

  updateTransform(event: OverlayPointer | null, label: string): void {
    const element = this.ensureSnap();
    if (!element) return;
    if (!event || !label) {
      element.style.display = 'none';
      element.classList.remove('is-transform');
      return;
    }
    const hostRect = this.host?.getBoundingClientRect();
    if (!hostRect) return;
    element.textContent = label;
    element.dataset.snap = 'transform';
    element.classList.add('is-transform');
    element.style.display = 'block';
    element.style.left = `${event.clientX - hostRect.left}px`;
    element.style.top = `${event.clientY - hostRect.top}px`;
  }

  updateMarquee(state: OverlayMarquee | null): void {
    const element = this.ensureMarquee();
    if (!element) return;
    if (!state) {
      element.style.display = 'none';
      element.classList.remove('is-crossing', 'is-window');
      return;
    }
    const rect = normalizeScreenRect(state.startX, state.startY, state.currentX, state.currentY);
    const mode = marqueeModeFromDrag(state.startX, state.currentX);
    element.style.display = 'block';
    element.style.left = `${rect.minX}px`;
    element.style.top = `${rect.minY}px`;
    element.style.width = `${Math.max(1, rect.maxX - rect.minX)}px`;
    element.style.height = `${Math.max(1, rect.maxY - rect.minY)}px`;
    element.classList.toggle('is-crossing', mode === 'crossing');
    element.classList.toggle('is-window', mode === 'window');
  }

  private ensureMarquee(): HTMLDivElement | null {
    if (this.marquee) return this.marquee;
    if (!this.host) return null;
    const element = document.createElement('div');
    element.className = 'selection-marquee';
    element.setAttribute('aria-hidden', 'true');
    element.style.display = 'none';
    this.host.appendChild(element);
    this.marquee = element;
    return element;
  }

  private ensureSnap(): HTMLDivElement | null {
    if (this.snap) return this.snap;
    if (!this.host) return null;
    const element = document.createElement('div');
    element.className = 'snap-indicator';
    element.setAttribute('aria-hidden', 'true');
    element.style.display = 'none';
    this.host.appendChild(element);
    this.snap = element;
    return element;
  }
}

/** Central keyboard / pointer ownership checks. */

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('[data-block-shortcuts="true"]'));
}

export type InputOwner =
  | 'none'
  | 'divider'
  | 'viewport'
  | 'panel'
  | 'text'
  | 'tool'
  | 'transform';

export class InputRouter {
  owner: InputOwner = 'none';

  begin(owner: InputOwner): void {
    this.owner = owner;
  }

  end(owner: InputOwner): void {
    if (this.owner === owner) this.owner = 'none';
  }

  /** Modal transform owns pointer/keyboard ahead of viewport navigation. */
  isTransformOwned(): boolean {
    return this.owner === 'transform';
  }

  /** Whether Tab should toggle viewport maximize. */
  canHandleTab(event: KeyboardEvent): boolean {
    if (event.key !== 'Tab') return false;
    if (isTypingTarget(event.target)) return false;
    if (this.owner === 'divider' || this.owner === 'text' || this.owner === 'transform') return false;
    return true;
  }
}

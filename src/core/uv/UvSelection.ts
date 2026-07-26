import type { FaceCornerId, FaceId } from '@/core/mesh/types';
import type { SelectionOp } from '@/core/selection/SelectionManager';

/** Editor-only UV corner selection (face corners), separate from 3D component picks. */
export type UvSelectionState = {
  selectedCornerIds: Set<FaceCornerId>;
  activeCornerId: FaceCornerId | null;
};

export function createEmptyUvSelection(): UvSelectionState {
  return { selectedCornerIds: new Set(), activeCornerId: null };
}

export class UvSelection {
  state: UvSelectionState = createEmptyUvSelection();

  clear(): void {
    this.state.selectedCornerIds.clear();
    this.state.activeCornerId = null;
  }

  selectCorners(ids: Iterable<FaceCornerId>, op: SelectionOp = 'replace'): void {
    const list = [...ids];
    if (op === 'replace') {
      this.state.selectedCornerIds.clear();
      for (const id of list) this.state.selectedCornerIds.add(id);
    } else {
      for (const id of list) {
        if (op === 'add') this.state.selectedCornerIds.add(id);
        else if (op === 'remove') this.state.selectedCornerIds.delete(id);
        else if (this.state.selectedCornerIds.has(id)) this.state.selectedCornerIds.delete(id);
        else this.state.selectedCornerIds.add(id);
      }
    }
    this.state.activeCornerId = list[list.length - 1] ?? this.state.activeCornerId;
    if (this.state.activeCornerId && !this.state.selectedCornerIds.has(this.state.activeCornerId)) {
      this.state.activeCornerId = this.state.selectedCornerIds.values().next().value ?? null;
    }
  }

  has(id: FaceCornerId): boolean {
    return this.state.selectedCornerIds.has(id);
  }

  get size(): number {
    return this.state.selectedCornerIds.size;
  }

  /** Faces that own any currently selected UV corner. */
  facesFromCorners(cornerToFace: Map<FaceCornerId, FaceId>): FaceId[] {
    const faces = new Set<FaceId>();
    for (const id of this.state.selectedCornerIds) {
      const faceId = cornerToFace.get(id);
      if (faceId) faces.add(faceId);
    }
    return [...faces];
  }
}

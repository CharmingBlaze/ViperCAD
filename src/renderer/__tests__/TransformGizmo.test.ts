import { describe, expect, it } from 'vitest';
import { Mesh, type MeshBasicMaterial } from 'three';
import { parseHexColor, themeById } from '@/app/theme/themeTokens';
import { TransformGizmo } from '@/renderer/TransformGizmo';

function handleHexes(gizmo: TransformGizmo): number[] {
  const hexes: number[] = [];
  gizmo.root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    const material = obj.material as MeshBasicMaterial;
    if (!material?.color || material.visible === false) return;
    hexes.push(material.color.getHex());
  });
  return hexes;
}

describe('TransformGizmo', () => {
  it('restores axis colours when switching back to a previous theme', () => {
    const gizmo = new TransformGizmo();
    gizmo.applyPalette(themeById('phosphor').palette);
    expect(handleHexes(gizmo)).toContain(parseHexColor(themeById('phosphor').palette.gizmoY));
    gizmo.applyPalette(themeById('synthwave').palette);
    const obsidian = themeById('obsidian').palette;
    gizmo.applyPalette(obsidian);
    const hexes = handleHexes(gizmo);
    expect(hexes).toContain(parseHexColor(obsidian.gizmoX));
    expect(hexes).toContain(parseHexColor(obsidian.gizmoY));
    expect(hexes).toContain(parseHexColor(obsidian.gizmoZ));
    expect(hexes).not.toContain(parseHexColor(themeById('phosphor').palette.gizmoY));
  });
});

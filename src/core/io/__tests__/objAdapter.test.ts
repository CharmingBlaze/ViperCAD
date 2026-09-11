import { describe, expect, it } from 'vitest';
import { exportObj, importObj } from '@/core/io/ObjAdapter';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { firstMeshValidationError } from '@/core/persistence/projectHealth';

describe('OBJ import', () => {
  it('round-trips a box with valid topology', () => {
    const mesh = importObj(exportObj(buildBox({ width: 1, height: 1, depth: 1 })));
    expect(firstMeshValidationError(mesh)).toBeNull();
    expect(mesh.faces.size).toBe(6);
  });

  it('refuses an out-of-range vertex index', () => {
    expect(() => importObj('v 0 0 0\nf 1 2 3\n')).toThrow(/out of range/);
  });

  it('refuses duplicate faces that break topology', () => {
    expect(() =>
      importObj(`
        v 0 0 0
        v 1 0 0
        v 0 1 0
        f 1 2 3
        f 1 2 3
      `),
    ).toThrow(/winding|validation|duplicate/i);
  });
});

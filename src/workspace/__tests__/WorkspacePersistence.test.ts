import { describe, expect, it } from 'vitest';
import { DEFAULT_CAMERAS, startupCamera } from '@/workspace/WorkspacePersistence';

describe('workspace camera defaults', () => {
  it('starts orthographic views close to the construction grid', () => {
    expect(DEFAULT_CAMERAS.top.orthoHeight).toBe(8);
    expect(DEFAULT_CAMERAS.front.orthoHeight).toBe(8);
    expect(DEFAULT_CAMERAS.right.orthoHeight).toBe(8);
  });

  it('returns a fresh default instead of a reusable persisted camera object', () => {
    const first = startupCamera('top');
    first.position[0] = 999;
    first.target[2] = 999;
    const next = startupCamera('top');
    expect(next).toEqual(DEFAULT_CAMERAS.top);
  });

  it('starts perspective from its standard position every time', () => {
    expect(startupCamera('persp')).toEqual(DEFAULT_CAMERAS.persp);
  });
});

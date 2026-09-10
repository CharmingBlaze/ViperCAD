import { describe, expect, it } from 'vitest';
import {
  calibrateReferenceScale,
  createDefaultReferenceImage,
  createEmptyBlockoutReferenceState,
  getReferenceImageDimensions,
  referencePlanesForPane,
  snapReferenceToGround,
  centerReferenceHorizontally,
} from '../ReferenceImages';

describe('ReferenceImages helpers', () => {
  it('computes correct dimensions from scale and aspect ratio', () => {
    const config = createDefaultReferenceImage('blob:test', 'front', 'Blueprint', 1.5);
    config.scale = 2.0;
    const dims = getReferenceImageDimensions(config);
    expect(dims.height).toBe(2.0);
    expect(dims.width).toBe(3.0);
  });

  it('calibrates scale based on measured distance vs target real-world distance', () => {
    const newScale = calibrateReferenceScale(2.0, 0.8, 1.6);
    expect(newScale).toBeCloseTo(4.0);
  });

  it('snaps reference image to ground plane (Y=0)', () => {
    const config = createDefaultReferenceImage('blob:test', 'front', 'Blueprint', 1.0);
    config.scale = 3.0;
    config.posY = 0;
    snapReferenceToGround(config);
    expect(config.posY).toBe(1.5);
  });

  it('centers reference image horizontally', () => {
    const front = createDefaultReferenceImage('blob:test', 'front', 'Front', 1.0);
    front.posX = 12.5;
    centerReferenceHorizontally(front);
    expect(front.posX).toBe(0);

    const side = createDefaultReferenceImage('blob:test', 'side', 'Side', 1.0);
    side.posZ = -7.2;
    centerReferenceHorizontally(side);
    expect(side.posZ).toBe(0);
  });

  it('shows a front blueprint in Front and Perspective, not Side', () => {
    const state = createEmptyBlockoutReferenceState();
    state.front = createDefaultReferenceImage('blob:front', 'front', 'Front.png', 1);
    expect(referencePlanesForPane('front', state)).toEqual({ front: true, side: false });
    expect(referencePlanesForPane('right', state)).toEqual({ front: false, side: false });
    expect(referencePlanesForPane('persp', state)).toEqual({ front: true, side: false });
    state.showInPersp = false;
    expect(referencePlanesForPane('persp', state)).toEqual({ front: false, side: false });
  });
});

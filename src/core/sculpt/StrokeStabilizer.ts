import { addVec3, lerpVec3, scaleVec3, subVec3, type Vec3 } from '@/core/math/Vec3';

export class StrokeStabilizer {
  enabled = false;
  /** Radius of the leash distance before the brush is pulled (0 = pure smooth, > 0 = lazy rope) */
  leashLength = 0.04;
  /** Smoothing inertia [0..0.95] */
  factor = 0.5;

  private currentSmoothed: Vec3 | null = null;
  private currentRaw: Vec3 | null = null;

  reset(): void {
    this.currentSmoothed = null;
    this.currentRaw = null;
  }

  update(rawPos: Vec3): { smoothed: Vec3; raw: Vec3 } {
    this.currentRaw = rawPos;
    if (!this.enabled || !this.currentSmoothed) {
      this.currentSmoothed = { ...rawPos };
      return { smoothed: this.currentSmoothed, raw: rawPos };
    }

    const delta = subVec3(rawPos, this.currentSmoothed);
    const dist = Math.hypot(delta.x, delta.y, delta.z);

    if (this.leashLength > 0) {
      if (dist > this.leashLength) {
        const pullDir = scaleVec3(delta, 1 / dist);
        const target = addVec3(rawPos, scaleVec3(pullDir, -this.leashLength));
        this.currentSmoothed = lerpVec3(this.currentSmoothed, target, 1 - this.factor * 0.5);
      }
    } else {
      this.currentSmoothed = lerpVec3(this.currentSmoothed, rawPos, 1 - this.factor);
    }

    return { smoothed: this.currentSmoothed, raw: rawPos };
  }

  getSmoothed(): Vec3 | null {
    return this.currentSmoothed;
  }

  getRaw(): Vec3 | null {
    return this.currentRaw;
  }
}

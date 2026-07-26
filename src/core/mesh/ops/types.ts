import type { TopologyChangeResult } from '@/core/mesh/types';
import type { Vec3 } from '@/core/math/Vec3';

export type GeometryError = {
  code: string;
  message: string;
  affectedElementIds: string[];
  recoverable: boolean;
  suggestedRepair?: string;
};

export type GeometryOpResult<T = void> = {
  ok: boolean;
  value?: T;
  change: TopologyChangeResult;
  error?: GeometryError;
  warnings: string[];
};

export type ExtrudeParams = {
  distance: number;
  direction?: Vec3;
  /** Average region normal (default) vs individual face normals. */
  mode?: 'region' | 'individual';
  keepOriginalFaces?: boolean;
  sideMaterialSlot?: number;
};

export type InsetParams = {
  thickness: number;
  depth?: number;
  individual?: boolean;
};

export type BevelParams = {
  width: number;
  segments?: number;
  profile?: number;
};

export type SolidifyParams = {
  thickness: number;
  /** -1 = shell inward from original, 0 = centered, 1 = outward. Default -1. */
  offset?: number;
};

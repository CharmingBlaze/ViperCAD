import type { EditableMesh } from '@/core/mesh/types';

export type PrimitiveBuilderId =
  | 'box'
  | 'plane'
  | 'cylinder'
  | 'cone'
  | 'sphere'
  | 'icosphere'
  | 'capsule'
  | 'pyramid'
  | 'ramp'
  | 'stairs'
  | 'arch'
  | 'torus'
  | 'tube'
  | 'circle'
  | 'ring'
  | 'polygon'
  | 'star'
  | 'prism'
  | 'wedge'
  | 'octahedron';

export type PrimitiveBuilder<TOptions> = {
  id: PrimitiveBuilderId;
  label: string;
  defaultOptions: TOptions;
  build: (options: TOptions) => EditableMesh;
};

import { BlockoutVectorTool } from './BlockoutVectorTool';

/** Same click-to-silhouette as Flat, with a live boxy thickness preview. */
export class BlockoutSolidTool extends BlockoutVectorTool {
  id = 'blockout-solid' as const;
  label = 'Square';
}

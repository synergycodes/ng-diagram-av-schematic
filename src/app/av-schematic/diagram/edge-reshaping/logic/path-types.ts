export type EdgeEndpointSide = 'source' | 'target';

export type Orientation = 'horizontal' | 'vertical';

export interface SegmentHandle {
  x: number;
  y: number;
  segmentIndex: number;
  axis: Orientation;
}

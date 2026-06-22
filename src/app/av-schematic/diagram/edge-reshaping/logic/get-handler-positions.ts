import { type Point } from 'ng-diagram';
import { type SegmentHandle } from './path-types';
import { segmentMidpoint } from './point-array';
import { segmentAxis } from './segment-axis';

/**
 * One reshape handle per orthogonal segment, sitting at the segment midpoint.
 * The axis is coordinate-derived (works for any port side); oblique or
 * degenerate segments are skipped. End segments are included — dragging one
 * grows a new segment off the anchored port. Empty for paths shorter than a
 * single segment so callers don't need to guard.
 */
export const getHandlerPositions = (points: readonly Point[]): SegmentHandle[] => {
  const handles: SegmentHandle[] = [];
  if (points.length < 2) return handles;

  for (let i = 0; i < points.length - 1; i++) {
    const axis = segmentAxis(points[i], points[i + 1]);
    if (axis === null) continue;
    const mid = segmentMidpoint(points[i], points[i + 1]);
    handles.push({ x: mid.x, y: mid.y, segmentIndex: i, axis });
  }

  return handles;
};

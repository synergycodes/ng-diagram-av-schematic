import { type Point } from 'ng-diagram';
import { type Orientation } from './path-types';

/**
 * Slides one orthogonal segment to a new perpendicular coordinate. Both of the
 * segment's vertices move together so the segment stays straight; neighbours are
 * left untouched — because each neighbour shares only the moved coordinate's
 * *other* axis with this segment, they stay orthogonal automatically.
 *
 * `target` is the new shared coordinate on the perpendicular axis: the y for a
 * horizontal segment, the x for a vertical one. Out-of-range indices return a
 * copy unchanged. Grid snapping is a command-layer concern (see reshapeEdge),
 * not applied here.
 */
export const moveSegment = (
  points: readonly Point[],
  segmentIndex: number,
  axis: Orientation,
  target: number,
): Point[] => {
  const result = points.map((p) => ({ ...p }));
  if (segmentIndex < 0 || segmentIndex >= result.length - 1) return result;

  if (axis === 'horizontal') {
    result[segmentIndex].y = target;
    result[segmentIndex + 1].y = target;
  } else {
    result[segmentIndex].x = target;
    result[segmentIndex + 1].x = target;
  }

  return result;
};

import { type Point } from 'ng-diagram';
import { POSITION_TOLERANCE } from './constants';

/**
 * Replaces each oblique segment with a vertical-first L-bend, leaving already
 * orthogonal segments untouched. Used per-move to mop up any diagonal left by
 * re-anchoring an endpoint to a drifted port or by a free end following its
 * node. The drag-end merge later folds any bend that turns out collinear.
 *
 * Vertical-first matches the top/bottom-port convention; for this app's
 * horizontal, static-port edges it is effectively a no-op (segments arrive
 * already orthogonal), but it keeps the per-move pipeline identical to SLD.
 */
export const orthogonalizePolyline = (points: readonly Point[]): Point[] => {
  if (points.length < 2) return points.map((p) => ({ x: p.x, y: p.y }));
  const result: Point[] = [{ x: points[0].x, y: points[0].y }];
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const sameX = Math.abs(prev.x - curr.x) < POSITION_TOLERANCE;
    const sameY = Math.abs(prev.y - curr.y) < POSITION_TOLERANCE;
    if (sameX || sameY) {
      result.push({ x: curr.x, y: curr.y });
      continue;
    }
    result.push({ x: prev.x, y: curr.y });
    result.push({ x: curr.x, y: curr.y });
  }
  return result;
};

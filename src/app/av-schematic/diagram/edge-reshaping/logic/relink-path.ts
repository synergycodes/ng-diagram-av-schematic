import type { Point } from 'ng-diagram';
import { ALIGNMENT_TOLERANCE } from './constants';
import { orthogonalizePolyline } from './orthogonalize';
import { removeStraightSegments } from './simplify';
import type { EdgeEndpointSide } from './types';

/**
 * The original route with one endpoint re-anchored at `position`, kept
 * orthogonal. Callers rebuild from the *original* points on every move so bends
 * never accumulate across a drag; the interior bends themselves are carried
 * through untouched, which is what "preserve the valid interior runs" means for
 * a relink or an endpoint move.
 *
 * `merge` folds the collinear L-bend `orthogonalizePolyline` may add -- pass it
 * only on drop, so the committed route matches the preview the user saw.
 */
export const rebuildEndpointPath = (
  points: readonly Point[],
  side: EdgeEndpointSide,
  position: Point,
  merge: boolean,
): Point[] => {
  const next = points.map((p) => ({ x: p.x, y: p.y }));
  if (next.length === 0) return next;
  next[side === 'source' ? 0 : next.length - 1] = { x: position.x, y: position.y };
  const ortho = orthogonalizePolyline(next);
  return merge ? removeStraightSegments(ortho, ALIGNMENT_TOLERANCE) : ortho;
};

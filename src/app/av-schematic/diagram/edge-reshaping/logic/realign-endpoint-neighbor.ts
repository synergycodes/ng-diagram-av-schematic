import { type Point } from 'ng-diagram';
import { type EdgeEndpointSide, type Orientation } from './path-types';

/**
 * Snaps the endpoint's neighbour back onto the given axis, undoing the
 * sub-pixel drift introduced when the endpoint is re-anchored to its live
 * port. `axis` is the end segment's orientation captured *before* the
 * re-anchor (see {@link endpointNeighborAxis}); a `null` axis (oblique end)
 * is a no-op. Mutates and returns `points`.
 */
export const realignEndpointNeighbor = (
  points: Point[],
  side: EdgeEndpointSide,
  axis: Orientation | null,
): Point[] => {
  if (axis === null || points.length < 2) return points;
  const endIndex = side === 'source' ? 0 : points.length - 1;
  const neighborIndex = side === 'source' ? 1 : points.length - 2;
  if (axis === 'vertical') {
    points[neighborIndex] = { x: points[endIndex].x, y: points[neighborIndex].y };
  } else {
    points[neighborIndex] = { x: points[neighborIndex].x, y: points[endIndex].y };
  }
  return points;
};

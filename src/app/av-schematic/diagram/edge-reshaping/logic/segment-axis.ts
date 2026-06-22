import { type Point } from 'ng-diagram';
import { POSITION_TOLERANCE } from './constants';
import { type EdgeEndpointSide, type Orientation } from './path-types';

/**
 * The orthogonal axis of the segment between `a` and `b`, derived purely from
 * coordinates — `null` when the segment is oblique or degenerate (collocated).
 * Coordinate-derived (not source-orientation parity) so it holds for any port
 * side, including top/bottom (vertical) ports.
 */
export const segmentAxis = (a: Point, b: Point): Orientation | null => {
  const sameX = Math.abs(a.x - b.x) < POSITION_TOLERANCE;
  const sameY = Math.abs(a.y - b.y) < POSITION_TOLERANCE;
  if (sameY && !sameX) return 'horizontal';
  if (sameX && !sameY) return 'vertical';
  return null;
};

/** The axis of the end segment on the given side, or null if oblique/too short. */
export const endpointNeighborAxis = (
  points: readonly Point[],
  side: EdgeEndpointSide,
): Orientation | null => {
  if (points.length < 2) return null;
  const endIndex = side === 'source' ? 0 : points.length - 1;
  const neighborIndex = side === 'source' ? 1 : points.length - 2;
  return segmentAxis(points[endIndex], points[neighborIndex]);
};

/**
 * The orientation to feed parity-based passes (`correctPath`, `snapToGrid`):
 * the actual axis of the first segment, not the source port's. A wire grown at
 * the source exits perpendicular to its port, so the port axis is wrong there;
 * the first segment's coordinate-derived axis is always right for a clean
 * orthogonal path. Falls back to `fallback` (the port axis) for a degenerate
 * first segment.
 */
export const pathSourceOrientation = (
  points: readonly Point[],
  fallback: Orientation,
): Orientation => (points.length >= 2 ? (segmentAxis(points[0], points[1]) ?? fallback) : fallback);

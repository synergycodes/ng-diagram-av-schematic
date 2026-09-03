import type { Point } from 'ng-diagram';
import {
  ROUTE_POSITION_TOLERANCE_PX,
  collapseCollinearRouteBends,
  dropSameAxisRouteBends,
  normalizePersistedRoute,
} from '../../model/persisted-wire-route.mjs';

// Fold genuinely redundant interior points. A point folds only when collinear
// with its neighbours AND between them (a straight pass-through); a U-turn
// extremum is a real bend (e.g. a collapsed reshape) and is kept.
export const collapseCollinearBends = (points: readonly Point[]): Point[] => {
  return collapseCollinearRouteBends(points);
};

// `b` within [a, c] (either order), with tolerance -- pass-through vs U-turn.
const isBetween = (a: number, b: number, c: number, tolerance: number): boolean =>
  b >= Math.min(a, c) - tolerance && b <= Math.max(a, c) + tolerance;

// Fold a route to its minimal set of bends: collinear pass-throughs, then
// same-axis near-collinear runs. A visually straight run becomes one segment.
export const normalizeRoute = (points: readonly Point[] | undefined): Point[] => {
  if (!points) return [];
  return normalizePersistedRoute(points);
};

// Drop interior pass-through points whose incoming/outgoing segments share a
// dominant axis. Looser than `collapseCollinearBends` -- catches quasi-collinear
// 3-point routes left sub-grid-misaligned by the reshape. The between check is
// essential: a same-axis extremum is a valid reversal, not a redundant bend.
export const dropSameAxisBends = (points: readonly Point[]): Point[] => {
  return dropSameAxisRouteBends(points);
};

/**
 * Drop collinear interior points within the given tolerance, merging three
 * consecutive segments into one when the middle bend is (nearly) on the line
 * from its neighbours. Always preserves the source and target endpoints.
 */
export const removeStraightSegments = (
  points: readonly Point[],
  alignmentTolerance: number,
): Point[] => {
  if (points.length < 3) return points.slice();

  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const next = points[i + 1];

    const xAligned =
      Math.abs(prev.x - curr.x) <= alignmentTolerance &&
      Math.abs(curr.x - next.x) <= alignmentTolerance;
    const yAligned =
      Math.abs(prev.y - curr.y) <= alignmentTolerance &&
      Math.abs(curr.y - next.y) <= alignmentTolerance;

    // A loose match around `curr` is not enough: removing it joins `prev`
    // directly to `next`, so those endpoints must still form a persisted
    // orthogonal segment. Otherwise a near-grid endpoint can become a tiny
    // diagonal that save/open correctly rejects.
    const verticalPassThrough =
      xAligned &&
      Math.abs(prev.x - next.x) < ROUTE_POSITION_TOLERANCE_PX &&
      isBetween(prev.y, curr.y, next.y, alignmentTolerance);
    const horizontalPassThrough =
      yAligned &&
      Math.abs(prev.y - next.y) < ROUTE_POSITION_TOLERANCE_PX &&
      isBetween(prev.x, curr.x, next.x, alignmentTolerance);

    if (verticalPassThrough || horizontalPassThrough) continue;
    result.push(curr);
  }
  result.push(points[points.length - 1]);
  return result;
};

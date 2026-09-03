// Explicit bend (waypoint) editing for orthogonal routes: create a bend on a
// segment, drag a single bend, delete a bend. Complements `reshape-segment.ts`,
// which slides a whole segment -- these three act on one vertex.
//
// Pure geometry: no model access, no DOM. Every function keeps the polyline
// orthogonal and never moves the two endpoints (they are port-anchored; the
// callers re-anchor them to live ports afterwards).
import type { Point } from 'ng-diagram';
import { POSITION_TOLERANCE_PX } from './constants';
import { orthogonalizePolyline } from './orthogonalize';
import { segmentAxis } from './segment-axis';
import { collapseCollinearBends, dropSameAxisBends } from './simplify';
import type { Orientation } from './types';

/** Perpendicular jog applied by `insertBendAt` when snapping is off. */
export const DEFAULT_BEND_OFFSET_PX = 20;

/** One draggable/deletable interior vertex of a route. */
export interface BendHandle {
  readonly bendIndex: number;
  readonly point: Point;
}

/** Actual direction changes in a route, retaining their persisted point indices. */
export const findBendHandles = (points: readonly Point[] | undefined): BendHandle[] => {
  if (!points || points.length < 3) return [];
  const handles: BendHandle[] = [];
  for (let i = 1; i <= points.length - 2; i++) {
    const incomingAxis = segmentAxis(points[i - 1], points[i]);
    const outgoingAxis = segmentAxis(points[i], points[i + 1]);
    if (incomingAxis === null || outgoingAxis === null) continue;
    if (
      incomingAxis === outgoingAxis &&
      isPassThrough(points[i - 1], points[i], points[i + 1], incomingAxis)
    ) {
      continue;
    }
    handles.push({ bendIndex: i, point: { x: points[i].x, y: points[i].y } });
  }
  return handles;
};

const isPassThrough = (
  previous: Point,
  current: Point,
  next: Point,
  axis: Orientation,
): boolean => {
  const before = axis === 'horizontal' ? previous.x : previous.y;
  const at = axis === 'horizontal' ? current.x : current.y;
  const after = axis === 'horizontal' ? next.x : next.y;
  return (
    at >= Math.min(before, after) - POSITION_TOLERANCE_PX &&
    at <= Math.max(before, after) + POSITION_TOLERANCE_PX
  );
};

/** True when every consecutive pair is axis-aligned (zero-length pairs count). */
export const isOrthogonalPolyline = (points: readonly Point[]): boolean => {
  for (let i = 0; i < points.length - 1; i++) {
    const sameX = Math.abs(points[i].x - points[i + 1].x) < POSITION_TOLERANCE_PX;
    const sameY = Math.abs(points[i].y - points[i + 1].y) < POSITION_TOLERANCE_PX;
    if (!sameX && !sameY) return false;
  }
  return true;
};

/**
 * Insert a bend on `segmentIndex` at `at`, as a jog that detours the segment
 * and comes back to it -- three new vertices, all axis-aligned, so the rest of
 * the route (and both port-anchored ends) is untouched.
 *
 * A single collinear waypoint would be folded away again by the drop-time
 * simplification passes; a jog is a real, visible pair of bends that survives
 * them and gives the user something to drag. The jog goes toward `at` and is
 * separated from the base line (`DEFAULT_BEND_OFFSET_PX` when snapping is off).
 *
 * Returns null when the segment is oblique/degenerate or too short to split.
 */
export const insertBendAt = (
  points: readonly Point[],
  segmentIndex: number,
  at: Point,
  grid: { x: number; y: number } | null,
): Point[] | null => {
  if (segmentIndex < 0 || segmentIndex + 1 >= points.length) return null;
  const start = points[segmentIndex];
  const end = points[segmentIndex + 1];
  const axis = segmentAxis(start, end);
  if (axis === null) return null;

  const result = points.map((p) => ({ x: p.x, y: p.y }));

  if (axis === 'horizontal') {
    const along = splitCoordinate(at.x, start.x, end.x, grid?.x);
    if (along === null) return null;
    const jog = jogCoordinate(start.y, at.y, grid?.y);
    result.splice(
      segmentIndex + 1,
      0,
      { x: along, y: start.y },
      { x: along, y: jog },
      { x: end.x, y: jog },
    );
    return result;
  }

  const along = splitCoordinate(at.y, start.y, end.y, grid?.y);
  if (along === null) return null;
  const jog = jogCoordinate(start.x, at.x, grid?.x);
  result.splice(
    segmentIndex + 1,
    0,
    { x: start.x, y: along },
    { x: jog, y: along },
    { x: jog, y: end.y },
  );
  return result;
};

/**
 * Delete the bend at `bendIndex`, together with the smallest run of neighbouring
 * bends needed to leave the route orthogonal with both endpoints fixed.
 *
 * Dropping a single vertex from an orthogonal polyline usually leaves a
 * diagonal, so a lone bend is rarely removable on its own -- the jog it belongs
 * to is. Widening windows are tried innermost-first, so the smallest edit that
 * still yields an orthogonal route wins. Returns null when no window works (an
 * L between two fixed ports has one structural bend that cannot go).
 */
export const removeBendAt = (points: readonly Point[], bendIndex: number): Point[] | null => {
  const lastBend = points.length - 2;
  if (bendIndex < 1 || bendIndex > lastBend) return null;

  for (const [from, to] of removalWindows(bendIndex, 1, lastBend)) {
    const candidate = [...points.slice(0, from), ...points.slice(to + 1)].map((p) => ({
      x: p.x,
      y: p.y,
    }));
    if (candidate.length < 2) continue;
    if (!isOrthogonalPolyline(candidate)) continue;
    return dropSameAxisBends(collapseCollinearBends(candidate));
  }
  return null;
};

/**
 * Move the bend at `bendIndex` to `target` (grid-snapped when `grid` is set),
 * sliding both segments that meet there.
 *
 * Interior neighbours follow along their shared axis so the corner stays
 * square. An endpoint neighbour is port-anchored and must not move, so the
 * diagonal left at that end is turned into an L-bend by `orthogonalizePolyline`
 * -- the same "grow a bend off the port" behaviour `reshapeAnchoredSegment` has.
 */
export const moveBendTo = (
  points: readonly Point[],
  bendIndex: number,
  target: Point,
  grid: { x: number; y: number } | null,
): Point[] | null => {
  if (bendIndex < 1 || bendIndex > points.length - 2) return null;

  const moved: Point = grid
    ? { x: Math.round(target.x / grid.x) * grid.x, y: Math.round(target.y / grid.y) * grid.y }
    : { x: target.x, y: target.y };

  const incomingAxis = segmentAxis(points[bendIndex - 1], points[bendIndex]);
  const outgoingAxis = segmentAxis(points[bendIndex], points[bendIndex + 1]);

  const result = points.map((p) => ({ x: p.x, y: p.y }));
  result[bendIndex] = moved;
  if (bendIndex - 1 > 0) alignNeighbor(result[bendIndex - 1], moved, incomingAxis);
  if (bendIndex + 1 < result.length - 1) alignNeighbor(result[bendIndex + 1], moved, outgoingAxis);

  return orthogonalizePolyline(result);
};

// Keep `neighbor` on the same axis-aligned segment as the moved bend.
const alignNeighbor = (neighbor: Point, moved: Point, axis: Orientation | null): void => {
  if (axis === 'horizontal') neighbor.y = moved.y;
  else if (axis === 'vertical') neighbor.x = moved.x;
};

// Where to split a segment running from `from` to `to`, clamped just inside it
// so neither half collapses to zero length. Null when the segment is too short.
const splitCoordinate = (
  requested: number,
  from: number,
  to: number,
  step: number | undefined,
): number | null => {
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  if (high - low <= 2 * POSITION_TOLERANCE_PX) return null;

  const minimum = low + POSITION_TOLERANCE_PX;
  const maximum = high - POSITION_TOLERANCE_PX;
  if (!step) return Math.min(Math.max(requested, minimum), maximum);

  // Clamp to the first/last *grid intersection* inside the segment. Clamping
  // an already-rounded coordinate to `minimum`/`maximum` would turn a click
  // near an endpoint into an off-grid value (for example 0 -> 1 on a 20 px
  // grid). If the segment contains no interior grid line, it cannot host a
  // snapped jog without collapsing one of its halves.
  const firstGrid = Math.ceil(minimum / step) * step;
  const lastGrid = Math.floor(maximum / step) * step;
  if (firstGrid > lastGrid) return null;
  const snapped = Math.round(requested / step) * step;
  return Math.min(Math.max(snapped, firstGrid), lastGrid);
};

// How deep the inserted jog goes, on the axis perpendicular to the segment:
// toward the pointer, snapped, and kept visibly separated from the base line.
const jogCoordinate = (base: number, requested: number, step: number | undefined): number => {
  const depth = step ?? DEFAULT_BEND_OFFSET_PX;
  const snapped = step ? Math.round(requested / step) * step : requested;
  if (Math.abs(snapped - base) >= depth / 2) return snapped;
  if (!step) return requested < base ? base - depth : base + depth;

  // `base` is commonly a port coordinate and need not lie on the global grid.
  // Select a real grid line on the requested side instead of adding one step
  // to that off-grid base. The half-step clearance matches the rule above and
  // makes the tie (`requested === base`) deterministic toward the positive side.
  return requested < base
    ? Math.floor((base - depth / 2) / step) * step
    : Math.ceil((base + depth / 2) / step) * step;
};

// Index windows containing `index`, narrowest first, clamped to [lo, hi].
const removalWindows = (index: number, lo: number, hi: number): [number, number][] => {
  const windows: [number, number][] = [];
  for (let width = 1; width <= hi - lo + 1; width++) {
    const first = Math.max(lo, index - width + 1);
    const last = Math.min(index, hi - width + 1);
    for (let from = first; from <= last; from++) {
      windows.push([from, from + width - 1]);
    }
  }
  return windows;
};

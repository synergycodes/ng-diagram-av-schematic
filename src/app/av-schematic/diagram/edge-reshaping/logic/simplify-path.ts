import { type Point } from 'ng-diagram';
import { ALIGNMENT_TOLERANCE, ENDPOINT_OFFSET, MAX_SAFE_ITERATIONS } from './constants';
import { correctPath } from './correct-path';
import { type Orientation } from './path-types';
import { removeStraightSegments } from './remove-straight-segments';
import { snapToGrid } from './snap-to-grid';

export interface SimplifyOptions {
  alignmentTolerance: number;
  endpointOffset: number;
  minInteriorBends: number;
  gridSize?: { x: number; y: number };
  sourceFree?: boolean;
  targetFree?: boolean;
}

const defaults: SimplifyOptions = {
  alignmentTolerance: ALIGNMENT_TOLERANCE,
  endpointOffset: ENDPOINT_OFFSET,
  minInteriorBends: 0,
};

const samePath = (a: readonly Point[], b: readonly Point[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].x !== b[i].x || a[i].y !== b[i].y) return false;
  }
  return true;
};

/**
 * Iteratively normalises a (possibly mid-drag-noisy) orthogonal path:
 * removes collinear bends, snaps drifted segments back to H/V alternation,
 * enforces the endpoint min-length, and optionally snaps to grid. Bails out
 * after MAX_SAFE_ITERATIONS — convergence is fast in practice but the loop
 * is bounded for safety.
 *
 * Honors `minInteriorBends`: if a collinear merge would drop below the
 * minimum, the bend is preserved and only the corrective pass runs.
 */
export const simplifyPath = (
  points: readonly Point[],
  sourceOrientation: Orientation,
  targetOrientation: Orientation,
  options?: Partial<SimplifyOptions>,
): Point[] => {
  const opts: SimplifyOptions = { ...defaults, ...options };
  let current = points.slice();

  for (let i = 0; i < MAX_SAFE_ITERATIONS; i++) {
    const previousLength = current.length;
    const removed = removeStraightSegments(current, opts.alignmentTolerance);
    const removedInterior = removed.length - 2;
    const candidate = removedInterior >= opts.minInteriorBends ? removed : current;

    let next = correctPath(candidate, sourceOrientation, targetOrientation, opts.endpointOffset);
    if (opts.gridSize)
      next = snapToGrid(next, opts.gridSize, sourceOrientation, {
        sourceFree: opts.sourceFree,
        targetFree: opts.targetFree,
      });

    if (samePath(next, current) && next.length === previousLength) return next;
    current = next;
  }

  return current;
};

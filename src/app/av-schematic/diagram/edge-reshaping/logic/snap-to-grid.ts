import { type Point } from 'ng-diagram';
import { expectedSegmentOrientation } from './expected-segment-orientation';
import { type Orientation } from './path-types';

export interface SnapToGridOptions {
  /** Source endpoint is dangling (not port-driven) — its stub segment may snap. */
  sourceFree?: boolean;
  /** Target endpoint is dangling (not port-driven) — its stub segment may snap. */
  targetFree?: boolean;
}

/**
 * Grid-snap that respects orthogonal-edge constraints:
 * - Port-driven endpoints are never snapped, and their stub segment is left
 *   aligned to the port (not snapped).
 * - A *dangling* endpoint isn't port-driven, so its stub segment IS snapped
 *   (enable via `sourceFree` / `targetFree`).
 * - Only the shared coord of a snappable segment is moved; propagating it to
 *   both segment endpoints preserves orthogonality and keeps constrained axes
 *   intact.
 */
export const snapToGrid = (
  points: readonly Point[],
  grid: { x: number; y: number },
  sourceOrientation: Orientation,
  options?: SnapToGridOptions,
): Point[] => {
  if (points.length < 2) return points.slice();

  const result = points.map((p) => ({ ...p }));

  const startSeg = options?.sourceFree ? 0 : 1;
  const endSeg = options?.targetFree ? result.length - 2 : result.length - 3;

  for (let segIdx = startSeg; segIdx <= endSeg; segIdx++) {
    const orient = expectedSegmentOrientation(segIdx, sourceOrientation);
    const a = result[segIdx];
    const b = result[segIdx + 1];

    if (orient === 'horizontal') {
      const snapped = Math.round(a.y / grid.y) * grid.y;
      a.y = snapped;
      b.y = snapped;
    } else {
      const snapped = Math.round(a.x / grid.x) * grid.x;
      a.x = snapped;
      b.x = snapped;
    }
  }

  return result;
};

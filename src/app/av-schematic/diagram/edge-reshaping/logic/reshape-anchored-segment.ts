import { type Point } from 'ng-diagram';
import { moveSegment } from './move-segment';
import { type Orientation } from './path-types';

/**
 * Reshapes an end segment that touches a port. The port endpoint must stay put,
 * so instead of dragging it we slide the segment to `target` and splice in an
 * elbow vertex — growing a new perpendicular segment that reconnects to the
 * fixed port. This is how a fresh segment is born by dragging the first or last
 * segment of a wire.
 *
 * `anchorSource` / `anchorTarget` say which ends are ports; only the matching
 * end of this segment grows an elbow. A single-segment wire (one segment that is
 * both first and last) grows an elbow at *both* ends. When neither anchor applies
 * to this segment it behaves like a plain {@link moveSegment}.
 */
export const reshapeAnchoredSegment = (
  points: readonly Point[],
  segmentIndex: number,
  axis: Orientation,
  target: number,
  anchorSource: boolean,
  anchorTarget: boolean,
): Point[] => {
  const shifted = moveSegment(points, segmentIndex, axis, target);
  const lastIndex = shifted.length - 1;
  const growAtSource = anchorSource && segmentIndex === 0;
  const growAtTarget = anchorTarget && segmentIndex + 1 === lastIndex;
  if (!growAtSource && !growAtTarget) return shifted;

  let result = shifted;

  if (growAtTarget) {
    const origTarget = points[lastIndex];
    const elbow: Point =
      axis === 'horizontal' ? { x: origTarget.x, y: target } : { x: target, y: origTarget.y };
    result = [...result.slice(0, lastIndex), elbow, { x: origTarget.x, y: origTarget.y }];
  }

  if (growAtSource) {
    const origSource = points[0];
    const elbow: Point =
      axis === 'horizontal' ? { x: origSource.x, y: target } : { x: target, y: origSource.y };
    result = [{ x: origSource.x, y: origSource.y }, elbow, ...result.slice(1)];
  }

  return result;
};

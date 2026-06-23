import { type Point } from 'ng-diagram';
import { ALIGNMENT_TOLERANCE } from './constants';
import { type Orientation } from './path-types';

/**
 * Minimum number of interior bends required for an orthogonal edge between
 * ports of the given orientations.
 *
 * - Perpendicular orientations: an L-shape needs 1 bend.
 * - Same orientation: a Z/U needs 2 bends — *unless* the endpoints align on
 *   the axis perpendicular to their exit, in which case a straight 0-bend
 *   connection is valid. Whether that holds is a property of the actual
 *   coordinates, so pass `source`/`target` to let an aligned wire collapse to
 *   a straight line. Without coordinates the conservative 2 is returned.
 */
export const getDefaultMinInteriorBends = (
  sourceOrientation: Orientation,
  targetOrientation: Orientation,
  source?: Point,
  target?: Point,
  tolerance: number = ALIGNMENT_TOLERANCE,
): number => {
  if (sourceOrientation !== targetOrientation) return 1;
  if (source && target) {
    const aligned =
      sourceOrientation === 'horizontal'
        ? Math.abs(source.y - target.y) <= tolerance
        : Math.abs(source.x - target.x) <= tolerance;
    if (aligned) return 0;
  }
  return 2;
};

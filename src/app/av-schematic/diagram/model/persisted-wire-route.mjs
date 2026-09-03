/**
 * Runtime-safe route normalization shared by the Angular model and the local
 * Node service. Keeping it in one plain ESM module prevents persistence from
 * drifting away from the geometry editor's tolerance and simplification.
 */

export const ROUTE_POSITION_TOLERANCE_PX = 1;

const clonePoint = (point) => ({ x: point.x, y: point.y });

const isBetween = (a, b, c, tolerance) =>
  b >= Math.min(a, c) - tolerance && b <= Math.max(a, c) + tolerance;

export const collapseCollinearRouteBends = (points) => {
  if (points.length < 3) return points.map(clonePoint);
  const result = [clonePoint(points[0])];
  for (let index = 1; index < points.length - 1; index++) {
    const previous = result[result.length - 1];
    const current = points[index];
    const next = points[index + 1];
    const collinearX =
      Math.abs(previous.x - current.x) < ROUTE_POSITION_TOLERANCE_PX &&
      Math.abs(current.x - next.x) < ROUTE_POSITION_TOLERANCE_PX &&
      isBetween(previous.y, current.y, next.y, ROUTE_POSITION_TOLERANCE_PX);
    const collinearY =
      Math.abs(previous.y - current.y) < ROUTE_POSITION_TOLERANCE_PX &&
      Math.abs(current.y - next.y) < ROUTE_POSITION_TOLERANCE_PX &&
      isBetween(previous.x, current.x, next.x, ROUTE_POSITION_TOLERANCE_PX);
    if (collinearX || collinearY) continue;
    result.push(clonePoint(current));
  }
  result.push(clonePoint(points[points.length - 1]));
  return result;
};

export const dropSameAxisRouteBends = (points) => {
  if (points.length < 3) return points.map(clonePoint);
  const result = [clonePoint(points[0])];
  for (let index = 1; index < points.length - 1; index++) {
    const previous = result[result.length - 1];
    const current = points[index];
    const next = points[index + 1];
    const incomingAxis =
      Math.abs(current.x - previous.x) > Math.abs(current.y - previous.y) ? 'h' : 'v';
    const outgoingAxis =
      Math.abs(next.x - current.x) > Math.abs(next.y - current.y) ? 'h' : 'v';
    const alongPrevious = incomingAxis === 'h' ? previous.x : previous.y;
    const alongCurrent = incomingAxis === 'h' ? current.x : current.y;
    const alongNext = incomingAxis === 'h' ? next.x : next.y;
    if (
      incomingAxis === outgoingAxis &&
      isBetween(alongPrevious, alongCurrent, alongNext, ROUTE_POSITION_TOLERANCE_PX)
    ) {
      continue;
    }
    result.push(clonePoint(current));
  }
  result.push(clonePoint(points[points.length - 1]));
  return result;
};

export const normalizePersistedRoute = (points) =>
  dropSameAxisRouteBends(collapseCollinearRouteBends(points));

export const isOrthogonalPersistedRoute = (points) => {
  for (let index = 0; index < points.length - 1; index++) {
    const sameX =
      Math.abs(points[index].x - points[index + 1].x) < ROUTE_POSITION_TOLERANCE_PX;
    const sameY =
      Math.abs(points[index].y - points[index + 1].y) < ROUTE_POSITION_TOLERANCE_PX;
    if (!sameX && !sameY) return false;
  }
  return true;
};

/** Returns a normalized orthogonal clone, or null for a diagonal route. */
export const normalizeOrthogonalPersistedRoute = (points) => {
  if (!isOrthogonalPersistedRoute(points)) return null;
  const normalized = normalizePersistedRoute(points);
  return isOrthogonalPersistedRoute(normalized) ? normalized : null;
};

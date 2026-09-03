export interface PersistedRoutePoint {
  x: number;
  y: number;
}

export const ROUTE_POSITION_TOLERANCE_PX: number;

export function collapseCollinearRouteBends(
  points: readonly PersistedRoutePoint[],
): PersistedRoutePoint[];

export function dropSameAxisRouteBends(
  points: readonly PersistedRoutePoint[],
): PersistedRoutePoint[];

export function normalizePersistedRoute(
  points: readonly PersistedRoutePoint[],
): PersistedRoutePoint[];

export function isOrthogonalPersistedRoute(points: readonly PersistedRoutePoint[]): boolean;

export function normalizeOrthogonalPersistedRoute(
  points: readonly PersistedRoutePoint[],
): PersistedRoutePoint[] | null;

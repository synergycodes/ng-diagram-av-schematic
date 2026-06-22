import type { Edge, NgDiagramService, Node, SnappingConfig } from 'ng-diagram';

/**
 * Resolve the grid to apply to an edge by mirroring node-drag snap config: the
 * edge snaps only when its reference (source) node would snap on drag, using
 * that node's `computeSnapForNodeDrag` when defined, else `defaultDragSnap`.
 * With ng-diagram defaults (`shouldSnapDragForNode: () => false`) no snap fires,
 * so a user opts in by enabling node-drag snap and the edge follows. Returns
 * `undefined` when no snap applies.
 */
export const resolveEdgeGrid = (
  diagramService: NgDiagramService,
  edge: Edge | null | undefined,
  referenceNode: Node | undefined,
): { x: number; y: number } | undefined => {
  if (!edge || !referenceNode) return undefined;

  const snapping = diagramService.config()?.snapping as Partial<SnappingConfig> | undefined;
  if (!snapping?.shouldSnapDragForNode?.(referenceNode)) return undefined;

  const snap = snapping.computeSnapForNodeDrag?.(referenceNode) ?? snapping.defaultDragSnap;
  if (!snap?.width || !snap.height) return undefined;
  return { x: snap.width, y: snap.height };
};

/** Round a point to the nearest grid intersection. */
export const snapPointToGrid = (point: { x: number; y: number }, grid: { x: number; y: number }) => ({
  x: Math.round(point.x / grid.x) * grid.x,
  y: Math.round(point.y / grid.y) * grid.y,
});

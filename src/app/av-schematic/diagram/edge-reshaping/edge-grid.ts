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
  referenceNode: Node | undefined,
): { x: number; y: number } | undefined => {
  if (!referenceNode) return undefined;

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

/**
 * Pick the node whose drag-snap config governs an edge's grid: a connected end
 * if any, otherwise any node (snap is diagram-global, so a fully-dangling edge
 * still snaps). The node dependency is the seam ng-diagram core should remove —
 * edge snap there should be configurable independently of node-drag snap.
 */
export const edgeGridReferenceNode = (
  nodes: readonly Node[],
  edge: Edge | null | undefined,
): Node | undefined => {
  const connectedId = edge && (edge.source || edge.target);
  const connected = connectedId ? nodes.find((node) => node.id === connectedId) : undefined;
  return connected ?? nodes[0];
};

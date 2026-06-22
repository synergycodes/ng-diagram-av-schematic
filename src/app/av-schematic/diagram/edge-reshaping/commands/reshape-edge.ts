import {
  type Edge,
  type NgDiagramModelService,
  type NgDiagramService,
  type Node,
  type Point,
  type SnappingConfig,
} from 'ng-diagram';
import {
  getDefaultMinInteriorBends,
  getNodePortOrientation,
  pathSourceOrientation as derivePathSourceOrientation,
  simplifyPath,
  snapToGrid,
} from '../logic';

export interface ReshapeEdgeCommand {
  type: 'reshapeEdge';
  edgeId: string;
  points: Point[];
  finalize: boolean;
}

/**
 * Resolve the grid to apply to this edge by mirroring node-drag snap config:
 * the edge snaps only when the source node would snap on drag. Uses the
 * source node's per-node `computeSnapForNodeDrag` when defined, falling back
 * to `defaultDragSnap`. With the ng-diagram defaults (`shouldSnapDragForNode:
 * () => false`) no snap fires — so a user has to opt in by enabling node-drag
 * snap, and the edge follows the same opt-in.
 */
const gridForEdge = (
  diagramService: NgDiagramService,
  edge: Edge | null | undefined,
  sourceNode: Node | undefined,
): { x: number; y: number } | undefined => {
  if (!edge || !sourceNode) return undefined;

  const snapping = diagramService.config()?.snapping as Partial<SnappingConfig> | undefined;
  if (!snapping?.shouldSnapDragForNode?.(sourceNode)) return undefined;

  const snap = snapping.computeSnapForNodeDrag?.(sourceNode) ?? snapping.defaultDragSnap;
  if (!snap?.width || !snap.height) return undefined;
  return { x: snap.width, y: snap.height };
};

/**
 * Writes the new path to the model. Constraints applied:
 * - Grid snap on every dispatch (continue and finalize) when the edge's
 *   source node has node-drag snap enabled.
 * - Full normalization pipeline (collinear merge, alternation snap,
 *   endpoint nudge) on finalize only.
 */
export const reshapeEdge = (
  modelService: NgDiagramModelService,
  diagramService: NgDiagramService,
  command: ReshapeEdgeCommand,
): void => {
  const edge = modelService.getEdgeById(command.edgeId);
  const nodes = modelService.nodes();
  const sourceNode = edge ? nodes.find((node) => node.id === edge.source) : undefined;
  const targetNode = edge ? nodes.find((node) => node.id === edge.target) : undefined;

  const portSourceOrientation = getNodePortOrientation(sourceNode, edge?.sourcePort);
  const portTargetOrientation = getNodePortOrientation(targetNode, edge?.targetPort);
  const grid = gridForEdge(diagramService, edge, sourceNode);

  // Parity-based snap/correct assume the path alternates from the source-exit
  // axis. Growing a stub at the source flips that axis away from the port's, so
  // derive it from the actual geometry rather than the port. The port pair
  // still decides the minimum bend count.
  const pathSource = derivePathSourceOrientation(command.points, portSourceOrientation);

  let points = command.points;

  if (command.finalize) {
    points = simplifyPath(points, pathSource, portTargetOrientation, {
      minInteriorBends: getDefaultMinInteriorBends(portSourceOrientation, portTargetOrientation),
      gridSize: grid,
    });
  } else if (grid) {
    points = snapToGrid(points, grid, pathSource);
  }

  // For a dangling end (no connected node) the endpoint *is* its stored
  // position — keep it in sync or the model re-derives the old point and the
  // loose end snaps back.
  const update: Partial<Edge> = { points, routingMode: 'manual' };
  if (edge && !edge.source && points.length > 0) update.sourcePosition = points[0];
  if (edge && !edge.target && points.length > 0) update.targetPosition = points[points.length - 1];

  modelService.updateEdge(command.edgeId, update);
};

import type { NgDiagramModelService } from 'ng-diagram';
import {
  collapseCollinearBends,
  dropSameAxisBends,
  endpointNeighborAxis,
  orthogonalizePolyline,
  portFlowPosition,
  realignEndpointNeighbor,
  reshapeAnchoredSegment,
  type EdgeEndpointSide,
} from '../logic';
import type { ReshapeFinishCommand, ReshapeMoveCommand, SetEdgeRouteCommand } from './types';
import { isBoardJumperEdge } from '../../model/board-jumper';

// Pin an edge to manual mode with an explicit route (e.g. after normalizing the
// displayed route on gesture start).
export const setEdgeRoute = (
  model: NgDiagramModelService,
  command: SetEdgeRouteCommand,
): Promise<void> => {
  const points = command.points.map((p) => ({ x: p.x, y: p.y }));
  return model.updateEdge(command.edgeId, { points, routingMode: 'manual' });
};

// Apply one live segment move: slide the segment, snap endpoints to the live
// ports, realign their stubs, orthogonalize any diagonal, and commit. No merge
// here -- that is deferred to `finishReshape` so the drop matches the preview.
export const applyReshapeMove = (
  model: NgDiagramModelService,
  command: ReshapeMoveCommand,
): Promise<void> => {
  const newPoints = reshapeAnchoredSegment(
    command.initialPoints,
    command.segmentIndex,
    command.axis,
    command.dxWorld,
    command.dyWorld,
    command.grid,
    command.anchorPortAtSource,
    command.anchorPortAtTarget,
  );

  const sourceAxisBeforeAnchor = endpointNeighborAxis(newPoints, 'source');
  const targetAxisBeforeAnchor = endpointNeighborAxis(newPoints, 'target');
  anchorEndpointToPort(model, newPoints, command.edgeId, 'source');
  anchorEndpointToPort(model, newPoints, command.edgeId, 'target');
  realignEndpointNeighbor(newPoints, 'source', sourceAxisBeforeAnchor);
  realignEndpointNeighbor(newPoints, 'target', targetAxisBeforeAnchor);
  const orthoPoints = orthogonalizePolyline(newPoints);

  return model.updateEdge(command.edgeId, { points: orthoPoints, routingMode: 'manual' });
};

// Fold redundant bends once the gesture ends. Folding collinear/same-axis points
// is invisible, so the committed route matches what was on screen.
export const finishReshape = (
  model: NgDiagramModelService,
  command: ReshapeFinishCommand,
): Promise<void> => {
  const edge = model.getEdgeById(command.edgeId);
  if (!edge?.points || edge.points.length < 3) return Promise.resolve();
  if (isBoardJumperEdge(edge)) return Promise.resolve();
  const collapsed = dropSameAxisBends(collapseCollinearBends(edge.points));
  if (collapsed.length === edge.points.length) return Promise.resolve();
  return model.updateEdge(command.edgeId, { points: collapsed, routingMode: 'manual' });
};

// Replace the end vertex with the live port world position. Shared with
// `bend-edge.ts`, which re-anchors after a bend edit the same way.
export const anchorEndpointToPort = (
  model: NgDiagramModelService,
  points: { x: number; y: number }[],
  edgeId: string,
  side: EdgeEndpointSide,
): void => {
  const edge = model.getEdgeById(edgeId);
  if (!edge) return;
  const nodeId = side === 'source' ? edge.source : edge.target;
  const portId = side === 'source' ? edge.sourcePort : edge.targetPort;
  if (!nodeId || !portId) return;
  const node = model.getNodeById(nodeId);
  const anchor = portFlowPosition(node, portId);
  if (!anchor) return;
  const idx = side === 'source' ? 0 : points.length - 1;
  points[idx] = anchor;
};

import type { NgDiagramModelService, Point } from 'ng-diagram';
import {
  collapseCollinearBends,
  dropSameAxisBends,
  endpointNeighborAxis,
  insertBendAt,
  moveBendTo,
  normalizeRoute,
  orthogonalizePolyline,
  realignEndpointNeighbor,
  removeBendAt,
} from '../logic';
import { anchorEndpointToPort } from './reshape-edge';
import type { InsertBendCommand, MoveBendCommand, RemoveBendCommand } from './types';
import { isBoardJumperEdge } from '../../model/board-jumper';

/**
 * Bend-editing writes. Same contract as `reshape-edge.ts`: the geometry is
 * decided by the pure layer, this file only re-anchors the ends to the live
 * ports and commits. A live move defers folding to `reshape-finish`; discrete
 * insertion/removal folds in the same command because there is no drag-end
 * phase for them.
 */

// Create a bend on a segment. The route is normalized first so the segment
// indices the overlay handed out match the points actually being edited.
export const applyInsertBend = (
  model: NgDiagramModelService,
  command: InsertBendCommand,
): Promise<void> => {
  const edge = model.getEdgeById(command.edgeId);
  if (isBoardJumperEdge(edge) && edge.points) {
    if (command.segmentIndex < 0 || command.segmentIndex >= edge.points.length - 1) {
      return Promise.resolve();
    }
    const points = edge.points.map((point) => ({ ...point }));
    points.splice(command.segmentIndex + 1, 0, snapFreePoint(command.at, command.grid));
    anchorFreeRoute(model, command.edgeId, points);
    return model.updateEdge(command.edgeId, { points, routing: 'polyline', routingMode: 'manual' });
  }
  const points = normalizeRoute(edge?.points);
  if (points.length < 2) return Promise.resolve();

  const next = insertBendAt(points, command.segmentIndex, command.at, command.grid);
  if (!next) return Promise.resolve();

  return model.updateEdge(command.edgeId, {
    points: simplifyRoute(anchorRoute(model, command.edgeId, next)),
    routingMode: 'manual',
  });
};

// Delete a bend. `removeBendAt` returns null when the bend is structural (an L
// between two fixed ports) -- then the route is left exactly as it was.
export const applyRemoveBend = (
  model: NgDiagramModelService,
  command: RemoveBendCommand,
): Promise<void> => {
  const edge = model.getEdgeById(command.edgeId);
  if (!edge?.points) return Promise.resolve();

  if (isBoardJumperEdge(edge)) {
    if (command.bendIndex < 1 || command.bendIndex >= edge.points.length - 1) {
      return Promise.resolve();
    }
    const points = edge.points.map((point) => ({ ...point }));
    points.splice(command.bendIndex, 1);
    anchorFreeRoute(model, command.edgeId, points);
    return model.updateEdge(command.edgeId, { points, routing: 'polyline', routingMode: 'manual' });
  }

  const next = removeBendAt(edge.points, command.bendIndex);
  if (!next) return Promise.resolve();

  return model.updateEdge(command.edgeId, {
    points: simplifyRoute(anchorRoute(model, command.edgeId, next)),
    routingMode: 'manual',
  });
};

// Apply one live bend drag: the bend follows the cursor from where it started,
// recomputed from `initialPoints` each move so drags never accumulate error.
export const applyMoveBend = (
  model: NgDiagramModelService,
  command: MoveBendCommand,
): Promise<void> => {
  const origin = command.initialPoints[command.bendIndex] as Point | undefined;
  if (!origin) return Promise.resolve();

  const edge = model.getEdgeById(command.edgeId);
  if (isBoardJumperEdge(edge)) {
    if (command.bendIndex < 1 || command.bendIndex >= command.initialPoints.length - 1) {
      return Promise.resolve();
    }
    const points = command.initialPoints.map((point) => ({ ...point }));
    points[command.bendIndex] = snapFreePoint(
      { x: origin.x + command.dxWorld, y: origin.y + command.dyWorld },
      command.grid,
    );
    anchorFreeRoute(model, command.edgeId, points);
    return model.updateEdge(command.edgeId, { points, routing: 'polyline', routingMode: 'manual' });
  }

  const next = moveBendTo(
    command.initialPoints,
    command.bendIndex,
    { x: origin.x + command.dxWorld, y: origin.y + command.dyWorld },
    command.grid,
  );
  if (!next) return Promise.resolve();

  return model.updateEdge(command.edgeId, {
    points: anchorRoute(model, command.edgeId, next),
    routingMode: 'manual',
  });
};

// Pin both ends back onto their live ports, undo the sub-pixel port drift that
// leaves behind, and orthogonalize whatever diagonal is left.
const anchorRoute = (
  model: NgDiagramModelService,
  edgeId: string,
  points: readonly Point[],
): Point[] => {
  const next = points.map((p) => ({ x: p.x, y: p.y }));
  const sourceAxis = endpointNeighborAxis(next, 'source');
  const targetAxis = endpointNeighborAxis(next, 'target');
  anchorEndpointToPort(model, next, edgeId, 'source');
  anchorEndpointToPort(model, next, edgeId, 'target');
  // With only two points the "neighbour" IS the other endpoint -- realigning
  // would drag it off its port.
  if (next.length >= 3) {
    realignEndpointNeighbor(next, 'source', sourceAxis);
    realignEndpointNeighbor(next, 'target', targetAxis);
  }
  return orthogonalizePolyline(next);
};

const simplifyRoute = (points: readonly Point[]): Point[] =>
  dropSameAxisBends(collapseCollinearBends(points));

const snapFreePoint = (point: Point, grid: { x: number; y: number } | null): Point =>
  grid
    ? {
        x: Math.round(point.x / grid.x) * grid.x,
        y: Math.round(point.y / grid.y) * grid.y,
      }
    : { ...point };

const anchorFreeRoute = (model: NgDiagramModelService, edgeId: string, points: Point[]): void => {
  anchorEndpointToPort(model, points, edgeId, 'source');
  anchorEndpointToPort(model, points, edgeId, 'target');
};

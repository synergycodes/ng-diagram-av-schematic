import { Injectable, inject } from '@angular/core';
import {
  NgDiagramModelService,
  NgDiagramService,
  type Edge,
  type EdgeDrawEndedEvent,
  type Point,
} from 'ng-diagram';
import { resolveEdgeGrid, snapPointToGrid } from '../edge-reshaping/edge-grid';
import {
  getNodePortOrientation,
  getPortFlowPosition,
  pathSourceOrientation,
  snapToGrid,
  POSITION_TOLERANCE,
} from '../edge-reshaping/logic';
import { EdgeTemplateType, type WireEdgeData } from '../model/interfaces';
import { randomShortId } from '../../shared/utils/random-short-id';
import { TempEdgePointsService } from './temp-edge-points.service';

/**
 * Turns a port-to-background draw into a dangling cable. ng-diagram discards a
 * draw that ends without a target; on that `edgeDrawEnded` we add a one-end
 * edge from the source port to the drop point, routed orthogonally so it
 * matches the live preview.
 */
@Injectable()
export class LinkDanglingService {
  private readonly modelService = inject(NgDiagramModelService);
  private readonly diagramService = inject(NgDiagramService);
  private readonly tempEdgePoints = inject(TempEdgePointsService);

  handleEdgeDrawEnded(event: EdgeDrawEndedEvent): void {
    if (event.success || event.reason !== 'noTarget' || !event.sourcePort) return;

    const sourceNode = this.modelService.getNodeById(event.source.id);
    if (!sourceNode) return;
    const start = getPortFlowPosition(sourceNode, event.sourcePort);
    if (!start) return;

    // Prefer the preview's own rendered points so the created edge keeps its
    // exact bends; fall back to a simple stub if none were captured.
    const preview = this.tempEdgePoints.take(event.source.id, event.sourcePort);
    const rawPoints =
      preview ?? this.stubPath(sourceNode, event.sourcePort, start, event.dropPosition);

    // Grid-snap the persisted path; the dangling target end is free so it snaps.
    const grid = resolveEdgeGrid(this.diagramService, sourceNode);
    const points = grid
      ? snapToGrid(
          rawPoints,
          grid,
          pathSourceOrientation(rawPoints, getNodePortOrientation(sourceNode, event.sourcePort)),
          { targetFree: true },
        )
      : rawPoints;

    this.modelService.addEdges([
      {
        id: randomShortId('wire'),
        type: EdgeTemplateType.WireEdge,
        source: event.source.id,
        sourcePort: event.sourcePort,
        target: '',
        targetPosition: points[points.length - 1],
        routingMode: 'manual',
        points,
        data: { type: 'wire', wireId: randomShortId('W') },
      } satisfies Edge<WireEdgeData>,
    ]);
  }

  private stubPath(
    sourceNode: Parameters<typeof getNodePortOrientation>[0],
    sourcePort: string,
    start: Point,
    drop: Point,
  ): Point[] {
    const grid = resolveEdgeGrid(this.diagramService, sourceNode ?? undefined);
    const end = grid ? snapPointToGrid(drop, grid) : drop;
    const orientation = getNodePortOrientation(sourceNode, sourcePort);
    const aligned =
      Math.abs(start.x - end.x) < POSITION_TOLERANCE ||
      Math.abs(start.y - end.y) < POSITION_TOLERANCE;
    if (aligned) return [start, end];
    const elbow: Point =
      orientation === 'horizontal' ? { x: end.x, y: start.y } : { x: start.x, y: end.y };
    return [start, elbow, end];
  }
}

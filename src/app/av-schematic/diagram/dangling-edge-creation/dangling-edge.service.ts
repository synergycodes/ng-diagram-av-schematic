import { Injectable, inject } from '@angular/core';
import {
  NgDiagramModelService,
  NgDiagramService,
  type Edge,
  type EdgeDrawEndedEvent,
  type Node,
  type Point,
} from 'ng-diagram';
import {
  getNodePortOrientation,
  pathSourceOrientation,
  portFlowPosition,
  resolveEdgeGrid,
  snapPointToGrid,
  snapToGrid,
  POSITION_TOLERANCE_PX,
} from '../edge-reshaping/logic';
import { EdgeTemplateType, type WireEdgeData } from '../model/interfaces';
import { randomShortId } from '../../shared/utils/random-short-id';
import { TempEdgePointsService } from './temp-edge-points.service';
import { defaultVisualPlane } from '../model/visual-planes';

/**
 * Turns a port-to-background draw into a dangling wire. ng-diagram discards a
 * draw that ends without a target; on that `edgeDrawEnded` this adds a one-ended
 * edge from the source port to the drop point, routed orthogonally so it matches
 * the live preview (reusing the preview's captured points when available).
 * AV-specific: it mints a `WireEdge` with a `wireId`.
 */
@Injectable()
export class DanglingEdgeService {
  private readonly modelService = inject(NgDiagramModelService);
  private readonly diagramService = inject(NgDiagramService);
  private readonly tempEdgePoints = inject(TempEdgePointsService);

  async handleEdgeDrawEnded(event: EdgeDrawEndedEvent): Promise<void> {
    if (event.success || event.reason !== 'noTarget' || !event.sourcePort) return;

    // Dropped over a node but missed its ports: leave it unconnected rather than
    // minting a dangling wire that visually overlaps the node.
    if (this.isOverNode(event.dropPosition)) return;

    const sourceNode = this.modelService.getNodeById(event.source.id);
    if (!sourceNode) return;
    const start = portFlowPosition(sourceNode, event.sourcePort);
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

    await this.modelService.addEdges([
      {
        id: randomShortId('wire'),
        type: EdgeTemplateType.WireEdge,
        source: event.source.id,
        sourcePort: event.sourcePort,
        target: '',
        targetPosition: points[points.length - 1],
        routingMode: 'manual',
        points,
        data: {
          type: 'wire',
          wireId: randomShortId('W'),
          visualPlane: defaultVisualPlane('conductor'),
        },
      } satisfies Edge<WireEdgeData>,
    ]);
  }

  private isOverNode(point: Point): boolean {
    // Committed model, not the nodes() signal — inside an event handler the
    // signal still shows the state from before the current interaction.
    return this.modelService
      .getModel()
      .getNodes()
      .some((node) => this.containsPoint(node, point));
  }

  private containsPoint(node: Node, point: Point): boolean {
    const bounds = node.measuredBounds;
    const rect = bounds ?? (node.size ? { ...node.position, ...node.size } : undefined);
    if (!rect) return false;
    return (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    );
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
      Math.abs(start.x - end.x) < POSITION_TOLERANCE_PX ||
      Math.abs(start.y - end.y) < POSITION_TOLERANCE_PX;
    if (aligned) return [start, end];
    const elbow: Point =
      orientation === 'horizontal' ? { x: end.x, y: start.y } : { x: start.x, y: end.y };
    return [start, elbow, end];
  }
}

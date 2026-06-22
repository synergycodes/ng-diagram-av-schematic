import { Injectable, inject } from '@angular/core';
import { NgDiagramModelService, NgDiagramViewportService, type Edge, type Point } from 'ng-diagram';
import {
  ALIGNMENT_TOLERANCE,
  getPortFlowPosition,
  orthogonalizePolyline,
  removeStraightSegments,
  type EdgeEndpointSide,
} from '../edge-reshaping/logic';

interface RelinkState {
  edgeId: string;
  side: EdgeEndpointSide;
  pointerId: number;
  originalPoints: readonly Point[];
}

interface PortHit {
  nodeId: string;
  portId: string;
}

const SNAP_TO_PORT_PX = 24;

/**
 * Drag either endpoint of a selected edge. During the drag the dragged end
 * follows the cursor; on drop it reconnects to the nearest port within
 * {@link SNAP_TO_PORT_PX}, or stays dangling (one free end) if dropped in empty
 * space. Mirrors single-line-diagram's relink (`RelinkBranch` attach /
 * leaveDangling), pared to ports-only attachment for this app.
 *
 * Unlike SLD, the edge is kept `routingMode: 'manual'` throughout: plain
 * orthogonal routing won't render a dangling end, so we build the orthogonal
 * path ourselves and let a dangling end live in the stored points.
 *
 * Porting target: an input-events handler + `relinkEdge` command in ng-diagram;
 * the port hit-test becomes a shared spatial lookup.
 */
@Injectable()
export class RelinkEndpointHandler {
  private readonly viewport = inject(NgDiagramViewportService);
  private readonly modelService = inject(NgDiagramModelService);

  private state: RelinkState | null = null;

  onEndpointStart(
    edgeId: string,
    side: EdgeEndpointSide,
    points: readonly Point[],
    pointerId: number,
  ): void {
    if (points.length < 2) return;
    this.state = { edgeId, side, pointerId, originalPoints: points.slice() };
  }

  onEndpointContinue(clientX: number, clientY: number, pointerId: number): void {
    if (this.state?.pointerId !== pointerId) return;
    const flow = this.viewport.clientToFlowPosition({ x: clientX, y: clientY });
    this.leaveDangling(this.state, flow);
  }

  onEndpointEnd(clientX: number, clientY: number, pointerId: number): void {
    if (this.state?.pointerId !== pointerId) return;
    const drag = this.state;
    const flow = this.viewport.clientToFlowPosition({ x: clientX, y: clientY });
    const hit = this.findPortNear(flow);
    if (hit) {
      this.connect(drag, hit);
    } else {
      this.leaveDangling(drag, flow);
    }
    this.state = null;
  }

  private leaveDangling(drag: RelinkState, position: Point): void {
    const points = this.pathWithEndpointAt(drag, position);
    const patch: Partial<Edge> =
      drag.side === 'target'
        ? { points, routingMode: 'manual', target: '', targetPort: undefined, targetPosition: position }
        : { points, routingMode: 'manual', source: '', sourcePort: undefined, sourcePosition: position };
    this.modelService.updateEdge(drag.edgeId, patch);
  }

  private connect(drag: RelinkState, hit: PortHit): void {
    const node = this.modelService.nodes().find((n) => n.id === hit.nodeId);
    const portPos = node ? getPortFlowPosition(node, hit.portId) : null;
    const points = portPos ? this.pathWithEndpointAt(drag, portPos) : undefined;
    const patch: Partial<Edge> =
      drag.side === 'target'
        ? { points, routingMode: 'manual', target: hit.nodeId, targetPort: hit.portId, targetPosition: undefined }
        : { points, routingMode: 'manual', source: hit.nodeId, sourcePort: hit.portId, sourcePosition: undefined };
    this.modelService.updateEdge(drag.edgeId, patch);
  }

  /**
   * Original path with the dragged endpoint moved to `position`, re-orthogonalised
   * and collapsed. The collapse folds the collinear L-bend orthogonalize adds for
   * the moved end — without it, every drag would split the second-to-last segment
   * and the bends would accumulate.
   */
  private pathWithEndpointAt(drag: RelinkState, position: Point): Point[] {
    const next = drag.originalPoints.map((p) => ({ x: p.x, y: p.y }));
    next[drag.side === 'source' ? 0 : next.length - 1] = { x: position.x, y: position.y };
    return removeStraightSegments(orthogonalizePolyline(next), ALIGNMENT_TOLERANCE);
  }

  private findPortNear(position: Point): PortHit | null {
    let best: PortHit | null = null;
    let bestDistSq = SNAP_TO_PORT_PX * SNAP_TO_PORT_PX;
    for (const node of this.modelService.nodes()) {
      for (const port of node.measuredPorts ?? []) {
        const portPos = getPortFlowPosition(node, port.id);
        if (!portPos) continue;
        const dx = portPos.x - position.x;
        const dy = portPos.y - position.y;
        const distSq = dx * dx + dy * dy;
        if (distSq <= bestDistSq) {
          bestDistSq = distSq;
          best = { nodeId: node.id, portId: port.id };
        }
      }
    }
    return best;
  }
}

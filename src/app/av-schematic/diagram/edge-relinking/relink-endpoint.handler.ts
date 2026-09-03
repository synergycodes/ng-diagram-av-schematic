import { Injectable, inject } from '@angular/core';
import {
  NgDiagramModelService,
  NgDiagramService,
  NgDiagramViewportService,
  type Edge,
  type Point,
} from 'ng-diagram';
import {
  PORT_SNAP_PX,
  edgeGridReferenceNode,
  portFlowPosition,
  rebuildEndpointPath,
  resolveEdgeGrid,
  snapPointToGrid,
  type EdgeEndpointSide,
} from '../edge-reshaping/logic';
import { boardPortsResolveToSameCopper, physicalEdgeNet } from '../model/physical-connectivity';
import { parseHolePortId } from '../model/board-ports';
import { isBoardJumperEdge } from '../model/board-jumper';
import { isBoardNode } from '../model/guards';
import { RelinkTargetHighlightService } from './relink-target-highlight.service';

interface RelinkState {
  edgeId: string;
  side: EdgeEndpointSide;
  pointerId: number;
  originalPoints: readonly Point[];
  grid?: { x: number; y: number };
  jumperBoardId?: string;
  originalSource: string;
  originalSourcePort?: string;
  originalSourcePosition?: Point;
  originalTarget: string;
  originalTargetPort?: string;
  originalTargetPosition?: Point;
  history?: HistoryGroup;
}

interface HistoryGroup {
  beginHistoryGroup(): void;
  endHistoryGroup(): void;
}

interface PortHit {
  nodeId: string;
  portId: string;
}

/**
 * Drag either endpoint of a selected edge. During the drag the dragged end
 * follows the cursor; on drop it reconnects to the nearest port within
 * {@link PORT_SNAP_PX}, or stays dangling (one free end) if dropped in empty
 * space.
 *
 * The edge is kept `routingMode: 'manual'` throughout: plain orthogonal routing
 * won't render a dangling end, so we build the orthogonal path ourselves and
 * let a dangling end live in the stored points. Geometry comes from
 * `edge-reshaping/logic`; the writes are this feature's own.
 */
@Injectable()
export class RelinkEndpointHandler {
  private readonly viewport = inject(NgDiagramViewportService);
  private readonly modelService = inject(NgDiagramModelService);
  private readonly diagramService = inject(NgDiagramService);
  private readonly highlight = inject(RelinkTargetHighlightService);

  private state: RelinkState | null = null;
  private pendingMutation: Promise<void> = Promise.resolve();

  onEndpointStart(
    edgeId: string,
    side: EdgeEndpointSide,
    points: readonly Point[],
    pointerId: number,
  ): void {
    if (points.length < 2) return;
    const edge = this.modelService.getEdgeById(edgeId);
    if (!edge) return;
    const history = this.historyGroup();
    history?.beginHistoryGroup();
    this.pendingMutation = Promise.resolve();
    this.highlight.clear();
    this.state = {
      edgeId,
      side,
      pointerId,
      originalPoints: points.slice(),
      grid: this.gridForEdge(edgeId),
      jumperBoardId: isBoardJumperEdge(edge) ? edge.data.jumperBoardId : undefined,
      originalSource: edge.source,
      originalSourcePort: edge.sourcePort,
      originalSourcePosition: edge.sourcePosition,
      originalTarget: edge.target,
      originalTargetPort: edge.targetPort,
      originalTargetPosition: edge.targetPosition,
      history,
    };
  }

  onEndpointContinue(clientX: number, clientY: number, pointerId: number): void {
    if (this.state?.pointerId !== pointerId) return;
    const drag = this.state;
    const hit = this.allowedHit(drag, this.portHitAt(clientX, clientY));
    if (hit) {
      // Latch the preview onto the port and highlight it, mirroring the hover
      // feedback ng-diagram shows while drawing a new edge. Preview only --
      // never connect or merge mid-drag (point #4: no early simplification).
      this.highlight.set(hit.nodeId, hit.portId);
      const portPos = this.portPosition(hit);
      this.pendingMutation = this.pendingMutation.then(() =>
        this.leaveDangling(drag, portPos ?? this.danglingPosition(drag, clientX, clientY), false),
      );
    } else {
      this.highlight.clear();
      this.pendingMutation = this.pendingMutation.then(() =>
        this.leaveDangling(drag, this.danglingPosition(drag, clientX, clientY), false),
      );
    }
  }

  async onEndpointEnd(clientX: number, clientY: number, pointerId: number): Promise<void> {
    if (this.state?.pointerId !== pointerId) return;
    const drag = this.state;
    try {
      await this.pendingMutation;
      this.highlight.clear();
      const hit = this.allowedHit(drag, this.portHitAt(clientX, clientY));
      // Merge only now, on drop -- folding collinear points is invisible, so the
      // committed route matches the preview the user just saw.
      if (hit) {
        await this.connect(drag, hit);
      } else if (drag.jumperBoardId) {
        await this.restoreEndpoint(drag);
      } else {
        await this.leaveDangling(drag, this.danglingPosition(drag, clientX, clientY), true);
      }
    } finally {
      this.state = null;
      this.pendingMutation = Promise.resolve();
      drag.history?.endHistoryGroup();
    }
  }

  /** Cursor in flow coords, snapped to grid when snap is enabled for the edge. */
  private danglingPosition(drag: RelinkState, clientX: number, clientY: number): Point {
    const flow = this.viewport.clientToFlowPosition({ x: clientX, y: clientY });
    return drag.grid ? snapPointToGrid(flow, drag.grid) : flow;
  }

  private gridForEdge(edgeId: string): { x: number; y: number } | undefined {
    const edge = this.modelService.getEdgeById(edgeId);
    const refNode = edgeGridReferenceNode(this.modelService.nodes(), edge);
    return resolveEdgeGrid(this.diagramService, refNode);
  }

  private leaveDangling(drag: RelinkState, position: Point, merge: boolean): Promise<void> {
    const points = this.pathWithEndpointAt(drag, position, merge);
    const patch: Partial<Edge> =
      drag.side === 'target'
        ? {
            points,
            routingMode: 'manual',
            target: '',
            targetPort: undefined,
            targetPosition: position,
          }
        : {
            points,
            routingMode: 'manual',
            source: '',
            sourcePort: undefined,
            sourcePosition: position,
          };
    return this.modelService.updateEdge(drag.edgeId, patch);
  }

  private async connect(drag: RelinkState, hit: PortHit): Promise<void> {
    const portPos = this.portPosition(hit);
    const points = portPos ? this.pathWithEndpointAt(drag, portPos, true) : undefined;
    const routingMode = points ? 'manual' : 'auto';
    const patch: Partial<Edge> =
      drag.side === 'target'
        ? {
            points,
            routingMode,
            target: hit.nodeId,
            targetPort: hit.portId,
            targetPosition: undefined,
          }
        : {
            points,
            routingMode,
            source: hit.nodeId,
            sourcePort: hit.portId,
            sourcePosition: undefined,
          };
    if (this.wouldRejectPhysicalConnection(drag.edgeId, patch)) {
      // Refuse a physical short or a conductor whose board ports canonicalize
      // to one copper junction, leaving the attempted end visibly dangling.
      if (drag.jumperBoardId) await this.restoreEndpoint(drag);
      else if (portPos) await this.leaveDangling(drag, portPos, true);
      return;
    }
    await this.modelService.updateEdge(drag.edgeId, patch);
  }

  private allowedHit(drag: RelinkState, hit: PortHit | null): PortHit | null {
    if (!hit || !drag.jumperBoardId) return hit;
    const board = this.modelService
      .getModel()
      .getNodes()
      .find((node) => node.id === hit.nodeId);
    return isBoardNode(board) &&
      board.data.boardId === drag.jumperBoardId &&
      parseHolePortId(hit.portId)
      ? hit
      : null;
  }

  private restoreEndpoint(drag: RelinkState): Promise<void> {
    const patch: Partial<Edge> =
      drag.side === 'target'
        ? {
            points: drag.originalPoints.slice(),
            routingMode: 'manual',
            target: drag.originalTarget,
            targetPort: drag.originalTargetPort,
            targetPosition: drag.originalTargetPosition,
          }
        : {
            points: drag.originalPoints.slice(),
            routingMode: 'manual',
            source: drag.originalSource,
            sourcePort: drag.originalSourcePort,
            sourcePosition: drag.originalSourcePosition,
          };
    return this.modelService.updateEdge(drag.edgeId, patch);
  }

  private wouldRejectPhysicalConnection(edgeId: string, patch: Partial<Edge>): boolean {
    const edge = this.modelService.getEdgeById(edgeId);
    if (!edge) return false;
    const model = this.modelService.getModel();
    const candidate = { ...edge, ...patch };
    return (
      boardPortsResolveToSameCopper(model.getNodes(), candidate) ||
      physicalEdgeNet(model.getNodes(), candidate, model.getEdges()).conflict.length > 0
    );
  }

  /**
   * Original path with the dragged endpoint moved to `position`, re-orthogonalised.
   * Recomputed from `originalPoints` each call so bends never accumulate across
   * moves. `merge` (drop only) folds the collinear L-bend orthogonalize adds.
   * The geometry itself lives in `logic/relink-path.ts` so it is unit-testable
   * without a diagram.
   */
  private pathWithEndpointAt(drag: RelinkState, position: Point, merge: boolean): Point[] {
    if (drag.jumperBoardId) {
      const points = drag.originalPoints.map((point) => ({ ...point }));
      if (drag.side === 'source') points[0] = { ...position };
      else points[points.length - 1] = { ...position };
      return points;
    }
    return rebuildEndpointPath(drag.originalPoints, drag.side, position, merge);
  }

  private historyGroup(): HistoryGroup | undefined {
    const model = this.modelService.getModel() as Partial<HistoryGroup>;
    return typeof model.beginHistoryGroup === 'function' &&
      typeof model.endHistoryGroup === 'function'
      ? (model as HistoryGroup)
      : undefined;
  }

  private portHitAt(clientX: number, clientY: number): PortHit | null {
    const flow = this.viewport.clientToFlowPosition({ x: clientX, y: clientY });
    return this.findPortNear(flow);
  }

  private portPosition(hit: PortHit): Point | null {
    const node = this.modelService.nodes().find((n) => n.id === hit.nodeId);
    return node ? portFlowPosition(node, hit.portId) : null;
  }

  private findPortNear(position: Point): PortHit | null {
    let best: PortHit | null = null;
    let bestDistSq = PORT_SNAP_PX * PORT_SNAP_PX;
    for (const node of this.modelService.nodes()) {
      for (const port of node.measuredPorts ?? []) {
        const portPos = portFlowPosition(node, port.id);
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

import { Injectable, inject } from '@angular/core';
import { NgDiagramModelService, NgDiagramViewportService, type Point } from 'ng-diagram';
import { EdgeReshapeCommandDispatcher } from '../commands/dispatcher';
import {
  endpointNeighborAxis,
  getDefaultMinInteriorBends,
  getEdgePortOrientations,
  getPortFlowPosition,
  orthogonalizePolyline,
  realignEndpointNeighbor,
  reshapeAnchoredSegment,
  type EdgeEndpointSide,
  type Orientation,
} from '../logic';

interface DragState {
  edgeId: string;
  segmentIndex: number;
  axis: Orientation;
  pointerId: number;
  anchorSource: boolean;
  anchorTarget: boolean;
  startFlow: Point;
  originalPoints: readonly Point[];
  lastComputedPoints: readonly Point[];
}

const fallbackOrientation: Orientation = 'horizontal';

/**
 * Translates pointer-phase events from `EdgeReshapeDirective` into reshape
 * commands. Owns the in-flight drag state for the duration of a gesture.
 *
 * The drag slides one whole segment to follow the cursor (grab-offset
 * preserved via the start-pointer baseline), grows an L-bend off any anchored
 * port end, then re-anchors endpoints to their live ports and re-orthogonalizes
 * — the same per-move pipeline as the single-line-diagram reference. Segment
 * merging is deferred to drag end (`finalize`).
 *
 * Porting target: when this lands inside ng-diagram, the inline `state`
 * field moves to `ActionStateManager.edgeReshape` so other parts of the
 * system can observe it (mirror of how dragging/resize state lives there
 * today). Method shapes don't change.
 */
@Injectable()
export class EdgeReshapeEventHandler {
  private readonly viewport = inject(NgDiagramViewportService);
  private readonly modelService = inject(NgDiagramModelService);
  private readonly dispatcher = inject(EdgeReshapeCommandDispatcher);

  private state: DragState | null = null;

  onSegmentStart(
    edgeId: string,
    segmentIndex: number,
    axis: Orientation,
    points: readonly Point[],
    pointerId: number,
    clientX: number,
    clientY: number,
  ): void {
    if (points.length < 2) return;
    const edge = this.modelService.getEdgeById(edgeId);
    this.state = {
      edgeId,
      segmentIndex,
      axis,
      pointerId,
      anchorSource: !!edge?.source && !!edge?.sourcePort,
      anchorTarget: !!edge?.target && !!edge?.targetPort,
      startFlow: this.viewport.clientToFlowPosition({ x: clientX, y: clientY }),
      originalPoints: points.slice(),
      lastComputedPoints: points.slice(),
    };
    this.dispatcher.dispatch({ type: 'reshapeEdgeStart', edgeId });
  }

  onContinue(clientX: number, clientY: number, pointerId: number): void {
    const drag = this.dragFor(pointerId);
    if (!drag) return;

    const flow = this.viewport.clientToFlowPosition({ x: clientX, y: clientY });
    const target = this.targetCoordinate(drag, flow);

    const slid = reshapeAnchoredSegment(
      drag.originalPoints,
      drag.segmentIndex,
      drag.axis,
      target,
      drag.anchorSource,
      drag.anchorTarget,
    );
    const anchored = this.anchorEndsToPorts(slid, drag.edgeId);
    const next = orthogonalizePolyline(anchored);

    this.state = { ...drag, lastComputedPoints: next };
    this.dispatcher.dispatch({
      type: 'reshapeEdge',
      edgeId: drag.edgeId,
      points: next,
      finalize: false,
    });
  }

  onEnd(pointerId: number): void {
    const drag = this.dragFor(pointerId);
    if (!drag) return;

    this.dispatcher.dispatch({
      type: 'reshapeEdge',
      edgeId: drag.edgeId,
      points: drag.lastComputedPoints.slice(),
      finalize: true,
    });
    this.dispatcher.dispatch({ type: 'reshapeEdgeStop', edgeId: drag.edgeId });
    this.state = null;
  }

  /**
   * Removes an interior orthogonal segment. Both endpoint bends of the
   * segment go away; simplifyPath snaps the bridging segment back to
   * orthogonal alternation. Refused when:
   * - the segment touches a port stub (segmentIndex 0 or last segment),
   * - removal would drop interior bends below the per-edge minimum.
   */
  onRemoveSegmentRequest(edgeId: string, segmentIndex: number, points: readonly Point[]): void {
    if (segmentIndex < 1 || segmentIndex > points.length - 3) return;

    const orientations = this.orientationsFor(edgeId);
    const minBends = getDefaultMinInteriorBends(orientations.source, orientations.target);
    const remainingInteriorBends = points.length - 2 - 2;
    if (remainingInteriorBends < minBends) return;

    const next = [...points.slice(0, segmentIndex), ...points.slice(segmentIndex + 2)];

    this.dispatcher.dispatch({
      type: 'reshapeEdge',
      edgeId,
      points: next,
      finalize: true,
    });
  }

  private targetCoordinate(drag: DragState, flow: Point): number {
    const origin = drag.originalPoints[drag.segmentIndex];
    return drag.axis === 'horizontal'
      ? origin.y + (flow.y - drag.startFlow.y)
      : origin.x + (flow.x - drag.startFlow.x);
  }

  /**
   * Re-anchors each connected endpoint to its live port and snaps the adjacent
   * stub back onto the axis it had before the anchor — so port drift never
   * freezes into the route. Dangling ends (no port) are left where the slide
   * put them.
   */
  private anchorEndsToPorts(points: readonly Point[], edgeId: string): Point[] {
    const next = points.map((p) => ({ x: p.x, y: p.y }));
    const sourceAxis = endpointNeighborAxis(next, 'source');
    const targetAxis = endpointNeighborAxis(next, 'target');
    this.anchorEndToPort(next, edgeId, 'source');
    this.anchorEndToPort(next, edgeId, 'target');
    realignEndpointNeighbor(next, 'source', sourceAxis);
    realignEndpointNeighbor(next, 'target', targetAxis);
    return next;
  }

  private anchorEndToPort(points: Point[], edgeId: string, side: EdgeEndpointSide): void {
    const edge = this.modelService.getEdgeById(edgeId);
    if (!edge) return;
    const nodeId = side === 'source' ? edge.source : edge.target;
    const portId = side === 'source' ? edge.sourcePort : edge.targetPort;
    if (!nodeId || !portId) return;
    const node = this.modelService.nodes().find((n) => n.id === nodeId);
    if (!node) return;
    const anchor = getPortFlowPosition(node, portId);
    if (!anchor) return;
    points[side === 'source' ? 0 : points.length - 1] = anchor;
  }

  private dragFor(pointerId: number): DragState | null {
    return this.state?.pointerId === pointerId ? this.state : null;
  }

  private orientationsFor(edgeId: string): { source: Orientation; target: Orientation } {
    const edge = this.modelService.getEdgeById(edgeId);
    if (!edge) return { source: fallbackOrientation, target: fallbackOrientation };
    return getEdgePortOrientations(this.modelService.nodes(), edge);
  }
}

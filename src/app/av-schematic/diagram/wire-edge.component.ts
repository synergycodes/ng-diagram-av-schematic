import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import {
  NgDiagramBaseEdgeComponent,
  NgDiagramBaseEdgeLabelComponent,
  type Edge,
  type NgDiagramEdgeTemplate,
} from 'ng-diagram';
import {
  EdgeReshapeDirective,
  type EdgeReshapePointerEvent,
} from './edge-reshaping/directives/edge-reshape.directive';
import { EdgeReshapeEventHandler } from './edge-reshaping/handlers/edge-reshape.handler';
import { getHandlerPositions, type EdgeEndpointSide, type Orientation } from './edge-reshaping/logic';
import { RelinkEndpointHandler } from './edge-relinking/relink-endpoint.handler';
import { TempEdgePointsService } from './edge-linking/temp-edge-points.service';
import { type WireEdgeData } from './model/interfaces';

interface SegmentHandleView {
  id: string;
  segmentIndex: number;
  axis: Orientation;
  transform: string;
}

interface EndpointHandleView {
  id: string;
  side: EdgeEndpointSide;
  transform: string;
}

const handleTransform = (x: number, y: number, originX: number, originY: number): string =>
  `translate(${x - originX}px, ${y - originY}px) translate(-50%, -50%)`;

@Component({
  imports: [NgDiagramBaseEdgeComponent, NgDiagramBaseEdgeLabelComponent, EdgeReshapeDirective],
  templateUrl: './wire-edge.component.html',
  styleUrl: './wire-edge.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WireEdgeComponent implements NgDiagramEdgeTemplate<WireEdgeData> {
  private readonly reshapeHandler = inject(EdgeReshapeEventHandler);
  private readonly relinkHandler = inject(RelinkEndpointHandler);
  private readonly tempEdgePoints = inject(TempEdgePointsService);

  edge = input.required<Edge<WireEdgeData>>();

  private readonly baseEdge = viewChild(NgDiagramBaseEdgeComponent);

  constructor() {
    // While this is the link-draw preview, publish its rendered (routed) points
    // so a drop-to-background can create a real edge with identical bends.
    effect(() => {
      const edge = this.edge();
      if (!edge.temporary) return;
      const points = this.baseEdge()?.points();
      if (points && points.length >= 2) {
        this.tempEdgePoints.publish(edge.source, edge.sourcePort, points);
      }
    });
  }

  protected readonly strokeColor = computed(() =>
    this.edge().selected ? 'var(--av-color-accent)' : 'var(--av-color-wire-stroke)',
  );

  protected readonly strokeWidth = computed(() => (this.edge().selected ? 2 : 1));

  protected readonly segmentHandles = computed<SegmentHandleView[]>(() => {
    if (!this.edge().selected) return [];
    const points = this.baseEdge()?.points();
    if (!points || points.length === 0) return [];
    const source = points[0];
    return getHandlerPositions(points).map((handle) => ({
      id: `segment-${handle.segmentIndex}`,
      segmentIndex: handle.segmentIndex,
      axis: handle.axis,
      transform: handleTransform(handle.x, handle.y, source.x, source.y),
    }));
  });

  protected onSegmentStart(
    event: EdgeReshapePointerEvent,
    segmentIndex: number,
    axis: Orientation,
  ): void {
    const points = this.baseEdge()?.points();
    if (!points) return;
    this.reshapeHandler.onSegmentStart(
      this.edge().id,
      segmentIndex,
      axis,
      points,
      event.pointerId,
      event.clientX,
      event.clientY,
    );
  }

  protected onReshapeContinue(event: EdgeReshapePointerEvent): void {
    this.reshapeHandler.onContinue(event.clientX, event.clientY, event.pointerId);
  }

  protected onReshapeEnd(event: EdgeReshapePointerEvent): void {
    this.reshapeHandler.onEnd(event.pointerId);
  }

  protected onSegmentContextMenu(event: MouseEvent, segmentIndex: number): void {
    event.preventDefault();
    event.stopPropagation();
    const points = this.baseEdge()?.points();
    if (!points) return;
    this.reshapeHandler.onRemoveSegmentRequest(this.edge().id, segmentIndex, points);
  }

  protected readonly endpointHandles = computed<EndpointHandleView[]>(() => {
    if (!this.edge().selected) return [];
    const points = this.baseEdge()?.points();
    if (!points || points.length < 2) return [];
    const source = points[0];
    const target = points[points.length - 1];
    return [
      { id: 'endpoint-source', side: 'source' as const, transform: handleTransform(source.x, source.y, source.x, source.y) },
      { id: 'endpoint-target', side: 'target' as const, transform: handleTransform(target.x, target.y, source.x, source.y) },
    ];
  });

  protected onEndpointStart(event: EdgeReshapePointerEvent, side: EdgeEndpointSide): void {
    const points = this.baseEdge()?.points();
    if (!points) return;
    this.relinkHandler.onEndpointStart(this.edge().id, side, points, event.pointerId);
  }

  protected onEndpointContinue(event: EdgeReshapePointerEvent): void {
    this.relinkHandler.onEndpointContinue(event.clientX, event.clientY, event.pointerId);
  }

  protected onEndpointEnd(event: EdgeReshapePointerEvent): void {
    this.relinkHandler.onEndpointEnd(event.clientX, event.clientY, event.pointerId);
  }
}

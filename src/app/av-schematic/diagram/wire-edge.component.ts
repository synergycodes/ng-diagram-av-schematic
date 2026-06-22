import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
import { getHandlerPositions, type Orientation } from './edge-reshaping/logic';
import { type WireEdgeData } from './model/interfaces';

interface SegmentHandleView {
  id: string;
  segmentIndex: number;
  axis: Orientation;
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

  edge = input.required<Edge<WireEdgeData>>();

  private readonly baseEdge = viewChild(NgDiagramBaseEdgeComponent);

  protected readonly strokeColor = computed(() =>
    this.edge().selected ? 'var(--av-color-accent)' : 'var(--av-color-wire-stroke)',
  );

  protected readonly strokeWidth = computed(() => (this.edge().selected ? 2 : 1));

  protected readonly segmentHandles = computed<SegmentHandleView[]>(() => {
    if (!this.edge().selected) return [];
    const points = this.baseEdge()?.points();
    if (!points || points.length === 0) return [];
    const source = points[0];
    const views = getHandlerPositions(points).map((handle) => ({
      id: `segment-${handle.segmentIndex}`,
      segmentIndex: handle.segmentIndex,
      axis: handle.axis,
      transform: handleTransform(handle.x, handle.y, source.x, source.y),
    }));
    console.log(`[reshape] handles ${views.map((v) => v.id).join(',')}`);
    return views;
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
}

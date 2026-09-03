import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import {
  NgDiagramBaseEdgeComponent,
  NgDiagramBaseEdgeLabelComponent,
  NgDiagramModelService,
  type Edge,
  type NgDiagramEdgeTemplate,
  type Point,
} from 'ng-diagram';
import { type EdgeEndpointSide } from './edge-reshaping/logic';
import { RelinkEndpointHandler } from './edge-relinking/relink-endpoint.handler';
import {
  RelinkHandleDirective,
  type RelinkPointerEvent,
} from './edge-relinking/relink-handle.directive';
import { TempEdgePointsService } from './dangling-edge-creation/temp-edge-points.service';
import { dimWireColor, type NetEmphasis } from './net-highlight/net-emphasis';
import { NetHighlightService } from './net-highlight/net-highlight.service';
import { describeWireEndpoints, formatWireEndpoint } from './model/wire-endpoints';
import { type WireEdgeData } from './model/interfaces';
import { resolveWireColor } from './model/wire-colors';
import { boardJumperLengthLabel, isBoardJumperEdge } from './model/board-jumper';

interface EndpointHandleView {
  id: string;
  side: EdgeEndpointSide;
  transform: string;
}

interface InspectionFact {
  label: string;
  value: string;
}

const handleTransform = (x: number, y: number, originX: number, originY: number): string =>
  `translate(${x - originX}px, ${y - originY}px) translate(-50%, -50%)`;

// Point halfway along the polyline by arc length -- where the inspection chip
// sits. Labels are positioned from the source end (`positionOnEdge: '0px'`),
// so the chip is translated by (midpoint - source), same trick as the endpoint
// handles.
const polylineMidpoint = (points: readonly Point[]): Point => {
  if (points.length === 1) return { x: points[0].x, y: points[0].y };
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  let remaining = total / 2;
  for (let i = 0; i < points.length - 1; i++) {
    const segment = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    if (segment >= remaining) {
      const ratio = segment === 0 ? 0 : remaining / segment;
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * ratio,
        y: points[i].y + (points[i + 1].y - points[i].y) * ratio,
      };
    }
    remaining -= segment;
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y };
};

@Component({
  imports: [NgDiagramBaseEdgeComponent, NgDiagramBaseEdgeLabelComponent, RelinkHandleDirective],
  templateUrl: './wire-edge.component.html',
  styleUrl: './wire-edge.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WireEdgeComponent implements NgDiagramEdgeTemplate<WireEdgeData> {
  private readonly relinkHandler = inject(RelinkEndpointHandler);
  private readonly tempEdgePoints = inject(TempEdgePointsService);
  private readonly netHighlight = inject(NetHighlightService);
  private readonly modelService = inject(NgDiagramModelService);

  edge = input.required<Edge<WireEdgeData>>();

  constructor() {
    // While this is the link-draw preview, publish its rendered (routed) points
    // so a drop-to-background can create a real edge with identical bends.
    effect(() => {
      const edge = this.edge();
      if (!edge.temporary) return;
      const points = edge.points;
      if (points && points.length >= 2) {
        this.tempEdgePoints.publish(edge.source, edge.sourcePort, points);
      }
    });
  }

  protected readonly emphasis = computed<NetEmphasis>(() =>
    this.netHighlight.emphasisForEdge(this.edge().id),
  );

  protected readonly strokeColor = computed(() => {
    const data = this.edge().data;
    const base = this.edge().selected
      ? 'var(--av-color-accent)'
      : (data.color ?? resolveWireColor(data.colorCode).color ?? 'var(--av-color-wire-stroke)');
    return this.emphasis() === 'dimmed' ? dimWireColor(base) : base;
  });

  protected readonly strokeWidth = computed(() => {
    if (isBoardJumperEdge(this.edge())) return 2;
    if (this.edge().selected) return 2;
    return this.emphasis() === 'highlighted' ? 2 : 1;
  });

  protected readonly isBoardJumper = computed(() => isBoardJumperEdge(this.edge()));

  protected readonly isDimmed = computed(() => this.emphasis() === 'dimmed');

  /**
   * The detail chip is opt-in: it appears while the wire is selected, or while
   * its net is the highlighted one. Nothing about net / endpoints / gauge /
   * length / notes is painted on the canvas otherwise.
   */
  protected readonly isInspected = computed(
    () => !!this.edge().selected || this.emphasis() === 'highlighted',
  );

  protected readonly inspectionTransform = computed(() => {
    const points = this.edge().points;
    if (!points || points.length < 2) return 'translate(-50%, -50%)';
    const middle = polylineMidpoint(points);
    return handleTransform(middle.x, middle.y, points[0].x, points[0].y);
  });

  protected readonly endpointSummary = computed(() => {
    const edge = this.edge();
    const { source, target } = describeWireEndpoints(this.modelService.nodes(), edge);
    return `${formatWireEndpoint(source)} → ${formatWireEndpoint(target)}`;
  });

  /** Only the metadata that is actually filled in -- an empty field shows nothing. */
  protected readonly inspectionFacts = computed<InspectionFact[]>(() => {
    const edge = this.edge();
    const data = edge.data;
    const facts: InspectionFact[] = [];
    const netLabel = this.netHighlight.netForEdge(edge.id)?.name;
    if (netLabel) facts.push({ label: 'Net', value: netLabel });
    if (data.wireType) facts.push({ label: 'Tipo', value: data.wireType });
    if (data.gauge) facts.push({ label: 'Bitola', value: data.gauge });
    const jumperLength = boardJumperLengthLabel(this.modelService.nodes(), edge);
    if (jumperLength ?? data.length) {
      facts.push({ label: 'Comprimento', value: jumperLength ?? data.length ?? '' });
    }
    return facts;
  });

  protected readonly inspectionColor = computed(() => {
    const data = this.edge().data;
    return data.color ?? resolveWireColor(data.colorCode).color ?? 'var(--av-color-wire-stroke)';
  });

  protected readonly endpointHandles = computed<EndpointHandleView[]>(() => {
    const edge = this.edge();
    if (!edge.selected) return [];
    const points = edge.points;
    if (!points || points.length < 2) return [];
    const source = points[0];
    const target = points[points.length - 1];
    return [
      {
        id: 'endpoint-source',
        side: 'source' as const,
        transform: handleTransform(source.x, source.y, source.x, source.y),
      },
      {
        id: 'endpoint-target',
        side: 'target' as const,
        transform: handleTransform(target.x, target.y, source.x, source.y),
      },
    ];
  });

  protected onEndpointStart(event: RelinkPointerEvent, side: EdgeEndpointSide): void {
    const points = this.edge().points;
    if (!points) return;
    this.relinkHandler.onEndpointStart(this.edge().id, side, points, event.pointerId);
  }

  protected onEndpointContinue(event: RelinkPointerEvent): void {
    this.relinkHandler.onEndpointContinue(event.clientX, event.clientY, event.pointerId);
  }

  protected onEndpointEnd(event: RelinkPointerEvent): void {
    void this.relinkHandler.onEndpointEnd(event.clientX, event.clientY, event.pointerId);
  }
}

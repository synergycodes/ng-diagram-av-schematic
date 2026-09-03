import type { Point } from 'ng-diagram';
import { isBoardNode } from '../../diagram/model/guards';
import { NodeTemplateType, type WireEdgeData } from '../../diagram/model/interfaces';
import { DxfLwPolyline, DxfText } from '../dxf/dxf-entity';
import type { DxfEdgeRenderer, DxfRenderContext } from '../dxf/dxf-types';
import {
  FONT_WIRE_LABEL,
  LAYERS,
  LINE_WEIGHT,
  TEXT_STYLE,
  WIRE_ENDPOINT_EXTENSION,
  WIRE_LABEL_DISTANCE_FROM_END,
} from './av-dxf-constants';

/**
 * Emits a single LWPOLYLINE per wire edge from `edge.points` plus two
 * `wireId` labels, one near each end - mirroring the two
 * `<ng-diagram-base-edge-label>` markers in wire-edge.component.html.
 *
 * `edge.points` is supplied by ng-diagram after routing - orthogonal,
 * polyline, and future point-following routings all expose the same array,
 * so this renderer doesn't care which routing produced them.
 *
 * The first/last point is the port's *measured center*. The generic device-node
 * renderer snaps each port rect's adjacent edge flush with the device
 * frame, leaving the rect's outer edge slightly past the measured center.
 * We extend each endpoint a small distance along the first/last segment
 * (toward the next routing point - that direction always points outward
 * from the port for left/right side ports) so wires meet ports at their
 * outer boundary. Board holes/traces and footprint pins are physical center
 * coordinates, so those endpoints must remain untouched.
 */
export const renderWireEdge: DxfEdgeRenderer = (ctx, edge) => {
  const points = edge.points ?? [];
  if (points.length < 2) return;

  const lastIndex = points.length - 1;
  const adjusted = [...points];
  if (!isPhysicalEndpoint(ctx, edge.source)) {
    adjusted[0] = extendToward(points[0], points[1], WIRE_ENDPOINT_EXTENSION);
  }
  if (!isPhysicalEndpoint(ctx, edge.target)) {
    adjusted[lastIndex] = extendToward(
      points[lastIndex],
      points[lastIndex - 1],
      WIRE_ENDPOINT_EXTENSION,
    );
  }

  const mapped = adjusted.map((point) => ctx.mapper.mapPoint(point.x, point.y));
  const data = edge.data as WireEdgeData;
  const layer = data.jumperBoardId ? LAYERS.JUMPERS : LAYERS.WIRES;
  ctx.doc.addEntity(new DxfLwPolyline(layer, mapped, false, undefined, LINE_WEIGHT.WIRE));

  renderWireLabels(ctx, adjusted, data, layer);
};

const isPhysicalEndpoint = (ctx: DxfRenderContext, nodeId: string | null): boolean => {
  const node = ctx.nodes.find((candidate) => candidate.id === nodeId);
  return isBoardNode(node) || node?.type === NodeTemplateType.FootprintNode;
};

const renderWireLabels = (
  ctx: DxfRenderContext,
  points: readonly Point[],
  data: WireEdgeData,
  layer: string,
): void => {
  const wireId = data?.wireId;
  if (!wireId) return;

  const sourceAnchor = pointAtDistance(points, WIRE_LABEL_DISTANCE_FROM_END, false);
  const targetAnchor = pointAtDistance(points, WIRE_LABEL_DISTANCE_FROM_END, true);
  if (sourceAnchor) renderLabel(ctx, sourceAnchor, wireId, layer);
  if (targetAnchor) renderLabel(ctx, targetAnchor, wireId, layer);
};

const renderLabel = (ctx: DxfRenderContext, anchor: Point, text: string, layer: string): void => {
  const mappedPoint = ctx.mapper.mapPoint(anchor.x, anchor.y);
  const heightMm = ctx.mapper.mapLength(FONT_WIRE_LABEL);
  // halign=1 (center), valign=1 (bottom) - text sits centered above the wire,
  // bottom edge of the glyphs flush with the wire line.
  ctx.doc.addEntity(
    new DxfText(layer, text, mappedPoint.x, mappedPoint.y, heightMm, TEXT_STYLE.STANDARD, 1, 1),
  );
};

const pointAtDistance = (
  points: readonly Point[],
  distance: number,
  fromEnd: boolean,
): Point | null => {
  if (points.length < 2) return null;
  const ordered = fromEnd ? [...points].reverse() : points;

  let remaining = distance;
  for (let i = 0; i < ordered.length - 1; i++) {
    const from = ordered[i];
    const to = ordered[i + 1];
    const deltaX = to.x - from.x;
    const deltaY = to.y - from.y;
    const segmentLength = Math.hypot(deltaX, deltaY);
    if (remaining <= segmentLength) {
      const progress = segmentLength === 0 ? 0 : remaining / segmentLength;
      return { x: from.x + deltaX * progress, y: from.y + deltaY * progress };
    }
    remaining -= segmentLength;
  }
  // Path is shorter than `distance` - fall back to the far end.
  return ordered[ordered.length - 1];
};

const extendToward = (point: Point, neighbor: Point, distance: number): Point => {
  const deltaX = neighbor.x - point.x;
  const deltaY = neighbor.y - point.y;
  const length = Math.hypot(deltaX, deltaY);
  if (length === 0) return point;
  return {
    x: point.x + (deltaX / length) * distance,
    y: point.y + (deltaY / length) * distance,
  };
};

import type { BoardNodeData } from '../../diagram/model/interfaces';
import {
  BOARD_MARGIN,
  boardHoles,
  boardSize,
  holeLocalPoint,
} from '../../diagram/model/board-geometry';
import { boardHoleRadius } from '../../diagram/model/board-surface';
import { traceHoles, traceSegmentHoles } from '../../diagram/model/board-trace';
import { DxfCircle, DxfLwPolyline, DxfText } from '../dxf/dxf-entity';
import type { DxfNodeRenderer, DxfRenderContext } from '../dxf/dxf-types';
import { FONT_PHYSICAL_LABEL, LAYERS, LINE_WEIGHT, TEXT_STYLE } from './av-dxf-constants';

/** Renders a board's real outline, copper runs and hole centers. */
export const renderBoardNode: DxfNodeRenderer = (ctx, node) => {
  const data = node.data as BoardNodeData;
  const size = boardSize(data);
  const nodeX = node.position.x;
  const nodeY = node.position.y;

  ctx.doc.addEntity(
    new DxfLwPolyline(
      LAYERS.BOARDS,
      [
        ctx.mapper.mapPoint(nodeX, nodeY),
        ctx.mapper.mapPoint(nodeX + size.width, nodeY),
        ctx.mapper.mapPoint(nodeX + size.width, nodeY + size.height),
        ctx.mapper.mapPoint(nodeX, nodeY + size.height),
      ],
      true,
      undefined,
      LINE_WEIGHT.FRAME,
    ),
  );

  // Copper sealed inside the body is not on the drawing for the same reason it
  // is not on the canvas: it has no visible run and no exposed pad. Emitting
  // the 130 groups of an 830-point breadboard as copper would cover the board
  // with lines and labels that no one could solder to.
  for (const trace of data.traces ?? []) {
    if (trace.internal) continue;
    trace.segments.forEach((segment, index) => {
      const from = toDiagramPoint(data, nodeX, nodeY, segment.from);
      const to = toDiagramPoint(data, nodeX, nodeY, segment.to);
      if (traceSegmentHoles(segment).length === 1) {
        addCircle(ctx, from.x, from.y, data.pitch * 0.22, LAYERS.BOARDS, LINE_WEIGHT.DETAIL);
      } else {
        addLine(ctx, from.x, from.y, to.x, to.y, LINE_WEIGHT.DETAIL);
      }

      if (index > 0) {
        const previous = trace.segments[index - 1];
        const bridgeFrom = toDiagramPoint(data, nodeX, nodeY, previous.to);
        addLine(ctx, bridgeFrom.x, bridgeFrom.y, from.x, from.y, LINE_WEIGHT.SUBTLE);
      }
    });

    const holes = traceHoles(trace);
    const last = holes[holes.length - 1];
    if (last) {
      const labelPoint = toDiagramPoint(data, nodeX, nodeY, last);
      addText(ctx, labelPoint.x + BOARD_MARGIN * 0.4, labelPoint.y + 3, trace.net ?? trace.label);
    }
  }

  // Same radius rule as the canvas, so the drawing matches what was on screen.
  const radius = boardHoleRadius(data);
  for (const hole of boardHoles(data)) {
    const point = toDiagramPoint(data, nodeX, nodeY, hole);
    addCircle(ctx, point.x, point.y, radius, LAYERS.BOARDS, LINE_WEIGHT.SUBTLE);
  }

  addText(ctx, nodeX, nodeY - 6, data.label, 0);
};

function toDiagramPoint(
  data: BoardNodeData,
  nodeX: number,
  nodeY: number,
  hole: { row: number; col: number },
): { x: number; y: number } {
  const local = holeLocalPoint(data, hole);
  return { x: nodeX + local.x, y: nodeY + local.y };
}

function addCircle(
  ctx: DxfRenderContext,
  x: number,
  y: number,
  radius: number,
  layer: string,
  lineweight: number,
): void {
  const mapped = ctx.mapper.mapPoint(x, y);
  ctx.doc.addEntity(
    new DxfCircle(layer, mapped.x, mapped.y, ctx.mapper.mapLength(radius), undefined, lineweight),
  );
}

function addLine(
  ctx: DxfRenderContext,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  lineweight: number,
): void {
  ctx.doc.addEntity(
    new DxfLwPolyline(
      LAYERS.BOARDS,
      [ctx.mapper.mapPoint(x1, y1), ctx.mapper.mapPoint(x2, y2)],
      false,
      undefined,
      lineweight,
    ),
  );
}

function addText(
  ctx: DxfRenderContext,
  x: number,
  y: number,
  text: string,
  valign: 0 | 1 | 2 | 3 = 2,
): void {
  const mapped = ctx.mapper.mapPoint(x, y);
  ctx.doc.addEntity(
    new DxfText(
      LAYERS.BOARDS,
      text,
      mapped.x,
      mapped.y,
      ctx.mapper.mapLength(FONT_PHYSICAL_LABEL),
      TEXT_STYLE.STANDARD,
      0,
      valign,
    ),
  );
}

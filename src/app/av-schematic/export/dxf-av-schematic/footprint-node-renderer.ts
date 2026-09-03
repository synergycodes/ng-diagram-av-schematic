import type { Node, Point } from 'ng-diagram';
import {
  FOOTPRINT_PADDING_CELLS,
  footprintChannel,
  footprintDrawPoint,
  footprintNodeSize,
  type FootprintChannel,
} from '../../diagram/model/footprint-geometry';
import { resolveFootprint, type FootprintShape } from '../../diagram/model/footprint';
import { isBoardNode } from '../../diagram/model/guards';
import type { BoardNodeData, BoardRotation, DeviceNodeData } from '../../diagram/model/interfaces';
import { DxfCircle, DxfLwPolyline, DxfText } from '../dxf/dxf-entity';
import type { DxfNodeRenderer, DxfRenderContext } from '../dxf/dxf-types';
import { FONT_PHYSICAL_LABEL, LAYERS, LINE_WEIGHT, TEXT_STYLE } from './av-dxf-constants';

const FALLBACK_PITCH = 20;
const PIN_RADIUS_CELLS = 0.19;

/** Renders a footprint in the same pitch-scaled and rotated geometry as its SVG node. */
export const renderFootprintNode: DxfNodeRenderer = (ctx, node) => {
  const data = node.data as DeviceNodeData;
  const footprint = resolveFootprint(data);
  if (!footprint) return;

  const rotation = data.placement?.rotation ?? data.footprintRotation ?? 0;
  const board = hostBoard(ctx, data);
  // Same derived geometry as the canvas: the board's central channel moves the
  // half of a seated footprint that sits below it, so a drawing that ignored
  // the gap would put that half a whole `centerGap` away from its own holes.
  const pitch = board?.data.pitch ?? data.footprintPitch ?? FALLBACK_PITCH;
  const channel =
    board && data.placement ? footprintChannel(board.data, footprint, data.placement) : null;
  const pad = FOOTPRINT_PADDING_CELLS * pitch;
  const origin = { x: node.position.x + pad, y: node.position.y + pad };
  const size = footprintNodeSize(footprint, rotation, pitch, channel);

  addPolyline(
    ctx,
    [
      { x: node.position.x, y: node.position.y },
      { x: node.position.x + size.width, y: node.position.y },
      { x: node.position.x + size.width, y: node.position.y + size.height },
      { x: node.position.x, y: node.position.y + size.height },
    ],
    true,
    LINE_WEIGHT.SUBTLE,
  );

  for (const shape of footprint.shapes) {
    renderShape(ctx, shape, footprint, rotation, pitch, origin, channel);
  }
  for (const pin of footprint.pins) {
    const center = shapePoint(
      pin.cell.col,
      pin.cell.row,
      footprint,
      rotation,
      pitch,
      origin,
      channel,
    );
    const mapped = ctx.mapper.mapPoint(center.x, center.y);
    ctx.doc.addEntity(
      new DxfCircle(
        LAYERS.FOOTPRINTS,
        mapped.x,
        mapped.y,
        ctx.mapper.mapLength(PIN_RADIUS_CELLS * pitch),
        undefined,
        pin.primary ? LINE_WEIGHT.FRAME : LINE_WEIGHT.SUBTLE,
      ),
    );
  }

  const caption = [data.deviceId, data.model, `${rotation} deg`].filter(Boolean).join(' ');
  const captionPoint = ctx.mapper.mapPoint(node.position.x + 4, node.position.y - 4);
  ctx.doc.addEntity(
    new DxfText(
      LAYERS.FOOTPRINTS,
      caption,
      captionPoint.x,
      captionPoint.y,
      ctx.mapper.mapLength(FONT_PHYSICAL_LABEL),
      TEXT_STYLE.STANDARD,
    ),
  );
};

function hostBoard(ctx: DxfRenderContext, data: DeviceNodeData): Node<BoardNodeData> | null {
  const boardId = data.placement?.boardId;
  if (!boardId) return null;
  return ctx.nodes.filter(isBoardNode).find((board) => board.data.boardId === boardId) ?? null;
}

function renderShape(
  ctx: DxfRenderContext,
  shape: FootprintShape,
  box: { rows: number; cols: number },
  rotation: BoardRotation,
  pitch: number,
  origin: Point,
  channel: FootprintChannel | null,
): void {
  switch (shape.kind) {
    case 'line': {
      addPolyline(
        ctx,
        [
          shapePoint(shape.x1, shape.y1, box, rotation, pitch, origin, channel),
          shapePoint(shape.x2, shape.y2, box, rotation, pitch, origin, channel),
        ],
        false,
        LINE_WEIGHT.DETAIL,
      );
      return;
    }
    case 'rect': {
      addPolyline(
        ctx,
        [
          shapePoint(shape.x, shape.y, box, rotation, pitch, origin, channel),
          shapePoint(shape.x + shape.width, shape.y, box, rotation, pitch, origin, channel),
          shapePoint(
            shape.x + shape.width,
            shape.y + shape.height,
            box,
            rotation,
            pitch,
            origin,
            channel,
          ),
          shapePoint(shape.x, shape.y + shape.height, box, rotation, pitch, origin, channel),
        ],
        true,
        LINE_WEIGHT.DETAIL,
      );
      return;
    }
    case 'circle': {
      const center = shapePoint(shape.cx, shape.cy, box, rotation, pitch, origin, channel);
      const mapped = ctx.mapper.mapPoint(center.x, center.y);
      ctx.doc.addEntity(
        new DxfCircle(
          LAYERS.FOOTPRINTS,
          mapped.x,
          mapped.y,
          ctx.mapper.mapLength(shape.r * pitch),
          undefined,
          LINE_WEIGHT.DETAIL,
        ),
      );
      return;
    }
    case 'text': {
      const point = shapePoint(shape.x, shape.y, box, rotation, pitch, origin, channel);
      const mapped = ctx.mapper.mapPoint(point.x, point.y);
      const halign = shape.anchor === 'middle' ? 1 : shape.anchor === 'end' ? 2 : 0;
      const dxfRotation = rotation === 0 ? undefined : (360 - rotation) % 360;
      ctx.doc.addEntity(
        new DxfText(
          LAYERS.FOOTPRINTS,
          shape.text,
          mapped.x,
          mapped.y,
          ctx.mapper.mapLength((shape.size ?? 0.42) * pitch),
          TEXT_STYLE.BOLD,
          halign,
          2,
          undefined,
          dxfRotation,
        ),
      );
    }
  }
}

function shapePoint(
  x: number,
  y: number,
  box: { rows: number; cols: number },
  rotation: BoardRotation,
  pitch: number,
  origin: Point,
  channel: FootprintChannel | null,
): Point {
  const drawn = footprintDrawPoint(x, y, box, rotation, channel);
  return { x: origin.x + drawn.x * pitch, y: origin.y + drawn.y * pitch };
}

function addPolyline(
  ctx: DxfRenderContext,
  points: readonly Point[],
  closed: boolean,
  lineweight: number,
): void {
  ctx.doc.addEntity(
    new DxfLwPolyline(
      LAYERS.FOOTPRINTS,
      points.map((point) => ctx.mapper.mapPoint(point.x, point.y)),
      closed,
      undefined,
      lineweight,
    ),
  );
}

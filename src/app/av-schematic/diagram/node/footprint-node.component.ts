import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import {
  NgDiagramModelService,
  NgDiagramPortComponent,
  type NgDiagramNodeTemplate,
  type Node,
} from 'ng-diagram';
import {
  DETACHED_FOOTPRINT_FALLBACK_PITCH,
  FOOTPRINT_PADDING_CELLS,
  applyFootprintChannel,
  footprintChannel,
  footprintDrawPoint,
  footprintDrawnExtent,
  footprintNodeSize,
  footprintPinHoles,
  type FootprintChannel,
} from '../model/footprint-geometry';
import { resolveFootprint, type Footprint, type FootprintPaint } from '../model/footprint';
import { isBoardNode } from '../model/guards';
import { type BoardRotation, type DeviceNodeData, type DevicePort } from '../model/interfaces';
import { BoardPlacementService } from '../placement/board-placement.service';
import { centerLeftPortBoxPosition } from '../edge-reshaping/logic/port-position';

export interface FootprintPinView {
  id: string;
  label: string;
  x: number;
  y: number;
  port: boolean;
  primary: boolean;
}

/**
 * Where each pin is drawn inside the node, in node-local pixels.
 *
 * `channel` is the host board's central gap seen from this placement. Feeding
 * it through here is what keeps the guarantee that matters:
 *
 *   node.position + pinView == board.position + holeLocalPoint(board, hole)
 *
 * A part straddling a breadboard's trench has its lower pins a whole
 * `centerGap` further down the board, and its drawing has to follow them.
 */
export function footprintPinViews(
  footprint: Footprint,
  rotation: BoardRotation,
  pitch: number,
  ports: readonly DevicePort[],
  channel: FootprintChannel | null = null,
): FootprintPinView[] {
  const portIds = new Set(ports.map((port) => port.id));
  const pinsById = new Map(footprint.pins.map((pin) => [pin.id, pin]));
  const pad = FOOTPRINT_PADDING_CELLS * pitch;
  return footprintPinHoles(footprint, { anchor: { row: 0, col: 0 }, rotation }).map((pin) => ({
    id: pin.pinId,
    label: pin.label,
    x: pad + pin.cell.col * pitch,
    y: pad + applyFootprintChannel(pin.cell.row, channel) * pitch,
    port: portIds.has(pin.pinId),
    primary: pinsById.get(pin.pinId)?.primary ?? false,
  }));
}

/** A pin pad drawn on the illustration, already rotated and channel-mapped. */
export interface FootprintPadView {
  id: string;
  cx: number;
  cy: number;
  primary: boolean;
}

export function footprintPadViews(
  footprint: Footprint,
  rotation: BoardRotation,
  channel: FootprintChannel | null,
): FootprintPadView[] {
  return footprint.pins.map((pin) => {
    const point = footprintDrawPoint(pin.cell.col, pin.cell.row, footprint, rotation, channel);
    return { id: pin.id, cx: point.x, cy: point.y, primary: pin.primary === true };
  });
}

/**
 * An illustration shape resolved into the drawn frame: rotated, mapped through
 * the board's channel, and with its paint roles turned into CSS values.
 *
 * The rotation used to be a `matrix(...)` on the whole group, which cannot
 * express the channel: the gap is a horizontal cut in *board* space, so it has
 * to be applied after rotation, per point. Rects are rebuilt from the extremes
 * of their four mapped corners, which is also what stretches one across the
 * trench instead of leaving it behind.
 */
export type FootprintShapeView =
  | {
      kind: 'rect';
      x: number;
      y: number;
      width: number;
      height: number;
      rx: number;
      fill: string;
      stroke: string;
    }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill: string; stroke: string }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; width: number }
  | {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      size: number;
      anchor: 'start' | 'middle' | 'end';
      fill: string;
      /** Turns the glyphs with the part, about the text's own origin. */
      transform: string | null;
    };

/** Bounded palette of paint roles -> the stylesheet's custom properties. */
export function footprintPaintValue(paint: FootprintPaint | undefined): string {
  switch (paint ?? 'none') {
    case 'none':
      return 'none';
    case 'body':
      return 'var(--footprint-body)';
    case 'body-alt':
      return 'var(--footprint-body-alt)';
    case 'accent':
      return 'var(--footprint-accent)';
    case 'lead':
      return 'var(--footprint-lead)';
    case 'silk':
      return 'var(--footprint-silk)';
    case 'polarity':
      return 'var(--footprint-polarity)';
  }
}

export const FOOTPRINT_TEXT_SIZE_CELLS = 0.42;
export const FOOTPRINT_LINE_WIDTH_CELLS = 0.08;

export function footprintShapeViews(
  footprint: Footprint,
  rotation: BoardRotation,
  channel: FootprintChannel | null,
): FootprintShapeView[] {
  const at = (x: number, y: number) => footprintDrawPoint(x, y, footprint, rotation, channel);
  return footprint.shapes.map((shape): FootprintShapeView => {
    switch (shape.kind) {
      case 'rect': {
        const corners = [
          at(shape.x, shape.y),
          at(shape.x + shape.width, shape.y),
          at(shape.x + shape.width, shape.y + shape.height),
          at(shape.x, shape.y + shape.height),
        ];
        const xs = corners.map((corner) => corner.x);
        const ys = corners.map((corner) => corner.y);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        return {
          kind: 'rect',
          x,
          y,
          width: Math.max(...xs) - x,
          height: Math.max(...ys) - y,
          rx: shape.rx ?? 0,
          fill: footprintPaintValue(shape.fill),
          stroke: footprintPaintValue(shape.stroke),
        };
      }
      case 'circle': {
        const center = at(shape.cx, shape.cy);
        return {
          kind: 'circle',
          cx: center.x,
          cy: center.y,
          r: shape.r,
          fill: footprintPaintValue(shape.fill),
          stroke: footprintPaintValue(shape.stroke),
        };
      }
      case 'line': {
        const from = at(shape.x1, shape.y1);
        const to = at(shape.x2, shape.y2);
        return {
          kind: 'line',
          x1: from.x,
          y1: from.y,
          x2: to.x,
          y2: to.y,
          stroke: footprintPaintValue(shape.stroke),
          width: shape.width ?? FOOTPRINT_LINE_WIDTH_CELLS,
        };
      }
      case 'text': {
        const point = at(shape.x, shape.y);
        return {
          kind: 'text',
          x: point.x,
          y: point.y,
          text: shape.text,
          size: shape.size ?? FOOTPRINT_TEXT_SIZE_CELLS,
          anchor: shape.anchor ?? 'start',
          fill: footprintPaintValue(shape.fill),
          transform: rotation === 0 ? null : `rotate(${rotation} ${point.x} ${point.y})`,
        };
      }
    }
  });
}

@Component({
  selector: 'app-footprint-node',
  imports: [NgDiagramPortComponent],
  templateUrl: './footprint-node.component.html',
  styleUrl: './footprint-node.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.selected]': 'node().selected',
  },
})
export class FootprintNodeComponent implements NgDiagramNodeTemplate<DeviceNodeData> {
  private readonly modelService = inject(NgDiagramModelService);
  private readonly placementService = inject(BoardPlacementService);

  node = input.required<Node<DeviceNodeData>>();

  protected readonly data = computed(() => this.node().data);
  protected readonly footprint = computed(() => resolveFootprint(this.data()));
  protected readonly rotation = computed<BoardRotation>(
    () => this.data().placement?.rotation ?? this.data().footprintRotation ?? 0,
  );

  /** The board this footprint is seated on, when it is seated at all. */
  private readonly hostBoard = computed(() => {
    const placement = this.data().placement;
    if (!placement) return null;
    return (
      this.modelService
        .nodes()
        .filter(isBoardNode)
        .find((candidate) => candidate.data.boardId === placement.boardId) ?? null
    );
  });

  protected readonly pitch = computed(
    () =>
      this.hostBoard()?.data.pitch ??
      this.data().footprintPitch ??
      DETACHED_FOOTPRINT_FALLBACK_PITCH,
  );

  /**
   * The host board's central channel, seen from this placement.
   *
   * Null for a loose footprint and for any board without a `centerGap`, which
   * is why nothing about a perfboard-seated part changes.
   */
  protected readonly channel = computed<FootprintChannel | null>(() => {
    const board = this.hostBoard();
    const placement = this.data().placement;
    if (!board || !placement) return null;
    const footprint = this.footprint();
    if (!footprint) return null;
    return footprintChannel(board.data, footprint, placement);
  });

  protected readonly size = computed(() => {
    const footprint = this.footprint();
    if (!footprint) return { width: 0, height: 0 };
    return footprintNodeSize(footprint, this.rotation(), this.pitch(), this.channel());
  });

  protected readonly viewBox = computed(() => {
    const footprint = this.footprint();
    if (!footprint) return '0 0 0 0';
    const extent = footprintDrawnExtent(footprint, this.rotation(), this.channel());
    return `${extent.left} ${extent.top} ${extent.right - extent.left} ${extent.bottom - extent.top}`;
  });

  protected readonly shapes = computed<FootprintShapeView[]>(() => {
    const footprint = this.footprint();
    if (!footprint) return [];
    return footprintShapeViews(footprint, this.rotation(), this.channel());
  });

  protected readonly pads = computed<FootprintPadView[]>(() => {
    const footprint = this.footprint();
    if (!footprint) return [];
    return footprintPadViews(footprint, this.rotation(), this.channel());
  });

  protected readonly pins = computed<FootprintPinView[]>(() => {
    const footprint = this.footprint();
    if (!footprint) return [];
    return footprintPinViews(
      footprint,
      this.rotation(),
      this.pitch(),
      this.data().ports,
      this.channel(),
    );
  });

  protected readonly conflictMessage = computed(() => {
    const conflict = this.placementService.conflict();
    return conflict?.nodeId === this.node().id ? this.placementService.conflictMessage() : null;
  });

  protected readonly portSize = computed(() => Math.max(4, Math.min(this.pitch() - 2, 14)));

  protected portLeft(pin: FootprintPinView): number {
    return centerLeftPortBoxPosition(pin, this.portSize()).x;
  }

  protected portTop(pin: FootprintPinView): number {
    return centerLeftPortBoxPosition(pin, this.portSize()).y;
  }

  protected async rotate(step: 1 | -1, event: Event): Promise<void> {
    event.stopPropagation();
    await this.placementService.rotate(this.node().id, step);
  }

  protected stopNodeGesture(event: Event): void {
    event.stopPropagation();
  }
}

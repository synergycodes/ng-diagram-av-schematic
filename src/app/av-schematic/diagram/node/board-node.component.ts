import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NgDiagramPortComponent, type NgDiagramNodeTemplate, type Node } from 'ng-diagram';
import {
  BOARD_MARGIN,
  boardHoles,
  boardSize,
  holeKey,
  holeLocalPoint,
} from '../model/board-geometry';
import {
  type BoardChannelRect,
  type BoardRailBand,
  type RailPolarity,
  boardChannelRect,
  boardHoleRadius,
  boardHoleStrokeWidth,
  boardMarkingFontSize,
  boardMarkingGap,
  boardRailBands,
  boardRailBleed,
  boardRailStripeOffset,
  boardRowMarkText,
  boardStripeWidth,
  isBreadboard,
  railPolarity,
} from '../model/board-surface';
import { boardHoleLabel, holePortId, tracePortId } from '../model/board-ports';
import { traceHoles, traceSegmentHoles } from '../model/board-trace';
import { type BoardHole, type BoardNodeData, type BoardTrace } from '../model/interfaces';
import { BoardPlacementService } from '../placement/board-placement.service';
import { centerLeftPortBoxPosition } from '../edge-reshaping/logic/port-position';
import { BoardJumperCreationService } from '../board-jumper-creation.service';

interface HoleView extends BoardHole {
  key: string;
  x: number;
  y: number;
  portId: string;
  /** Printed address, e.g. `L2-C5` or `J10` - what the tooltip shows. */
  address: string;
  /** Polarity of the power rail this hole sits on, when it sits on one. */
  polarity: RailPolarity | null;
  /** Outline weight, heavier on a rail so its holes read as one run. */
  strokeWidth: number;
  conflicted: boolean;
}

/** A row's printed name, drawn in both side margins the way a board silks it. */
interface RowMarkingView {
  row: number;
  /** Glyph actually silked: `+`/`-` for a rail, the row name otherwise. */
  label: string;
  y: number;
  /** `+`/`-` suffix of a power bus, which also gets a polarity guide line. */
  polarity: RailPolarity | null;
  guideY: number;
}

interface ColumnTickView {
  x: number;
  text: string;
}

/** A column ruler drawn in a hole-free band, like the numbers on a breadboard. */
interface ColumnRulerView {
  key: string;
  y: number;
  ticks: ColumnTickView[];
}

interface TraceSegmentView {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** A segment that covers a single hole is a solder blob, not a run. */
  dot: boolean;
}

interface TraceView {
  id: string;
  label: string;
  net?: string;
  color: string;
  /** Copper inside the body: drawn faintly, and with no landing pad of its own. */
  internal: boolean;
  segments: TraceSegmentView[];
  /** Dashed hops between disjoint segments of one trace - i.e. jumper wires. */
  bridges: { x1: number; y1: number; x2: number; y2: number }[];
  portId: string;
  portX: number;
  portY: number;
  labelX: number;
  labelY: number;
}

/** Column numbers are printed every fifth column, as on the reference board. */
const COLUMN_TICK_STEP = 5;

/** Stable hue per net name, so the same rail is the same color on every board. */
function netColor(net: string | undefined): string {
  if (!net) return 'var(--av-color-board-copper, #b87333)';
  let hash = 0;
  for (let i = 0; i < net.length; i++) {
    hash = (hash * 31 + net.charCodeAt(i)) % 360;
  }
  return `hsl(${hash}, 68%, 28%)`;
}

/**
 * Renders a physical board as an ng-diagram node: an addressable hole grid,
 * its copper traces, and a connection port for every hole and every trace.
 *
 * Nothing about the rendering is specialized per board - placa A (6 x 11), the
 * 6 x 28 origin perfboard, the 830-point breadboard and the 6 x 3 pecas all
 * take this same path, sized from `rows`/`cols`/`pitch`. Sharing the single
 * `Node[]` array, coordinate space and z-order with device nodes is what keeps
 * "mesmo canvas" true.
 *
 * Every hole carries a port, which is what makes "furos e trilhas funcionam
 * como endpoints conectaveis" literally true rather than approximated: the
 * association a wire records is an ordinary `targetPort` on this node. For a
 * 6 x 28 board that is 168 ports and for the 830-point breadboard it is 830;
 * boards materially larger than that would want ports minted on demand instead
 * (see docs/physical-footprints.md).
 */
@Component({
  selector: 'app-board-node',
  imports: [NgDiagramPortComponent],
  templateUrl: './board-node.component.html',
  styleUrl: './board-node.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.selected]': 'node().selected',
  },
})
export class BoardNodeComponent implements NgDiagramNodeTemplate<BoardNodeData> {
  private readonly placement = inject(BoardPlacementService);
  protected readonly jumperCreation = inject(BoardJumperCreationService);

  node = input.required<Node<BoardNodeData>>();

  protected readonly data = computed(() => this.node().data);

  protected readonly size = computed(() => boardSize(this.data()));

  /** Light plastic, rail bands and a moulded channel instead of bare substrate. */
  protected readonly breadboard = computed(() => isBreadboard(this.data()));

  protected readonly channel = computed<BoardChannelRect | null>(() =>
    boardChannelRect(this.data()),
  );

  /** The pale `+`/`-` bands a breadboard prints behind its power rails. */
  protected readonly railBands = computed<BoardRailBand[]>(() => boardRailBands(this.data()));

  protected readonly holeRadius = computed(() => boardHoleRadius(this.data()));

  /** Every printed marking scales with the pitch, never with a pixel constant. */
  protected readonly markingFontSize = computed(() => boardMarkingFontSize(this.data()));

  protected readonly markingGap = computed(() => boardMarkingGap(this.data()));

  protected readonly stripeWidth = computed(() => boardStripeWidth(this.data()));

  /** A polarity stripe spans exactly the rail band it belongs to. */
  protected readonly stripeX1 = computed(() => BOARD_MARGIN - boardRailBleed(this.data()));

  protected readonly stripeX2 = computed(() => this.size().width - this.stripeX1());

  protected readonly rowMarkLeftX = computed(() => BOARD_MARGIN - this.markingGap());

  protected readonly rowMarkRightX = computed(
    () => this.size().width - BOARD_MARGIN + this.markingGap(),
  );

  /** Hit area for a hole's port: generous enough to grab, never wider than the pitch. */
  protected readonly holePortSize = computed(() =>
    Math.max(4, Math.min(this.data().pitch - 2, 14)),
  );

  private readonly conflictedKeys = computed(() =>
    this.placement.conflictHoleKeys(this.data().boardId),
  );

  protected readonly holes = computed<HoleView[]>(() => {
    const data = this.data();
    const conflicted = this.conflictedKeys();
    return boardHoles(data).map((hole) => {
      const key = holeKey(hole);
      const polarity = railPolarity(data.rowLabels?.[hole.row]);
      return {
        ...hole,
        key,
        ...holeLocalPoint(data, hole),
        portId: holePortId(hole),
        address: boardHoleLabel(hole, data.rowLabels),
        polarity,
        strokeWidth: boardHoleStrokeWidth(data, polarity),
        conflicted: conflicted.has(key),
      };
    });
  });

  protected onHolePointerDown(event: PointerEvent, hole: BoardHole): void {
    if (event.button !== 0 || !this.jumperCreation.selectHole(this.node(), hole)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  private readonly allTraces = computed<TraceView[]>(() =>
    (this.data().traces ?? []).map((trace) => this.toTraceView(trace)),
  );

  /**
   * The copper this board actually shows: drawn, labelled and given a
   * `trace:<id>` port.
   *
   * Internal grouping - a breadboard's column clips and its four buses - is
   * copper sealed inside the body. It has no visible run, no exposed pad to
   * land on, and drawing it would put 130 phantom lines and 130 port boxes
   * over the board's own holes. So normal rendering omits it entirely: the
   * groups keep grouping (they are still one electrical point, still what a
   * net is derived from), and connecting to one means connecting to one of its
   * holes, exactly as on the hardware.
   */
  protected readonly exposedTraces = computed<TraceView[]>(() =>
    this.allTraces().filter((trace) => !trace.internal),
  );

  /**
   * Row names in both side margins, plus the polarity guide line a `+`/`-` bus
   * draws alongside it. Both come straight from `rowLabels`, so a board that
   * does not name its rows draws nothing extra.
   *
   * The first row of a block of adjacent `+`/`-` rows draws its guide above,
   * every following row draws it below. A bus pair therefore ends up bracketed
   * by its two lines, which is how a breadboard silks them - and the offset is
   * wide enough to clear the rail band drawn behind the row.
   *
   * A rail silks the bare `+`/`-` glyph rather than `top+`: that is what the
   * plastic prints, and it is what fits in the side margin.
   */
  protected readonly rowMarkings = computed<RowMarkingView[]>(() => {
    const data = this.data();
    const labels = data.rowLabels;
    if (!labels) return [];
    const offset = boardRailStripeOffset(data);
    const markings: RowMarkingView[] = [];
    labels.forEach((label, row) => {
      if (!label) return;
      const { y } = holeLocalPoint(data, { row, col: 0 });
      const polarity = railPolarity(label);
      const outward = polarity === null ? 0 : railPolarity(labels[row - 1]) === null ? -1 : 1;
      markings.push({
        row,
        label: boardRowMarkText(label),
        y,
        polarity,
        guideY: y + outward * offset,
      });
    });
    return markings;
  });

  /**
   * Column numbers, drawn centred in each band of hole-free rows. On a
   * breadboard those bands are the two spacers that separate the buses from
   * the terminal strips - exactly where the numbers are printed; a board with
   * no empty rows gets no ruler.
   */
  protected readonly columnRulers = computed<ColumnRulerView[]>(() => {
    const data = this.data();
    const occupied = new Set(boardHoles(data).map((hole) => hole.row));
    const rulers: ColumnRulerView[] = [];
    let runStart: number | null = null;
    for (let row = 0; row <= data.rows; row++) {
      const empty = row < data.rows && !occupied.has(row);
      if (empty && runStart === null) runStart = row;
      if (!empty && runStart !== null) {
        rulers.push(this.toColumnRuler(runStart, row - 1));
        runStart = null;
      }
    }
    return rulers;
  });

  private toColumnRuler(firstRow: number, lastRow: number): ColumnRulerView {
    const data = this.data();
    const top = holeLocalPoint(data, { row: firstRow, col: 0 }).y;
    const bottom = holeLocalPoint(data, { row: lastRow, col: 0 }).y;
    const ticks: ColumnTickView[] = [];
    for (let col = COLUMN_TICK_STEP - 1; col < data.cols; col += COLUMN_TICK_STEP) {
      ticks.push({
        x: holeLocalPoint(data, { row: firstRow, col }).x,
        text: String(col + 1),
      });
    }
    return { key: `${firstRow}-${lastRow}`, y: (top + bottom) / 2, ticks };
  }

  protected holePortLeft(hole: HoleView): number {
    return centerLeftPortBoxPosition(hole, this.holePortSize()).x;
  }

  protected holePortTop(hole: HoleView): number {
    return centerLeftPortBoxPosition(hole, this.holePortSize()).y;
  }

  /**
   * A port's flow position is taken from its own box (left edge, vertical
   * centre - see edge-reshaping/logic/port-position.ts), so every port box is
   * laid out with its left edge exactly on the point it represents. That makes
   * wires land on the hole centre without any correction elsewhere.
   */
  protected tracePortLeft(trace: TraceView): number {
    return centerLeftPortBoxPosition({ x: trace.portX, y: trace.portY }, this.holePortSize()).x;
  }

  protected tracePortTop(trace: TraceView): number {
    return centerLeftPortBoxPosition({ x: trace.portX, y: trace.portY }, this.holePortSize()).y;
  }

  private toTraceView(trace: BoardTrace): TraceView {
    const data = this.data();
    const segments: TraceSegmentView[] = trace.segments.map((segment) => {
      const from = holeLocalPoint(data, segment.from);
      const to = holeLocalPoint(data, segment.to);
      return {
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
        dot: traceSegmentHoles(segment).length === 1,
      };
    });

    const bridges = segments.slice(1).map((segment, index) => {
      const previous = segments[index];
      return { x1: previous.x2, y1: previous.y2, x2: segment.x1, y2: segment.y1 };
    });

    const holes = traceHoles(trace);
    const first = holes[0] ?? { row: 0, col: 0 };
    const last = holes[holes.length - 1] ?? first;
    const firstPoint = holeLocalPoint(data, first);
    const lastPoint = holeLocalPoint(data, last);

    return {
      id: trace.id,
      label: trace.label,
      net: trace.net,
      color: netColor(trace.net),
      internal: trace.internal === true,
      segments,
      bridges,
      portId: tracePortId(trace.id),
      portX: firstPoint.x,
      portY: firstPoint.y,
      labelX: lastPoint.x + BOARD_MARGIN * 0.4,
      labelY: lastPoint.y + 3,
    };
  }
}

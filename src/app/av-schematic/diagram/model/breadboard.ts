import { boardHoleLabel } from './board-ports';
import { type BoardHole, type BoardNodeData, type BoardTrace } from './interfaces';

/**
 * Geometry of a full-size solderless breadboard - the 830-point board.
 *
 * Layout adapted from the MIT-licensed `safaorhan/breadboard` (revision
 * `db5f279`, `src/board.ts`): its row order, the three-pitch gaps around the
 * central channel and the bus-column formula `(col - 3) % 6 < 5` over columns
 * 3..61. Everything here is expressed against this repository's own
 * `BoardNodeData` model - rows, columns, pitch, a sparse hole list and copper
 * traces - so no code was copied; see docs/license-matrix.md for the
 * attribution record.
 *
 * The numbers a physical 830-point board is sold by:
 *
 * | region             | holes                                  |
 * |--------------------|----------------------------------------|
 * | terminal strips    | 63 columns x 10 rows (A-J) = 630       |
 * | buses (4 rails)    | 4 x 50                     = 200       |
 * | total                                           = 830       |
 *
 * Nothing in the model knows about any of this: a breadboard is an ordinary
 * board whose holes and traces happen to be built by the helpers below, so it
 * shares the single canvas, the drag/snap path and the save format with every
 * other board.
 */

/** Numbered columns of a full-size breadboard. */
export const BREADBOARD_COLS = 63;

/** Terminal rows, top to bottom, exactly as silk-screened on the plastic. */
export const BREADBOARD_TERMINAL_ROWS = ['J', 'I', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A'] as const;

/** Bus (power rail) names, top to bottom. */
export const BREADBOARD_BUS_ROWS = ['top-', 'top+', 'bottom-', 'bottom+'] as const;

export type BreadboardTerminalRow = (typeof BREADBOARD_TERMINAL_ROWS)[number];
export type BreadboardBusRow = (typeof BREADBOARD_BUS_ROWS)[number];

/**
 * Row name per grid row, top to bottom; `''` is a spacer row that carries no
 * holes at all.
 *
 * The two spacer rows above `J` and below `A` are what puts the buses three
 * pitch units away from the terminal strips, as on the real board. The
 * central channel is *not* a spacer row: it is the board's `centerGap`, which
 * keeps rows `F` and `E` adjacent as addresses while drawing the 0.3 in
 * recess between them (see `breadboardCenterGap`).
 */
export const BREADBOARD_ROW_LABELS: readonly string[] = [
  'top-',
  'top+',
  '',
  '',
  'J',
  'I',
  'H',
  'G',
  'F',
  'E',
  'D',
  'C',
  'B',
  'A',
  '',
  '',
  'bottom-',
  'bottom+',
];

export const BREADBOARD_ROWS = BREADBOARD_ROW_LABELS.length;

/** Holes of one terminal group, and of one bus group between its gaps. */
export const BREADBOARD_GROUP_SIZE = 5;

/** First column (0-based) that carries bus holes. */
const BUS_FIRST_COL = 2;
/** Last column (0-based) that carries bus holes. */
const BUS_LAST_COL = 60;
/** Bus columns repeat as five holes then one blank. */
const BUS_PERIOD = BREADBOARD_GROUP_SIZE + 1;

/**
 * The channel is 0.3 in wide - two pitch units of clearance on top of the one
 * pitch that separates any two adjacent rows, so `F` and `E` end up three
 * pitch units apart exactly like the reference.
 */
export function breadboardCenterGap(pitch: number): number {
  return pitch * 2;
}

/** Row index of a named row, or -1 when the board has no such row. */
export function breadboardRowIndex(rowLabel: string): number {
  return BREADBOARD_ROW_LABELS.indexOf(rowLabel);
}

/** Whether a 0-based column carries bus holes; the gaps between groups do not. */
export function isBreadboardBusColumn(col: number): boolean {
  return (
    col >= BUS_FIRST_COL &&
    col <= BUS_LAST_COL &&
    (col - BUS_FIRST_COL) % BUS_PERIOD < BREADBOARD_GROUP_SIZE
  );
}

/** Every 0-based column of one bus, in order. */
export function breadboardBusColumns(): number[] {
  const cols: number[] = [];
  for (let col = 0; col < BREADBOARD_COLS; col++) {
    if (isBreadboardBusColumn(col)) cols.push(col);
  }
  return cols;
}

/** Row indices of the ten terminal rows, top to bottom. */
export function breadboardTerminalRowIndices(): number[] {
  return BREADBOARD_TERMINAL_ROWS.map((row) => breadboardRowIndex(row));
}

/** Row indices of the four buses, top to bottom. */
export function breadboardBusRowIndices(): number[] {
  return BREADBOARD_BUS_ROWS.map((row) => breadboardRowIndex(row));
}

/** The 630 terminal holes, row-major. */
export function breadboardTerminalHoles(): BoardHole[] {
  const holes: BoardHole[] = [];
  for (const row of breadboardTerminalRowIndices()) {
    for (let col = 0; col < BREADBOARD_COLS; col++) {
      holes.push({ row, col });
    }
  }
  return holes;
}

/** The 200 bus holes, row-major. */
export function breadboardBusHoles(): BoardHole[] {
  const cols = breadboardBusColumns();
  const holes: BoardHole[] = [];
  for (const row of breadboardBusRowIndices()) {
    for (const col of cols) {
      holes.push({ row, col });
    }
  }
  return holes;
}

/** All 830 holes, sorted row-major - the board's sparse hole list. */
export function breadboardHoles(): BoardHole[] {
  return [...breadboardBusHoles(), ...breadboardTerminalHoles()].sort(
    (a, b) => a.row - b.row || a.col - b.col,
  );
}

/** Trace id of one terminal group: the two independent halves of a column. */
export function breadboardColumnTraceId(col: number, half: 'jf' | 'ea'): string {
  return `bb-col-${col + 1}-${half}`;
}

export function breadboardBusTraceId(bus: BreadboardBusRow): string {
  return `bb-bus-${bus.replace('+', 'plus').replace('-', 'minus')}`;
}

/**
 * The 126 terminal groups: every column carries two electrically independent
 * runs of five holes, `J..F` above the channel and `E..A` below it.
 */
export function breadboardColumnTraces(): BoardTrace[] {
  const jRow = breadboardRowIndex('J');
  const fRow = breadboardRowIndex('F');
  const eRow = breadboardRowIndex('E');
  const aRow = breadboardRowIndex('A');
  const traces: BoardTrace[] = [];
  for (let col = 0; col < BREADBOARD_COLS; col++) {
    traces.push({
      id: breadboardColumnTraceId(col, 'jf'),
      label: `J${col + 1}-F${col + 1}`,
      internal: true,
      segments: [{ from: { row: jRow, col }, to: { row: fRow, col } }],
    });
    traces.push({
      id: breadboardColumnTraceId(col, 'ea'),
      label: `E${col + 1}-A${col + 1}`,
      internal: true,
      segments: [{ from: { row: eRow, col }, to: { row: aRow, col } }],
    });
  }
  return traces;
}

/**
 * The four buses. Each is one electrical point spanning fifty holes, drawn as
 * the ten runs of five the plastic actually exposes; the one-column gaps
 * between runs are physically bridged inside the strip, which is what a
 * multi-segment trace already means here.
 */
export function breadboardBusTraces(
  nets?: Partial<Record<BreadboardBusRow, string>>,
): BoardTrace[] {
  return BREADBOARD_BUS_ROWS.map((bus) => {
    const row = breadboardRowIndex(bus);
    const segments = [];
    for (let col = BUS_FIRST_COL; col <= BUS_LAST_COL; col += BUS_PERIOD) {
      segments.push({
        from: { row, col },
        to: { row, col: col + BREADBOARD_GROUP_SIZE - 1 },
      });
    }
    return {
      id: breadboardBusTraceId(bus),
      label: bus,
      net: nets?.[bus],
      internal: true,
      segments,
    };
  });
}

export function breadboardTraces(nets?: Partial<Record<BreadboardBusRow, string>>): BoardTrace[] {
  return [...breadboardColumnTraces(), ...breadboardBusTraces(nets)];
}

export interface BreadboardOptions {
  boardId: string;
  label: string;
  pitch: number;
  notes?: string;
  holeDiameter?: number;
  /** Net carried by each bus, when the assembly already assigns one. */
  busNets?: Partial<Record<BreadboardBusRow, string>>;
}

/**
 * A complete 830-point breadboard as an ordinary `BoardNodeData`.
 *
 * `pitch` is the only scale: hole positions, the channel, the printed markings
 * and every seated footprint are derived from it, so the board is not pinned
 * to any particular pixel size.
 *
 * `surface: 'breadboard'` is what carries the light plastic, the recessed
 * channel and the rail bands across a save/reload - the renderer never guesses
 * a board's kind from its dimensions.
 */
export function createBreadboard830(options: BreadboardOptions): BoardNodeData {
  return {
    type: 'board',
    boardId: options.boardId,
    label: options.label,
    surface: 'breadboard',
    ...(options.notes === undefined ? {} : { notes: options.notes }),
    rows: BREADBOARD_ROWS,
    cols: BREADBOARD_COLS,
    pitch: options.pitch,
    centerGap: breadboardCenterGap(options.pitch),
    rowLabels: [...BREADBOARD_ROW_LABELS],
    ...(options.holeDiameter === undefined ? {} : { holeDiameter: options.holeDiameter }),
    holes: breadboardHoles(),
    traces: breadboardTraces(options.busNets),
  };
}

/** Hole address on a breadboard, e.g. `J10` or `top+:12`; null on a spacer row. */
export function breadboardHoleAddress(hole: BoardHole): string | null {
  if (!BREADBOARD_ROW_LABELS[hole.row]) return null;
  return boardHoleLabel(hole, BREADBOARD_ROW_LABELS);
}

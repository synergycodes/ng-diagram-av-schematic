import {
  BOARD_MARGIN,
  DEFAULT_HOLE_DIAMETER,
  boardCenterGap,
  boardSize,
  holeLocalPoint,
} from './board-geometry';
import { DEFAULT_BOARD_SURFACE, type BoardNodeData, type BoardSurface } from './interfaces';

/**
 * The drawn appearance of a board, derived from its persisted `surface`.
 *
 * Everything here is a ratio of the board's own `pitch`, never a pixel
 * constant: a board is described by `rows`, `cols` and `pitch` alone, so its
 * plastic, its channel, its rail bands and its silk-screen have to scale with
 * it or a board saved at a different pitch would come back wrong.
 *
 * The breadboard ratios are the proportions of the MIT-licensed
 * `safaorhan/breadboard` (revision `db5f279`, `src/board.ts` and
 * `src/render.ts`) re-expressed against its own `PITCH = 12` and
 * `HOLE_RADIUS = 3.5`, so the board reads like the reference at any pitch. No
 * code was copied; see docs/license-matrix.md.
 */

/** `HOLE_RADIUS / PITCH` in the reference: the drawn radius of a hole. */
export const BREADBOARD_HOLE_RADIUS_RATIO = 3.5 / 12;

/** `(HOLE_RADIUS * 2 + 4) / PITCH`: height of the pale band behind a rail row. */
export const BREADBOARD_RAIL_BAND_HEIGHT_RATIO = 11 / 12;

/** `4 / PITCH`: how far a rail band runs past the outermost hole column. */
export const BREADBOARD_RAIL_BAND_BLEED_RATIO = 4 / 12;

/** `3 / PITCH`: corner radius of a rail band. */
export const BREADBOARD_RAIL_BAND_RADIUS_RATIO = 3 / 12;

/** `(HOLE_RADIUS + 2 + 4) / PITCH`: rail-row centre to its polarity stripe. */
export const BREADBOARD_RAIL_STRIPE_RATIO = 9.5 / 12;

/** `(PITCH - 2) / PITCH`: height of the recessed central channel. */
export const BREADBOARD_CHANNEL_RATIO = 10 / 12;

/** `0.5 / PITCH`: outline weight of a hole in the plastic. */
export const BREADBOARD_HOLE_STROKE_RATIO = 0.5 / 12;

/** `0.75 / PITCH`: outline weight of a hole that sits on a power rail. */
export const BREADBOARD_RAIL_HOLE_STROKE_RATIO = 0.75 / 12;

/** `1.5 / PITCH`: weight of a polarity stripe. */
export const BREADBOARD_STRIPE_WIDTH_RATIO = 1.5 / 12;

/** Silk-screen text height, as a share of the pitch. */
export const BOARD_MARKING_FONT_RATIO = 0.42;

/** Row name to first-hole gap, as a share of the pitch. */
export const BOARD_MARKING_GAP_RATIO = 0.5;

/**
 * Ratios that would otherwise push a marking off the board are clamped to a
 * share of `BOARD_MARGIN`, which is a fixed pixel frame rather than a multiple
 * of the pitch. Without this a board whose pitch is large relative to the
 * margin would silk its stripes and row names outside its own body.
 */
const MARGIN_CLAMP = 0.8;
const MARKING_MARGIN_CLAMP = 0.55;

export type RailPolarity = 'positive' | 'negative';

/** The surface a board is drawn with; the default for a board without one. */
export function boardSurface(board: Pick<BoardNodeData, 'surface'>): BoardSurface {
  return board.surface ?? DEFAULT_BOARD_SURFACE;
}

export function isBreadboard(board: Pick<BoardNodeData, 'surface'>): boolean {
  return boardSurface(board) === 'breadboard';
}

/**
 * Polarity a printed row name declares, by its trailing sign - `top+` is the
 * positive rail, `top-` the negative one, `J` is neither. The suffix is the
 * only thing read, so a board is free to name its rails whatever it prints.
 */
export function railPolarity(rowLabel: string | undefined): RailPolarity | null {
  if (!rowLabel) return null;
  if (rowLabel.endsWith('+')) return 'positive';
  if (rowLabel.endsWith('-')) return 'negative';
  return null;
}

/**
 * What a rail row silks in the side margins: the bare polarity glyph, exactly
 * as the hardware prints it. `top+` would not fit in the margin and would say
 * nothing a `+` beside the top rail does not already say.
 */
export function boardRowMarkText(rowLabel: string): string {
  const polarity = railPolarity(rowLabel);
  if (polarity === 'positive') return '+';
  if (polarity === 'negative') return '−';
  return rowLabel;
}

/** Drawn radius of a hole: explicit `holeDiameter` first, else per surface. */
export function boardHoleRadius(
  board: Pick<BoardNodeData, 'surface' | 'pitch' | 'holeDiameter'>,
): number {
  if (board.holeDiameter !== undefined) return board.holeDiameter / 2;
  if (isBreadboard(board)) return board.pitch * BREADBOARD_HOLE_RADIUS_RATIO;
  return DEFAULT_HOLE_DIAMETER / 2;
}

/** Silk-screen text height for this board. */
export function boardMarkingFontSize(board: Pick<BoardNodeData, 'pitch'>): number {
  return board.pitch * BOARD_MARKING_FONT_RATIO;
}

/** Gap between a side margin's row name and the first hole of that row. */
export function boardMarkingGap(board: Pick<BoardNodeData, 'pitch'>): number {
  return Math.min(board.pitch * BOARD_MARKING_GAP_RATIO, BOARD_MARGIN * MARKING_MARGIN_CLAMP);
}

/** Distance from a rail row's centre to its polarity stripe. */
export function boardRailStripeOffset(board: Pick<BoardNodeData, 'pitch'>): number {
  return Math.min(board.pitch * BREADBOARD_RAIL_STRIPE_RATIO, BOARD_MARGIN * MARGIN_CLAMP);
}

export function boardStripeWidth(board: Pick<BoardNodeData, 'pitch'>): number {
  return board.pitch * BREADBOARD_STRIPE_WIDTH_RATIO;
}

/** How far a rail band - and the polarity stripe above it - overruns the holes. */
export function boardRailBleed(board: Pick<BoardNodeData, 'pitch'>): number {
  return board.pitch * BREADBOARD_RAIL_BAND_BLEED_RATIO;
}

export function boardHoleStrokeWidth(
  board: Pick<BoardNodeData, 'pitch'>,
  polarity: RailPolarity | null,
): number {
  const ratio =
    polarity === null ? BREADBOARD_HOLE_STROKE_RATIO : BREADBOARD_RAIL_HOLE_STROKE_RATIO;
  return board.pitch * ratio;
}

export interface BoardRailBand {
  row: number;
  polarity: RailPolarity;
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

/**
 * The pale rounded band a solderless breadboard prints behind each power rail,
 * one per `+`/`-` row of `rowLabels`.
 *
 * A perfboard has no printing at all, so it gets none: this is the whole of
 * "sem alterar a aparencia das perfboards" for the rails.
 */
export function boardRailBands(
  board: Pick<BoardNodeData, 'surface' | 'rows' | 'cols' | 'pitch' | 'centerGap' | 'rowLabels'>,
): BoardRailBand[] {
  if (!isBreadboard(board)) return [];
  const labels = board.rowLabels;
  if (!labels) return [];
  const bleed = boardRailBleed(board);
  const height = board.pitch * BREADBOARD_RAIL_BAND_HEIGHT_RATIO;
  const bands: BoardRailBand[] = [];
  labels.forEach((label, row) => {
    const polarity = railPolarity(label);
    if (polarity === null) return;
    bands.push({
      row,
      polarity,
      x: BOARD_MARGIN - bleed,
      y: holeLocalPoint(board, { row, col: 0 }).y - height / 2,
      width: (board.cols - 1) * board.pitch + bleed * 2,
      height,
      radius: board.pitch * BREADBOARD_RAIL_BAND_RADIUS_RATIO,
    });
  });
  return bands;
}

export interface BoardChannelRect {
  y: number;
  height: number;
  width: number;
}

/**
 * The central gap, drawn per surface.
 *
 * A perfboard's `centerGap` is plain clearance between two halves of the same
 * substrate, so it is filled edge to edge exactly as before. A breadboard's is
 * a moulded recess: the plastic continues either side of it and only the
 * groove itself is sunk, so it is drawn as a narrow band centred in the gap -
 * the reference's `board-trench`.
 */
export function boardChannelRect(
  board: Pick<BoardNodeData, 'surface' | 'rows' | 'cols' | 'pitch' | 'centerGap'>,
): BoardChannelRect | null {
  const gap = boardCenterGap(board);
  if (!gap) return null;
  const width = boardSize(board).width;
  if (!isBreadboard(board)) return { y: gap.y, height: gap.height, width };
  const height = board.pitch * BREADBOARD_CHANNEL_RATIO;
  return { y: gap.y + gap.height / 2 - height / 2, height, width };
}

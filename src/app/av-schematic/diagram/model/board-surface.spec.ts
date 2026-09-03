import { describe, expect, it } from 'vitest';
import { BOARD_MARGIN, DEFAULT_HOLE_DIAMETER, boardSize, holeLocalPoint } from './board-geometry';
import {
  BREADBOARD_HOLE_RADIUS_RATIO,
  type BoardChannelRect,
  BREADBOARD_RAIL_BAND_HEIGHT_RATIO,
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
  boardSurface,
  isBreadboard,
  railPolarity,
} from './board-surface';
import { BREADBOARD_ROW_LABELS, breadboardRowIndex, createBreadboard830 } from './breadboard';
import { type BoardNodeData } from './interfaces';

const PITCH = 20;

/** The breadboard's channel, without a `!` on every read of it. */
function channelOf(board: BoardNodeData): BoardChannelRect {
  const channel = boardChannelRect(board);
  if (!channel) throw new Error(`${board.boardId}: expected a drawn channel`);
  return channel;
}

const breadboard = createBreadboard830({
  boardId: 'bb',
  label: 'Breadboard 830',
  pitch: PITCH,
});

/** The 6 x 28 origin perfboard: bare substrate, no printing, no channel. */
const perfboard: BoardNodeData = {
  type: 'board',
  boardId: 'perf',
  label: 'Perfboard',
  rows: 6,
  cols: 28,
  pitch: PITCH,
};

describe('board surface', () => {
  it('treats a board without a surface as a perfboard', () => {
    expect(boardSurface(perfboard)).toBe('perfboard');
    expect(isBreadboard(perfboard)).toBe(false);
  });

  it('carries the breadboard surface on the 830-point board itself', () => {
    expect(breadboard.surface).toBe('breadboard');
    expect(isBreadboard(breadboard)).toBe(true);
  });

  it('reads polarity from the printed row name, and nothing else', () => {
    expect(railPolarity('top+')).toBe('positive');
    expect(railPolarity('bottom-')).toBe('negative');
    expect(railPolarity('J')).toBeNull();
    expect(railPolarity('')).toBeNull();
    expect(railPolarity(undefined)).toBeNull();
  });

  it('silks a rail as its bare polarity glyph and a terminal row as its name', () => {
    expect(boardRowMarkText('top+')).toBe('+');
    expect(boardRowMarkText('bottom-')).toBe('−');
    expect(boardRowMarkText('J')).toBe('J');
  });
});

describe('breadboard drawn geometry', () => {
  it('derives every printed dimension from the pitch, at any pitch', () => {
    const small = createBreadboard830({ boardId: 'bb', label: 'small', pitch: 8 });
    const ratio = (board: BoardNodeData, value: number) => value / board.pitch;

    expect(ratio(breadboard, boardHoleRadius(breadboard))).toBeCloseTo(
      ratio(small, boardHoleRadius(small)),
    );
    expect(ratio(breadboard, boardMarkingFontSize(breadboard))).toBeCloseTo(
      ratio(small, boardMarkingFontSize(small)),
    );
    expect(ratio(breadboard, boardStripeWidth(breadboard))).toBeCloseTo(
      ratio(small, boardStripeWidth(small)),
    );
    expect(ratio(breadboard, boardRailBleed(breadboard))).toBeCloseTo(
      ratio(small, boardRailBleed(small)),
    );
    expect(ratio(breadboard, channelOf(breadboard).height)).toBeCloseTo(
      ratio(small, channelOf(small).height),
    );
    expect(ratio(breadboard, boardRailBands(breadboard)[0].height)).toBeCloseTo(
      ratio(small, boardRailBands(small)[0].height),
    );
  });

  it('sizes a breadboard hole from the pitch, not from the perfboard default', () => {
    expect(boardHoleRadius(breadboard)).toBeCloseTo(PITCH * BREADBOARD_HOLE_RADIUS_RATIO);
    expect(boardHoleRadius(perfboard)).toBe(DEFAULT_HOLE_DIAMETER / 2);
  });

  it('lets an explicit holeDiameter win over the surface default', () => {
    expect(boardHoleRadius({ ...breadboard, holeDiameter: 9 })).toBe(4.5);
  });

  it('outlines a rail hole more heavily than a plain one', () => {
    expect(boardHoleStrokeWidth(breadboard, 'positive')).toBeGreaterThan(
      boardHoleStrokeWidth(breadboard, null),
    );
  });

  it('prints one rail band per +/- row, centred on that row', () => {
    const bands = boardRailBands(breadboard);
    expect(bands.map((band) => band.polarity)).toEqual([
      'negative',
      'positive',
      'negative',
      'positive',
    ]);
    expect(bands.map((band) => band.row)).toEqual([
      breadboardRowIndex('top-'),
      breadboardRowIndex('top+'),
      breadboardRowIndex('bottom-'),
      breadboardRowIndex('bottom+'),
    ]);

    const band = bands[0];
    const rowY = holeLocalPoint(breadboard, { row: band.row, col: 0 }).y;
    expect(band.y + band.height / 2).toBeCloseTo(rowY);
    expect(band.height).toBeCloseTo(PITCH * BREADBOARD_RAIL_BAND_HEIGHT_RATIO);
  });

  it('runs a rail band past the outermost hole on both sides, and no further', () => {
    const band = boardRailBands(breadboard)[0];
    const bleed = boardRailBleed(breadboard);
    const lastHoleX = holeLocalPoint(breadboard, { row: band.row, col: breadboard.cols - 1 }).x;
    expect(band.x).toBeCloseTo(BOARD_MARGIN - bleed);
    expect(band.x + band.width).toBeCloseTo(lastHoleX + bleed);
    expect(band.x).toBeGreaterThan(0);
    expect(band.x + band.width).toBeLessThan(boardSize(breadboard).width);
  });

  it('keeps every rail band and its stripe inside the board body', () => {
    const height = boardSize(breadboard).height;
    for (const band of boardRailBands(breadboard)) {
      expect(band.y).toBeGreaterThan(0);
      expect(band.y + band.height).toBeLessThan(height);

      const rowY = holeLocalPoint(breadboard, { row: band.row, col: 0 }).y;
      const offset = boardRailStripeOffset(breadboard);
      // The stripe clears the band it brackets instead of being drawn over it.
      expect(offset).toBeGreaterThan(band.height / 2);
      expect(rowY - offset).toBeGreaterThan(0);
      expect(rowY + offset).toBeLessThan(height);
    }
  });

  it('leaves the row name inside the margin instead of hanging off the board', () => {
    const gap = boardMarkingGap(breadboard);
    expect(BOARD_MARGIN - gap).toBeGreaterThan(0);
    expect(gap).toBeGreaterThan(0);
  });

  it('gives a perfboard no rail bands at all, even when it names rows', () => {
    expect(boardRailBands(perfboard)).toEqual([]);
    expect(
      boardRailBands({ ...perfboard, rowLabels: ['top+', 'top-', 'A', 'B', 'C', 'D'] }),
    ).toEqual([]);
  });

  it('sinks only a narrow groove in a breadboard, not the whole clearance', () => {
    const channel = channelOf(breadboard);
    const fRow = holeLocalPoint(breadboard, { row: breadboardRowIndex('F'), col: 0 }).y;
    const eRow = holeLocalPoint(breadboard, { row: breadboardRowIndex('E'), col: 0 }).y;

    expect(channel.y + channel.height / 2).toBeCloseTo((fRow + eRow) / 2);
    expect(breadboard.centerGap).toBe(PITCH * 2);
    expect(channel.height).toBeLessThan(PITCH * 2);
    expect(channel.y).toBeGreaterThan(fRow);
    expect(channel.y + channel.height).toBeLessThan(eRow);
    expect(channel.width).toBe(boardSize(breadboard).width);
  });

  it('fills a perfboard clearance edge to edge, exactly as before', () => {
    const gapped = { ...perfboard, centerGap: 12 };
    const channel = channelOf(gapped);
    expect(channel.height).toBe(12);
    expect(channel.y).toBe(BOARD_MARGIN + 2 * PITCH + PITCH / 2);
  });

  it('draws no channel on a board that declares no clearance', () => {
    expect(boardChannelRect(perfboard)).toBeNull();
  });

  it('names every row the reference names, in the reference order', () => {
    expect(breadboard.rowLabels).toEqual([...BREADBOARD_ROW_LABELS]);
  });
});

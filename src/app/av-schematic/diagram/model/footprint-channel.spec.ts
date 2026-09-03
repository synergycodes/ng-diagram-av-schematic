import { describe, expect, it } from 'vitest';
import { holeLocalPoint } from './board-geometry';
import {
  FOOTPRINT_PADDING_CELLS,
  applyFootprintChannel,
  rotateCell,
  rotateFootprintPoint,
  footprintChannel,
  footprintDrawPoint,
  footprintNodeSize,
  footprintPinHoles,
  placementNodePosition,
  rotatedFootprintBox,
} from './footprint-geometry';
import { footprintPinViews } from '../node/footprint-node.component';
import { BREADBOARD_ROWS, breadboardRowIndex, createBreadboard830 } from './breadboard';
import { RESISTOR_1K_FOOTPRINT, type Footprint } from './footprint';
import {
  BOARD_ROTATIONS,
  type BoardNodeData,
  type BoardRotation,
  type DevicePlacement,
  type DevicePort,
} from './interfaces';

const PITCH = 20;

const breadboard = createBreadboard830({
  boardId: 'bb',
  label: 'Breadboard 830',
  pitch: PITCH,
});

/** A flat perfboard of the same grid: no channel, so nothing may move. */
const perfboard: BoardNodeData = {
  type: 'board',
  boardId: 'perf',
  label: 'Perfboard',
  rows: BREADBOARD_ROWS,
  cols: 12,
  pitch: PITCH,
};

/**
 * A two-row module with a header band drawn across its body - the shape the
 * bug was invisible on until it straddled the trench. Six cells long so that
 * at 90 degrees it still spans the channel.
 */
const module6: Footprint = {
  id: 'straddler',
  label: 'Straddler',
  rows: 2,
  cols: 6,
  pins: [
    { id: 'p1', label: 'P1', cell: { row: 0, col: 0 }, primary: true },
    { id: 'p2', label: 'P2', cell: { row: 0, col: 5 } },
    { id: 'p3', label: 'P3', cell: { row: 1, col: 0 } },
    { id: 'p4', label: 'P4', cell: { row: 1, col: 5 } },
  ],
  shapes: [
    { kind: 'rect', x: 0, y: 0, width: 5, height: 1, fill: 'body', stroke: 'silk' },
    { kind: 'line', x1: 0, y1: 1, x2: 5, y2: 1, stroke: 'lead' },
    { kind: 'circle', cx: 0, cy: 1, r: 0.2, fill: 'accent' },
    { kind: 'text', x: 0.5, y: 0.5, text: 'U1', fill: 'silk' },
  ],
  bodyCells: [],
};

const ports: DevicePort[] = module6.pins.map((pin) => ({
  id: pin.id,
  label: pin.label,
  direction: 'input',
}));

const SPLIT = breadboardRowIndex('E');

function placementAt(anchorRow: number, rotation: BoardRotation): DevicePlacement {
  return { boardId: breadboard.boardId, anchor: { row: anchorRow, col: 1 }, rotation };
}

/**
 * The invariant the whole correction exists for: where a pin is *drawn* and
 * where its hole *is* are the same point in diagram space.
 */
function pinDrawnPoints(
  board: BoardNodeData,
  placement: DevicePlacement,
  boardPosition = { x: 137, y: -42 },
): { drawn: { x: number; y: number }; hole: { x: number; y: number } }[] {
  const channel = footprintChannel(board, module6, placement);
  const node = placementNodePosition({ board, position: boardPosition }, placement);
  const views = footprintPinViews(module6, placement.rotation, board.pitch, ports, channel);
  const holes = footprintPinHoles(module6, placement);

  return views.map((view) => {
    const hole = holes.find((candidate) => candidate.pinId === view.id);
    if (!hole) throw new Error(`${view.id}: no hole`);
    const holePoint = holeLocalPoint(board, hole.hole);
    return {
      drawn: { x: node.x + view.x, y: node.y + view.y },
      hole: { x: boardPosition.x + holePoint.x, y: boardPosition.y + holePoint.y },
    };
  });
}

function expectPinsOnTheirHoles(board: BoardNodeData, placement: DevicePlacement): void {
  for (const pin of pinDrawnPoints(board, placement)) {
    expect(pin.drawn.x).toBeCloseTo(pin.hole.x);
    expect(pin.drawn.y).toBeCloseTo(pin.hole.y);
  }
}

/** True when the placement actually has rows on both sides of the channel. */
function straddles(placement: DevicePlacement): boolean {
  const box = rotatedFootprintBox(module6, placement.rotation);
  return placement.anchor.row < SPLIT && placement.anchor.row + box.rows - 1 >= SPLIT;
}

describe('footprintChannel', () => {
  it('is absent for a board that declares no central gap', () => {
    expect(footprintChannel(perfboard, module6, placementAt(3, 0))).toBeNull();
  });

  it('opens half a cell after the last row above the split', () => {
    const channel = footprintChannel(breadboard, module6, placementAt(SPLIT - 1, 0));
    expect(channel).toEqual({ cutY: 0.5, gapCells: 2 });
  });

  it('uses the whole centerGap, not the narrower groove the plastic paints', () => {
    const channel = footprintChannel(breadboard, module6, placementAt(SPLIT - 1, 0));
    expect(channel?.gapCells).toBe((breadboard.centerGap ?? 0) / PITCH);
  });

  it('pins the anchor cell to itself when the footprint crosses the channel', () => {
    expect(
      applyFootprintChannel(0, footprintChannel(breadboard, module6, placementAt(SPLIT - 1, 0))),
    ).toBe(0);
  });

  it('moves nothing when the footprint stays on one side', () => {
    const above = footprintChannel(breadboard, module6, placementAt(SPLIT - 4, 0));
    expect(applyFootprintChannel(1, above)).toBe(1);
    const below = footprintChannel(breadboard, module6, placementAt(SPLIT + 1, 0));
    expect(applyFootprintChannel(1, below)).toBe(1);
  });

  it('keeps a resistor rigid on the first row wholly below the channel in every rotation', () => {
    const label = RESISTOR_1K_FOOTPRINT.shapes.find((shape) => shape.kind === 'text');
    if (label?.kind !== 'text') throw new Error('resistor label not found');

    for (const rotation of BOARD_ROTATIONS) {
      const placement = placementAt(SPLIT, rotation);
      const channel = footprintChannel(breadboard, RESISTOR_1K_FOOTPRINT, placement);

      expect(channel, `${rotation} degrees`).toBeNull();
      expect(
        footprintDrawPoint(label.x, label.y, RESISTOR_1K_FOOTPRINT, rotation, channel),
      ).toEqual(rotateFootprintPoint(label.x, label.y, RESISTOR_1K_FOOTPRINT, rotation));
    }
  });

  it('pushes the far side of the channel down by the whole gap', () => {
    const channel = footprintChannel(breadboard, module6, placementAt(SPLIT - 1, 0));
    expect(applyFootprintChannel(0, channel)).toBe(0);
    expect(applyFootprintChannel(1, channel)).toBe(3);
  });
});

describe('a seated footprint is drawn on its own holes', () => {
  for (const rotation of BOARD_ROTATIONS) {
    it(`keeps every pin on its hole at ${rotation} degrees, straddling the channel`, () => {
      const anchor = rotation === 90 || rotation === 270 ? SPLIT - 3 : SPLIT - 1;
      const placement = placementAt(anchor, rotation);
      expect(straddles(placement)).toBe(true);
      expectPinsOnTheirHoles(breadboard, placement);
    });

    it(`keeps every pin on its hole at ${rotation} degrees, clear of the channel`, () => {
      const placement = placementAt(0, rotation);
      expect(straddles(placement)).toBe(false);
      expectPinsOnTheirHoles(breadboard, placement);
    });

    it(`keeps every pin on its hole at ${rotation} degrees, wholly below the channel`, () => {
      const box = rotatedFootprintBox(module6, rotation);
      const placement = placementAt(BREADBOARD_ROWS - box.rows, rotation);
      expect(straddles(placement)).toBe(false);
      expectPinsOnTheirHoles(breadboard, placement);
    });

    it(`keeps every pin on its hole at ${rotation} degrees on a board with no gap`, () => {
      expectPinsOnTheirHoles(perfboard, {
        ...placementAt(SPLIT - 1, rotation),
        boardId: perfboard.boardId,
      });
    });
  }

  it('holds for a fractional gap that is not a whole number of pitches', () => {
    const odd: BoardNodeData = { ...breadboard, centerGap: PITCH * 1.35 };
    const placement = placementAt(SPLIT - 1, 0);
    expect(footprintChannel(odd, module6, placement)?.gapCells).toBeCloseTo(1.35);
    expectPinsOnTheirHoles(odd, placement);
  });

  it('draws exactly as before on a board with no channel', () => {
    const placement = { ...placementAt(1, 90), boardId: perfboard.boardId };
    const withChannel = footprintPinViews(
      module6,
      placement.rotation,
      PITCH,
      ports,
      footprintChannel(perfboard, module6, placement),
    );
    expect(withChannel).toEqual(footprintPinViews(module6, placement.rotation, PITCH, ports));
  });
});

describe('the drawn body follows its pins across the channel', () => {
  const placement = placementAt(SPLIT - 1, 0);
  const channel = footprintChannel(breadboard, module6, placement);

  it('stretches the node box by the gap, and only when the part straddles it', () => {
    const straddling = footprintNodeSize(module6, 0, PITCH, channel);
    const clear = footprintNodeSize(
      module6,
      0,
      PITCH,
      footprintChannel(breadboard, module6, placementAt(0, 0)),
    );
    const ungapped = footprintNodeSize(module6, 0, PITCH);

    expect(clear).toEqual(ungapped);
    expect(straddling.width).toBe(ungapped.width);
    expect(straddling.height).toBe(ungapped.height + (breadboard.centerGap ?? 0));
  });

  it('carries a body rect across the trench by stretching it, not moving it', () => {
    // The rect spans rows 0..1, which the channel now separates by three cells.
    const top = footprintDrawPoint(0, 0, module6, 0, channel);
    const bottom = footprintDrawPoint(5, 1, module6, 0, channel);
    expect(top.y).toBe(0);
    expect(bottom.y).toBe(3);
  });

  it('leaves the half above the channel exactly where it was', () => {
    expect(footprintDrawPoint(2.5, 0.25, module6, 0, channel)).toEqual({ x: 2.5, y: 0.25 });
  });

  it('never scales the horizontal axis', () => {
    for (const rotation of BOARD_ROTATIONS) {
      const anchor = rotation === 90 || rotation === 270 ? SPLIT - 3 : SPLIT - 1;
      const rotated = footprintChannel(breadboard, module6, placementAt(anchor, rotation));
      expect(footprintDrawPoint(3, 1, module6, rotation, rotated).x).toBe(
        footprintDrawPoint(3, 1, module6, rotation, null).x,
      );
    }
  });
});

describe('padding around a channel-straddling footprint', () => {
  it('keeps cell (0,0) one padding in from the node corner, whatever the gap', () => {
    const placement = placementAt(SPLIT - 1, 0);
    const channel = footprintChannel(breadboard, module6, placement);
    const views = footprintPinViews(module6, 0, PITCH, ports, channel);
    const first = views.find((view) => view.id === 'p1');
    expect(first?.x).toBe(FOOTPRINT_PADDING_CELLS * PITCH);
    expect(first?.y).toBe(FOOTPRINT_PADDING_CELLS * PITCH);
  });
});

/**
 * The illustration used to be rotated by a `matrix(...)` on the whole group,
 * which cannot express the channel. Replacing it with a per-point mapping is
 * only safe while that mapping is the *same* rotation - both against the cell
 * rotation the pins and holes already use, and against the matrices the
 * template used to emit.
 */
describe('the per-point rotation replaces the group matrix exactly', () => {
  const box = { rows: module6.rows, cols: module6.cols };

  it('agrees with the cell rotation the holes are addressed by', () => {
    for (const rotation of BOARD_ROTATIONS) {
      for (const pin of module6.pins) {
        const cell = rotateCell(pin.cell, rotation, box);
        const point = rotateFootprintPoint(pin.cell.col, pin.cell.row, box, rotation);
        expect({ row: point.y, col: point.x }).toEqual(cell);
      }
    }
  });

  it('reproduces the matrices the template used to apply', () => {
    const matrices: Record<number, (x: number, y: number) => { x: number; y: number }> = {
      // matrix(0 1 -1 0 rows-1 0)
      90: (x, y) => ({ x: -y + (box.rows - 1), y: x }),
      // matrix(-1 0 0 -1 cols-1 rows-1)
      180: (x, y) => ({ x: -x + (box.cols - 1), y: -y + (box.rows - 1) }),
      // matrix(0 -1 1 0 0 cols-1)
      270: (x, y) => ({ x: y, y: -x + (box.cols - 1) }),
    };
    for (const [rotation, matrix] of Object.entries(matrices)) {
      for (const [x, y] of [
        [0, 0],
        [5, 1],
        [2.5, 0.25],
        [-0.3, 1.4],
      ]) {
        expect(rotateFootprintPoint(x, y, box, Number(rotation) as BoardRotation)).toEqual(
          matrix(x, y),
        );
      }
    }
  });
});

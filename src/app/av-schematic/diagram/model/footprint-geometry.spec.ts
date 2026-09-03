import { describe, expect, it } from 'vitest';
import {
  anchorAfterRotation,
  anchorForNodePosition,
  cellToHole,
  deviceHoleClaims,
  findFreeAnchor,
  footprintNodeSize,
  footprintOccupiedHoles,
  footprintPinHoles,
  isPlacementInBounds,
  placementNodePosition,
  rotateCell,
  rotatedFootprintBox,
  stepRotation,
  syncPortHolesToPlacement,
  validatePlacement,
} from './footprint-geometry';
import { type Footprint } from './footprint';
import { type BoardNodeData, type DeviceNodeData, type DevicePlacement } from './interfaces';

const board: BoardNodeData = {
  type: 'board',
  boardId: 'board-test',
  label: 'Board test',
  rows: 5,
  cols: 7,
  pitch: 20,
};

const footprint: Footprint = {
  id: 'test-module',
  label: 'Test module',
  rows: 2,
  cols: 3,
  pins: [
    { id: 'a', label: 'A', cell: { row: 0, col: 0 } },
    { id: 'b', label: 'B', cell: { row: 1, col: 2 } },
  ],
  shapes: [],
};

describe('footprint rotation', () => {
  it('rotates cells clockwise inside the footprint box', () => {
    expect(rotateCell({ row: 0, col: 0 }, 0, footprint)).toEqual({ row: 0, col: 0 });
    expect(rotateCell({ row: 0, col: 0 }, 90, footprint)).toEqual({ row: 0, col: 1 });
    expect(rotateCell({ row: 0, col: 0 }, 180, footprint)).toEqual({ row: 1, col: 2 });
    expect(rotateCell({ row: 0, col: 0 }, 270, footprint)).toEqual({ row: 2, col: 0 });
  });

  it('swaps the bounding axes at 90 and 270 degrees', () => {
    expect(rotatedFootprintBox(footprint, 0)).toEqual({ rows: 2, cols: 3 });
    expect(rotatedFootprintBox(footprint, 90)).toEqual({ rows: 3, cols: 2 });
    expect(rotatedFootprintBox(footprint, 270)).toEqual({ rows: 3, cols: 2 });
  });

  it('steps through all four allowed rotations in both directions', () => {
    expect(stepRotation(0, 1)).toBe(90);
    expect(stepRotation(270, 1)).toBe(0);
    expect(stepRotation(0, -1)).toBe(270);
  });

  it('maps pins to rotated board holes', () => {
    const placement: DevicePlacement = {
      boardId: board.boardId,
      anchor: { row: 1, col: 2 },
      rotation: 90,
    };
    expect(footprintPinHoles(footprint, placement)).toEqual([
      { pinId: 'a', label: 'A', cell: { row: 0, col: 1 }, hole: { row: 1, col: 3 } },
      { pinId: 'b', label: 'B', cell: { row: 2, col: 0 }, hole: { row: 3, col: 2 } },
    ]);
    expect(cellToHole({ row: 1, col: 2 }, footprint, placement)).toEqual({ row: 3, col: 2 });
  });

  it('returns to the exact anchor after four rotations without pixel rounding drift', () => {
    const initial: DevicePlacement = {
      boardId: board.boardId,
      anchor: { row: 2, col: 3 },
      rotation: 0,
    };
    const pivot = footprint.pins[0].cell;
    const pivotHole = cellToHole(pivot, footprint, initial);
    let placement = initial;

    for (let turn = 0; turn < 4; turn++) {
      const rotation = stepRotation(placement.rotation, 1);
      placement = {
        ...placement,
        anchor: anchorAfterRotation(footprint, placement, rotation),
        rotation,
      };
      expect(cellToHole(pivot, footprint, placement)).toEqual(pivotHole);
    }

    expect(placement).toEqual(initial);
  });
});

describe('pitch and snap', () => {
  const frame = { board, position: { x: 100, y: 200 } };
  const placement: DevicePlacement = {
    boardId: board.boardId,
    anchor: { row: 2, col: 3 },
    rotation: 0,
  };

  it('derives node pixels from the board pitch and anchor', () => {
    expect(placementNodePosition(frame, placement)).toEqual({ x: 161, y: 241 });
    expect(footprintNodeSize(footprint, 0, board.pitch)).toEqual({ width: 70, height: 50 });
  });

  it('snaps a nearby dropped node back to the same hole', () => {
    const exact = placementNodePosition(frame, placement);
    expect(anchorForNodePosition(frame, { x: exact.x + 7, y: exact.y - 8 })).toEqual(
      placement.anchor,
    );
  });

  it('derives exact geometry for a pitch other than 20', () => {
    const pitch17Board = { ...board, pitch: 17 };
    const pitch17Frame = { board: pitch17Board, position: { x: 100, y: 200 } };

    expect(placementNodePosition(pitch17Frame, placement)).toEqual({ x: 154.25, y: 237.25 });
    expect(footprintNodeSize(footprint, 0, pitch17Board.pitch)).toEqual({
      width: 59.5,
      height: 42.5,
    });
    expect(anchorForNodePosition(pitch17Frame, { x: 158.25, y: 232.25 })).toEqual(placement.anchor);
  });

  it('cannot derive an anchor when the board explicitly has no holes', () => {
    expect(
      anchorForNodePosition(
        { board: { ...board, holes: [] }, position: { x: 100, y: 200 } },
        { x: 101, y: 201 },
      ),
    ).toBeNull();
  });
});

describe('bounds and occupancy', () => {
  it('reports whether the rotated box fits the arbitrary board grid', () => {
    expect(
      isPlacementInBounds(board, footprint, {
        anchor: { row: 3, col: 4 },
        rotation: 0,
      }),
    ).toBe(true);
    expect(
      isPlacementInBounds(board, footprint, {
        anchor: { row: 4, col: 5 },
        rotation: 0,
      }),
    ).toBe(false);
  });

  it('rejects a placement over a missing hole on a sparse board', () => {
    const sparseBoard: BoardNodeData = {
      ...board,
      holes: [
        { row: 0, col: 0 },
        { row: 0, col: 1 },
        { row: 0, col: 2 },
        { row: 1, col: 0 },
        { row: 1, col: 2 },
      ],
    };
    expect(
      isPlacementInBounds(sparseBoard, footprint, {
        anchor: { row: 0, col: 0 },
        rotation: 0,
      }),
    ).toBe(false);
  });

  it('occupies every body cell by default, not only exposed pins', () => {
    const placement: DevicePlacement = {
      boardId: board.boardId,
      anchor: { row: 1, col: 1 },
      rotation: 0,
    };
    expect(footprintOccupiedHoles(footprint, placement)).toEqual([
      { row: 1, col: 1 },
      { row: 1, col: 2 },
      { row: 1, col: 3 },
      { row: 2, col: 1 },
      { row: 2, col: 2 },
      { row: 2, col: 3 },
    ]);
  });

  it('always claims pin holes even when sparse bodyCells omit them', () => {
    const sparseBody: Footprint = {
      ...footprint,
      bodyCells: [{ row: 0, col: 1 }],
    };
    const placement: DevicePlacement = {
      boardId: board.boardId,
      anchor: { row: 1, col: 1 },
      rotation: 0,
    };

    expect(footprintOccupiedHoles(sparseBody, placement)).toEqual([
      { row: 1, col: 2 },
      { row: 1, col: 1 },
      { row: 2, col: 3 },
    ]);
  });

  it('rejects a silent overlap and names the blocking component', () => {
    const placement: DevicePlacement = {
      boardId: board.boardId,
      anchor: { row: 1, col: 1 },
      rotation: 0,
    };
    expect(
      validatePlacement('moving', board, footprint, placement, [
        { boardId: board.boardId, ownerId: 'already-there', hole: { row: 2, col: 2 } },
      ]),
    ).toMatchObject({
      kind: 'occupied',
      holes: [{ row: 2, col: 2 }],
      blockedBy: ['already-there'],
    });
  });

  it('finds the next free seat when the preferred one is occupied', () => {
    expect(
      findFreeAnchor('moving', board, footprint, 0, { row: 0, col: 0 }, [
        { boardId: board.boardId, ownerId: 'blocker', hole: { row: 0, col: 0 } },
      ]),
    ).toEqual({ row: 0, col: 1 });
  });
});

describe('persisted pin association', () => {
  it('synchronizes exposed pin holes from placement and rotation', () => {
    const data: DeviceNodeData = {
      type: 'device',
      deviceId: 'TEST-1',
      manufacturer: 'Test',
      model: 'Module',
      footprintId: footprint.id,
      placement: { boardId: board.boardId, anchor: { row: 1, col: 2 }, rotation: 90 },
      ports: [
        { id: 'a', label: 'A', direction: 'input' },
        { id: 'b', label: 'B', direction: 'output' },
      ],
    };

    // This fixture footprint is local to the test and therefore is not in the
    // catalog. Exercise the catalog-backed path with the registered wire link.
    const catalogData: DeviceNodeData = {
      ...data,
      footprintId: 'wire-link',
      placement: { boardId: board.boardId, anchor: { row: 2, col: 1 }, rotation: 90 },
    };
    const synced = syncPortHolesToPlacement(catalogData);
    expect(synced.boardId).toBe(board.boardId);
    expect(synced.ports.map((port) => port.hole)).toEqual([
      { row: 2, col: 1 },
      { row: 4, col: 1 },
    ]);
    expect(deviceHoleClaims('wire-1', synced)).toHaveLength(2);
  });
});

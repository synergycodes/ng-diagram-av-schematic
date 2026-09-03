import { describe, expect, it } from 'vitest';
import { diagramModel } from '../data';
import {
  allHoles,
  boardCenterGap,
  boardHoles,
  boardSize,
  findHoleCollisions,
  findOutOfBoundsHoleClaims,
  holeLocalPoint,
  isBoardHoleAvailable,
  isHoleInBounds,
  nearestAvailableHole,
  nearestHole,
  lowerBoardHalfStartRow,
  type BoardHoleClaim,
} from './board-geometry';
import { isBoardNode, isDeviceNode } from './guards';
import { type BoardHole, type BoardNodeData, type DevicePort } from './interfaces';

const boardA = { boardId: 'board-a', label: 'Board A', rows: 6, cols: 11, pitch: 20 } as const;

describe('boardSize', () => {
  it('spans (n - 1) * pitch between the first and last hole, plus margins', () => {
    expect(boardSize(boardA)).toEqual({
      width: (11 - 1) * 20 + 32,
      height: (6 - 1) * 20 + 32,
    });
  });

  it('collapses to just the margins for a single-hole board', () => {
    expect(boardSize({ rows: 1, cols: 1, pitch: 20 })).toEqual({ width: 32, height: 32 });
  });

  it('adds an optional central channel without changing legacy board dimensions', () => {
    expect(boardSize({ rows: 6, cols: 18, pitch: 14, centerGap: 12 })).toEqual({
      width: (18 - 1) * 14 + 32,
      height: (6 - 1) * 14 + 32 + 12,
    });
    expect(boardSize({ rows: 6, cols: 18, pitch: 14 })).toEqual({
      width: (18 - 1) * 14 + 32,
      height: (6 - 1) * 14 + 32,
    });
  });
});

describe('central channel helpers', () => {
  it('splits even and odd row counts deterministically', () => {
    expect(lowerBoardHalfStartRow({ rows: 6 })).toBe(3);
    expect(lowerBoardHalfStartRow({ rows: 3 })).toBe(2);
  });

  it('positions a configured channel midway between the two row halves', () => {
    expect(boardCenterGap({ rows: 6, pitch: 20, centerGap: 12 })).toEqual({
      y: 66,
      height: 12,
    });
  });

  it('omits the channel when it has no positive height or the board has one row', () => {
    expect(boardCenterGap({ rows: 6, pitch: 20 })).toBeNull();
    expect(boardCenterGap({ rows: 6, pitch: 20, centerGap: 0 })).toBeNull();
    expect(boardCenterGap({ rows: 1, pitch: 20, centerGap: 12 })).toBeNull();
  });
});

describe('holeLocalPoint', () => {
  it('places hole (0, 0) at the margin offset', () => {
    expect(holeLocalPoint(boardA, { row: 0, col: 0 })).toEqual({ x: 16, y: 16 });
  });

  it('scales by pitch for later holes', () => {
    expect(holeLocalPoint(boardA, { row: 2, col: 3 })).toEqual({ x: 16 + 60, y: 16 + 40 });
  });

  it('places the lower half after the optional central channel', () => {
    const protoboard = { rows: 6, cols: 18, pitch: 14, centerGap: 12 };
    expect(holeLocalPoint(protoboard, { row: 2, col: 0 }).y).toBe(44);
    expect(holeLocalPoint(protoboard, { row: 3, col: 0 }).y).toBe(70);
  });
});

describe('nearestHole', () => {
  it('snaps across a central channel to the physically nearest row', () => {
    const protoboard = { rows: 6, pitch: 20, centerGap: 12 };
    expect(nearestHole(protoboard, { x: 16, y: 67 })).toEqual({ row: 2, col: 0 });
    expect(nearestHole(protoboard, { x: 16, y: 73 })).toEqual({ row: 3, col: 0 });
    expect(nearestHole(protoboard, { x: 16, y: 72 })).toEqual({ row: 3, col: 0 });
  });

  it('preserves the legacy half-up tie for boards without a channel', () => {
    expect(nearestHole(boardA, { x: 16, y: 66 })).toEqual({ row: 3, col: 0 });
  });

  it('keeps out-of-bounds rows unclamped with a central channel', () => {
    const protoboard = { rows: 6, pitch: 20, centerGap: 12 };
    expect(nearestHole(protoboard, { x: 16, y: -15 })).toEqual({ row: -2, col: 0 });
    expect(nearestHole(protoboard, { x: 16, y: 159 })).toEqual({ row: 7, col: 0 });
  });
});

describe('allHoles', () => {
  it('enumerates rows * cols holes, row-major', () => {
    const holes = allHoles({ rows: 2, cols: 3 });
    expect(holes).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: 2 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
      { row: 1, col: 2 },
    ]);
  });

  it('matches rows * cols for board A (6 x 11)', () => {
    expect(allHoles(boardA)).toHaveLength(66);
  });
});

describe('explicit board holes', () => {
  const sparseBoard = {
    rows: 3,
    cols: 3,
    pitch: 20,
    holes: [
      { row: 0, col: 0 },
      { row: 0, col: 2 },
      { row: 2, col: 2 },
    ],
  };

  it('uses the configured hole list instead of assuming a full rectangle', () => {
    expect(boardHoles(sparseBoard)).toEqual(sparseBoard.holes);
    expect(isBoardHoleAvailable(sparseBoard, { row: 0, col: 2 })).toBe(true);
    expect(isBoardHoleAvailable(sparseBoard, { row: 1, col: 1 })).toBe(false);
  });

  it('snaps to the nearest hole that actually exists', () => {
    expect(nearestAvailableHole(sparseBoard, { x: 36, y: 36 })).toEqual({ row: 0, col: 0 });
    expect(nearestAvailableHole(sparseBoard, { x: 54, y: 20 })).toEqual({ row: 0, col: 2 });
  });

  it('treats an explicit empty list as a board with no holes', () => {
    const emptyBoard = { rows: 3, cols: 3, pitch: 17, holes: [] };
    expect(boardHoles(emptyBoard)).toEqual([]);
    expect(isBoardHoleAvailable(emptyBoard, { row: 0, col: 0 })).toBe(false);
    expect(nearestAvailableHole(emptyBoard, { x: 16, y: 16 })).toBeNull();
  });
});

describe('isHoleInBounds', () => {
  it('accepts holes within the grid', () => {
    expect(isHoleInBounds(boardA, { row: 0, col: 0 })).toBe(true);
    expect(isHoleInBounds(boardA, { row: 5, col: 10 })).toBe(true);
  });

  it('rejects holes outside the grid', () => {
    expect(isHoleInBounds(boardA, { row: -1, col: 0 })).toBe(false);
    expect(isHoleInBounds(boardA, { row: 6, col: 0 })).toBe(false);
    expect(isHoleInBounds(boardA, { row: 0, col: 11 })).toBe(false);
  });
});

describe('findOutOfBoundsHoleClaims', () => {
  const boardsById = new Map<string, Pick<BoardNodeData, 'rows' | 'cols'>>([['board-a', boardA]]);

  it('returns an empty list when every claim fits its board', () => {
    const claims: BoardHoleClaim[] = [
      { boardId: 'board-a', ownerId: 'nano:d9', hole: { row: 1, col: 1 } },
      { boardId: 'board-a', ownerId: 'nano:d8', hole: { row: 5, col: 10 } },
    ];
    expect(findOutOfBoundsHoleClaims(claims, boardsById)).toEqual([]);
  });

  it('flags a claim whose hole is outside its board grid', () => {
    const outOfBounds: BoardHoleClaim = {
      boardId: 'board-a',
      ownerId: 'nano:d9',
      hole: { row: 6, col: 0 },
    };
    const claims: BoardHoleClaim[] = [
      { boardId: 'board-a', ownerId: 'nano:d8', hole: { row: 0, col: 0 } },
      outOfBounds,
    ];
    expect(findOutOfBoundsHoleClaims(claims, boardsById)).toEqual([outOfBounds]);
  });

  it('flags a claim referencing a board that does not exist', () => {
    const claim: BoardHoleClaim = {
      boardId: 'no-such-board',
      ownerId: 'nano:d9',
      hole: { row: 0, col: 0 },
    };
    expect(findOutOfBoundsHoleClaims([claim], boardsById)).toEqual([claim]);
  });

  it('flags an in-bounds address omitted by an explicit sparse hole list', () => {
    const sparse = new Map([['sparse', { rows: 2, cols: 2, holes: [{ row: 0, col: 0 }] }]]);
    const claim: BoardHoleClaim = {
      boardId: 'sparse',
      ownerId: 'part:a',
      hole: { row: 1, col: 1 },
    };
    expect(findOutOfBoundsHoleClaims([claim], sparse)).toEqual([claim]);
  });
});

describe('findHoleCollisions', () => {
  it('returns no groups when every claim addresses a distinct hole', () => {
    const claims: BoardHoleClaim[] = [
      { boardId: 'board-a', ownerId: 'nano:d9', hole: { row: 1, col: 1 } },
      { boardId: 'board-a', ownerId: 'tb6612:pwma', hole: { row: 4, col: 1 } },
    ];
    expect(findHoleCollisions(claims)).toEqual([]);
  });

  it('groups two claims that address the same hole on the same board', () => {
    const hole: BoardHole = { row: 1, col: 1 };
    const claimA: BoardHoleClaim = { boardId: 'board-a', ownerId: 'nano:d9', hole };
    const claimB: BoardHoleClaim = { boardId: 'board-a', ownerId: 'tb6612:pwma', hole };
    expect(findHoleCollisions([claimA, claimB])).toEqual([[claimA, claimB]]);
  });

  it('does not collide the same row/col address on two different boards', () => {
    const claims: BoardHoleClaim[] = [
      { boardId: 'board-a', ownerId: 'nano:d9', hole: { row: 1, col: 1 } },
      { boardId: 'board-b', ownerId: 'other:pin', hole: { row: 1, col: 1 } },
    ];
    expect(findHoleCollisions(claims)).toEqual([]);
  });
});

describe('seed board-hole placement (issue #1 tracer bullet)', () => {
  const boards = diagramModel.nodes.filter(isBoardNode);
  const devices = diagramModel.nodes.filter(isDeviceNode);
  const boardsById = new Map(boards.map((board) => [board.data.boardId, board.data]));

  const claims: BoardHoleClaim[] = devices.flatMap((device) =>
    device.data.ports
      .filter((port): port is DevicePort & { hole: BoardHole } => port.hole !== undefined)
      .map(
        (port): BoardHoleClaim => ({
          boardId: device.data.boardId ?? '',
          ownerId: `${device.id}:${port.id}`,
          hole: port.hole,
        }),
      ),
  );

  it('exercises hole addressing on at least one pin per seeded device', () => {
    expect(claims.length).toBeGreaterThan(0);
  });

  it('every seeded hole fits inside its declared board', () => {
    expect(findOutOfBoundsHoleClaims(claims, boardsById)).toEqual([]);
  });

  it('no two seeded pins claim the same hole on the same board', () => {
    expect(findHoleCollisions(claims)).toEqual([]);
  });
});

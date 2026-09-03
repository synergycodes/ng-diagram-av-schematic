import { type Edge, type Node } from 'ng-diagram';
import { describe, expect, it } from 'vitest';
import {
  boardJumperForConnection,
  boardJumperLengthLabel,
  boardJumperPitchLength,
  boardLocalPoints,
  boardWorldPoints,
  defaultBoardJumperLocalRoute,
  formatPitchLength,
  isBoardJumperEdge,
} from './board-jumper';
import { EdgeTemplateType, NodeTemplateType, type BoardNodeData } from './interfaces';

const breadboard = (position = { x: 100, y: 200 }): Node<BoardNodeData> => ({
  id: 'board-node-instance',
  type: NodeTemplateType.BoardNode,
  position,
  data: {
    type: 'board',
    boardId: 'breadboard',
    label: 'Protoboard',
    surface: 'breadboard',
    rows: 10,
    cols: 12,
    pitch: 10,
    centerGap: 20,
  },
});

describe('board jumpers', () => {
  it('recognizes only two holes on the same breadboard as a jumper connection', () => {
    const board = breadboard();
    const connection = boardJumperForConnection([board], {
      source: board.id,
      sourcePort: 'hole:1:2',
      target: board.id,
      targetPort: 'hole:7:6',
    });

    expect(connection).toMatchObject({
      board,
      sourceHole: { row: 1, col: 2 },
      targetHole: { row: 7, col: 6 },
    });
    expect(
      boardJumperForConnection([{ ...board, data: { ...board.data, surface: 'perfboard' } }], {
        source: board.id,
        sourcePort: 'hole:1:2',
        target: board.id,
        targetPort: 'hole:7:6',
      }),
    ).toBeNull();
    expect(
      boardJumperForConnection([board], {
        source: board.id,
        sourcePort: 'hole:1:2',
        target: 'external',
        targetPort: 'in',
      }),
    ).toBeNull();
    expect(
      boardJumperForConnection([board], {
        source: board.id,
        sourcePort: 'hole:1:2',
        target: board.id,
        targetPort: 'hole:1:2',
      }),
    ).toBeNull();
  });

  it('rejects two different holes that share one internal copper group', () => {
    const board = breadboard();
    board.data.traces = [
      {
        id: 'terminal-strip',
        label: 'Terminal strip',
        internal: true,
        segments: [{ from: { row: 1, col: 2 }, to: { row: 1, col: 6 } }],
      },
    ];

    expect(
      boardJumperForConnection([board], {
        source: board.id,
        sourcePort: 'hole:1:2',
        target: board.id,
        targetPort: 'hole:1:6',
      }),
    ).toBeNull();
  });

  it('builds a straight two-point polyline in board-local coordinates', () => {
    const board = breadboard();
    expect(
      defaultBoardJumperLocalRoute(board.data, { row: 1, col: 2 }, { row: 7, col: 6 }),
    ).toEqual([
      { x: 36, y: 26 },
      { x: 76, y: 106 },
    ]);
    expect(
      defaultBoardJumperLocalRoute(board.data, { row: 1, col: 2 }, { row: 1, col: 6 }),
    ).toEqual([
      { x: 36, y: 26 },
      { x: 76, y: 26 },
    ]);
  });

  it('translates every route point between board-local and world coordinates', () => {
    const board = breadboard();
    const local = [
      { x: 36, y: 26 },
      { x: 56, y: 26 },
      { x: 56, y: 106 },
      { x: 76, y: 106 },
    ];

    const world = boardWorldPoints(board, local);
    expect(world).toEqual([
      { x: 136, y: 226 },
      { x: 156, y: 226 },
      { x: 156, y: 306 },
      { x: 176, y: 306 },
    ]);
    expect(boardLocalPoints(board, world)).toEqual(local);
  });

  it('calculates and formats polyline length in pitch units', () => {
    const board = breadboard();
    const points = boardWorldPoints(board, [
      { x: 16, y: 16 },
      { x: 46, y: 16 },
      { x: 46, y: 31 },
    ]);

    expect(boardJumperPitchLength(board, points)).toBe(4.5);
    expect(formatPitchLength(4.5)).toBe('4,5 pitch');
    expect(formatPitchLength(3)).toBe('3 pitch');
  });

  it('identifies live jumper edges by their explicit owner', () => {
    const edge: Edge = {
      id: 'jumper-1',
      type: EdgeTemplateType.WireEdge,
      source: 'breadboard',
      sourcePort: 'hole:0:0',
      target: 'breadboard',
      targetPort: 'hole:1:1',
      data: { type: 'wire', wireId: 'W1', jumperBoardId: 'breadboard' },
    };

    expect(isBoardJumperEdge(edge)).toBe(true);
    expect(isBoardJumperEdge({ ...edge, data: { type: 'wire', wireId: 'W1' } })).toBe(false);
  });

  it('derives the user-facing length from a live owned route', () => {
    const board = breadboard();
    const edge: Edge = {
      id: 'jumper-1',
      source: board.id,
      target: board.id,
      points: boardWorldPoints(board, [
        { x: 16, y: 16 },
        { x: 46, y: 16 },
        { x: 46, y: 31 },
      ]),
      data: { type: 'wire', wireId: 'W1', jumperBoardId: board.data.boardId },
    };

    expect(boardJumperLengthLabel([board], edge)).toBe('4,5 pitch');
  });
});

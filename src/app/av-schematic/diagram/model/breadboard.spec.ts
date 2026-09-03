import { type Edge, type Node } from 'ng-diagram';
import { describe, expect, it } from 'vitest';
import {
  boardHoles,
  boardSize,
  holeLocalPoint,
  isBoardHoleAvailable,
  nearestAvailableHole,
} from './board-geometry';
import { boardHoleLabel, holePortId, parseHolePortId } from './board-ports';
import { findTraceDefects, findTraceOverlaps, holesOnSameTrace, traceHoles } from './board-trace';
import {
  BREADBOARD_BUS_ROWS,
  BREADBOARD_COLS,
  BREADBOARD_GROUP_SIZE,
  BREADBOARD_ROWS,
  BREADBOARD_TERMINAL_ROWS,
  breadboardBusColumns,
  breadboardBusHoles,
  breadboardBusTraceId,
  breadboardCenterGap,
  breadboardColumnTraceId,
  breadboardHoleAddress,
  breadboardHoles,
  breadboardRowIndex,
  breadboardTerminalHoles,
  createBreadboard830,
  isBreadboardBusColumn,
} from './breadboard';
import {
  fromCanonicalProject,
  junctionTapPortId,
  toCanonicalProject,
  type CanonicalBoard,
  type CanonicalProjectV2,
} from './canonical-project';
import { parseCanonicalProject } from './canonical-project-parse';
import {
  NodeTemplateType,
  EdgeTemplateType,
  type BoardNodeData,
  type JunctionNodeData,
  type WireEdgeData,
} from './interfaces';
import { OPERATIONAL_LIMITS } from './operational-limits.mjs';
import { resolveWireColor } from './wire-colors';

const PITCH = 20;

const board = createBreadboard830({
  boardId: 'bb',
  label: 'Breadboard 830',
  pitch: PITCH,
});

describe('breadboard hole counts', () => {
  it('has 630 terminal holes, 200 bus holes and 830 points in total', () => {
    expect(breadboardTerminalHoles()).toHaveLength(630);
    expect(breadboardBusHoles()).toHaveLength(200);
    expect(breadboardHoles()).toHaveLength(830);
    expect(board.holes).toHaveLength(830);
    expect(boardHoles(board)).toHaveLength(830);
  });

  it('lists every hole exactly once', () => {
    const keys = new Set(breadboardHoles().map((hole) => `${hole.row}:${hole.col}`));
    expect(keys.size).toBe(830);
  });

  it('stays inside the operational limits a saved project is bounded by', () => {
    expect(board.rows).toBeLessThanOrEqual(OPERATIONAL_LIMITS.maxBoardRows);
    expect(board.cols).toBeLessThanOrEqual(OPERATIONAL_LIMITS.maxBoardCols);
    expect(board.holes?.length ?? 0).toBeLessThanOrEqual(OPERATIONAL_LIMITS.maxBoardHoles);
    expect(board.traces?.length ?? 0).toBeLessThanOrEqual(OPERATIONAL_LIMITS.maxBoardTraces);
    const segments = (board.traces ?? []).reduce(
      (total, trace) => total + trace.segments.length,
      0,
    );
    expect(segments).toBeLessThanOrEqual(OPERATIONAL_LIMITS.maxTraceSegmentsPerBoard);
    for (const trace of board.traces ?? []) {
      expect(traceHoles(trace).length).toBeLessThanOrEqual(OPERATIONAL_LIMITS.maxJunctionTaps);
    }
  });
});

describe('breadboard geometry', () => {
  it('matches the reference row order, with A-J and the four buses', () => {
    expect(BREADBOARD_COLS).toBe(63);
    expect(BREADBOARD_ROWS).toBe(18);
    expect([...BREADBOARD_TERMINAL_ROWS]).toEqual([
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
    ]);
    expect([...BREADBOARD_BUS_ROWS]).toEqual(['top-', 'top+', 'bottom-', 'bottom+']);
    expect(board.rowLabels).toHaveLength(BREADBOARD_ROWS);
    expect(board.rowLabels?.[breadboardRowIndex('J')]).toBe('J');
  });

  it('separates the buses from the terminal strips by three pitch units', () => {
    const topPlus = holeLocalPoint(board, { row: breadboardRowIndex('top+'), col: 0 }).y;
    const rowJ = holeLocalPoint(board, { row: breadboardRowIndex('J'), col: 0 }).y;
    const rowA = holeLocalPoint(board, { row: breadboardRowIndex('A'), col: 0 }).y;
    const bottomMinus = holeLocalPoint(board, { row: breadboardRowIndex('bottom-'), col: 0 }).y;
    expect(rowJ - topPlus).toBe(3 * PITCH);
    expect(bottomMinus - rowA).toBe(3 * PITCH);
  });

  it('opens a three-pitch central channel between rows F and E', () => {
    const rowF = holeLocalPoint(board, { row: breadboardRowIndex('F'), col: 0 }).y;
    const rowE = holeLocalPoint(board, { row: breadboardRowIndex('E'), col: 0 }).y;
    expect(board.centerGap).toBe(breadboardCenterGap(PITCH));
    expect(rowE - rowF).toBe(3 * PITCH);
  });

  it('spaces adjacent terminal rows and columns by exactly one pitch', () => {
    const rowI = holeLocalPoint(board, { row: breadboardRowIndex('I'), col: 0 }).y;
    const rowH = holeLocalPoint(board, { row: breadboardRowIndex('H'), col: 0 }).y;
    expect(rowH - rowI).toBe(PITCH);
    const c1 = holeLocalPoint(board, { row: breadboardRowIndex('H'), col: 0 }).x;
    const c2 = holeLocalPoint(board, { row: breadboardRowIndex('H'), col: 1 }).x;
    expect(c2 - c1).toBe(PITCH);
  });

  it('derives its whole size from the pitch alone', () => {
    const wide = createBreadboard830({ boardId: 'bb2', label: 'Wide', pitch: 32 });
    const size = boardSize(wide);
    expect(size.width).toBe(boardSize(board).width + (BREADBOARD_COLS - 1) * (32 - PITCH));
    expect(wide.centerGap).toBe(breadboardCenterGap(32));
  });

  it('puts bus holes in ten groups of five, leaving the gap columns empty', () => {
    const cols = breadboardBusColumns();
    expect(cols).toHaveLength(50);
    expect(cols.slice(0, 6)).toEqual([2, 3, 4, 5, 6, 8]);
    expect(cols[cols.length - 1]).toBe(60);
    expect(isBreadboardBusColumn(7)).toBe(false);
    expect(isBreadboardBusColumn(61)).toBe(false);
    expect(isBreadboardBusColumn(62)).toBe(false);
    const busRow = breadboardRowIndex('top+');
    expect(isBoardHoleAvailable(board, { row: busRow, col: 7 })).toBe(false);
    expect(isBoardHoleAvailable(board, { row: busRow, col: 6 })).toBe(true);
  });

  it('has no holes on the spacer rows, but the full 63 on every terminal row', () => {
    const spacerRows = (board.rowLabels ?? [])
      .map((label, row) => ({ label, row }))
      .filter((entry) => entry.label === '')
      .map((entry) => entry.row);
    expect(spacerRows).toEqual([2, 3, 14, 15]);
    for (const row of spacerRows) {
      expect(board.holes?.some((hole) => hole.row === row)).toBe(false);
    }
    for (const row of BREADBOARD_TERMINAL_ROWS) {
      const index = breadboardRowIndex(row);
      expect(board.holes?.filter((hole) => hole.row === index)).toHaveLength(BREADBOARD_COLS);
    }
  });
});

describe('breadboard addressing', () => {
  it('gives every hole a stable printed address', () => {
    expect(breadboardHoleAddress({ row: breadboardRowIndex('J'), col: 9 })).toBe('J10');
    expect(breadboardHoleAddress({ row: breadboardRowIndex('A'), col: 0 })).toBe('A1');
    expect(breadboardHoleAddress({ row: breadboardRowIndex('top+'), col: 11 })).toBe('top+:12');
    expect(breadboardHoleAddress({ row: 2, col: 0 })).toBeNull();
    expect(boardHoleLabel({ row: breadboardRowIndex('E'), col: 17 }, board.rowLabels)).toBe('E18');
  });

  it('keeps the port id addressed by {row, col} and round-trips it', () => {
    const hole = { row: breadboardRowIndex('G'), col: 42 };
    const portId = holePortId(hole);
    expect(portId).toBe('hole:7:42');
    expect(parseHolePortId(portId)).toEqual(hole);
  });

  it('never repeats an address across the 830 holes', () => {
    const addresses = (board.holes ?? []).map((hole) => breadboardHoleAddress(hole));
    expect(addresses.every((address) => address !== null)).toBe(true);
    expect(new Set(addresses).size).toBe(830);
  });

  it('falls back to L<row>-C<col> for a board that does not name its rows', () => {
    expect(boardHoleLabel({ row: 1, col: 4 })).toBe('L2-C5');
  });
});

describe('breadboard electrical groups', () => {
  it('gives every column two independent groups of five holes', () => {
    const columnTraces = (board.traces ?? []).filter((trace) => trace.id.startsWith('bb-col-'));
    expect(columnTraces).toHaveLength(BREADBOARD_COLS * 2);
    for (const trace of columnTraces) {
      expect(traceHoles(trace)).toHaveLength(BREADBOARD_GROUP_SIZE);
    }

    const col = 17;
    const upper = { row: breadboardRowIndex('J'), col };
    const upperOther = { row: breadboardRowIndex('F'), col };
    const lower = { row: breadboardRowIndex('E'), col };
    const lowerOther = { row: breadboardRowIndex('A'), col };
    expect(holesOnSameTrace(board, upper, upperOther)).toBe(true);
    expect(holesOnSameTrace(board, lower, lowerOther)).toBe(true);
    expect(holesOnSameTrace(board, upper, lower)).toBe(false);
    expect(holesOnSameTrace(board, upper, { row: breadboardRowIndex('J'), col: col + 1 })).toBe(
      false,
    );
    expect(breadboardColumnTraceId(col, 'jf')).toBe('bb-col-18-jf');
  });

  it('joins each bus into one fifty-hole group across its ten runs', () => {
    for (const bus of BREADBOARD_BUS_ROWS) {
      const trace = (board.traces ?? []).find(
        (candidate) => candidate.id === breadboardBusTraceId(bus),
      );
      expect(trace, bus).toBeDefined();
      expect(trace?.segments).toHaveLength(10);
      expect(trace ? traceHoles(trace) : []).toHaveLength(50);
    }
    const row = breadboardRowIndex('bottom-');
    expect(holesOnSameTrace(board, { row, col: 2 }, { row, col: 60 })).toBe(true);
    expect(
      holesOnSameTrace(board, { row, col: 2 }, { row: breadboardRowIndex('bottom+'), col: 2 }),
    ).toBe(false);
  });

  it('groups all 830 holes and shorts nothing', () => {
    expect(board.traces).toHaveLength(BREADBOARD_COLS * 2 + BREADBOARD_BUS_ROWS.length);
    expect(findTraceDefects(board)).toEqual([]);
    expect(findTraceOverlaps(board)).toEqual([]);
    const grouped = new Set(
      (board.traces ?? []).flatMap((trace) =>
        traceHoles(trace).map((hole) => `${hole.row}:${hole.col}`),
      ),
    );
    expect(grouped.size).toBe(830);
  });

  it('keeps every group inside the body, with no exposed landing pad', () => {
    expect((board.traces ?? []).every((trace) => trace.internal === true)).toBe(true);
  });
});

describe('breadboard snap', () => {
  it('snaps a local point onto the hole under it', () => {
    const hole = { row: breadboardRowIndex('C'), col: 30 };
    const point = holeLocalPoint(board, hole);
    expect(nearestAvailableHole(board, { x: point.x + 3, y: point.y - 4 })).toEqual(hole);
  });

  it('snaps a drop over a bus gap column onto the nearest real bus hole', () => {
    const row = breadboardRowIndex('top-');
    const gap = holeLocalPoint(board, { row, col: 7 });
    const snapped = nearestAvailableHole(board, gap);
    expect(snapped && isBoardHoleAvailable(board, snapped)).toBe(true);
    expect(snapped?.row).toBe(row);
    expect([6, 8]).toContain(snapped?.col);
  });

  it('snaps a drop inside the central channel onto a terminal row, not into the gap', () => {
    const rowF = holeLocalPoint(board, { row: breadboardRowIndex('F'), col: 5 });
    const inChannel = { x: rowF.x, y: rowF.y + PITCH };
    const snapped = nearestAvailableHole(board, inChannel);
    expect(snapped?.row).toBe(breadboardRowIndex('F'));
    expect(snapped?.col).toBe(5);
  });

  it('snaps a drop over a spacer row onto the nearest holed row', () => {
    const spacer = holeLocalPoint(board, { row: 3, col: 20 });
    const snapped = nearestAvailableHole(board, spacer);
    expect(snapped?.row).toBe(breadboardRowIndex('J'));
    expect(snapped?.col).toBe(20);
  });
});

describe('breadboard movement', () => {
  it('keeps hole positions relative to the node, so moving the board moves them all', () => {
    const hole = { row: breadboardRowIndex('B'), col: 44 };
    const local = holeLocalPoint(board, hole);
    const at = (origin: { x: number; y: number }) => ({
      x: origin.x + local.x,
      y: origin.y + local.y,
    });
    const first = at({ x: 0, y: 0 });
    const moved = at({ x: 137, y: -58 });
    expect(moved.x - first.x).toBe(137);
    expect(moved.y - first.y).toBe(-58);
    // Local geometry does not depend on where the node was dropped.
    expect(holeLocalPoint(board, hole)).toEqual(local);
  });
});

describe('breadboard round-trip', () => {
  const LANDING = { row: breadboardRowIndex('H'), col: 12 };
  const POSITION = { x: 244, y: -96 };

  function model(position: { x: number; y: number }): {
    nodes: Node[];
    edges: Edge[];
  } {
    const boardNode: Node<BoardNodeData> = {
      id: board.boardId,
      type: NodeTemplateType.BoardNode,
      position,
      data: board,
    };
    const junctionNode: Node<JunctionNodeData> = {
      id: 'probe',
      type: NodeTemplateType.JunctionNode,
      position: { x: position.x + 1400, y: position.y },
      data: { type: 'junction', junctionId: 'probe', label: 'Probe', kind: 'junction', taps: 1 },
    };
    const edge: Edge<WireEdgeData> = {
      id: 'w-probe',
      type: EdgeTemplateType.WireEdge,
      source: board.boardId,
      sourcePort: holePortId(LANDING),
      target: 'probe',
      targetPort: junctionTapPortId(0),
      data: {
        type: 'wire',
        wireId: 'W-PROBE',
        wireType: 'signal',
        netName: 'PROBE',
        ...resolveWireColor('YE'),
      },
    };
    return { nodes: [boardNode, junctionNode], edges: [edge] };
  }

  it('preserves geometry, position, connectivity and the landing hole', () => {
    const original = model(POSITION);
    const saved = parseCanonicalProject(
      JSON.parse(JSON.stringify(toCanonicalProject(original.nodes, original.edges))),
    );

    const savedBoard = saved.layout.boards.find((entry) => entry.id === board.boardId);
    expect(savedBoard).toBeDefined();
    expect(savedBoard?.position).toEqual(POSITION);
    expect(savedBoard?.rows).toBe(BREADBOARD_ROWS);
    expect(savedBoard?.cols).toBe(BREADBOARD_COLS);
    expect(savedBoard?.centerGap).toBe(breadboardCenterGap(PITCH));
    expect(savedBoard?.rowLabels).toEqual(board.rowLabels);
    // The visual variant is saved state: reopening never has to infer
    // "830 holes, therefore breadboard".
    expect(savedBoard?.surface).toBe('breadboard');
    expect(savedBoard?.holes).toHaveLength(830);
    expect(savedBoard?.traces).toHaveLength(BREADBOARD_COLS * 2 + BREADBOARD_BUS_ROWS.length);
    expect(savedBoard?.traces?.every((trace) => trace.internal === true)).toBe(true);

    const reopened = fromCanonicalProject(saved);
    const reopenedBoard = reopened.nodes.find((node) => node.id === board.boardId);
    expect(reopenedBoard?.position).toEqual(POSITION);
    expect((reopenedBoard?.data as BoardNodeData).holes).toHaveLength(830);
    expect((reopenedBoard?.data as BoardNodeData).rowLabels).toEqual(board.rowLabels);
    expect((reopenedBoard?.data as BoardNodeData).surface).toBe('breadboard');

    const wire = reopened.edges.find((edge) => edge.id === 'w-probe');
    expect(wire?.source).toBe(board.boardId);
    // The exact hole survives, not just "somewhere on the H12 group".
    expect(wire?.sourcePort).toBe(holePortId(LANDING));
    expect(parseHolePortId(wire?.sourcePort ?? '')).toEqual(LANDING);

    // A second round-trip is a fixed point, so reopening never drifts.
    expect(toCanonicalProject(reopened.nodes, reopened.edges)).toEqual(
      toCanonicalProject(original.nodes, original.edges),
    );
  });

  it('refuses a saved breadboard the renderer could not draw as one', () => {
    const original = model(POSITION);
    const saved = toCanonicalProject(original.nodes, original.edges);
    const clone = (): CanonicalProjectV2 => structuredClone(saved);
    const savedBoardOf = (project: CanonicalProjectV2): CanonicalBoard => {
      const entry = project.layout.boards.find((candidate) => candidate.id === board.boardId);
      if (!entry) throw new Error('the saved project lost its board');
      return entry;
    };

    const withoutChannel = clone();
    delete savedBoardOf(withoutChannel).centerGap;
    const withoutRowLabels = clone();
    delete savedBoardOf(withoutRowLabels).rowLabels;

    // The surface is a rendering claim and the renderer takes it literally, so
    // a board that keeps it without the channel or the printed rows is
    // rejected at the boundary rather than reopening as a blank rectangle.
    expect(() => parseCanonicalProject(withoutChannel)).toThrow(/centerGap/);
    expect(() => parseCanonicalProject(withoutRowLabels)).toThrow(/rowLabels/);
    expect(() => parseCanonicalProject(clone())).not.toThrow();
  });

  it('records the landing as one junction on the column group, keeping the exact hole', () => {
    const original = model(POSITION);
    const saved = toCanonicalProject(original.nodes, original.edges);
    const copper = saved.electrical.junctions.filter((junction) =>
      junction.id.startsWith('copper:'),
    );
    // The five holes of J13..F13 are one electrical point, so they are one
    // junction - not five.
    expect(copper).toHaveLength(1);
    expect(copper[0].kind).toBe('rail');
    expect(copper[0].label).toBe('J13-F13');

    const layout = saved.layout.junctions.find((entry) => entry.junctionId === copper[0].id);
    expect(layout?.taps).toBe(BREADBOARD_GROUP_SIZE);
    expect(layout?.boardId).toBe(board.boardId);
    expect(layout?.boardPort).toBe(`trace:${breadboardColumnTraceId(12, 'jf')}`);

    // Which of the five holes the wire actually lands on survives as the tap
    // index: H13 is the third hole of the group, counted from J.
    const conductor = saved.layout.conductors.find((entry) => entry.conductorId === 'w-probe');
    expect(conductor?.fromTap ?? conductor?.toTap).toBe(2);
  });

  it('moves every hole with the board and keeps the saved position exact', () => {
    const moved = model({ x: POSITION.x + 500, y: POSITION.y + 250 });
    const saved = toCanonicalProject(moved.nodes, moved.edges);
    const savedBoard = saved.layout.boards.find((entry) => entry.id === board.boardId);
    expect(savedBoard?.position).toEqual({ x: POSITION.x + 500, y: POSITION.y + 250 });

    const junction = saved.layout.junctions.find((entry) => entry.junctionId.startsWith('copper:'));
    const anchor = holeLocalPoint(board, { row: breadboardRowIndex('J'), col: 12 });
    expect(junction?.position).toEqual({
      x: POSITION.x + 500 + anchor.x,
      y: POSITION.y + 250 + anchor.y,
    });
  });
});

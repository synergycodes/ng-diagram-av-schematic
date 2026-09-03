import { describe, expect, it } from 'vitest';
import { boardSize, findHoleCollisions, findOutOfBoundsHoleClaims } from '../model/board-geometry';
import { holePortId } from '../model/board-ports';
import {
  findTraceDefects,
  findTraceOverlaps,
  holesOnSameTrace,
  netForHole,
} from '../model/board-trace';
import { BREADBOARD_COLS, BREADBOARD_ROWS, breadboardHoleAddress } from '../model/breadboard';
import { deviceHoleClaims } from '../model/footprint-geometry';
import { junctionTapPortId } from '../model/canonical-project';
import { NodeTemplateType } from '../model/interfaces';
import { physicalEdgeNet } from '../model/physical-connectivity';
import {
  EXTERNAL_COMPONENT_NODES,
  BOARD_POSITIONS,
  PHYSICAL_BOARDS,
  PHYSICAL_BOARD_NODES,
  PHYSICAL_WIRE_EDGES,
  PLACA_A_BOARD,
  PLACA_ORIGEM_BOARD,
  PROTOBOARD_ENDPOINT_NODES,
  PROTOBOARD_JUMPER_EDGES,
  PROTOBOARD_NANO_HOLE,
  PROTOBOARD_SUPERIOR_BOARD,
  PROTOBOARD_TB6612_HOLE,
  PECA_E_BOARD,
  PECA_G_BOARD,
  SEATED_COMPONENT_NODES,
} from './physical-boards.fixture';

describe('physical board fixtures', () => {
  const boards = [PLACA_A_BOARD, ...PHYSICAL_BOARDS];

  it('contains distinct placa A, source board, upper protoboard, and only pieces E/G', () => {
    expect(PLACA_A_BOARD).toMatchObject({ rows: 6, cols: 11 });
    expect(PLACA_ORIGEM_BOARD).toMatchObject({ rows: 6, cols: 28 });
    expect(PROTOBOARD_SUPERIOR_BOARD).toMatchObject({
      boardId: 'protoboard-superior',
      label: 'Protoboard superior (830 pontos)',
      rows: BREADBOARD_ROWS,
      cols: BREADBOARD_COLS,
      pitch: 20,
      centerGap: 40,
    });
    expect(PROTOBOARD_SUPERIOR_BOARD.holes).toHaveLength(830);
    expect(PROTOBOARD_SUPERIOR_BOARD.traces).toHaveLength(BREADBOARD_COLS * 2 + 4);
    expect(PROTOBOARD_SUPERIOR_BOARD.notes).toContain('470 uF');
    expect(PECA_E_BOARD).toMatchObject({ rows: 6, cols: 3 });
    expect(PECA_G_BOARD).toMatchObject({ rows: 6, cols: 4 });
    expect(PHYSICAL_BOARDS.map((board) => board.boardId)).toEqual([
      'protoboard-superior',
      'placa-origem',
      'peca-e',
      'peca-g',
    ]);
    expect(new Set(boards.map((board) => board.boardId)).size).toBe(5);
    expect(PROTOBOARD_SUPERIOR_BOARD.boardId).not.toBe(PLACA_A_BOARD.boardId);
    expect(PROTOBOARD_SUPERIOR_BOARD.boardId).not.toBe(PLACA_ORIGEM_BOARD.boardId);
  });

  it('uses the shared board pitch on every board, breadboard included', () => {
    expect(PROTOBOARD_SUPERIOR_BOARD.pitch).toBe(PLACA_A_BOARD.pitch);
    expect(boards.every((board) => board.pitch === PLACA_A_BOARD.pitch)).toBe(true);
  });

  it('lays every board body out without overlapping another', () => {
    const rects = boards.map((board) => {
      const position = BOARD_POSITIONS[board.boardId];
      const size = boardSize(board);
      return {
        boardId: board.boardId,
        left: position.x,
        top: position.y,
        right: position.x + size.width,
        bottom: position.y + size.height,
      };
    });
    for (const a of rects) {
      for (const b of rects) {
        if (a.boardId >= b.boardId) continue;
        const overlaps =
          a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        expect(overlaps, `${a.boardId} vs ${b.boardId}`).toBe(false);
      }
    }
  });

  it('defines only valid, non-overlapping traces', () => {
    for (const board of boards) {
      expect(findTraceDefects(board), board.boardId).toEqual([]);
      expect(findTraceOverlaps(board), board.boardId).toEqual([]);
    }
  });

  it('keeps each runtime board node id equal to its boardId', () => {
    expect(PHYSICAL_BOARD_NODES.every((node) => node.id === node.data.boardId)).toBe(true);
  });
});

describe('physical component fixtures', () => {
  it('uses the footprint template for every seated component', () => {
    expect(SEATED_COMPONENT_NODES.length).toBeGreaterThan(0);
    expect(
      SEATED_COMPONENT_NODES.every(
        (node) => node.type === NodeTemplateType.FootprintNode && node.data.footprint !== undefined,
      ),
    ).toBe(true);
  });

  it('keeps every occupied hole in bounds and collision-free', () => {
    const boardsById = new Map(
      [PLACA_A_BOARD, ...PHYSICAL_BOARDS].map((board) => [board.boardId, board]),
    );
    const claims = SEATED_COMPONENT_NODES.flatMap((node) => deviceHoleClaims(node.id, node.data));
    expect(findOutOfBoundsHoleClaims(claims, boardsById)).toEqual([]);
    expect(findHoleCollisions(claims)).toEqual([]);
  });

  it('seeds a persisted non-zero rotation', () => {
    const rotated = SEATED_COMPONENT_NODES.find((node) => node.data.placement?.rotation !== 0);
    expect(rotated?.data.placement?.rotation).toBe(180);
  });

  it('removes the former D/F bulk pieces and their capacitors from the active seed', () => {
    expect(PHYSICAL_BOARDS.some((board) => ['peca-d', 'peca-f'].includes(board.boardId))).toBe(
      false,
    );
    expect(
      SEATED_COMPONENT_NODES.some(
        (node) => node.id.startsWith('cap-d-') || node.id.startsWith('cap-f-'),
      ),
    ).toBe(false);
    expect(
      PHYSICAL_WIRE_EDGES.some(
        (edge) =>
          edge.source === 'peca-d' ||
          edge.source === 'peca-f' ||
          edge.target === 'peca-d' ||
          edge.target === 'peca-f',
      ),
    ).toBe(false);
  });

  it('keeps the rotated UART divider junction separate from ground', () => {
    const r1 = SEATED_COMPONENT_NODES.find((node) => node.id === 'res-e-r1');
    const r2 = SEATED_COMPONENT_NODES.find((node) => node.id === 'res-e-r2');
    const r1Junction = r1?.data.ports.find((port) => port.id === 'b')?.hole;
    const r2Junction = r2?.data.ports.find((port) => port.id === 'b')?.hole;
    const r2Ground = r2?.data.ports.find((port) => port.id === 'a')?.hole;
    if (!r1Junction || !r2Junction || !r2Ground) {
      throw new Error('UART divider fixture has no resolved pin holes');
    }
    expect(holesOnSameTrace(PECA_E_BOARD, r1Junction, r2Junction)).toBe(true);
    expect(netForHole(PECA_E_BOARD, r2Junction)).toBeUndefined();
    expect(netForHole(PECA_E_BOARD, r2Ground)).toBe('GND_SYS');
  });

  it('connects external components directly to board holes and traces', () => {
    expect(PHYSICAL_WIRE_EDGES.some((edge) => edge.targetPort?.startsWith('hole:'))).toBe(true);
    expect(PHYSICAL_WIRE_EDGES.some((edge) => edge.targetPort?.startsWith('trace:'))).toBe(true);
  });

  it('models exactly the two documented upper-protoboard jumpers with provisional endpoints', () => {
    expect(PROTOBOARD_JUMPER_EDGES).toHaveLength(2);
    expect(PROTOBOARD_ENDPOINT_NODES).toHaveLength(2);
    const nano = PROTOBOARD_JUMPER_EDGES.find((edge) => edge.id === 'jumper-proto-nano');
    const tb6612 = PROTOBOARD_JUMPER_EDGES.find((edge) => edge.id === 'jumper-proto-tb6612');
    expect(nano?.source).toBe('protoboard-superior');
    expect(nano?.sourcePort).toBe(holePortId(PROTOBOARD_NANO_HOLE));
    expect(breadboardHoleAddress(PROTOBOARD_NANO_HOLE)).toBe('E18');
    expect(nano?.target).toBe('proto-endpoint-nano');
    expect(nano?.targetPort).toBe(junctionTapPortId(0));
    expect(nano?.data.wireType).toBe('signal');
    expect(nano?.data.netName).toBe('PROTO_NANO_SIGNAL');
    expect(tb6612?.source).toBe('protoboard-superior');
    expect(tb6612?.sourcePort).toBe(holePortId(PROTOBOARD_TB6612_HOLE));
    expect(breadboardHoleAddress(PROTOBOARD_TB6612_HOLE)).toBe('I18');
    // The two jumpers sit on different column groups, so they stay separate nets.
    expect(
      holesOnSameTrace(PROTOBOARD_SUPERIOR_BOARD, PROTOBOARD_NANO_HOLE, PROTOBOARD_TB6612_HOLE),
    ).toBe(false);
    expect(tb6612?.target).toBe('proto-endpoint-tb6612');
    expect(tb6612?.targetPort).toBe(junctionTapPortId(0));
    expect(tb6612?.data.wireType).toBe('signal');
    expect(tb6612?.data.netName).toBe('PROTO_TB6612_SIGNAL');
    expect(
      PROTOBOARD_ENDPOINT_NODES.every(
        (node) => node.data.taps === 1 && node.data.notes?.includes('não documentado'),
      ),
    ).toBe(true);
  });

  it('stores authored net names without forging canonical net ids or copper shorts', () => {
    const nodes = [
      ...PHYSICAL_BOARD_NODES,
      ...PROTOBOARD_ENDPOINT_NODES,
      ...SEATED_COMPONENT_NODES,
      ...EXTERNAL_COMPONENT_NODES,
    ];
    expect(PHYSICAL_WIRE_EDGES.every((edge) => edge.data.netName && !edge.data.netId)).toBe(true);
    expect(
      PHYSICAL_WIRE_EDGES.every((edge) => physicalEdgeNet(nodes, edge).conflict.length === 0),
    ).toBe(true);
  });
});

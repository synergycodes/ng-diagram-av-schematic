import { describe, expect, it } from 'vitest';
import { holePortId, parseHolePortId, parseTracePortId, tracePortId } from './board-ports';
import {
  findTraceDefects,
  findTraceOverlaps,
  holesOnSameTrace,
  netForHole,
  rowTrace,
  traceHoles,
  traceSegmentHoles,
} from './board-trace';
import { type BoardNodeData, type BoardTrace } from './interfaces';

describe('board trace geometry', () => {
  it('expands horizontal and vertical runs inclusively in either direction', () => {
    expect(traceSegmentHoles({ from: { row: 1, col: 3 }, to: { row: 1, col: 1 } })).toEqual([
      { row: 1, col: 1 },
      { row: 1, col: 2 },
      { row: 1, col: 3 },
    ]);
    expect(traceSegmentHoles({ from: { row: 3, col: 2 }, to: { row: 1, col: 2 } })).toEqual([
      { row: 1, col: 2 },
      { row: 2, col: 2 },
      { row: 3, col: 2 },
    ]);
  });

  it('joins disjoint segments into one electrical trace without duplicate holes', () => {
    const trace: BoardTrace = {
      id: 'jumper',
      label: 'jumper',
      segments: [
        { from: { row: 0, col: 2 }, to: { row: 0, col: 2 } },
        { from: { row: 2, col: 0 }, to: { row: 2, col: 0 } },
        { from: { row: 0, col: 2 }, to: { row: 0, col: 2 } },
      ],
    };
    expect(traceHoles(trace)).toEqual([
      { row: 0, col: 2 },
      { row: 2, col: 0 },
    ]);
  });

  it('associates holes on the same rail and resolves its net', () => {
    const board: BoardNodeData = {
      type: 'board',
      boardId: 'rails',
      label: 'Rails',
      rows: 2,
      cols: 5,
      pitch: 20,
      traces: [rowTrace('power', 'L1', 0, 5, '5V')],
    };
    expect(holesOnSameTrace(board, { row: 0, col: 0 }, { row: 0, col: 4 })).toBe(true);
    expect(holesOnSameTrace(board, { row: 0, col: 0 }, { row: 1, col: 0 })).toBe(false);
    expect(netForHole(board, { row: 0, col: 3 })).toBe('5V');
  });

  it('reports diagonal, out-of-bounds, and overlapping trace definitions', () => {
    const board: BoardNodeData = {
      type: 'board',
      boardId: 'broken',
      label: 'Broken',
      rows: 2,
      cols: 3,
      pitch: 20,
      traces: [
        {
          id: 'a',
          label: 'A',
          segments: [{ from: { row: 0, col: 0 }, to: { row: 1, col: 1 } }],
        },
        {
          id: 'b',
          label: 'B',
          segments: [{ from: { row: 0, col: 0 }, to: { row: 0, col: 3 } }],
        },
      ],
    };
    expect(findTraceDefects(board).map((defect) => defect.reason)).toEqual([
      'diagonal',
      'out-of-bounds',
    ]);
    expect(findTraceOverlaps(board)).toEqual([{ hole: { row: 0, col: 0 }, traceIds: ['a', 'b'] }]);
  });

  it('reports a trace that crosses a hole omitted by a sparse board', () => {
    const board: BoardNodeData = {
      type: 'board',
      boardId: 'sparse',
      label: 'Sparse',
      rows: 1,
      cols: 3,
      pitch: 20,
      holes: [
        { row: 0, col: 0 },
        { row: 0, col: 2 },
      ],
      traces: [rowTrace('broken-rail', 'L1', 0, 3)],
    };
    expect(findTraceDefects(board)).toContainEqual({
      traceId: 'broken-rail',
      segmentIndex: 0,
      hole: { row: 0, col: 1 },
      reason: 'missing-hole',
    });
  });
});

describe('board endpoint ids', () => {
  it('round-trips hole and trace endpoint ids', () => {
    expect(parseHolePortId(holePortId({ row: 5, col: 27 }))).toEqual({ row: 5, col: 27 });
    expect(parseTracePortId(tracePortId('g-l1'))).toBe('g-l1');
  });

  it('rejects malformed endpoint ids', () => {
    expect(parseHolePortId('hole:-1:2')).toBeNull();
    expect(parseHolePortId('hole:1')).toBeNull();
    expect(parseHolePortId('hole::2')).toBeNull();
    expect(parseHolePortId('hole:01:2')).toBeNull();
    expect(parseHolePortId(`hole:${Number.MAX_SAFE_INTEGER + 1}:2`)).toBeNull();
    expect(parseTracePortId('trace:')).toBeNull();
  });
});

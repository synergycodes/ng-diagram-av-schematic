import { holeKey, isBoardHoleAvailable, isHoleInBounds, type BoardGrid } from './board-geometry';
import {
  type BoardHole,
  type BoardNodeData,
  type BoardTrace,
  type BoardTraceSegment,
} from './interfaces';

/**
 * Every hole a segment covers, inclusive of both ends.
 *
 * Segments are axis-aligned by definition; a segment whose ends share neither
 * a row nor a column is malformed and yields only its two endpoints rather
 * than inventing a diagonal run of holes - `findMalformedTraceSegments` is
 * what reports it, so expansion never has to throw mid-render.
 */
export function traceSegmentHoles(segment: BoardTraceSegment): BoardHole[] {
  const { from, to } = segment;
  if (from.row === to.row) {
    const [start, end] = from.col <= to.col ? [from.col, to.col] : [to.col, from.col];
    const holes: BoardHole[] = [];
    for (let col = start; col <= end; col++) holes.push({ row: from.row, col });
    return holes;
  }
  if (from.col === to.col) {
    const [start, end] = from.row <= to.row ? [from.row, to.row] : [to.row, from.row];
    const holes: BoardHole[] = [];
    for (let row = start; row <= end; row++) holes.push({ row, col: from.col });
    return holes;
  }
  return [{ ...from }, { ...to }];
}

/**
 * Every hole a trace joins, de-duplicated and row-major.
 *
 * A trace's segments need not touch each other: an insulated jumper wire
 * bridging two distant holes (peca E's UART divider node) is one trace made of
 * two single-hole segments. Electrically they are one point either way, which
 * is the only thing a trace claims.
 */
export function traceHoles(trace: BoardTrace): BoardHole[] {
  const seen = new Set<string>();
  const holes: BoardHole[] = [];
  for (const segment of trace.segments) {
    for (const hole of traceSegmentHoles(segment)) {
      const key = holeKey(hole);
      if (seen.has(key)) continue;
      seen.add(key);
      holes.push(hole);
    }
  }
  return holes.sort((a, b) => a.row - b.row || a.col - b.col);
}

/** A trace covering an entire row, the shape every power rail on placa A uses. */
export function rowTrace(
  id: string,
  label: string,
  row: number,
  cols: number,
  net?: string,
): BoardTrace {
  return {
    id,
    label,
    net,
    segments: [{ from: { row, col: 0 }, to: { row, col: cols - 1 } }],
  };
}

/** Lookup from hole key to the trace covering it. A hole belongs to at most one trace. */
export function buildTraceIndex(board: Pick<BoardNodeData, 'traces'>): Map<string, BoardTrace> {
  const index = new Map<string, BoardTrace>();
  for (const trace of board.traces ?? []) {
    for (const hole of traceHoles(trace)) {
      index.set(holeKey(hole), trace);
    }
  }
  return index;
}

export function traceForHole(
  board: Pick<BoardNodeData, 'traces'>,
  hole: BoardHole,
): BoardTrace | undefined {
  return buildTraceIndex(board).get(holeKey(hole));
}

/**
 * Whether two holes on the same board are electrically the same point.
 *
 * True when they are literally the same hole, or when one trace covers both.
 * This is the association that has to survive save/reload: a wire landing on
 * any hole of `GND_SYS` is on `GND_SYS`, wherever the component moved to.
 */
export function holesOnSameTrace(
  board: Pick<BoardNodeData, 'traces'>,
  a: BoardHole,
  b: BoardHole,
): boolean {
  if (a.row === b.row && a.col === b.col) return true;
  const index = buildTraceIndex(board);
  const traceA = index.get(holeKey(a));
  const traceB = index.get(holeKey(b));
  return !!traceA && !!traceB && traceA.id === traceB.id;
}

/** The net a hole sits on, when its trace declares one. */
export function netForHole(
  board: Pick<BoardNodeData, 'traces'>,
  hole: BoardHole,
): string | undefined {
  return traceForHole(board, hole)?.net;
}

export interface TraceDefect {
  traceId: string;
  segmentIndex: number;
  hole: BoardHole;
  reason: 'diagonal' | 'out-of-bounds' | 'missing-hole';
}

/**
 * Structural problems in a board's own trace definitions: a segment that is
 * neither horizontal nor vertical, or an endpoint off the grid. Empty means
 * every trace describes copper that could physically exist on that board.
 */
export function findTraceDefects(board: BoardGrid & Pick<BoardNodeData, 'traces'>): TraceDefect[] {
  const defects: TraceDefect[] = [];
  for (const trace of board.traces ?? []) {
    trace.segments.forEach((segment, segmentIndex) => {
      if (segment.from.row !== segment.to.row && segment.from.col !== segment.to.col) {
        defects.push({ traceId: trace.id, segmentIndex, hole: segment.from, reason: 'diagonal' });
      }
      for (const hole of traceSegmentHoles(segment)) {
        if (!isHoleInBounds(board, hole)) {
          defects.push({ traceId: trace.id, segmentIndex, hole, reason: 'out-of-bounds' });
        } else if (!isBoardHoleAvailable(board, hole)) {
          defects.push({ traceId: trace.id, segmentIndex, hole, reason: 'missing-hole' });
        }
      }
    });
  }
  return defects;
}

/**
 * Holes claimed by more than one trace on the same board - two nets shorted
 * together, which is a wiring error rather than a layout preference.
 */
export function findTraceOverlaps(board: Pick<BoardNodeData, 'traces'>): {
  hole: BoardHole;
  traceIds: string[];
}[] {
  const byHole = new Map<string, { hole: BoardHole; traceIds: string[] }>();
  for (const trace of board.traces ?? []) {
    for (const hole of traceHoles(trace)) {
      const key = holeKey(hole);
      const entry = byHole.get(key);
      if (entry) {
        entry.traceIds.push(trace.id);
      } else {
        byHole.set(key, { hole, traceIds: [trace.id] });
      }
    }
  }
  return [...byHole.values()].filter((entry) => entry.traceIds.length > 1);
}

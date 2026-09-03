import { type BoardHole, type BoardNodeData } from './interfaces';

/** Outer margin (px) around the hole grid, so holes don't sit flush on the board edge. */
export const BOARD_MARGIN = 16;

/** Drawn hole diameter (px) when a board doesn't override `holeDiameter`. */
export const DEFAULT_HOLE_DIAMETER = 5;

export interface BoardSize {
  width: number;
  height: number;
}

/** Grid bounds plus an optional sparse hole list, without a whole `BoardNodeData`. */
export type BoardGrid = Pick<BoardNodeData, 'rows' | 'cols' | 'holes'>;
export type BoardMetrics = Pick<BoardNodeData, 'rows' | 'cols' | 'pitch' | 'centerGap'>;

/** First row below the optional central channel. */
export function lowerBoardHalfStartRow(board: Pick<BoardNodeData, 'rows'>): number {
  return Math.ceil(board.rows / 2);
}

/** Top and height of the channel in board-local pixels, when one is configured. */
export function boardCenterGap(
  board: Pick<BoardNodeData, 'rows' | 'pitch' | 'centerGap'>,
): { y: number; height: number } | null {
  const height = board.centerGap ?? 0;
  if (height <= 0 || board.rows < 2) return null;
  const upperRow = lowerBoardHalfStartRow(board) - 1;
  return {
    y: BOARD_MARGIN + upperRow * board.pitch + board.pitch / 2,
    height,
  };
}

/**
 * Pixel size of a board's rendered body, derived from its hole grid.
 * `rows`/`cols` count holes, so the grid spans `(n - 1) * pitch` between the
 * first and last hole on each axis.
 */
export function boardSize(board: BoardMetrics): BoardSize {
  const gap = board.rows > 1 ? (board.centerGap ?? 0) : 0;
  return {
    width: (board.cols - 1) * board.pitch + BOARD_MARGIN * 2,
    height: (board.rows - 1) * board.pitch + BOARD_MARGIN * 2 + gap,
  };
}

/**
 * Pixel position of a hole's center, relative to the board node's own
 * top-left corner (i.e. add the board node's `position` to place it in
 * diagram space).
 */
export function holeLocalPoint(
  board: Pick<BoardNodeData, 'rows' | 'pitch' | 'centerGap'>,
  hole: BoardHole,
): { x: number; y: number } {
  const gapOffset = hole.row >= lowerBoardHalfStartRow(board) ? (board.centerGap ?? 0) : 0;
  return {
    x: BOARD_MARGIN + hole.col * board.pitch,
    y: BOARD_MARGIN + hole.row * board.pitch + gapOffset,
  };
}

/**
 * The hole whose center is nearest to a point given in board-local pixels -
 * the inverse of `holeLocalPoint`, and the primitive the drag-to-seat snap is
 * built on. Not clamped to the grid: an out-of-bounds result is a real answer
 * ("you dropped past the edge") that the caller decides what to do with.
 */
export function nearestHole(
  board: Pick<BoardNodeData, 'rows' | 'pitch' | 'centerGap'>,
  localPoint: { x: number; y: number },
): BoardHole {
  const localY = localPoint.y - BOARD_MARGIN;
  const col = Math.round((localPoint.x - BOARD_MARGIN) / board.pitch);
  const gap = board.rows > 1 ? (board.centerGap ?? 0) : 0;
  if (gap <= 0) {
    return { row: Math.round(localY / board.pitch), col };
  }

  const lastRowY = (board.rows - 1) * board.pitch + gap;
  let row: number;
  if (localY < 0) {
    row = Math.round(localY / board.pitch);
  } else if (localY > lastRowY) {
    row = board.rows - 1 + Math.round((localY - lastRowY) / board.pitch);
  } else {
    row = Array.from({ length: board.rows }, (_, candidate) => candidate).reduce(
      (closest, candidate) => {
        const closestY = holeLocalPoint(board, { row: closest, col: 0 }).y;
        const candidateY = holeLocalPoint(board, { row: candidate, col: 0 }).y;
        return Math.abs(candidateY - localPoint.y) <= Math.abs(closestY - localPoint.y)
          ? candidate
          : closest;
      },
      0,
    );
  }
  return {
    row,
    col,
  };
}

/**
 * Nearest hole that actually exists on a board. For a regular board this is
 * the rounded grid address; for an explicit sparse hole list it is the closest
 * listed address in Euclidean grid distance. Returns null for an explicitly
 * empty list, which represents a board with no holes.
 */
export function nearestAvailableHole(
  board: BoardMetrics & Pick<BoardNodeData, 'holes'>,
  localPoint: { x: number; y: number },
): BoardHole | null {
  const rounded = nearestHole(board, localPoint);
  if (board.holes === undefined) return rounded;
  if (board.holes.length === 0) return null;
  // The rounded address is the nearest grid point; when the board actually has
  // that hole it is also the nearest listed one, so a dense sparse board (an
  // 830-point breadboard is 830 entries) never pays for the scan below.
  if (isBoardHoleAvailable(board, rounded)) return rounded;
  return board.holes.reduce((closest, candidate) => {
    const closestPoint = holeLocalPoint(board, closest);
    const candidatePoint = holeLocalPoint(board, candidate);
    const closestDistance =
      (closestPoint.y - localPoint.y) ** 2 + (closestPoint.x - localPoint.x) ** 2;
    const candidateDistance =
      (candidatePoint.y - localPoint.y) ** 2 + (candidatePoint.x - localPoint.x) ** 2;
    return candidateDistance < closestDistance ? candidate : closest;
  });
}

/** Every hole address on a board's grid, row-major. */
export function allHoles(board: BoardGrid): BoardHole[] {
  const holes: BoardHole[] = [];
  for (let row = 0; row < board.rows; row++) {
    for (let col = 0; col < board.cols; col++) {
      holes.push({ row, col });
    }
  }
  return holes;
}

/** Holes physically present: the explicit list, or every cell for a regular grid. */
export function boardHoles(board: BoardGrid): BoardHole[] {
  return board.holes?.map((hole) => ({ ...hole })) ?? allHoles(board);
}

export function isHoleInBounds(board: BoardGrid, hole: BoardHole): boolean {
  return hole.row >= 0 && hole.row < board.rows && hole.col >= 0 && hole.col < board.cols;
}

/** True only when the address is in bounds and is not omitted by a sparse board. */
export function isBoardHoleAvailable(board: BoardGrid, hole: BoardHole): boolean {
  if (!isHoleInBounds(board, hole)) return false;
  return board.holes === undefined || board.holes.some((candidate) => holesEqual(candidate, hole));
}

/** Stable string form of a hole address, for map keys and port ids. */
export function holeKey(hole: BoardHole): string {
  return `${hole.row}:${hole.col}`;
}

export function holesEqual(a: BoardHole, b: BoardHole): boolean {
  return a.row === b.row && a.col === b.col;
}

/**
 * One pin's claim on a board hole - the minimal shape needed to validate
 * hole placement without depending on `DeviceNodeData`/ng-diagram `Node`
 * types, so the checks below stay pure and framework-agnostic.
 */
export interface BoardHoleClaim {
  /** `BoardNodeData.boardId` this hole is addressed against. */
  boardId: string;
  /** Opaque id identifying the claiming pin, e.g. `${deviceId}:${portId}`, for error reporting. */
  ownerId: string;
  hole: BoardHole;
}

/**
 * Every claim whose hole falls outside its declared board's grid. Empty
 * means every claim addresses a real hole on its board - a physical
 * precondition for a pin to be "encaixado" (fitted) on that board at all.
 */
export function findOutOfBoundsHoleClaims(
  claims: readonly BoardHoleClaim[],
  boardsById: ReadonlyMap<string, BoardGrid>,
): BoardHoleClaim[] {
  return claims.filter((claim) => {
    const board = boardsById.get(claim.boardId);
    return !board || !isBoardHoleAvailable(board, claim.hole);
  });
}

/**
 * Groups claims that physically collide: two or more pins addressing the
 * same hole on the same board, which no real board can seat at once. Holes
 * are board-local addresses, so claims on different boards never collide
 * even if their `row`/`col` match. Returns one group per colliding hole
 * (each group has length >= 2); an empty result means every claimed hole on
 * every board is used by at most one pin.
 *
 * Claims that share an `ownerId` never collide with each other: that is the
 * same physical pin being re-evaluated (e.g. a live drag preview against the
 * placement it is replacing), not two pins fighting over one hole.
 */
export function findHoleCollisions(claims: readonly BoardHoleClaim[]): BoardHoleClaim[][] {
  const byKey = new Map<string, BoardHoleClaim[]>();
  for (const claim of claims) {
    const key = `${claim.boardId}:${holeKey(claim.hole)}`;
    const group = byKey.get(key);
    if (group) {
      group.push(claim);
    } else {
      byKey.set(key, [claim]);
    }
  }
  return [...byKey.values()].filter(
    (group) => new Set(group.map((claim) => claim.ownerId)).size > 1,
  );
}

/** The set of holes on one board that are already claimed by someone else. */
export function occupiedHoleKeys(
  claims: readonly BoardHoleClaim[],
  boardId: string,
  excludeOwnerIds: ReadonlySet<string> = new Set(),
): Set<string> {
  const keys = new Set<string>();
  for (const claim of claims) {
    if (claim.boardId !== boardId) continue;
    if (excludeOwnerIds.has(claim.ownerId)) continue;
    keys.add(holeKey(claim.hole));
  }
  return keys;
}

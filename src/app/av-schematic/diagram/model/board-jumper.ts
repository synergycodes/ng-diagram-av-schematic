import { type Edge, type Node, type Point } from 'ng-diagram';
import { holeLocalPoint, isBoardHoleAvailable } from './board-geometry';
import { parseHolePortId } from './board-ports';
import { isBoardNode, isWireEdge } from './guards';
import { type BoardHole, type BoardNodeData, type WireEdgeData } from './interfaces';
import { boardPortsResolveToSameCopper } from './physical-connectivity';

export interface BoardJumperConnection {
  board: Node<BoardNodeData>;
  sourceHole: BoardHole;
  targetHole: BoardHole;
}

type Connection = Pick<Edge, 'source' | 'sourcePort' | 'target' | 'targetPort'>;

/**
 * Resolves the only gesture that creates a board-local jumper: two distinct
 * hole ports on one solderless breadboard.
 */
export function boardJumperForConnection(
  nodes: readonly Node[],
  connection: Connection,
): BoardJumperConnection | null {
  const resolved = resolveBoardJumperStructure(nodes, connection);
  if (!resolved) return null;
  if (boardPortsResolveToSameCopper(nodes, connection)) return null;
  return resolved;
}

/** Resolves board/holes without performing copper connectivity validation. */
export function resolveBoardJumperStructure(
  nodes: readonly Node[],
  connection: Connection,
): BoardJumperConnection | null {
  if (!connection.source || connection.source !== connection.target) return null;
  if (!connection.sourcePort || !connection.targetPort) return null;
  const board = nodes.find((node) => node.id === connection.source);
  if (!isBoardNode(board) || board.data.surface !== 'breadboard') return null;
  const sourceHole = parseHolePortId(connection.sourcePort);
  const targetHole = parseHolePortId(connection.targetPort);
  if (!sourceHole || !targetHole) return null;
  if (sourceHole.row === targetHole.row && sourceHole.col === targetHole.col) return null;
  if (
    !isBoardHoleAvailable(board.data, sourceHole) ||
    !isBoardHoleAvailable(board.data, targetHole)
  ) {
    return null;
  }
  return { board, sourceHole, targetHole };
}

/** Direct route whose coordinates belong to the board, not the canvas. */
export function defaultBoardJumperLocalRoute(
  board: BoardNodeData,
  sourceHole: BoardHole,
  targetHole: BoardHole,
): Point[] {
  const source = holeLocalPoint(board, sourceHole);
  const target = holeLocalPoint(board, targetHole);
  return [source, target];
}

export function boardWorldPoints(
  board: Pick<Node<BoardNodeData>, 'position'>,
  localPoints: readonly Point[],
): Point[] {
  return localPoints.map((point) => ({
    x: point.x + board.position.x,
    y: point.y + board.position.y,
  }));
}

export function boardLocalPoints(
  board: Pick<Node<BoardNodeData>, 'position'>,
  worldPoints: readonly Point[],
): Point[] {
  return worldPoints.map((point) => ({
    x: point.x - board.position.x,
    y: point.y - board.position.y,
  }));
}

export function isBoardJumperEdge(edge: Edge | null | undefined): edge is Edge<WireEdgeData> {
  return isWireEdge(edge) && typeof edge.data.jumperBoardId === 'string';
}

export function boardJumperPitchLength(
  board: Pick<Node<BoardNodeData>, 'data'>,
  points: readonly Point[],
): number {
  let length = 0;
  for (let index = 0; index < points.length - 1; index++) {
    const current = points[index];
    const next = points[index + 1];
    length += Math.hypot(next.x - current.x, next.y - current.y);
  }
  return length / board.data.pitch;
}

export function boardJumperLengthLabel(nodes: readonly Node[], edge: Edge): string | null {
  if (!isBoardJumperEdge(edge) || !edge.points || edge.points.length < 2) return null;
  const board = nodes.find(
    (node) => isBoardNode(node) && node.data.boardId === edge.data.jumperBoardId,
  );
  if (!isBoardNode(board)) return null;
  return formatPitchLength(boardJumperPitchLength(board, edge.points));
}

export function formatPitchLength(length: number): string {
  const rounded = Math.round(length * 100) / 100;
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(rounded)} pitch`;
}

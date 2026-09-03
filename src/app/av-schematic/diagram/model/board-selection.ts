import { type Node } from 'ng-diagram';
import { boardSize } from './board-geometry';
import { isBoardNode } from './guards';
import { type BoardNodeData } from './interfaces';

/**
 * Chooses one board for a dropped component when rendered board bodies overlap.
 *
 * The previous placement wins while its board still contains the point. New
 * placements prefer the smallest containing board, then stable board/node ids.
 * The result is independent of model array order, so reload cannot silently
 * move a component to a different overlapping board.
 */
export function selectPlacementBoard(
  nodes: readonly Node[],
  point: { x: number; y: number },
  preferredBoardId?: string,
): Node<BoardNodeData> | null {
  const candidates = nodes.filter(isBoardNode).filter((board) => containsPoint(board, point));
  candidates.sort((a, b) => {
    const aPreferred = a.data.boardId === preferredBoardId;
    const bPreferred = b.data.boardId === preferredBoardId;
    if (aPreferred !== bPreferred) return aPreferred ? -1 : 1;

    const aSize = boardSize(a.data);
    const bSize = boardSize(b.data);
    const areaDifference = aSize.width * aSize.height - bSize.width * bSize.height;
    if (areaDifference !== 0) return areaDifference;

    const boardIdOrder = compareText(a.data.boardId, b.data.boardId);
    return boardIdOrder !== 0 ? boardIdOrder : compareText(a.id, b.id);
  });
  return candidates[0] ?? null;
}

function containsPoint(board: Node<BoardNodeData>, point: { x: number; y: number }): boolean {
  const size = boardSize(board.data);
  return (
    point.x >= board.position.x - board.data.pitch &&
    point.y >= board.position.y - board.data.pitch &&
    point.x <= board.position.x + size.width &&
    point.y <= board.position.y + size.height
  );
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

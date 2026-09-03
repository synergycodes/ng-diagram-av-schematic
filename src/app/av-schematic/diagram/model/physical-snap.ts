import { type Node, type Size } from 'ng-diagram';
import { isBoardNode, isDeviceNode } from './guards';

/**
 * Resolve drag/edge snap from physical data instead of assuming a 20 px grid.
 * Footprints inherit the pitch of their placement board; board nodes expose
 * their own pitch. Generic AV nodes keep the configured fallback grid.
 */
export function snapForNode(node: Node, nodes: readonly Node[], fallback: Size): Size {
  if (isBoardNode(node)) return squareSnap(node.data.pitch);
  if (isDeviceNode(node) && node.data.placement) {
    const board = nodes
      .filter(isBoardNode)
      .find((candidate) => candidate.data.boardId === node.data.placement?.boardId);
    if (board) return squareSnap(board.data.pitch);
  }
  return { ...fallback };
}

function squareSnap(pitch: number): Size {
  return { width: pitch, height: pitch };
}

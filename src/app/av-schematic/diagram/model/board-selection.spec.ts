import { type Node } from 'ng-diagram';
import { describe, expect, it } from 'vitest';
import { NodeTemplateType, type BoardNodeData } from './interfaces';
import { selectPlacementBoard } from './board-selection';

function board(
  id: string,
  rows: number,
  cols: number,
  position = { x: 0, y: 0 },
): Node<BoardNodeData> {
  return {
    id,
    type: NodeTemplateType.BoardNode,
    position,
    data: { type: 'board', boardId: id, label: id, rows, cols, pitch: 17 },
  };
}

describe('selectPlacementBoard', () => {
  const large = board('large', 8, 8);
  const small = board('small', 3, 3);
  const point = { x: 20, y: 20 };

  it('chooses the smallest overlapping board independently of model order', () => {
    expect(selectPlacementBoard([large, small], point)?.id).toBe('small');
    expect(selectPlacementBoard([small, large], point)?.id).toBe('small');
  });

  it('keeps the prior board while it still contains the drop point', () => {
    expect(selectPlacementBoard([large, small], point, 'large')?.id).toBe('large');
  });

  it('uses stable board ids as the tie breaker', () => {
    const boardB = board('board-b', 3, 3);
    const boardA = board('board-a', 3, 3);
    expect(selectPlacementBoard([boardB, boardA], point)?.id).toBe('board-a');
  });

  it('returns null outside every board', () => {
    expect(selectPlacementBoard([large, small], { x: 999, y: 999 })).toBeNull();
  });
});

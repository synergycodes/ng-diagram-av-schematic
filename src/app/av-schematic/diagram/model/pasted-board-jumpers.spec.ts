import { type Edge, type Node } from 'ng-diagram';
import { describe, expect, it } from 'vitest';
import { NodeTemplateType, type BoardNodeData } from './interfaces';
import { planPastedBoardOwnership } from './pasted-board-jumpers';

describe('planPastedBoardOwnership', () => {
  it('remaps a pasted jumper to the copied board domain id', () => {
    const original: Node<BoardNodeData> = {
      id: 'board-original-node',
      type: NodeTemplateType.BoardNode,
      position: { x: 0, y: 0 },
      data: {
        type: 'board',
        boardId: 'board-domain',
        label: 'Protoboard',
        surface: 'breadboard',
        rows: 2,
        cols: 3,
        pitch: 20,
      },
    };
    const copied: Node<BoardNodeData> = {
      ...original,
      id: 'board-copy-node',
      position: { x: 100, y: 100 },
    };
    const jumper: Edge = {
      id: 'jumper-copy',
      source: copied.id,
      sourcePort: 'hole:0:0',
      target: copied.id,
      targetPort: 'hole:1:2',
      data: { type: 'wire', wireId: 'J1', jumperBoardId: original.data.boardId },
    };

    const plan = planPastedBoardOwnership([copied], [jumper], [original, copied]);

    expect(plan.nodeUpdates).toContainEqual({
      id: copied.id,
      data: { ...copied.data, boardId: copied.id },
    });
    expect(plan.edgeUpdates).toContainEqual({
      id: jumper.id,
      data: { ...jumper.data, jumperBoardId: copied.id },
    });
    expect(plan.rejectedEdgeIds).toEqual([]);
  });

  it('rejects a pasted jumper whose owner cannot be resolved', () => {
    const orphan: Edge = {
      id: 'orphan-copy',
      source: 'missing-board-node',
      sourcePort: 'hole:0:0',
      target: 'missing-board-node',
      targetPort: 'hole:1:1',
      data: { type: 'wire', wireId: 'J1', jumperBoardId: 'missing-board-domain' },
    };

    expect(planPastedBoardOwnership([], [orphan], [])).toMatchObject({
      edgeUpdates: [],
      rejectedEdgeIds: [orphan.id],
    });
  });

  it('rejects a jumper when its owner board is not part of the pasted nodes', () => {
    const original: Node<BoardNodeData> = {
      id: 'board-existing-node',
      type: NodeTemplateType.BoardNode,
      position: { x: 0, y: 0 },
      data: {
        type: 'board',
        boardId: 'board-existing-domain',
        label: 'Existing',
        surface: 'breadboard',
        rows: 2,
        cols: 3,
        pitch: 20,
      },
    };
    const jumper: Edge = {
      id: 'jumper-without-board-copy',
      source: original.id,
      sourcePort: 'hole:0:0',
      target: original.id,
      targetPort: 'hole:1:2',
      data: { type: 'wire', wireId: 'J1', jumperBoardId: original.data.boardId },
    };

    expect(planPastedBoardOwnership([], [jumper], [original])).toMatchObject({
      edgeUpdates: [],
      rejectedEdgeIds: [jumper.id],
    });
  });
});

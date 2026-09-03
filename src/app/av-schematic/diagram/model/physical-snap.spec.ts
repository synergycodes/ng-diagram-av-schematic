import { type Node } from 'ng-diagram';
import { describe, expect, it } from 'vitest';
import { NodeTemplateType, type BoardNodeData, type DeviceNodeData } from './interfaces';
import { snapForNode } from './physical-snap';

const boardNode: Node<BoardNodeData> = {
  id: 'board-17',
  type: NodeTemplateType.BoardNode,
  position: { x: 31, y: 47 },
  data: {
    type: 'board',
    boardId: 'board-17',
    label: 'Board 17',
    rows: 4,
    cols: 5,
    pitch: 17,
  },
};

const placedNode: Node<DeviceNodeData> = {
  id: 'placed-node',
  type: NodeTemplateType.FootprintNode,
  position: { x: 0, y: 0 },
  data: {
    type: 'device',
    deviceId: 'R1',
    manufacturer: 'generic',
    model: '1k',
    boardId: 'board-17',
    footprintId: 'custom-r',
    placement: { boardId: 'board-17', anchor: { row: 1, col: 1 }, rotation: 0 },
    ports: [],
  },
};

const genericNode: Node<DeviceNodeData> = {
  id: 'generic-node',
  type: NodeTemplateType.DeviceNode,
  position: { x: 0, y: 0 },
  data: {
    type: 'device',
    deviceId: 'SRC1',
    manufacturer: 'generic',
    model: 'source',
    ports: [],
  },
};

describe('snapForNode', () => {
  const nodes = [boardNode, placedNode, genericNode];
  const fallback = { width: 20, height: 20 };

  it('uses an arbitrary board pitch for the board and its placed components', () => {
    expect(snapForNode(boardNode, nodes, fallback)).toEqual({ width: 17, height: 17 });
    expect(snapForNode(placedNode, nodes, fallback)).toEqual({ width: 17, height: 17 });
  });

  it('keeps the configured fallback for generic or orphaned nodes', () => {
    expect(snapForNode(genericNode, nodes, fallback)).toEqual(fallback);
    expect(
      snapForNode(
        {
          ...placedNode,
          data: {
            ...placedNode.data,
            placement: {
              boardId: 'missing-board',
              anchor: { row: 1, col: 1 },
              rotation: 0,
            },
          },
        },
        nodes,
        fallback,
      ),
    ).toEqual(fallback);
  });
});

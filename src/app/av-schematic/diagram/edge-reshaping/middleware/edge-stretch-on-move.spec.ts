import { type Edge, type NgDiagramModelService, type Node, type Point } from 'ng-diagram';
import { describe, expect, it, vi } from 'vitest';
import { NodeTemplateType, type BoardNodeData, type DeviceNodeData } from '../../model/interfaces';
import { applyEdgeStretchOnSelectionMoved } from './edge-stretch-on-move';

interface EdgePointsPatch {
  id: string;
  points: Point[];
}

describe('applyEdgeStretchOnSelectionMoved', () => {
  it('translates every bend rigidly when a jumper owner board moves', async () => {
    const board: Node<BoardNodeData> = {
      id: 'board-node-instance',
      type: NodeTemplateType.BoardNode,
      position: { x: 130, y: 180 },
      data: {
        type: 'board',
        boardId: 'breadboard-domain',
        label: 'Protoboard',
        surface: 'breadboard',
        rows: 10,
        cols: 12,
        pitch: 10,
      },
      measuredPorts: [
        {
          id: 'hole:0:0',
          nodeId: 'board-node-instance',
          type: 'both',
          side: 'left',
          position: { x: 16, y: 9 },
          size: { width: 14, height: 14 },
        },
        {
          id: 'hole:2:4',
          nodeId: 'board-node-instance',
          type: 'both',
          side: 'left',
          position: { x: 56, y: 29 },
          size: { width: 14, height: 14 },
        },
      ],
    };
    const edge: Edge = {
      id: 'jumper-1',
      source: board.id,
      sourcePort: 'hole:0:0',
      target: board.id,
      targetPort: 'hole:2:4',
      routingMode: 'manual',
      points: [
        { x: 116, y: 216 },
        { x: 136, y: 216 },
        { x: 136, y: 236 },
        { x: 156, y: 236 },
      ],
      data: { type: 'wire', wireId: 'W1', jumperBoardId: board.data.boardId },
    };
    const updateEdges = vi.fn<(patches: EdgePointsPatch[]) => void>();
    const modelService = {
      getModel: () => ({ getNodes: () => [board], getEdges: () => [edge] }),
      getNodeById: () => board,
      updateEdges,
    } as unknown as NgDiagramModelService;

    await applyEdgeStretchOnSelectionMoved(modelService, new Set([board.id]), true);

    expect(updateEdges).toHaveBeenCalledWith([
      {
        id: edge.id,
        points: [
          { x: 146, y: 196 },
          { x: 166, y: 196 },
          { x: 166, y: 216 },
          { x: 186, y: 216 },
        ],
      },
    ]);
  });

  it('does not alter a board jumper when an external item moves', async () => {
    const edge: Edge = {
      id: 'jumper-1',
      source: 'breadboard',
      sourcePort: 'hole:0:0',
      target: 'breadboard',
      targetPort: 'hole:2:4',
      routingMode: 'manual',
      points: [
        { x: 16, y: 16 },
        { x: 56, y: 16 },
        { x: 56, y: 36 },
      ],
      data: { type: 'wire', wireId: 'W1', jumperBoardId: 'breadboard' },
    };
    const updateEdges = vi.fn();
    const modelService = {
      getModel: () => ({ getNodes: () => [], getEdges: () => [edge] }),
      updateEdges,
    } as unknown as NgDiagramModelService;

    await applyEdgeStretchOnSelectionMoved(modelService, new Set(['external']), true);

    expect(updateEdges).not.toHaveBeenCalled();
  });

  it('does not simplify a jumper already translated by the model adapter', async () => {
    const board: Node<BoardNodeData> = {
      id: 'board-node-instance',
      type: NodeTemplateType.BoardNode,
      position: { x: 130, y: 180 },
      data: {
        type: 'board',
        boardId: 'breadboard-domain',
        label: 'Protoboard',
        surface: 'breadboard',
        rows: 3,
        cols: 4,
        pitch: 20,
      },
      measuredPorts: [
        {
          id: 'hole:0:0',
          nodeId: 'board-node-instance',
          type: 'both',
          side: 'left',
          position: { x: 16, y: 9 },
          size: { width: 14, height: 14 },
        },
        {
          id: 'hole:1:2',
          nodeId: 'board-node-instance',
          type: 'both',
          side: 'left',
          position: { x: 56, y: 29 },
          size: { width: 14, height: 14 },
        },
      ],
    };
    const translated: Edge = {
      id: 'jumper-1',
      source: board.id,
      sourcePort: 'hole:0:0',
      target: board.id,
      targetPort: 'hole:1:2',
      routingMode: 'manual',
      points: [
        { x: 146, y: 196 },
        { x: 166, y: 206 },
        { x: 186, y: 216 },
      ],
      data: { type: 'wire', wireId: 'W1', jumperBoardId: board.data.boardId },
    };
    const updateEdges = vi.fn();
    const modelService = {
      getModel: () => ({ getNodes: () => [board], getEdges: () => [translated] }),
      getNodeById: () => board,
      updateEdges,
    } as unknown as NgDiagramModelService;

    await applyEdgeStretchOnSelectionMoved(modelService, new Set([board.id]), true);

    expect(updateEdges).not.toHaveBeenCalled();
    expect(translated.points).toHaveLength(3);
  });

  it('re-anchors only incident manual wires and preserves their internal route', async () => {
    const route = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 60 },
      { x: 80, y: 60 },
      { x: 80, y: 100 },
    ];
    const incident = {
      id: 'wire-1',
      source: 'source',
      sourcePort: 'out',
      target: 'target',
      targetPort: 'in',
      routingMode: 'manual',
      points: route,
      data: { type: 'wire', wireId: 'W1', notes: 'preserve me' },
    };
    const unrelated = {
      ...incident,
      id: 'wire-2',
      source: 'other-source',
      target: 'other-target',
      data: { type: 'wire', wireId: 'W2' },
    };
    const nodes = new Map([
      [
        'source',
        {
          id: 'source',
          position: { x: 20, y: 10 },
          measuredPorts: [
            {
              id: 'out',
              side: 'left',
              position: { x: 0, y: 0 },
              size: { width: 10, height: 20 },
            },
          ],
        },
      ],
      [
        'target',
        {
          id: 'target',
          position: { x: 80, y: 90 },
          measuredPorts: [
            {
              id: 'in',
              side: 'left',
              position: { x: 0, y: 0 },
              size: { width: 10, height: 20 },
            },
          ],
        },
      ],
    ]);
    const updateEdges = vi.fn<(patches: EdgePointsPatch[]) => void>();
    const model = {
      getModel: () => ({ getEdges: () => [incident, unrelated] }),
      getNodeById: (id: string) => nodes.get(id),
      updateEdges,
    };

    await applyEdgeStretchOnSelectionMoved(
      model as unknown as NgDiagramModelService,
      new Set(['source']),
      false,
    );

    expect(updateEdges).toHaveBeenCalledOnce();
    expect(updateEdges).toHaveBeenCalledWith([
      {
        id: 'wire-1',
        points: [
          { x: 20, y: 20 },
          { x: 40, y: 20 },
          { x: 40, y: 60 },
          { x: 80, y: 60 },
          { x: 80, y: 100 },
        ],
      },
    ]);
    expect(updateEdges.mock.calls[0][0][0]).not.toHaveProperty('data');
    expect(route).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 60 },
      { x: 80, y: 60 },
      { x: 80, y: 100 },
    ]);
  });

  it('reanchors a manual route to the measured physical center of a board endpoint', async () => {
    const board: Node<BoardNodeData> = {
      id: 'board-17',
      type: NodeTemplateType.BoardNode,
      position: { x: 40, y: 50 },
      data: {
        type: 'board',
        boardId: 'board-17',
        label: 'Board 17',
        rows: 2,
        cols: 3,
        pitch: 17,
      },
      measuredPorts: [
        {
          id: 'hole:0:0',
          nodeId: 'board-17',
          type: 'both',
          side: 'left',
          position: { x: 16, y: 9 },
          size: { width: 14, height: 14 },
        },
      ],
    };
    const target: Node<DeviceNodeData> = {
      id: 'target-node',
      type: NodeTemplateType.DeviceNode,
      position: { x: 200, y: 100 },
      data: {
        type: 'device',
        deviceId: 'DST1',
        manufacturer: 'generic',
        model: 'target',
        ports: [{ id: 'in', label: 'IN', direction: 'input' }],
      },
      measuredPorts: [
        {
          id: 'in',
          nodeId: 'target-node',
          type: 'target',
          side: 'left',
          position: { x: 0, y: 13 },
          size: { width: 14, height: 14 },
        },
      ],
    };
    const edge: Edge = {
      id: 'wire-1',
      source: board.id,
      sourcePort: 'hole:0:0',
      target: target.id,
      targetPort: 'in',
      routingMode: 'manual',
      points: [
        { x: 36, y: 66 },
        { x: 80, y: 66 },
        { x: 80, y: 120 },
        { x: 200, y: 120 },
      ],
      data: {},
    };
    const nodes: Node[] = [board, target];
    let patches: (Pick<Edge, 'id'> & Partial<Edge>)[] = [];
    const modelService = {
      getModel: () => ({ getEdges: () => [edge] }),
      getNodeById: (nodeId: string) => nodes.find((node) => node.id === nodeId),
      updateEdges: (updates: (Pick<Edge, 'id'> & Partial<Edge>)[]) => {
        patches = updates;
        return Promise.resolve();
      },
    } as unknown as NgDiagramModelService;

    await applyEdgeStretchOnSelectionMoved(modelService, new Set([board.id]), true);

    expect(patches).toEqual([
      {
        id: edge.id,
        points: [
          { x: 56, y: 66 },
          { x: 80, y: 66 },
          { x: 80, y: 120 },
          { x: 200, y: 120 },
        ],
      },
    ]);
  });
});

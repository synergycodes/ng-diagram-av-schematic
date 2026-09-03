import { TestBed } from '@angular/core/testing';
import {
  NgDiagramModelService,
  NgDiagramService,
  NgDiagramViewportService,
  type Edge,
  type Node,
  type Point,
} from 'ng-diagram';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeTemplateType, type BoardNodeData } from '../model/interfaces';
import { RelinkEndpointHandler } from './relink-endpoint.handler';
import { RelinkTargetHighlightService } from './relink-target-highlight.service';

describe('RelinkEndpointHandler', () => {
  const updateEdge = vi.fn<(edgeId: string, patch: Partial<Edge>) => void>();
  const beginHistoryGroup = vi.fn();
  const endHistoryGroup = vi.fn();
  const highlight = { clear: vi.fn(), set: vi.fn() };
  const sourceNode: Node = {
    id: 'source',
    position: { x: 0, y: 0 },
    measuredPorts: [],
    data: {},
  };
  const targetNode: Node = {
    id: 'new-target',
    position: { x: 200, y: 20 },
    measuredPorts: [
      {
        id: 'in',
        nodeId: 'new-target',
        type: 'both',
        side: 'left',
        position: { x: 0, y: 10 },
        size: { width: 10, height: 20 },
      },
    ],
    data: {},
  };
  const edge: Edge = { id: 'wire-1', source: 'source', target: 'old-target', data: {} };
  let modelNodes: Node[];
  let modelEdges: Edge[];

  beforeEach(() => {
    modelNodes = [sourceNode, targetNode];
    modelEdges = [edge];
    updateEdge.mockReset();
    beginHistoryGroup.mockReset();
    endHistoryGroup.mockReset();
    highlight.clear.mockReset();
    highlight.set.mockReset();
    TestBed.configureTestingModule({
      providers: [
        RelinkEndpointHandler,
        { provide: RelinkTargetHighlightService, useValue: highlight },
        {
          provide: NgDiagramModelService,
          useValue: {
            getEdgeById: vi.fn((edgeId: string) =>
              modelEdges.find((candidate) => candidate.id === edgeId),
            ),
            getModel: vi.fn(() => ({
              getNodes: () => modelNodes,
              getEdges: () => modelEdges,
              beginHistoryGroup,
              endHistoryGroup,
            })),
            nodes: vi.fn(() => modelNodes),
            updateEdge,
          },
        },
        {
          provide: NgDiagramViewportService,
          useValue: {
            clientToFlowPosition: vi.fn(({ x, y }: Point) => ({ x, y })),
          },
        },
        { provide: NgDiagramService, useValue: { config: vi.fn(() => undefined) } },
      ],
    });
  });

  it('previews a dangling endpoint, highlights the port, then commits one partial relink patch', async () => {
    const handler = TestBed.inject(RelinkEndpointHandler);
    const route = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 80, y: 40 },
    ];

    handler.onEndpointStart('wire-1', 'target', route, 9);
    handler.onEndpointContinue(201, 40, 9);

    expect(highlight.set).toHaveBeenCalledWith('new-target', 'in');
    await vi.waitFor(() => {
      expect(updateEdge).toHaveBeenNthCalledWith(
        1,
        'wire-1',
        expect.objectContaining({
          target: '',
          targetPort: undefined,
          targetPosition: { x: 200, y: 40 },
          routingMode: 'manual',
        }),
      );
    });

    await handler.onEndpointEnd(201, 40, 9);

    const committedPatch = updateEdge.mock.calls[1][1];
    expect(committedPatch).toEqual({
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 40 },
        { x: 200, y: 40 },
      ],
      routingMode: 'manual',
      target: 'new-target',
      targetPort: 'in',
      targetPosition: undefined,
    });
    expect(committedPatch).not.toHaveProperty('data');
    expect(committedPatch).not.toHaveProperty('source');
    expect(route[1]).toEqual({ x: 100, y: 0 });
    expect(highlight.clear).toHaveBeenCalled();
  });

  it('leaves the end dangling when relink would bridge incompatible copper', async () => {
    const board = (id: string, x: number, traceId: string, net: string): Node<BoardNodeData> => ({
      id,
      type: NodeTemplateType.BoardNode,
      position: { x, y: 0 },
      data: {
        type: 'board',
        boardId: id,
        label: id,
        rows: 1,
        cols: 1,
        pitch: 20,
        traces: [
          {
            id: traceId,
            label: traceId,
            net,
            segments: [{ from: { row: 0, col: 0 }, to: { row: 0, col: 0 } }],
          },
        ],
      },
      measuredPorts: [
        {
          id: 'hole:0:0',
          nodeId: id,
          type: 'both',
          side: 'left',
          position: { x: 0, y: 0 },
          size: { width: 10, height: 10 },
        },
      ],
    });
    const source = board('power-board', 0, 'vcc', 'VCC');
    const target = board('ground-board', 200, 'gnd', 'GND');
    const physicalEdge: Edge = {
      id: 'wire-physical',
      source: source.id,
      sourcePort: 'hole:0:0',
      target: '',
      targetPosition: { x: 100, y: 5 },
      routingMode: 'manual',
      points: [
        { x: 5, y: 5 },
        { x: 100, y: 5 },
      ],
      data: {},
    };
    modelNodes = [source, target];
    modelEdges = [physicalEdge];
    const handler = TestBed.inject(RelinkEndpointHandler);

    handler.onEndpointStart(physicalEdge.id, 'target', physicalEdge.points ?? [], 11);
    handler.onEndpointContinue(205, 5, 11);
    await handler.onEndpointEnd(205, 5, 11);

    expect(updateEdge).toHaveBeenCalledTimes(2);
    for (const [, patch] of updateEdge.mock.calls) {
      expect(patch.target).toBe('');
      expect(patch).not.toHaveProperty('data');
    }
  });

  it('leaves the end dangling when two board ports resolve to the same copper junction', async () => {
    const board: Node<BoardNodeData> = {
      id: 'shared-copper-board',
      type: NodeTemplateType.BoardNode,
      position: { x: 0, y: 0 },
      data: {
        type: 'board',
        boardId: 'shared-copper-board',
        label: 'Shared copper board',
        rows: 1,
        cols: 2,
        pitch: 20,
        traces: [
          {
            id: 'rail',
            label: 'Rail',
            segments: [{ from: { row: 0, col: 0 }, to: { row: 0, col: 1 } }],
          },
        ],
      },
      measuredPorts: [
        {
          id: 'hole:0:0',
          nodeId: 'shared-copper-board',
          type: 'both',
          side: 'left',
          position: { x: 0, y: 0 },
          size: { width: 10, height: 10 },
        },
        {
          id: 'hole:0:1',
          nodeId: 'shared-copper-board',
          type: 'both',
          side: 'left',
          position: { x: 200, y: 0 },
          size: { width: 10, height: 10 },
        },
      ],
    };
    const physicalEdge: Edge = {
      id: 'wire-same-copper',
      source: board.id,
      sourcePort: 'hole:0:0',
      target: '',
      targetPosition: { x: 100, y: 5 },
      routingMode: 'manual',
      points: [
        { x: 5, y: 5 },
        { x: 100, y: 5 },
      ],
      data: {},
    };
    modelNodes = [board];
    modelEdges = [physicalEdge];
    const handler = TestBed.inject(RelinkEndpointHandler);

    handler.onEndpointStart(physicalEdge.id, 'target', physicalEdge.points ?? [], 12);
    await handler.onEndpointEnd(205, 5, 12);

    expect(updateEdge).toHaveBeenCalledOnce();
    expect(updateEdge).toHaveBeenCalledWith(
      physicalEdge.id,
      expect.objectContaining({
        target: '',
        targetPort: undefined,
      }),
    );
  });

  it('restores a jumper endpoint when it is dropped outside its owner breadboard', async () => {
    const board: Node<BoardNodeData> = {
      id: 'board-node-instance',
      type: NodeTemplateType.BoardNode,
      position: { x: 0, y: 0 },
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
    const external: Node = {
      id: 'external',
      position: { x: 200, y: 0 },
      measuredPorts: [
        {
          id: 'in',
          nodeId: 'external',
          type: 'both',
          side: 'left',
          position: { x: 0, y: 10 },
          size: { width: 10, height: 20 },
        },
      ],
      data: {},
    };
    const jumper: Edge = {
      id: 'jumper',
      source: board.id,
      sourcePort: 'hole:0:0',
      target: board.id,
      targetPort: 'hole:1:2',
      routingMode: 'manual',
      points: [
        { x: 16, y: 16 },
        { x: 56, y: 16 },
        { x: 56, y: 36 },
      ],
      data: { type: 'wire', wireId: 'W1', jumperBoardId: board.data.boardId },
    };
    modelNodes = [board, external];
    modelEdges = [jumper];
    const handler = TestBed.inject(RelinkEndpointHandler);

    handler.onEndpointStart(jumper.id, 'target', jumper.points ?? [], 15);
    handler.onEndpointContinue(201, 20, 15);
    await handler.onEndpointEnd(201, 20, 15);

    expect(updateEdge).toHaveBeenLastCalledWith(jumper.id, {
      points: jumper.points,
      routingMode: 'manual',
      target: board.id,
      targetPort: 'hole:1:2',
      targetPosition: undefined,
    });
    expect(highlight.set).not.toHaveBeenCalledWith('external', 'in');
  });

  it('relinks a jumper within its owner without orthogonalizing its free bends', async () => {
    const board: Node<BoardNodeData> = {
      id: 'board-node-instance',
      type: NodeTemplateType.BoardNode,
      position: { x: 0, y: 0 },
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
          position: { x: 9, y: 9 },
          size: { width: 14, height: 14 },
        },
        {
          id: 'hole:1:2',
          nodeId: 'board-node-instance',
          type: 'both',
          side: 'left',
          position: { x: 49, y: 29 },
          size: { width: 14, height: 14 },
        },
        {
          id: 'hole:2:3',
          nodeId: 'board-node-instance',
          type: 'both',
          side: 'left',
          position: { x: 76, y: 49 },
          size: { width: 14, height: 14 },
        },
      ],
    };
    const jumper: Edge = {
      id: 'jumper-free-route',
      source: board.id,
      sourcePort: 'hole:0:0',
      target: board.id,
      targetPort: 'hole:1:2',
      routing: 'polyline',
      routingMode: 'manual',
      points: [
        { x: 16, y: 16 },
        { x: 30, y: 75 },
        { x: 51, y: 23 },
        { x: 56, y: 36 },
      ],
      data: { type: 'wire', wireId: 'W1', jumperBoardId: board.data.boardId },
    };
    modelNodes = [board];
    modelEdges = [jumper];
    const handler = TestBed.inject(RelinkEndpointHandler);

    handler.onEndpointStart(jumper.id, 'target', jumper.points ?? [], 16);
    await handler.onEndpointEnd(76, 56, 16);

    expect(updateEdge).toHaveBeenLastCalledWith(jumper.id, {
      points: [
        { x: 16, y: 16 },
        { x: 30, y: 75 },
        { x: 51, y: 23 },
        { x: 76, y: 56 },
      ],
      routingMode: 'manual',
      target: board.id,
      targetPort: 'hole:2:3',
      targetPosition: undefined,
    });
    expect(beginHistoryGroup).toHaveBeenCalledOnce();
    expect(endHistoryGroup).toHaveBeenCalledOnce();
  });
});

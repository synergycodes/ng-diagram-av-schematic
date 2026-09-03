import { TestBed } from '@angular/core/testing';
import {
  NgDiagramModelService,
  NgDiagramService,
  type Edge,
  type ModelAdapter,
  type Node,
} from 'ng-diagram';
import { describe, expect, it, vi } from 'vitest';
import { BoardJumperCreationService } from './board-jumper-creation.service';
import { NodeTemplateType, type BoardNodeData, type WireEdgeData } from './model/interfaces';
import { MAX_VISUAL_PLANE } from './model/visual-planes';
import { UndoableDiagramModelAdapter } from './model/undoable-model';

describe('BoardJumperCreationService', () => {
  it('creates one straight jumper above its owner in one history group', async () => {
    const board: Node<BoardNodeData> = {
      id: 'board-node-instance',
      type: NodeTemplateType.BoardNode,
      position: { x: 100, y: 200 },
      data: {
        type: 'board',
        boardId: 'breadboard-domain',
        label: 'Protoboard',
        surface: 'breadboard',
        rows: 4,
        cols: 5,
        pitch: 20,
        visualPlane: MAX_VISUAL_PLANE,
      },
    };
    let delegateNodes: Node[] = [board];
    let delegateEdges: Edge[] = [];
    const delegate = {
      destroy: () => undefined,
      getNodes: () => delegateNodes,
      getEdges: () => delegateEdges,
      updateNodes: (value: Node[] | ((nodes: Node[]) => Node[])) => {
        delegateNodes = typeof value === 'function' ? value(delegateNodes) : value;
      },
      updateEdges: (value: Edge[] | ((edges: Edge[]) => Edge[])) => {
        delegateEdges = typeof value === 'function' ? value(delegateEdges) : value;
      },
      getMetadata: () => ({ viewport: { x: 0, y: 0, scale: 1 } }),
      updateMetadata: () => undefined,
      onChange: () => undefined,
      unregisterOnChange: () => undefined,
      undo: () => undefined,
      redo: () => undefined,
      toJSON: () => '{}',
    } satisfies ModelAdapter;
    const model = new UndoableDiagramModelAdapter(delegate);
    const beginHistoryGroup = vi.spyOn(model, 'beginHistoryGroup');
    const endHistoryGroup = vi.spyOn(model, 'endHistoryGroup');
    const updateNodes = vi.fn((updates: (Pick<Node, 'id'> & Partial<Node>)[]) => {
      model.updateNodes((nodes) =>
        nodes.map((node) => {
          const update = updates.find((candidate) => candidate.id === node.id);
          return update ? { ...node, ...update } : node;
        }),
      );
    });
    const updateEdges = vi.fn((updates: (Pick<Edge, 'id'> & Partial<Edge>)[]) => {
      model.updateEdges((edges) =>
        edges.map((edge) => {
          const update = updates.find((candidate) => candidate.id === edge.id);
          return update ? { ...edge, ...update } : edge;
        }),
      );
    });
    const addEdges = vi.fn((created: Edge[]) => {
      model.updateEdges((edges) => [...edges, ...created]);
    });
    TestBed.configureTestingModule({
      providers: [
        BoardJumperCreationService,
        {
          provide: NgDiagramModelService,
          useValue: {
            getModel: () => model,
            addEdges,
            updateNodes,
            updateEdges,
          },
        },
        {
          provide: NgDiagramService,
          useValue: {
            transaction: (callback: () => void) => {
              callback();
              return Promise.resolve();
            },
          },
        },
      ],
    });
    const creation = TestBed.inject(BoardJumperCreationService);

    creation.toggle(board);
    expect(creation.selectHole(board, { row: 0, col: 0 })).toBe(true);
    expect(creation.isStart(board.data.boardId, { row: 0, col: 0 })).toBe(true);
    expect(creation.selectHole(board, { row: 2, col: 3 })).toBe(true);

    await vi.waitFor(() => {
      expect(endHistoryGroup).toHaveBeenCalledOnce();
    });

    const nodes = model.getNodes();
    const edges = model.getEdges();
    expect(addEdges).toHaveBeenCalledOnce();
    expect(edges[0]).toMatchObject({
      source: board.id,
      sourcePort: 'hole:0:0',
      target: board.id,
      targetPort: 'hole:2:3',
      routing: 'polyline',
      routingMode: 'manual',
      points: [
        { x: 116, y: 216 },
        { x: 176, y: 256 },
      ],
      data: {
        visualPlane: MAX_VISUAL_PLANE,
        wireType: 'jumper',
        jumperBoardId: board.data.boardId,
      },
    });
    const owner = nodes[0];
    const ownerPlane = (owner.data as BoardNodeData).visualPlane;
    const jumperPlane = (edges[0].data as WireEdgeData).visualPlane;
    expect(ownerPlane).toBe(MAX_VISUAL_PLANE - 1);
    expect(jumperPlane).toBeGreaterThan(ownerPlane ?? MAX_VISUAL_PLANE);
    expect(edges[0].zOrder).toBeGreaterThan(owner.zOrder ?? -1);
    expect(beginHistoryGroup).toHaveBeenCalledOnce();
    expect(endHistoryGroup).toHaveBeenCalledOnce();
    expect(creation.activeBoardId()).toBeNull();

    model.undo();
    expect(model.getEdges()).toEqual([]);
    expect((model.getNodes()[0].data as BoardNodeData).visualPlane).toBe(MAX_VISUAL_PLANE);
  });

  it('aborts creation when the selected holes belong to conflicting copper nets', () => {
    const board: Node<BoardNodeData> = {
      id: 'conflicting-board-node',
      type: NodeTemplateType.BoardNode,
      position: { x: 0, y: 0 },
      data: {
        type: 'board',
        boardId: 'conflicting-board',
        label: 'Conflicting',
        surface: 'breadboard',
        rows: 1,
        cols: 2,
        pitch: 20,
        traces: [
          {
            id: 'net-a',
            label: 'A',
            net: 'A',
            segments: [{ from: { row: 0, col: 0 }, to: { row: 0, col: 0 } }],
          },
          {
            id: 'net-b',
            label: 'B',
            net: 'B',
            segments: [{ from: { row: 0, col: 1 }, to: { row: 0, col: 1 } }],
          },
        ],
      },
    };
    const addEdges = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        BoardJumperCreationService,
        {
          provide: NgDiagramModelService,
          useValue: { getModel: () => ({ getNodes: () => [board], getEdges: () => [] }), addEdges },
        },
        { provide: NgDiagramService, useValue: { transaction: vi.fn() } },
      ],
    });
    const creation = TestBed.inject(BoardJumperCreationService);

    creation.toggle(board);
    expect(creation.selectHole(board, { row: 0, col: 0 })).toBe(true);
    expect(creation.selectHole(board, { row: 0, col: 1 })).toBe(true);

    expect(addEdges).not.toHaveBeenCalled();
    expect(creation.activeBoardId()).toBe(board.data.boardId);
    expect(creation.isStart(board.data.boardId, { row: 0, col: 0 })).toBe(false);
    expect(creation.status()).toContain('Conflito entre nets');
  });

  it('aborts same-copper and cross-board selections with accessible status', () => {
    const sameCopper: Node<BoardNodeData> = {
      id: 'same-copper-node',
      type: NodeTemplateType.BoardNode,
      position: { x: 0, y: 0 },
      data: {
        type: 'board',
        boardId: 'same-copper',
        label: 'Copper',
        surface: 'breadboard',
        rows: 1,
        cols: 2,
        pitch: 20,
        traces: [
          {
            id: 'trace',
            label: 'GND',
            net: 'GND',
            segments: [{ from: { row: 0, col: 0 }, to: { row: 0, col: 1 } }],
          },
        ],
      },
    };
    const other: Node<BoardNodeData> = {
      ...sameCopper,
      id: 'other-node',
      data: { ...sameCopper.data, boardId: 'other' },
    };
    const addEdges = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        BoardJumperCreationService,
        {
          provide: NgDiagramModelService,
          useValue: {
            getModel: () => ({ getNodes: () => [sameCopper, other], getEdges: () => [] }),
            addEdges,
          },
        },
        { provide: NgDiagramService, useValue: { transaction: vi.fn() } },
      ],
    });
    const creation = TestBed.inject(BoardJumperCreationService);
    creation.toggle(sameCopper);
    creation.selectHole(sameCopper, { row: 0, col: 0 });
    creation.selectHole(sameCopper, { row: 0, col: 1 });
    expect(addEdges).not.toHaveBeenCalled();
    expect(creation.status()).toContain('mesmo grupo de cobre');
    creation.selectHole(sameCopper, { row: 0, col: 0 });
    creation.selectHole(sameCopper, { row: 0, col: 0 });
    expect(creation.status()).toContain('furos de origem');
    creation.selectHole(sameCopper, { row: 0, col: 0 });
    creation.selectHole(other, { row: 0, col: 0 });
    expect(creation.status()).toContain('Owner inválido');
    creation.cancel();
    expect(creation.activeBoardId()).toBeNull();
    expect(creation.status()).toBeNull();
  });
});

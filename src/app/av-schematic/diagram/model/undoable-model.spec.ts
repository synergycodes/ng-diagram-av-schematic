import {
  type Edge,
  type Metadata,
  type ModelAdapter,
  type ModelChanges,
  type Node,
} from 'ng-diagram';
import { describe, expect, it } from 'vitest';
import { UndoableDiagramModelAdapter } from './undoable-model';

class DelegateStub implements ModelAdapter {
  constructor(
    private nodes: Node[],
    private edges: Edge[],
    private metadata: Metadata = { viewport: { x: 0, y: 0, scale: 1 } },
  ) {}

  private readonly callbacks: ((changes: ModelChanges) => void)[] = [];

  destroy(): void {
    this.callbacks.length = 0;
  }
  getNodes(): Node[] {
    return this.nodes;
  }
  getEdges(): Edge[] {
    return this.edges;
  }
  updateNodes(value: Node[] | ((nodes: Node[]) => Node[])): void {
    this.nodes = typeof value === 'function' ? value(this.nodes) : value;
    this.emit();
  }
  updateEdges(value: Edge[] | ((edges: Edge[]) => Edge[])): void {
    this.edges = typeof value === 'function' ? value(this.edges) : value;
    this.emit();
  }
  getMetadata(): Metadata {
    return this.metadata;
  }
  updateMetadata(value: Metadata | ((metadata: Metadata) => Metadata)): void {
    this.metadata = typeof value === 'function' ? value(this.metadata) : value;
    this.emit();
  }
  onChange(callback: (changes: ModelChanges) => void): void {
    this.callbacks.push(callback);
  }
  unregisterOnChange(callback: (changes: ModelChanges) => void): void {
    const index = this.callbacks.indexOf(callback);
    if (index >= 0) this.callbacks.splice(index, 1);
  }
  undo(): void {
    throw new Error('delegate undo must not be called');
  }
  redo(): void {
    throw new Error('delegate redo must not be called');
  }
  toJSON(): string {
    return JSON.stringify({ nodes: this.nodes, edges: this.edges, metadata: this.metadata });
  }
  private emit(): void {
    const changes = { nodes: this.nodes, edges: this.edges, metadata: this.metadata };
    for (const callback of this.callbacks) callback(changes);
  }
}

const board: Node = {
  id: 'board-node-instance',
  position: { x: 100, y: 200 },
  data: {
    type: 'board',
    boardId: 'breadboard-domain',
    label: 'Protoboard',
    surface: 'breadboard',
    rows: 3,
    cols: 4,
    pitch: 20,
  },
};

const jumper: Edge = {
  id: 'jumper',
  source: board.id,
  sourcePort: 'hole:0:0',
  target: board.id,
  targetPort: 'hole:1:2',
  routingMode: 'manual',
  points: [
    { x: 116, y: 216 },
    { x: 156, y: 216 },
    { x: 156, y: 236 },
  ],
  data: {
    type: 'wire',
    wireId: 'W1',
    jumperBoardId: 'breadboard-domain',
    color: '#ff0000',
    netName: 'SIGNAL',
  },
};

describe('UndoableDiagramModelAdapter', () => {
  it('moves a board and every owned jumper point as one undoable change', () => {
    const model = new UndoableDiagramModelAdapter(new DelegateStub([board], [jumper]));

    model.updateNodes((nodes) =>
      nodes.map((node) =>
        node.id === board.id ? { ...node, position: { x: 130, y: 180 } } : node,
      ),
    );

    expect(model.getNodes()[0].position).toEqual({ x: 130, y: 180 });
    expect(model.getEdges()[0]).toMatchObject({
      points: [
        { x: 146, y: 196 },
        { x: 186, y: 196 },
        { x: 186, y: 216 },
      ],
      data: {
        jumperBoardId: 'breadboard-domain',
        color: '#ff0000',
        netName: 'SIGNAL',
      },
    });

    model.undo();
    expect(model.getNodes()[0].position).toEqual({ x: 100, y: 200 });
    expect(model.getEdges()[0]).toEqual(jumper);

    model.redo();
    expect(model.getNodes()[0].position).toEqual({ x: 130, y: 180 });
    expect(model.getEdges()[0].points).toEqual([
      { x: 146, y: 196 },
      { x: 186, y: 196 },
      { x: 186, y: 216 },
    ]);
  });

  it('undoes and redoes jumper creation without losing its domain data', () => {
    const model = new UndoableDiagramModelAdapter(new DelegateStub([board], []));

    model.updateEdges([jumper]);
    expect(model.getEdges()[0]).toEqual(jumper);

    model.undo();
    expect(model.getEdges()).toEqual([]);

    model.redo();
    expect(model.getEdges()[0]).toEqual(jumper);
  });

  it('collapses every intermediate frame of one drag into a single undo entry', () => {
    const model = new UndoableDiagramModelAdapter(new DelegateStub([board], [jumper]));

    model.beginHistoryGroup();
    model.updateNodes((nodes) =>
      nodes.map((node) =>
        node.id === board.id ? { ...node, position: { x: 110, y: 205 } } : node,
      ),
    );
    model.updateNodes((nodes) =>
      nodes.map((node) =>
        node.id === board.id ? { ...node, position: { x: 130, y: 180 } } : node,
      ),
    );
    model.endHistoryGroup();

    model.undo();
    expect(model.getNodes()[0].position).toEqual({ x: 100, y: 200 });
    expect(model.getEdges()[0]).toEqual(jumper);

    model.redo();
    expect(model.getNodes()[0].position).toEqual({ x: 130, y: 180 });
    expect(model.getEdges()[0].points?.[0]).toEqual({ x: 146, y: 196 });

    model.undo();
    expect(model.getNodes()[0].position).toEqual({ x: 100, y: 200 });
  });

  it('does not move a jumper when another node changes position', () => {
    const external: Node = { id: 'external', position: { x: 0, y: 0 }, data: {} };
    const model = new UndoableDiagramModelAdapter(new DelegateStub([board, external], [jumper]));

    model.updateNodes((nodes) =>
      nodes.map((node) =>
        node.id === external.id ? { ...node, position: { x: 50, y: 50 } } : node,
      ),
    );

    expect(model.getEdges()[0]).toEqual(jumper);
  });

  it('does not create an undo entry for edge selection changes', () => {
    const model = new UndoableDiagramModelAdapter(new DelegateStub([board], [jumper]));

    model.updateEdges((edges) => edges.map((edge) => ({ ...edge, selected: true })));
    model.undo();

    expect(model.getEdges()[0].selected).toBe(true);
  });

  it('restores sanitized snapshots without runtime selection or measurements', () => {
    const model = new UndoableDiagramModelAdapter(new DelegateStub([board], [jumper]));

    model.updateNodes([
      {
        ...board,
        selected: true,
        measuredPorts: [],
        measuredBounds: { x: 0, y: 0, width: 1, height: 1 },
      },
    ]);
    model.updateNodes((nodes) => nodes.map((node) => ({ ...node, position: { x: 140, y: 190 } })));
    model.undo();

    const restored = model.getNodes()[0];
    expect(restored.position).toEqual(board.position);
    expect(restored).not.toHaveProperty('selected');
    expect(restored).not.toHaveProperty('measuredPorts');
    expect(restored).not.toHaveProperty('measuredBounds');
  });

  it('coalesces stale node and edge updates from one FlowCore batch and preserves jumper translation', () => {
    const model = new UndoableDiagramModelAdapter(new DelegateStub([board], [jumper]));
    const nextBoard = { ...board, position: { x: 130, y: 180 } };
    const staleEdges = [jumper];

    model.updateNodes([nextBoard]);
    model.updateEdges(staleEdges);

    expect(model.getEdges()[0].points).toEqual([
      { x: 146, y: 196 },
      { x: 186, y: 196 },
      { x: 186, y: 216 },
    ]);
    model.undo();
    expect(model.getNodes()).toEqual([board]);
    expect(model.getEdges()).toEqual([jumper]);
  });

  it('does not double-translate a functional edge update after board movement', () => {
    const model = new UndoableDiagramModelAdapter(new DelegateStub([board], [jumper]));
    model.updateNodes([{ ...board, position: { x: 130, y: 180 } }]);
    model.updateEdges((edges) => edges.map((edge) => ({ ...edge, selected: true })));
    expect(model.getEdges()[0].points?.[0]).toEqual({ x: 146, y: 196 });
  });

  it('does not double-translate when FlowCore passes the current edge array back', () => {
    const model = new UndoableDiagramModelAdapter(new DelegateStub([board], [jumper]));
    model.updateNodes([{ ...board, position: { x: 130, y: 180 } }]);
    model.updateEdges((current) => current);
    expect(model.getEdges()[0].points?.[0]).toEqual({ x: 146, y: 196 });
  });
});

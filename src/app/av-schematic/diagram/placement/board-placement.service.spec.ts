import { TestBed } from '@angular/core/testing';
import { NgDiagramModelService, type Edge, type Node } from 'ng-diagram';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DETACHED_FOOTPRINT_FALLBACK_PITCH,
  FOOTPRINT_PADDING_CELLS,
  footprintNodeSize,
  placementNodePosition,
  syncPortHolesToPlacement,
} from '../model/footprint-geometry';
import { type Footprint } from '../model/footprint';
import { rowTrace } from '../model/board-trace';
import {
  EdgeTemplateType,
  NodeTemplateType,
  type BoardNodeData,
  type DeviceNodeData,
  type WireEdgeData,
} from '../model/interfaces';
import { BoardPlacementService } from './board-placement.service';

const footprint: Footprint = {
  id: 'link',
  label: 'Link',
  rows: 1,
  cols: 2,
  pins: [
    { id: 'a', label: 'A', cell: { row: 0, col: 0 } },
    { id: 'b', label: 'B', cell: { row: 0, col: 1 } },
  ],
  bodyCells: [
    { row: 0, col: 0 },
    { row: 0, col: 1 },
  ],
  shapes: [],
};

function board(position = { x: 0, y: 0 }): Node<BoardNodeData> {
  return {
    id: 'board',
    type: NodeTemplateType.BoardNode,
    position,
    data: { type: 'board', boardId: 'board', label: 'Board', rows: 4, cols: 5, pitch: 17 },
  };
}

function device(id: string, position: { x: number; y: number }): Node<DeviceNodeData> {
  return {
    id,
    type: NodeTemplateType.DeviceNode,
    position,
    data: {
      type: 'device',
      deviceId: id,
      manufacturer: '',
      model: 'Link',
      footprintId: footprint.id,
      footprint,
      ports: [
        { id: 'a', label: 'A', direction: 'input' },
        { id: 'b', label: 'B', direction: 'output' },
      ],
    },
  };
}

class ModelStub {
  nodes: Node[] = [];
  edges: Edge[] = [];

  readonly getModel = vi.fn(() => ({
    getNodes: () => this.nodes,
    getEdges: () => this.edges,
  }));
  readonly getNodeById = vi.fn((id: string) => this.nodes.find((node) => node.id === id));
  readonly getConnectedEdges = vi.fn((id: string) =>
    this.edges.filter((edge) => edge.source === id || edge.target === id),
  );
  readonly updateNode = vi.fn((id: string, patch: Partial<Node>) => {
    const index = this.nodes.findIndex((node) => node.id === id);
    if (index >= 0) this.nodes[index] = { ...this.nodes[index], ...patch };
    return Promise.resolve();
  });
  readonly updateEdges = vi.fn((patches: readonly ({ id: string } & Partial<Edge>)[]) => {
    for (const patch of patches) {
      const index = this.edges.findIndex((edge) => edge.id === patch.id);
      if (index >= 0) this.edges[index] = { ...this.edges[index], ...patch };
    }
    return Promise.resolve();
  });
}

describe('BoardPlacementService', () => {
  let model: ModelStub;
  let service: BoardPlacementService;

  beforeEach(() => {
    model = new ModelStub();
    TestBed.configureTestingModule({
      providers: [BoardPlacementService, { provide: NgDiagramModelService, useValue: model }],
    });
    service = TestBed.inject(BoardPlacementService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('snaps a dropped footprint and derives its pin holes', async () => {
    const boardNode = board();
    const placement = { boardId: 'board', anchor: { row: 1, col: 1 }, rotation: 0 as const };
    const part = device(
      'part',
      placementNodePosition({ board: boardNode.data, position: boardNode.position }, placement),
    );
    model.nodes = [boardNode, part];

    await service.settleDrag(new Set(['part']));

    const seated = model.nodes.find((node) => node.id === 'part') as Node<DeviceNodeData>;
    expect(seated.type).toBe(NodeTemplateType.FootprintNode);
    expect(seated.data.placement).toEqual(placement);
    expect(seated.data.ports.map((port) => port.hole)).toEqual([
      { row: 1, col: 1 },
      { row: 1, col: 2 },
    ]);
  });

  it('rejects a silently overlapping placement and exposes the blocker', async () => {
    const boardNode = board();
    const placement = { boardId: 'board', anchor: { row: 1, col: 1 }, rotation: 0 as const };
    const fixed = device('fixed', { x: 0, y: 0 });
    fixed.type = NodeTemplateType.FootprintNode;
    fixed.data = syncPortHolesToPlacement({ ...fixed.data, boardId: 'board', placement });
    fixed.position = placementNodePosition(
      { board: boardNode.data, position: boardNode.position },
      placement,
    );
    const moving = device('moving', { ...fixed.position });
    model.nodes = [boardNode, fixed, moving];

    await service.settleDrag(new Set(['moving']));

    expect(service.conflict()).toMatchObject({ kind: 'occupied', blockedBy: ['fixed'] });
    expect(model.nodes.find((node) => node.id === 'moving')?.type).toBe(
      NodeTemplateType.DeviceNode,
    );
  });

  it('recomputes seated positions when the board moves', async () => {
    const boardNode = board({ x: 100, y: 80 });
    const placement = { boardId: 'board', anchor: { row: 2, col: 2 }, rotation: 0 as const };
    const part = device('part', { x: 0, y: 0 });
    part.type = NodeTemplateType.FootprintNode;
    part.data = syncPortHolesToPlacement({ ...part.data, boardId: 'board', placement });
    model.nodes = [boardNode, part];

    const affected = await service.settleDrag(new Set(['board']));

    expect(affected.has('part')).toBe(true);
    expect(model.nodes.find((node) => node.id === 'part')?.position).toEqual(
      placementNodePosition({ board: boardNode.data, position: boardNode.position }, placement),
    );
  });

  it('unseats a footprint without changing its renderer, geometry or wire', async () => {
    const boardNode = board();
    const placement = { boardId: 'board', anchor: { row: 1, col: 1 }, rotation: 90 as const };
    const part = device('part', { x: 999, y: 999 });
    part.type = NodeTemplateType.FootprintNode;
    part.data = syncPortHolesToPlacement({ ...part.data, boardId: 'board', placement });
    const external = device('external', { x: 700, y: 0 });
    external.data = { ...external.data, footprintId: undefined, footprint: undefined };
    const wire: Edge<WireEdgeData> = {
      id: 'wire',
      type: EdgeTemplateType.WireEdge,
      source: part.id,
      sourcePort: 'a',
      target: external.id,
      targetPort: 'a',
      routingMode: 'manual',
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ],
      data: {
        type: 'wire',
        wireId: 'W1',
        netId: 'imported-id',
        netName: 'AUTHORED',
      },
    };
    model.nodes = [boardNode, part, external];
    model.edges = [wire];

    await service.settleDrag(new Set(['part']));

    const unseated = model.nodes.find((node) => node.id === 'part') as Node<DeviceNodeData>;
    expect(unseated.type).toBe(NodeTemplateType.FootprintNode);
    expect(unseated.data.placement).toBeUndefined();
    expect(unseated.data.boardId).toBeUndefined();
    expect(unseated.data.footprintRotation).toBe(90);
    expect(unseated.data.footprintPitch).toBe(boardNode.data.pitch);
    expect(
      footprintNodeSize(
        footprint,
        unseated.data.footprintRotation ?? 0,
        unseated.data.footprintPitch ?? DETACHED_FOOTPRINT_FALLBACK_PITCH,
      ),
    ).toEqual(footprintNodeSize(footprint, placement.rotation, boardNode.data.pitch));
    expect(unseated.data.ports.every((port) => port.hole === undefined)).toBe(true);
    expect(model.edges[0]).toEqual(wire);
  });

  it('reseats an unseated footprint with its preserved rotation', async () => {
    const boardNode = board();
    const part = device('part', { x: 999, y: 999 });
    part.type = NodeTemplateType.FootprintNode;
    part.data = {
      ...part.data,
      footprintRotation: 90,
      footprintPitch: boardNode.data.pitch,
    };
    model.nodes = [boardNode, part];

    part.position = placementNodePosition(
      { board: boardNode.data, position: boardNode.position },
      { anchor: { row: 1, col: 1 }, rotation: 90 },
    );
    await service.settleDrag(new Set(['part']));

    const reseated = model.nodes.find((node) => node.id === 'part') as Node<DeviceNodeData>;
    expect(reseated.type).toBe(NodeTemplateType.FootprintNode);
    expect(reseated.data.placement).toEqual({
      boardId: boardNode.id,
      anchor: { row: 1, col: 1 },
      rotation: 90,
    });
  });

  it('uses the detached visual anchor when reseating on a different pitch', async () => {
    const boardNode = board();
    const detachedPitch = 40;
    const expectedPlacement = {
      boardId: boardNode.data.boardId,
      anchor: { row: 1, col: 1 },
      rotation: 0 as const,
    };
    const seatedPosition = placementNodePosition(
      { board: boardNode.data, position: boardNode.position },
      expectedPlacement,
    );
    const part = device('part', {
      x:
        seatedPosition.x +
        FOOTPRINT_PADDING_CELLS * boardNode.data.pitch -
        FOOTPRINT_PADDING_CELLS * detachedPitch,
      y:
        seatedPosition.y +
        FOOTPRINT_PADDING_CELLS * boardNode.data.pitch -
        FOOTPRINT_PADDING_CELLS * detachedPitch,
    });
    part.type = NodeTemplateType.FootprintNode;
    part.data = {
      ...part.data,
      footprintRotation: 0,
      footprintPitch: detachedPitch,
    };
    model.nodes = [boardNode, part];

    await service.settleDrag(new Set(['part']));

    const reseated = model.nodes.find((node) => node.id === 'part') as Node<DeviceNodeData>;
    expect(reseated.data.placement).toEqual(expectedPlacement);
  });

  it('rotates a detached footprint and preserves its detached state', async () => {
    const part = device('part', { x: 999, y: 999 });
    part.type = NodeTemplateType.FootprintNode;
    part.data = {
      ...part.data,
      footprintRotation: 90,
      footprintPitch: 17,
    };
    model.nodes = [part];

    expect(await service.rotate('part', 1)).toBe(true);

    const rotated = model.nodes.find((node) => node.id === 'part') as Node<DeviceNodeData>;
    expect(rotated.data.placement).toBeUndefined();
    expect(rotated.data.footprintRotation).toBe(180);
    expect(rotated.data.footprintPitch).toBe(17);
  });

  it('keeps a second detached drag outside boards conflict-free', async () => {
    const part = device('part', { x: 999, y: 999 });
    part.type = NodeTemplateType.FootprintNode;
    part.data = {
      ...part.data,
      footprintRotation: 90,
      footprintPitch: 17,
    };
    model.nodes = [part];

    await service.settleDrag(new Set(['part']));

    expect(service.conflict()).toBeNull();
  });

  it('keeps a legacy detached footprint second drag outside boards conflict-free', async () => {
    const part = device('part', { x: 999, y: 999 });
    part.type = NodeTemplateType.FootprintNode;
    model.nodes = [part];

    await service.settleDrag(new Set(['part']));

    expect(service.conflict()).toBeNull();
  });

  it('uses the legacy visual anchor when reseating on a high-pitch board', async () => {
    const boardNode = board();
    boardNode.data = { ...boardNode.data, pitch: 60 };
    const expectedPlacement = {
      boardId: boardNode.data.boardId,
      anchor: { row: 1, col: 1 },
      rotation: 0 as const,
    };
    const seatedPosition = placementNodePosition(
      { board: boardNode.data, position: boardNode.position },
      expectedPlacement,
    );
    const part = device('part', {
      x:
        seatedPosition.x +
        FOOTPRINT_PADDING_CELLS * boardNode.data.pitch -
        FOOTPRINT_PADDING_CELLS * DETACHED_FOOTPRINT_FALLBACK_PITCH,
      y:
        seatedPosition.y +
        FOOTPRINT_PADDING_CELLS * boardNode.data.pitch -
        FOOTPRINT_PADDING_CELLS * DETACHED_FOOTPRINT_FALLBACK_PITCH,
    });
    part.type = NodeTemplateType.FootprintNode;
    model.nodes = [boardNode, part];

    await service.settleDrag(new Set(['part']));

    const reseated = model.nodes.find((node) => node.id === 'part') as Node<DeviceNodeData>;
    expect(reseated.data.placement).toEqual(expectedPlacement);
  });

  it('leaves a generic component on the generic renderer', async () => {
    const generic = device('generic', { x: 999, y: 999 });
    generic.data = { ...generic.data, footprintId: undefined, footprint: undefined };
    model.nodes = [generic];

    await service.settleDrag(new Set(['generic']));

    expect(model.nodes[0]?.type).toBe(NodeTemplateType.DeviceNode);
    expect(model.nodes[0]?.data).not.toHaveProperty('footprintRotation');
    expect(model.nodes[0]?.data).not.toHaveProperty('footprintPitch');
  });

  it('reports a new footprint dropped outside every board', async () => {
    const part = device('part', { x: 999, y: 999 });
    model.nodes = [part];

    await service.settleDrag(new Set(['part']));

    expect(service.conflict()).toEqual({
      kind: 'unknown-board',
      nodeId: 'part',
      boardId: '',
      holes: [],
      blockedBy: [],
    });
  });

  it('rejects a seat that would join incompatible copper through a multi-drop graph', async () => {
    const boardNode = board();
    boardNode.data = {
      ...boardNode.data,
      traces: [
        rowTrace('vcc', 'VCC rail', 0, boardNode.data.cols, 'VCC'),
        rowTrace('gnd', 'GND rail', 2, boardNode.data.cols, 'GND'),
      ],
    };
    const placement = { boardId: 'board', anchor: { row: 0, col: 0 }, rotation: 0 as const };
    const part = device(
      'part',
      placementNodePosition({ board: boardNode.data, position: boardNode.position }, placement),
    );
    const hub = device('hub', { x: 300, y: 0 });
    hub.data = {
      ...hub.data,
      footprintId: undefined,
      footprint: undefined,
      ports: [{ id: 'p', label: 'P', direction: 'output' }],
    };
    const wire = (
      id: string,
      source: string,
      sourcePort: string,
      target: string,
      targetPort: string,
    ): Edge<WireEdgeData> => ({
      id,
      type: EdgeTemplateType.WireEdge,
      source,
      sourcePort,
      target,
      targetPort,
      data: { type: 'wire', wireId: id },
    });
    model.nodes = [boardNode, part, hub];
    model.edges = [
      wire('part-to-hub', part.id, 'a', hub.id, 'p'),
      wire('hub-to-gnd', hub.id, 'p', boardNode.id, 'trace:gnd'),
    ];

    await service.settleDrag(new Set([part.id]));

    expect(service.conflict()).toMatchObject({
      kind: 'net-conflict',
      blockedBy: ['GND', 'VCC'],
    });
    expect(model.nodes.find((node) => node.id === part.id)?.type).toBe(NodeTemplateType.DeviceNode);
  });

  it('rotates a legal seat and keeps pin 1 on the same hole', async () => {
    const boardNode = board();
    const placement = { boardId: 'board', anchor: { row: 1, col: 1 }, rotation: 0 as const };
    const part = device('part', { x: 0, y: 0 });
    part.type = NodeTemplateType.FootprintNode;
    part.data = syncPortHolesToPlacement({ ...part.data, boardId: 'board', placement });
    model.nodes = [boardNode, part];
    const before = part.data.ports.find((port) => port.id === 'a')?.hole;

    expect(await service.rotate('part', 1)).toBe(true);

    const rotated = model.nodes.find((node) => node.id === 'part') as Node<DeviceNodeData>;
    expect(rotated.data.placement?.rotation).toBe(90);
    expect(rotated.data.ports.find((port) => port.id === 'a')?.hole).toEqual(before);
  });
});

import { type Edge, type Node } from 'ng-diagram';
import { describe, expect, it } from 'vitest';
import { NodeTemplateType, EdgeTemplateType } from './interfaces';
import { applyVisualZOrder, DEFAULT_VISUAL_PLANES, MAX_VISUAL_PLANE } from './visual-planes';

const node = (id: string, type: 'board' | 'device' | 'junction', visualPlane?: number): Node => ({
  id,
  type:
    type === 'board'
      ? NodeTemplateType.BoardNode
      : type === 'junction'
        ? NodeTemplateType.JunctionNode
        : NodeTemplateType.DeviceNode,
  position: { x: 0, y: 0 },
  data: { type, visualPlane, ...(type === 'board' ? { boardId: id } : {}) },
});

const edge = (id: string, visualPlane?: number): Edge => ({
  id,
  type: EdgeTemplateType.WireEdge,
  source: 'a',
  target: 'b',
  data: { type: 'wire', visualPlane },
});

describe('visual plane ordering', () => {
  it('places boards below components, conductors and junctions by default', () => {
    const ordered = applyVisualZOrder(
      [node('junction', 'junction'), node('board', 'board'), node('component', 'device')],
      [edge('wire')],
    );
    const z = new Map<string, number | undefined>([
      ...ordered.nodes.map((item) => [item.id, item.zOrder] as const),
      ...ordered.edges.map((item) => [item.id, item.zOrder] as const),
    ]);
    expect(z.get('board')).toBeLessThan(z.get('component') ?? -1);
    expect(z.get('component')).toBeLessThan(z.get('wire') ?? -1);
    expect(z.get('wire')).toBeLessThan(z.get('junction') ?? -1);
    expect(ordered.nodes.find((item) => item.id === 'board')?.data).toMatchObject({
      visualPlane: DEFAULT_VISUAL_PLANES.board,
    });
  });

  it('uses kind and id as deterministic tie breakers inside one plane', () => {
    const first = applyVisualZOrder(
      [node('z', 'device', 7), node('a', 'device', 7)],
      [edge('m', 7)],
    );
    const second = applyVisualZOrder([...first.nodes].reverse(), first.edges);
    const zOrders = (value: typeof first) =>
      new Map<string, number | undefined>([
        ...value.nodes.map((item) => [item.id, item.zOrder] as const),
        ...value.edges.map((item) => [item.id, item.zOrder] as const),
      ]);
    expect(zOrders(second)).toEqual(zOrders(first));
  });

  it('lets an authored plane move a wire below a board', () => {
    const ordered = applyVisualZOrder([node('board', 'board')], [edge('wire', -1)]);
    expect(ordered.edges[0].zOrder).toBeLessThan(ordered.nodes[0].zOrder ?? -1);
  });

  it('keeps an owned board jumper strictly above its board plane', () => {
    const jumper = {
      ...edge('jumper', -1),
      source: 'board',
      target: 'board',
      data: { type: 'wire', visualPlane: -1, jumperBoardId: 'board' },
    };
    const ordered = applyVisualZOrder([node('board', 'board', 12)], [jumper]);

    expect(ordered.edges[0].data).toMatchObject({ visualPlane: 13 });
    expect(ordered.edges[0].zOrder).toBeGreaterThan(ordered.nodes[0].zOrder ?? Number.MAX_VALUE);
  });

  it('makes room above a board already at the maximum plane', () => {
    const jumper = {
      ...edge('jumper', MAX_VISUAL_PLANE),
      source: 'board-node',
      target: 'board-node',
      data: {
        type: 'wire',
        visualPlane: MAX_VISUAL_PLANE,
        jumperBoardId: 'board-domain',
      },
    };
    const board = {
      ...node('board-node', 'board', MAX_VISUAL_PLANE),
      data: {
        ...node('board-node', 'board', MAX_VISUAL_PLANE).data,
        boardId: 'board-domain',
      },
    };

    const ordered = applyVisualZOrder([board], [jumper]);

    expect(ordered.nodes[0].data).toMatchObject({ visualPlane: MAX_VISUAL_PLANE - 1 });
    expect(ordered.edges[0].data).toMatchObject({ visualPlane: MAX_VISUAL_PLANE });
  });

  it('renormalizes stale copied z-orders into one deterministic sequence after paste', () => {
    const copiedNodes = [
      { ...node('component-copy', 'device', 10), zOrder: 99 },
      { ...node('component', 'device', 10), zOrder: 99 },
    ];
    const copiedEdges = [
      { ...edge('wire-copy', 20), zOrder: 99 },
      { ...edge('wire', 20), zOrder: 99 },
    ];

    const first = applyVisualZOrder(copiedNodes, copiedEdges);
    const second = applyVisualZOrder([...copiedNodes].reverse(), [...copiedEdges].reverse());
    const zOrders = (value: typeof first) =>
      new Map<string, number | undefined>([
        ...value.nodes.map((item) => [item.id, item.zOrder] as const),
        ...value.edges.map((item) => [item.id, item.zOrder] as const),
      ]);

    expect(new Set(zOrders(first).values())).toEqual(new Set([0, 1, 2, 3]));
    expect(zOrders(second)).toEqual(zOrders(first));
  });
});

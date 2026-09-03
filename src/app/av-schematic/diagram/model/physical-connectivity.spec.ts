import { type Edge, type Node } from 'ng-diagram';
import { describe, expect, it } from 'vitest';
import { rowTrace } from './board-trace';
import { type Footprint } from './footprint';
import {
  boardPortsResolveToSameCopper,
  assessPhysicalConnection,
  initialNetNameFromCopper,
  physicalEdgeNet,
  physicalEndpoint,
  physicalNetLabelForEndpoint,
} from './physical-connectivity';
import {
  EdgeTemplateType,
  NodeTemplateType,
  type AvSchematicNodeData,
  type BoardNodeData,
  type DeviceNodeData,
  type WireEdgeData,
} from './interfaces';

const inlineFootprint: Footprint = {
  id: 'inline-link',
  label: 'Inline link',
  rows: 1,
  cols: 3,
  pins: [
    { id: 'a', label: 'A', cell: { row: 0, col: 0 } },
    { id: 'b', label: 'B', cell: { row: 0, col: 2 } },
  ],
  shapes: [],
  bodyCells: [
    { row: 0, col: 0 },
    { row: 0, col: 2 },
  ],
};

const board: Node<BoardNodeData> = {
  id: 'board-17',
  type: NodeTemplateType.BoardNode,
  position: { x: 20, y: 30 },
  data: {
    type: 'board',
    boardId: 'board-17',
    label: 'Board 17',
    rows: 3,
    cols: 4,
    pitch: 17,
    traces: [rowTrace('vcc', 'L1', 0, 4, 'VCC'), rowTrace('gnd', 'L3', 2, 4, 'GND')],
  },
};

const component: Node<DeviceNodeData> = {
  id: 'component-1',
  type: NodeTemplateType.FootprintNode,
  position: { x: 0, y: 0 },
  data: {
    type: 'device',
    deviceId: 'R1',
    manufacturer: 'generic',
    model: 'link',
    boardId: 'board-17',
    footprintId: inlineFootprint.id,
    footprint: inlineFootprint,
    placement: { boardId: 'board-17', anchor: { row: 0, col: 0 }, rotation: 0 },
    ports: [
      { id: 'a', label: 'A', direction: 'input' },
      { id: 'b', label: 'B', direction: 'output' },
    ],
  },
};

const nodes: Node<AvSchematicNodeData>[] = [board, component];

function edgeTo(targetPort: string): Edge<WireEdgeData> {
  return {
    id: `wire-${targetPort}`,
    type: EdgeTemplateType.WireEdge,
    source: component.id,
    sourcePort: 'a',
    target: board.id,
    targetPort,
    data: { type: 'wire', wireId: 'W1' },
  };
}

describe('physical connectivity', () => {
  it('resolves a placed pin through its hole and copper trace to a net', () => {
    expect(physicalEndpoint(nodes, component.id, 'a')).toEqual({
      boardId: 'board-17',
      hole: { row: 0, col: 0 },
      traceId: 'vcc',
      traceLabel: 'L1',
      netLabel: 'VCC',
    });
    expect(physicalNetLabelForEndpoint(nodes, component.id, 'a')).toBe('VCC');
  });

  it('keeps hand-addressed v2 pins connected without a footprint placement', () => {
    const handAddressed: Node<DeviceNodeData> = {
      ...component,
      id: 'manual-pin',
      type: NodeTemplateType.DeviceNode,
      data: {
        ...component.data,
        footprintId: undefined,
        footprint: undefined,
        placement: undefined,
        boardId: board.data.boardId,
        ports: [{ id: 'a', label: 'A', direction: 'input', hole: { row: 2, col: 1 } }],
      },
    };

    expect(physicalEndpoint([board, handAddressed], handAddressed.id, 'a')).toMatchObject({
      boardId: 'board-17',
      hole: { row: 2, col: 1 },
      traceId: 'gnd',
      netLabel: 'GND',
    });
  });

  it('resolves board hole and trace endpoints without a side table', () => {
    expect(physicalEndpoint(nodes, board.id, 'hole:0:2')).toMatchObject({
      boardId: 'board-17',
      hole: { row: 0, col: 2 },
      traceId: 'vcc',
      netLabel: 'VCC',
    });
    expect(physicalEndpoint(nodes, board.id, 'trace:gnd')).toMatchObject({
      boardId: 'board-17',
      hole: { row: 2, col: 0 },
      traceId: 'gnd',
      netLabel: 'GND',
    });
    expect(physicalEndpoint(nodes, board.id, 'hole:1:1')).toMatchObject({
      boardId: 'board-17',
      hole: { row: 1, col: 1 },
      netLabel: undefined,
    });
  });

  it('infers one physical edge net and reports incompatible copper endpoints', () => {
    expect(physicalEdgeNet(nodes, edgeTo('hole:0:3'))).toEqual({
      netLabel: 'VCC',
      conflict: [],
    });
    expect(physicalEdgeNet(nodes, edgeTo('trace:gnd'))).toEqual({
      conflict: ['GND', 'VCC'],
    });
  });

  it('recognizes only board ports that canonicalize to the same copper junction', () => {
    const sameTrace: Edge<WireEdgeData> = {
      id: 'same-trace',
      type: EdgeTemplateType.WireEdge,
      source: board.id,
      sourcePort: 'hole:0:1',
      target: board.id,
      targetPort: 'trace:vcc',
      data: { type: 'wire', wireId: 'W2' },
    };
    const pinToTrace: Edge<WireEdgeData> = {
      ...sameTrace,
      id: 'pin-to-trace',
      source: component.id,
      sourcePort: 'a',
    };

    expect(boardPortsResolveToSameCopper(nodes, sameTrace)).toBe(true);
    expect(boardPortsResolveToSameCopper(nodes, pinToTrace)).toBe(false);
  });

  it('returns conflict, label and same-copper in one physical assessment', () => {
    const sameTrace: Edge<WireEdgeData> = {
      id: 'assessment-same-trace',
      source: board.id,
      sourcePort: 'hole:0:1',
      target: board.id,
      targetPort: 'trace:vcc',
      data: { type: 'wire', wireId: 'assessment' },
    };
    expect(assessPhysicalConnection(nodes, sameTrace)).toMatchObject({
      netLabel: 'VCC',
      conflict: [],
      sameCopper: true,
    });
  });

  it('detects copper conflicts inherited through an existing multi-drop graph', () => {
    const external = (id: string): Node<DeviceNodeData> => ({
      id,
      type: NodeTemplateType.DeviceNode,
      position: { x: 200, y: 0 },
      data: {
        type: 'device',
        deviceId: id,
        manufacturer: '',
        model: '',
        ports: [{ id: 'p', label: 'P', direction: 'output' }],
      },
    });
    const left = external('left');
    const right = external('right');
    const edge = (
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
    const existing = [
      edge('to-vcc', left.id, 'p', board.id, 'trace:vcc'),
      edge('to-gnd', right.id, 'p', board.id, 'trace:gnd'),
    ];
    const bridge = edge('bridge', left.id, 'p', right.id, 'p');

    expect(physicalEdgeNet([...nodes, left, right], bridge, existing)).toEqual({
      conflict: ['GND', 'VCC'],
    });
  });

  it('uses copper only as a fallback and preserves an authored/imported net name', () => {
    expect(initialNetNameFromCopper(undefined, { netLabel: 'GND', conflict: [] })).toBe('GND');
    expect(initialNetNameFromCopper(undefined, { conflict: ['GND', 'VCC'] })).toBeUndefined();
    expect(initialNetNameFromCopper('AUTHORED', { netLabel: 'GND', conflict: [] })).toBe(
      'AUTHORED',
    );
  });
});

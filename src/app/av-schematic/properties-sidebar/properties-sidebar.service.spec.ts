import { type Node } from 'ng-diagram';
import { describe, expect, it } from 'vitest';
import { rowTrace } from '../diagram/model/board-trace';
import { type Footprint } from '../diagram/model/footprint';
import {
  NodeTemplateType,
  type AvSchematicNodeData,
  type BoardNodeData,
  type DeviceNodeData,
} from '../diagram/model/interfaces';
import { describeWireEndpoint } from '../diagram/model/wire-endpoints';

const footprint: Footprint = {
  id: 'inline-part',
  label: 'Inline part',
  rows: 1,
  cols: 2,
  pins: [
    { id: 'a', label: 'A', cell: { row: 0, col: 0 } },
    { id: 'b', label: 'B', cell: { row: 0, col: 1 } },
  ],
  shapes: [],
};

const board: Node<BoardNodeData> = {
  id: 'board-17',
  type: NodeTemplateType.BoardNode,
  position: { x: 0, y: 0 },
  data: {
    type: 'board',
    boardId: 'board-17',
    label: 'Physical board',
    rows: 2,
    cols: 4,
    pitch: 17,
    traces: [rowTrace('vcc', 'L1', 0, 4, 'VCC')],
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
    model: 'part',
    boardId: 'board-17',
    footprintId: footprint.id,
    footprint,
    placement: { boardId: 'board-17', anchor: { row: 0, col: 0 }, rotation: 0 },
    ports: [
      { id: 'a', label: 'A', direction: 'input' },
      { id: 'b', label: 'B', direction: 'output' },
    ],
  },
};

describe('physical wire endpoint inspection', () => {
  const nodes: Node<AvSchematicNodeData>[] = [board, component];

  it('inspects a board hole with its physical address, trace, and net', () => {
    expect(describeWireEndpoint(nodes, board.id, 'hole:0:2')).toEqual({
      deviceId: 'Physical board',
      portLabel: 'L1-C3 · L1 (VCC)',
    });
  });

  it('inspects a board trace endpoint', () => {
    expect(describeWireEndpoint(nodes, board.id, 'trace:vcc')).toEqual({
      deviceId: 'Physical board',
      portLabel: 'L1 (VCC)',
    });
  });

  it('inspects a placed component pin through its board hole', () => {
    expect(describeWireEndpoint(nodes, component.id, 'a')).toEqual({
      deviceId: 'R1',
      portLabel: 'A · L1-C1 (VCC)',
    });
  });
});

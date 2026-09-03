import { type Edge, type Node } from 'ng-diagram';
import { describe, expect, it } from 'vitest';
import { rowTrace } from './board-trace';
import { inspectPhysicalLayout } from './physical-diagnostics';
import {
  EdgeTemplateType,
  NodeTemplateType,
  type BoardNodeData,
  type DeviceNodeData,
  type WireEdgeData,
} from './interfaces';

const board: Node<BoardNodeData> = {
  id: 'board',
  type: NodeTemplateType.BoardNode,
  position: { x: 0, y: 0 },
  data: {
    type: 'board',
    boardId: 'board',
    label: 'Board',
    rows: 2,
    cols: 3,
    pitch: 17,
    traces: [rowTrace('vcc', 'VCC rail', 0, 3, 'VCC'), rowTrace('gnd', 'GND rail', 1, 3, 'GND')],
  },
};

const device: Node<DeviceNodeData> = {
  id: 'device',
  type: NodeTemplateType.DeviceNode,
  position: { x: 100, y: 0 },
  data: {
    type: 'device',
    deviceId: 'D1',
    manufacturer: '',
    model: '',
    ports: [{ id: 'p', label: 'P', direction: 'input' }],
  },
};

function edge(netName: string): Edge<WireEdgeData> {
  return {
    id: 'wire',
    type: EdgeTemplateType.WireEdge,
    source: device.id,
    sourcePort: 'p',
    target: board.id,
    targetPort: 'trace:vcc',
    data: { type: 'wire', wireId: 'W1', netId: 'imported-id', netName },
  };
}

describe('inspectPhysicalLayout', () => {
  it('reports an authored/copper divergence as a savable warning', () => {
    expect(inspectPhysicalLayout([board, device], [edge('AUTHORED')])).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'net-copper-divergence' }),
    );
  });

  it('does not warn when the authored name agrees with copper', () => {
    expect(inspectPhysicalLayout([board, device], [edge('VCC')])).toEqual([]);
  });

  it('reports competing authored names that one copper trace would merge', () => {
    const first = edge('ALPHA');
    const second = { ...edge('BETA'), id: 'wire-2' };
    expect(inspectPhysicalLayout([board, device], [first, second])).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'authored-net-merge' }),
    );
  });

  it('reports copper labels joined indirectly through a multi-drop graph', () => {
    const peer: Node<DeviceNodeData> = {
      ...device,
      id: 'peer',
      data: { ...device.data, deviceId: 'D2' },
    };
    const toVcc = edge('VCC');
    const toGnd: Edge<WireEdgeData> = {
      ...edge('GND'),
      id: 'wire-gnd',
      source: peer.id,
      targetPort: 'trace:gnd',
    };
    const bridge: Edge<WireEdgeData> = {
      ...edge('AUTHORED'),
      id: 'wire-bridge',
      source: device.id,
      sourcePort: 'p',
      target: peer.id,
      targetPort: 'p',
    };

    const shorts = inspectPhysicalLayout([board, device, peer], [toVcc, toGnd, bridge]).filter(
      (entry) => entry.code === 'copper-short',
    );
    expect(shorts).toEqual([expect.objectContaining({ severity: 'error', code: 'copper-short' })]);
  });

  it('reports overlapping copper as an error with a board path', () => {
    const invalid = {
      ...board,
      data: {
        ...board.data,
        traces: [
          rowTrace('a', 'A', 0, 3, 'A'),
          { id: 'b', label: 'B', segments: [{ from: { row: 0, col: 1 }, to: { row: 1, col: 1 } }] },
        ],
      },
    };
    expect(inspectPhysicalLayout([invalid], [])).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'trace-overlap' }),
    );
  });
});

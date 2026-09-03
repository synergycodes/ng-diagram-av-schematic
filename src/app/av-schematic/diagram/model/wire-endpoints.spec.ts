import { describe, expect, it } from 'vitest';
import { diagramModel } from '../data';
import { NodeTemplateType, type JunctionNodeData } from './interfaces';
import { describeWireEndpoint, describeWireEndpoints, formatWireEndpoint } from './wire-endpoints';

describe('wire endpoint inspection', () => {
  it('resolves the source and target from the same wire edge used by the canvas', () => {
    const edge = diagramModel.edges.find(
      (candidate) => candidate.data.type === 'wire' && candidate.data.wireId === 'W1',
    );
    if (!edge) throw new Error('fixture has no W1 wire edge');

    expect(describeWireEndpoints(diagramModel.nodes, edge)).toEqual({
      source: { deviceId: 'NANO-1', portLabel: 'D9' },
      target: { deviceId: 'DRV-1', portLabel: 'PWMA' },
    });
  });

  it('formats a dangling end without inventing endpoint metadata', () => {
    expect(formatWireEndpoint(null)).toBe('—');
  });

  it('describes a junction tap without assuming every endpoint is a device port', () => {
    const junction = {
      id: 'rail',
      type: NodeTemplateType.JunctionNode,
      position: { x: 0, y: 0 },
      data: {
        type: 'junction',
        junctionId: 'rail',
        label: 'Barramento 5 V',
        kind: 'rail',
        taps: 3,
      },
    } satisfies import('ng-diagram').Node<JunctionNodeData>;

    expect(describeWireEndpoint([junction], 'rail', 'tap-1')).toEqual({
      deviceId: 'Barramento 5 V',
      portLabel: 'tap 2',
    });
  });
});

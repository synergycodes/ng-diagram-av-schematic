import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NgDiagramModelService, type Edge, type Node } from 'ng-diagram';
import { describe, expect, it } from 'vitest';
import { toCanonicalProject } from '../model/canonical-project';
import {
  EdgeTemplateType,
  NodeTemplateType,
  type DeviceNodeData,
  type JunctionNodeData,
  type WireEdgeData,
} from '../model/interfaces';
import { NetHighlightService } from './net-highlight.service';

const device = (id: string, portIds: readonly string[]): Node<DeviceNodeData> => ({
  id,
  type: NodeTemplateType.DeviceNode,
  position: { x: 0, y: 0 },
  data: {
    type: 'device',
    deviceId: id.toUpperCase(),
    manufacturer: '',
    model: '',
    ports: portIds.map((portId) => ({
      id: portId,
      label: portId,
      direction: 'output',
    })),
  },
});

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
  data: { type: 'wire', wireId: id.toUpperCase() },
});

const junction = (id: string): Node<JunctionNodeData> => ({
  id,
  type: NodeTemplateType.JunctionNode,
  position: { x: 0, y: 0 },
  data: { type: 'junction', junctionId: id, label: id, kind: 'junction', taps: 2 },
});

describe('NetHighlightService', () => {
  it('derives highlighting from live connectivity for new and relinked wires', () => {
    const nodes = signal<Node<DeviceNodeData>[]>([
      device('source', ['out', 'spare']),
      device('hub', ['shared', 'other']),
      device('load', ['in']),
      device('isolated', ['in']),
    ]);
    const edges = signal<Edge<WireEdgeData>[]>([
      wire('w1', 'source', 'out', 'hub', 'shared'),
      wire('w2', 'hub', 'shared', 'load', 'in'),
      wire('w3', 'source', 'spare', 'isolated', 'in'),
    ]);
    TestBed.configureTestingModule({
      providers: [
        NetHighlightService,
        { provide: NgDiagramModelService, useValue: { nodes, edges } },
      ],
    });
    const service = TestBed.inject(NetHighlightService);

    expect(service.netForEdge('w1')?.edgeIds).toEqual(['w1', 'w2']);
    expect(service.netForEdge('w1')?.id).toBe(service.netForEdge('w2')?.id);

    service.toggleEdge('w1');
    expect(service.emphasisForEdge('w1')).toBe('highlighted');
    expect(service.emphasisForEdge('w2')).toBe('highlighted');
    expect(service.emphasisForEdge('w3')).toBe('dimmed');

    edges.update((current) =>
      current.map((edge) =>
        edge.id === 'w2' ? { ...edge, source: 'hub', sourcePort: 'other' } : edge,
      ),
    );

    expect(service.netForEdge('w1')?.edgeIds).toEqual(['w1']);
    expect(service.netForEdge('w2')?.edgeIds).toEqual(['w2']);
    expect(service.emphasisForEdge('w1')).toBe('highlighted');
    expect(service.emphasisForEdge('w2')).toBe('dimmed');

    service.setDimOthers(false);
    expect(service.emphasisForEdge('w2')).toBe('normal');
    service.toggleEdge('w1');
    expect(service.isActive()).toBe(false);
  });

  it('collapses junction taps into one net with the canonical id', () => {
    const nodes = signal<Node[]>([
      device('source', ['out']),
      junction('splice'),
      device('load', ['in']),
    ]);
    const edges = signal<Edge<WireEdgeData>[]>([
      wire('w1', 'source', 'out', 'splice', 'tap-0'),
      wire('w2', 'splice', 'tap-1', 'load', 'in'),
    ]);
    TestBed.configureTestingModule({
      providers: [
        NetHighlightService,
        { provide: NgDiagramModelService, useValue: { nodes, edges } },
      ],
    });
    const service = TestBed.inject(NetHighlightService);
    const canonicalNet = toCanonicalProject(nodes(), edges()).electrical.nets[0];

    expect(service.netForEdge('w1')).toMatchObject({
      id: canonicalNet.id,
      edgeIds: ['w1', 'w2'],
    });
    expect(service.netForEdge('w2')?.id).toBe(canonicalNet.id);
  });
});

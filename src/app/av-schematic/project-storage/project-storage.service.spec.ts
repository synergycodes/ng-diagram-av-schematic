import { TestBed } from '@angular/core/testing';
import { NgDiagramModelService, NgDiagramViewportService, type Edge, type Node } from 'ng-diagram';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EdgeTemplateType,
  NodeTemplateType,
  type DeviceNodeData,
  type WireEdgeData,
} from '../diagram/model/interfaces';
import { ProjectStorageService } from './project-storage.service';

const component = (
  id: string,
  portId: string,
  direction: 'input' | 'output',
  x: number,
): Node<DeviceNodeData> => ({
  id,
  type: NodeTemplateType.DeviceNode,
  position: { x, y: 0 },
  data: {
    type: 'device',
    deviceId: id.toUpperCase(),
    manufacturer: 'Talus',
    model: id,
    ports: [{ id: portId, label: portId.toUpperCase(), direction }],
  },
});

const wire = (): Edge<WireEdgeData> => ({
  id: 'wire-1',
  type: EdgeTemplateType.WireEdge,
  source: 'source',
  sourcePort: 'out',
  target: 'target',
  targetPort: 'in',
  routingMode: 'manual',
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 40 },
    { x: 200, y: 40 },
  ],
  data: {
    type: 'wire',
    wireId: 'W1',
    netId: 'motor',
    color: '#123456',
    colorCode: '#123456',
    gauge: '22 AWG',
    length: '120 mm',
    notes: 'Passar pela borda da placa',
  },
});

const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('ProjectStorageService save/open', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips the committed wire model through PUT, GET, parse and model replacement', async () => {
    let currentNodes: Node[] = [
      component('source', 'out', 'output', 0),
      component('target', 'in', 'input', 200),
    ];
    let currentEdges: Edge[] = [wire()];
    let savedBody: unknown;
    let restoredNodes: Node[] = [];
    let restoredEdges: Edge[] = [];
    const deleteEdges = vi.fn(() => {
      currentEdges = [];
      return Promise.resolve();
    });
    const deleteNodes = vi.fn(() => {
      currentNodes = [];
      return Promise.resolve();
    });
    const addNodes = vi.fn((nodes: Node[]) => {
      restoredNodes = nodes;
      currentNodes = nodes;
      return Promise.resolve();
    });
    const addEdges = vi.fn((edges: Edge[]) => {
      restoredEdges = edges;
      currentEdges = edges;
      return Promise.resolve();
    });
    const modelService = {
      getModel: () => ({
        getNodes: () => currentNodes,
        getEdges: () => currentEdges,
      }),
      getNodeById: (nodeId: string) => currentNodes.find((node) => node.id === nodeId),
      deleteEdges,
      deleteNodes,
      addNodes,
      addEdges,
      updateEdges: vi.fn(() => Promise.resolve()),
    };
    const zoomToFit = vi.fn(() => Promise.resolve());
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        if (typeof init.body !== 'string') {
          throw new TypeError('Expected the saved project body to be a JSON string');
        }
        savedBody = JSON.parse(init.body);
        return Promise.resolve(response({ id: 'project-1', saved: true }));
      }
      return Promise.resolve(response(savedBody));
    });
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({
      providers: [
        ProjectStorageService,
        { provide: NgDiagramModelService, useValue: modelService },
        { provide: NgDiagramViewportService, useValue: { zoomToFit } },
      ],
    });
    const storage = TestBed.inject(ProjectStorageService);

    await storage.save('project-1');

    expect(savedBody).toMatchObject({
      formatVersion: 4,
      electrical: {
        cables: [{ name: 'W1', colors: ['#123456'] }],
        nets: [
          {
            conductors: [
              expect.objectContaining({
                id: 'wire-1',
                gauge: '22 AWG',
                length: '120 mm',
                notes: 'Passar pela borda da placa',
              }),
            ],
          },
        ],
      },
      layout: {
        conductors: [
          expect.objectContaining({
            conductorId: 'wire-1',
            routingMode: 'manual',
            points: wire().points,
          }),
        ],
      },
    });
    expect(storage.status()).toBe('success');

    currentNodes = [component('old-node', 'old-port', 'output', 0)];
    currentEdges = [{ ...wire(), id: 'old-wire' }];
    await storage.open('project-1');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/projects/project-1',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/projects/project-1', { method: 'GET' });
    expect(deleteEdges).toHaveBeenCalledWith(['old-wire']);
    expect(deleteNodes).toHaveBeenCalledWith(['old-node']);
    expect(deleteEdges.mock.invocationCallOrder[0]).toBeLessThan(
      deleteNodes.mock.invocationCallOrder[0],
    );
    expect(addNodes).toHaveBeenCalledWith(expect.any(Array), { waitForMeasurements: true });
    expect(restoredNodes).toHaveLength(2);
    expect(restoredEdges).toHaveLength(1);
    expect(restoredEdges[0]).toMatchObject({
      id: 'wire-1',
      routingMode: 'manual',
      points: wire().points,
      data: {
        type: 'wire',
        wireId: 'W1',
        color: '#123456',
        colorCode: '#123456',
        gauge: '22 AWG',
        length: '120 mm',
        notes: 'Passar pela borda da placa',
      },
    });
    const restoredWireData = restoredEdges[0]?.data as WireEdgeData | undefined;
    expect(typeof restoredWireData?.netId).toBe('string');
    expect(storage.status()).toBe('success');
    expect(storage.message()).toContain('carregado com sucesso');
    expect(zoomToFit).toHaveBeenCalledOnce();
  });
});

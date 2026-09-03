import { TestBed } from '@angular/core/testing';
import {
  NgDiagramModelService,
  NgDiagramService,
  NgDiagramViewportService,
  type Point,
} from 'ng-diagram';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EdgeCommandDispatcher, type EdgeCommand } from '../commands';
import { EdgeBendHandler } from './edge-bend.handler';
import { EdgeReshapeHandler } from './edge-reshape.handler';

const pointerEvent = (
  type: string,
  values: { pointerId: number; button?: number; clientX: number; clientY: number },
): PointerEvent => {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, {
    pointerId: { value: values.pointerId },
    button: { value: values.button ?? 0 },
    clientX: { value: values.clientX },
    clientY: { value: values.clientY },
  });
  return event as PointerEvent;
};

describe('edge gesture handlers', () => {
  const dispatch = vi.fn<(command: EdgeCommand) => Promise<void>>().mockResolvedValue(undefined);
  const edge = {
    id: 'wire-1',
    source: 'source',
    target: 'target',
    points: [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
    ],
  };
  const referenceNode = { id: 'source', position: { x: 0, y: 0 }, data: {} };

  beforeEach(() => {
    dispatch.mockReset();
    TestBed.configureTestingModule({
      providers: [
        EdgeBendHandler,
        EdgeReshapeHandler,
        { provide: EdgeCommandDispatcher, useValue: { dispatch } },
        {
          provide: NgDiagramModelService,
          useValue: {
            getEdgeById: vi.fn(() => edge),
            nodes: vi.fn(() => [referenceNode]),
            getModel: vi.fn(() => ({})),
          },
        },
        {
          provide: NgDiagramViewportService,
          useValue: {
            scale: vi.fn(() => 2),
            clientToFlowPosition: vi.fn(({ x, y }: Point) => ({ x, y })),
          },
        },
        {
          provide: NgDiagramService,
          useValue: {
            config: vi.fn(() => ({
              snapping: {
                shouldSnapDragForNode: () => true,
                defaultDragSnap: { width: 20, height: 20 },
              },
            })),
          },
        },
      ],
    });
  });

  it('has the bend handler dispatch insertion and removal with the resolved grid', () => {
    const handler = TestBed.inject(EdgeBendHandler);

    handler.insertBendAtFlowPoint('wire-1', 0, { x: 18, y: 35 });
    handler.removeBend('wire-1', 1);

    expect(dispatch.mock.calls).toEqual([
      [
        {
          kind: 'insert-bend',
          edgeId: 'wire-1',
          segmentIndex: 0,
          at: { x: 18, y: 35 },
          grid: { x: 20, y: 20 },
        },
      ],
      [{ kind: 'remove-bend', edgeId: 'wire-1', bendIndex: 1 }],
    ]);
  });

  it('has the reshape handler translate pointer movement and finish through commands', async () => {
    const handler = TestBed.inject(EdgeReshapeHandler);
    const handle = document.createElement('button');
    const start = pointerEvent('pointerdown', {
      pointerId: 7,
      button: 0,
      clientX: 10,
      clientY: 20,
    });

    handler.start(start, handle, {
      edgeId: 'wire-1',
      segmentIndex: 1,
      midpoint: { x: 40, y: 20 },
      axis: 'vertical',
      anchorPortAtSource: false,
      anchorPortAtTarget: true,
    });
    handle.dispatchEvent(pointerEvent('pointermove', { pointerId: 7, clientX: 30, clientY: 50 }));
    handle.dispatchEvent(pointerEvent('pointerup', { pointerId: 7, clientX: 30, clientY: 50 }));

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          kind: 'reshape-move',
          edgeId: 'wire-1',
          segmentIndex: 1,
          grid: { x: 20, y: 20 },
          dxWorld: 10,
          dyWorld: 15,
        }),
      );
    });
    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenNthCalledWith(2, { kind: 'reshape-finish', edgeId: 'wire-1' });
    });
    expect(handler.current).toBeNull();
    expect(handler.gestureActive()).toBe(false);
  });
});

import { TestBed } from '@angular/core/testing';
import { NgDiagramModelService, type Point } from 'ng-diagram';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EdgeCommandDispatcher } from './dispatcher';

describe('EdgeCommandDispatcher', () => {
  const updateEdge =
    vi.fn<(edgeId: string, patch: { points?: Point[]; routingMode?: 'manual' | 'auto' }) => void>();
  const getEdgeById = vi.fn<(edgeId: string) => { id: string; points?: Point[] } | undefined>();

  beforeEach(() => {
    updateEdge.mockReset();
    getEdgeById.mockReset();
    TestBed.configureTestingModule({
      providers: [
        EdgeCommandDispatcher,
        {
          provide: NgDiagramModelService,
          useValue: { updateEdge, getEdgeById, getNodeById: vi.fn() },
        },
      ],
    });
  });

  it('routes a set-edge-route command to the single edge patch surface', async () => {
    const dispatcher = TestBed.inject(EdgeCommandDispatcher);
    const points = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ];

    updateEdge.mockResolvedValue(undefined);
    await dispatcher.dispatch({ kind: 'set-edge-route', edgeId: 'wire-1', points });

    expect(updateEdge).toHaveBeenCalledOnce();
    expect(updateEdge).toHaveBeenCalledWith('wire-1', {
      points,
      routingMode: 'manual',
    });
    expect(updateEdge.mock.calls[0][1].points).not.toBe(points);
  });

  it('routes reshape-finish and preserves a same-axis reversal while folding pass-throughs', async () => {
    getEdgeById.mockReturnValue({
      id: 'wire-1',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 50, y: 0 },
        { x: 25, y: 0 },
      ],
    });
    const dispatcher = TestBed.inject(EdgeCommandDispatcher);

    updateEdge.mockResolvedValue(undefined);
    await dispatcher.dispatch({ kind: 'reshape-finish', edgeId: 'wire-1' });

    expect(updateEdge).toHaveBeenCalledWith('wire-1', {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 25, y: 0 },
      ],
      routingMode: 'manual',
    });
  });
});

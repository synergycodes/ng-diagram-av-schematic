import { type Edge, type NgDiagramModelService } from 'ng-diagram';
import { describe, expect, it, vi } from 'vitest';
import { applyInsertBend, applyMoveBend, applyRemoveBend } from './bend-edge';

const jumper: Edge = {
  id: 'jumper',
  source: 'board-node',
  target: 'board-node',
  routing: 'polyline',
  routingMode: 'manual',
  points: [
    { x: 10, y: 10 },
    { x: 35, y: 70 },
    { x: 90, y: 40 },
  ],
  data: { type: 'wire', wireId: 'J1', jumperBoardId: 'board-domain' },
};

function modelFor(edge: Edge): {
  model: NgDiagramModelService;
  updateEdge: ReturnType<typeof vi.fn>;
} {
  const updateEdge = vi.fn().mockResolvedValue(undefined);
  return {
    model: {
      getEdgeById: () => edge,
      getNodeById: () => null,
      updateEdge,
    } as unknown as NgDiagramModelService,
    updateEdge,
  };
}

describe('free board-jumper bends', () => {
  it('inserts one free waypoint without creating an orthogonal jog', async () => {
    const basePoints = jumper.points ?? [];
    const { model, updateEdge } = modelFor({
      ...jumper,
      points: [basePoints[0], basePoints[2]],
    });

    await applyInsertBend(model, {
      kind: 'insert-bend',
      edgeId: jumper.id,
      segmentIndex: 0,
      at: { x: 35, y: 70 },
      grid: null,
    });

    expect(updateEdge).toHaveBeenCalledWith(jumper.id, {
      points: jumper.points,
      routing: 'polyline',
      routingMode: 'manual',
    });
  });

  it('moves and removes only the selected free waypoint', async () => {
    const moved = modelFor(jumper);
    await applyMoveBend(moved.model, {
      kind: 'move-bend',
      edgeId: jumper.id,
      initialPoints: jumper.points ?? [],
      bendIndex: 1,
      grid: null,
      dxWorld: 7,
      dyWorld: -11,
    });
    expect(moved.updateEdge).toHaveBeenCalledWith(jumper.id, {
      points: [
        { x: 10, y: 10 },
        { x: 42, y: 59 },
        { x: 90, y: 40 },
      ],
      routing: 'polyline',
      routingMode: 'manual',
    });

    const removed = modelFor(jumper);
    await applyRemoveBend(removed.model, {
      kind: 'remove-bend',
      edgeId: jumper.id,
      bendIndex: 1,
    });
    expect(removed.updateEdge).toHaveBeenCalledWith(jumper.id, {
      points: [
        { x: 10, y: 10 },
        { x: 90, y: 40 },
      ],
      routing: 'polyline',
      routingMode: 'manual',
    });
  });
});

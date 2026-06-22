import type { Point } from 'ng-diagram';
import { describe, expect, it } from 'vitest';
import { realignEndpointNeighbor } from './realign-endpoint-neighbor';

const drifted = (): Point[] => [
  { x: 0, y: 0 },
  { x: 0.4, y: 40 },
  { x: 100, y: 40 },
];

describe('realignEndpointNeighbor', () => {
  it('snaps the source neighbour onto a vertical end segment', () => {
    const result = realignEndpointNeighbor(drifted(), 'source', 'vertical');
    expect(result[1]).toEqual({ x: 0, y: 40 });
  });

  it('snaps the target neighbour onto a horizontal end segment', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: 40.4 },
      { x: 100, y: 40 },
    ];
    const result = realignEndpointNeighbor(points, 'target', 'horizontal');
    expect(result[1]).toEqual({ x: 0, y: 40 });
    expect(result[2]).toEqual({ x: 100, y: 40 });
  });

  it('is a no-op for a null (oblique) axis', () => {
    const points = drifted();
    const result = realignEndpointNeighbor(points, 'source', null);
    expect(result[1]).toEqual({ x: 0.4, y: 40 });
  });
});

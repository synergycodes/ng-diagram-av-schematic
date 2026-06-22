import type { Point } from 'ng-diagram';
import { describe, expect, it } from 'vitest';
import { endpointNeighborAxis, segmentAxis } from './segment-axis';

describe('segmentAxis', () => {
  it('classifies a horizontal segment', () => {
    expect(segmentAxis({ x: 0, y: 10 }, { x: 50, y: 10 })).toBe('horizontal');
  });

  it('classifies a vertical segment', () => {
    expect(segmentAxis({ x: 10, y: 0 }, { x: 10, y: 50 })).toBe('vertical');
  });

  it('returns null for an oblique segment', () => {
    expect(segmentAxis({ x: 0, y: 0 }, { x: 50, y: 50 })).toBeNull();
  });

  it('returns null for a collocated (degenerate) segment', () => {
    expect(segmentAxis({ x: 10, y: 10 }, { x: 10, y: 10 })).toBeNull();
  });

  it('tolerates sub-pixel drift within POSITION_TOLERANCE', () => {
    expect(segmentAxis({ x: 0, y: 10 }, { x: 50, y: 10.4 })).toBe('horizontal');
  });
});

describe('endpointNeighborAxis', () => {
  const path: Point[] = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 40 },
    { x: 100, y: 40 },
  ];

  it('reads the source end segment axis', () => {
    expect(endpointNeighborAxis(path, 'source')).toBe('horizontal');
  });

  it('reads the target end segment axis', () => {
    expect(endpointNeighborAxis(path, 'target')).toBe('horizontal');
  });

  it('returns null for a path that is too short', () => {
    expect(endpointNeighborAxis([{ x: 0, y: 0 }], 'source')).toBeNull();
  });
});

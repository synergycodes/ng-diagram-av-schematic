import type { Point } from 'ng-diagram';
import { describe, expect, it } from 'vitest';
import { getHandlerPositions } from './get-handler-positions';

describe('getHandlerPositions', () => {
  it('returns one handle per segment, at its midpoint, with coord-derived axis', () => {
    const path: Point[] = [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 200 },
      { x: 220, y: 200 },
    ];
    expect(getHandlerPositions(path)).toEqual([
      { x: 40, y: 0, segmentIndex: 0, axis: 'horizontal' },
      { x: 80, y: 100, segmentIndex: 1, axis: 'vertical' },
      { x: 150, y: 200, segmentIndex: 2, axis: 'horizontal' },
    ]);
  });

  it('derives axis from coordinates for vertical (top/bottom) ports', () => {
    const path: Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: 80 },
      { x: 200, y: 80 },
      { x: 200, y: 220 },
    ];
    expect(getHandlerPositions(path)).toEqual([
      { x: 0, y: 40, segmentIndex: 0, axis: 'vertical' },
      { x: 100, y: 80, segmentIndex: 1, axis: 'horizontal' },
      { x: 200, y: 150, segmentIndex: 2, axis: 'vertical' },
    ]);
  });

  it('includes end segments so a new segment can grow from them', () => {
    const path: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(getHandlerPositions(path)).toEqual([
      { x: 50, y: 0, segmentIndex: 0, axis: 'horizontal' },
    ]);
  });

  it('skips oblique and degenerate segments', () => {
    const path: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { x: 50, y: 50 },
      { x: 100, y: 50 },
    ];
    expect(getHandlerPositions(path)).toEqual([
      { x: 75, y: 50, segmentIndex: 2, axis: 'horizontal' },
    ]);
  });

  it('returns empty for paths shorter than one segment', () => {
    expect(getHandlerPositions([{ x: 0, y: 0 }])).toEqual([]);
  });
});

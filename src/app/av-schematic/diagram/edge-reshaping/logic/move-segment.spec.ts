import type { Point } from 'ng-diagram';
import { describe, expect, it } from 'vitest';
import { moveSegment } from './move-segment';

const path: Point[] = [
  { x: 0, y: 0 },
  { x: 50, y: 0 },
  { x: 50, y: 40 },
  { x: 100, y: 40 },
];

describe('moveSegment', () => {
  it('slides a vertical segment to a new x, moving both vertices together', () => {
    const result = moveSegment(path, 1, 'vertical', 70);
    expect(result).toEqual([
      { x: 0, y: 0 },
      { x: 70, y: 0 },
      { x: 70, y: 40 },
      { x: 100, y: 40 },
    ]);
  });

  it('slides a horizontal segment to a new y, moving both vertices together', () => {
    const result = moveSegment(path, 2, 'horizontal', 80);
    expect(result).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 80 },
      { x: 100, y: 80 },
    ]);
  });

  it('keeps neighbouring segments orthogonal', () => {
    const result = moveSegment(path, 1, 'vertical', 70);
    expect(result[0].y).toBe(result[1].y);
    expect(result[2].y).toBe(result[3].y);
  });

  it('does not mutate the input', () => {
    const snapshot = path.map((p) => ({ ...p }));
    moveSegment(path, 1, 'vertical', 70);
    expect(path).toEqual(snapshot);
  });

  it('returns a copy unchanged for out-of-range indices', () => {
    expect(moveSegment(path, -1, 'vertical', 70)).toEqual(path);
    expect(moveSegment(path, 3, 'horizontal', 70)).toEqual(path);
  });
});

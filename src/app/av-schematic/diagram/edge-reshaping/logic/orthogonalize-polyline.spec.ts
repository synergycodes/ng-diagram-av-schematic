import type { Point } from 'ng-diagram';
import { describe, expect, it } from 'vitest';
import { orthogonalizePolyline } from './orthogonalize-polyline';

describe('orthogonalizePolyline', () => {
  it('leaves an already orthogonal path untouched', () => {
    const path: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
      { x: 100, y: 40 },
    ];
    expect(orthogonalizePolyline(path)).toEqual(path);
  });

  it('inserts a vertical-first L-bend for an oblique segment', () => {
    const path: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 40 },
    ];
    expect(orthogonalizePolyline(path)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 40 },
      { x: 100, y: 40 },
    ]);
  });

  it('keeps collocated points without inserting a bend', () => {
    const path: Point[] = [
      { x: 10, y: 10 },
      { x: 10, y: 10 },
    ];
    expect(orthogonalizePolyline(path)).toEqual(path);
  });
});

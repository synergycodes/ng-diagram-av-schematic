import { describe, expect, it } from 'vitest';
import { type Point } from 'ng-diagram';
import { stretchPolyline, stretchPolylineWithBendInsertion } from './stretch';

const lShape: Point[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
];

describe('stretchPolyline', () => {
  it('rigidly translates when both ends move by the same delta', () => {
    const result = stretchPolyline(lShape, { x: 10, y: 10 }, { x: 110, y: 110 });
    expect(result).toEqual([
      { x: 10, y: 10 },
      { x: 110, y: 10 },
      { x: 110, y: 110 },
    ]);
  });

  it('slides the touching bend when only the source moves', () => {
    const result = stretchPolyline(lShape, { x: 0, y: 20 }, null);
    // First segment was horizontal, so the adjacent bend follows the new Y.
    expect(result).toEqual([
      { x: 0, y: 20 },
      { x: 100, y: 20 },
      { x: 100, y: 100 },
    ]);
  });

  it('returns null when the move cannot stay orthogonal with a fixed bend', () => {
    const straight: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ];
    // Moving the source off-axis leaves the interior point diagonal -> null.
    expect(stretchPolyline(straight, { x: 0, y: 40 }, null)).toBeNull();
  });
});

describe('stretchPolylineWithBendInsertion', () => {
  it('re-anchors a moved component while preserving the valid interior route', () => {
    const manualRoute: Point[] = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 60 },
      { x: 80, y: 60 },
      { x: 80, y: 100 },
    ];

    const result = stretchPolylineWithBendInsertion(manualRoute, { x: 20, y: 20 }, null);

    expect(result).toEqual([
      { x: 20, y: 20 },
      { x: 40, y: 20 },
      { x: 40, y: 60 },
      { x: 80, y: 60 },
      { x: 80, y: 100 },
    ]);
    expect(manualRoute[0]).toEqual({ x: 0, y: 0 });
  });

  it('inserts an L-bend when strict stretch fails', () => {
    const straight: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ];
    const result = stretchPolylineWithBendInsertion(straight, { x: 0, y: 40 }, null);
    expect(result).not.toBeNull();
    const points = result ?? [];
    // Stays orthogonal end-to-end.
    for (let i = 0; i < points.length - 1; i++) {
      const sameX = points[i].x === points[i + 1].x;
      const sameY = points[i].y === points[i + 1].y;
      expect(sameX || sameY).toBe(true);
    }
    expect(points[0]).toEqual({ x: 0, y: 40 });
  });

  it('keeps collinear bends when merge is false (deferred simplification)', () => {
    // A rigid translation of an already-collinear run: merging would fold the
    // middle point; with merge=false it must survive until drop.
    const collinear: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ];
    const merged = stretchPolylineWithBendInsertion(
      collinear,
      { x: 10, y: 0 },
      { x: 110, y: 0 },
      true,
    );
    const deferred = stretchPolylineWithBendInsertion(
      collinear,
      { x: 10, y: 0 },
      { x: 110, y: 0 },
      false,
    );
    expect(merged).toHaveLength(2);
    expect(deferred).toHaveLength(3);
  });
});

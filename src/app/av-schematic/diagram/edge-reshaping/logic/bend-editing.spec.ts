import { type Point } from 'ng-diagram';
import { describe, expect, it } from 'vitest';
import {
  findBendHandles,
  insertBendAt,
  isOrthogonalPolyline,
  moveBendTo,
  removeBendAt,
} from './bend-editing';

const straight: Point[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
];

describe('findBendHandles', () => {
  it('returns the interior vertices where an orthogonal route changes direction', () => {
    const route: Point[] = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 60 },
      { x: 100, y: 60 },
    ];

    expect(findBendHandles(route)).toEqual([
      { bendIndex: 1, point: { x: 40, y: 0 } },
      { bendIndex: 2, point: { x: 40, y: 60 } },
    ]);
  });

  it('skips a collinear point without renumbering the following real bend', () => {
    const route: Point[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 60 },
    ];

    expect(findBendHandles(route)).toEqual([{ bendIndex: 2, point: { x: 40, y: 0 } }]);
  });
});

describe('insertBendAt', () => {
  it('creates a snapped orthogonal jog without moving either endpoint', () => {
    const result = insertBendAt(straight, 0, { x: 43, y: 33 }, { x: 20, y: 20 });

    expect(result).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 100, y: 40 },
      { x: 100, y: 0 },
    ]);
    expect(isOrthogonalPolyline(result ?? [])).toBe(true);
    expect(straight).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
  });

  it('keeps a click near an endpoint on the nearest interior grid line', () => {
    const result = insertBendAt(straight, 0, { x: 1, y: 33 }, { x: 20, y: 20 });

    expect(result).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 40 },
      { x: 100, y: 40 },
      { x: 100, y: 0 },
    ]);
  });

  it('snaps deterministically near the opposite endpoint of a reversed segment', () => {
    const result = insertBendAt(
      [
        { x: 100, y: 0 },
        { x: 0, y: 0 },
      ],
      0,
      { x: 99, y: -33 },
      { x: 20, y: 20 },
    );

    expect(result).toEqual([
      { x: 100, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: -40 },
      { x: 0, y: -40 },
      { x: 0, y: 0 },
    ]);
  });

  it('rejects a snapped jog when a short segment has no interior grid line', () => {
    expect(
      insertBendAt(
        [
          { x: 1, y: 0 },
          { x: 19, y: 0 },
        ],
        0,
        { x: 10, y: 30 },
        { x: 20, y: 20 },
      ),
    ).toBeNull();
  });

  it('uses a global grid line for a jog whose base segment is off-grid', () => {
    const result = insertBendAt(
      [
        { x: 3, y: 7 },
        { x: 103, y: 7 },
      ],
      0,
      { x: 41, y: 8 },
      { x: 20, y: 20 },
    );

    expect(result).toEqual([
      { x: 3, y: 7 },
      { x: 40, y: 7 },
      { x: 40, y: 20 },
      { x: 103, y: 20 },
      { x: 103, y: 7 },
    ]);
  });

  it('rejects an oblique segment', () => {
    expect(
      insertBendAt(
        [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ],
        0,
        { x: 40, y: 40 },
        null,
      ),
    ).toBeNull();
  });
});

describe('removeBendAt', () => {
  it('removes the smallest complete jog that keeps the route orthogonal', () => {
    const jog = insertBendAt(straight, 0, { x: 43, y: 33 }, { x: 20, y: 20 });
    expect(jog).not.toBeNull();
    expect(removeBendAt(jog ?? [], 2)).toEqual(straight);
  });

  it('keeps a structural L bend between fixed endpoints', () => {
    const route: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    expect(removeBendAt(route, 1)).toBeNull();
  });

  it('preserves a valid reversal left after removing a neighbouring jog', () => {
    const route: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
      { x: 50, y: 0 },
      { x: 80, y: 0 },
    ];

    expect(removeBendAt(route, 3)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 0 },
      { x: 80, y: 0 },
    ]);
  });
});

describe('moveBendTo', () => {
  it('snaps one bend and slides both incident segments', () => {
    const route: Point[] = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 100, y: 40 },
      { x: 100, y: 0 },
    ];

    const result = moveBendTo(route, 2, { x: 58, y: 73 }, { x: 20, y: 20 });
    expect(result).toEqual([
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 80 },
      { x: 100, y: 80 },
      { x: 100, y: 0 },
    ]);
    expect(isOrthogonalPolyline(result ?? [])).toBe(true);
  });

  it('inserts endpoint stubs when moving a bend adjacent to fixed ports', () => {
    const route: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const result = moveBendTo(route, 1, { x: 60, y: 40 }, null);

    expect(result?.at(0)).toEqual(route[0]);
    expect(result?.at(-1)).toEqual(route.at(-1));
    expect(isOrthogonalPolyline(result ?? [])).toBe(true);
  });
});

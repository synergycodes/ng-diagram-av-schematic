import { describe, expect, it } from 'vitest';
import { type Point } from 'ng-diagram';
import {
  collapseCollinearBends,
  dropSameAxisBends,
  normalizeRoute,
  removeStraightSegments,
} from './simplify';

describe('collapseCollinearBends', () => {
  it('folds a straight pass-through point', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(collapseCollinearBends(points)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
  });

  it('keeps a real L corner', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    expect(collapseCollinearBends(points)).toEqual(points);
  });

  it('keeps a U-turn extremum (not between its neighbours)', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 0 },
    ];
    expect(collapseCollinearBends(points)).toEqual(points);
  });

  it('returns a copy for short paths', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    const result = collapseCollinearBends(points);
    expect(result).toEqual(points);
    expect(result).not.toBe(points);
  });
});

describe('dropSameAxisBends', () => {
  it('drops a bend whose incoming and outgoing segments share a dominant axis', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 2 },
      { x: 100, y: 0 },
    ];
    expect(dropSameAxisBends(points)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
  });

  it('keeps a genuine L corner', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    expect(dropSameAxisBends(points)).toEqual(points);
  });

  it('keeps a same-axis reversal', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 0 },
    ];
    expect(dropSameAxisBends(points)).toEqual(points);
    expect(normalizeRoute(points)).toEqual(points);
  });
});

describe('removeStraightSegments', () => {
  it('drops a near-collinear interior point within tolerance', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 3 },
      { x: 100, y: 0 },
    ];
    expect(removeStraightSegments(points, 5)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
  });

  it('preserves both endpoints', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const result = removeStraightSegments(points, 5);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[result.length - 1]).toEqual({ x: 100, y: 100 });
  });

  it('preserves an aligned reversal and its internal excursion', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
    ];
    expect(removeStraightSegments(points, 5)).toEqual(points);
  });
});

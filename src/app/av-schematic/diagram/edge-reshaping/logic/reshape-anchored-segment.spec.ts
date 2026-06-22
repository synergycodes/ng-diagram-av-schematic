import type { Point } from 'ng-diagram';
import { describe, expect, it } from 'vitest';
import { reshapeAnchoredSegment } from './reshape-anchored-segment';

const path: Point[] = [
  { x: 0, y: 0 },
  { x: 50, y: 0 },
  { x: 50, y: 40 },
  { x: 100, y: 40 },
];

describe('reshapeAnchoredSegment', () => {
  it('grows an elbow off the target port when dragging the last segment', () => {
    const result = reshapeAnchoredSegment(path, 2, 'horizontal', 80, true, true);
    expect(result).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 80 },
      { x: 100, y: 80 },
      { x: 100, y: 40 },
    ]);
  });

  it('grows an elbow off the source port when dragging the first segment', () => {
    const result = reshapeAnchoredSegment(path, 0, 'horizontal', -20, true, true);
    expect(result).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: -20 },
      { x: 50, y: -20 },
      { x: 50, y: 40 },
      { x: 100, y: 40 },
    ]);
  });

  it('grows an elbow off a vertical end segment, keeping the port fixed', () => {
    const lShape: Point[] = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 50 },
    ];
    const result = reshapeAnchoredSegment(lShape, 1, 'vertical', 70, true, true);
    expect(result).toEqual([
      { x: 0, y: 0 },
      { x: 70, y: 0 },
      { x: 70, y: 50 },
      { x: 40, y: 50 },
    ]);
  });

  it('grows elbows at both ends of a single-segment wire', () => {
    const straight: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const result = reshapeAnchoredSegment(straight, 0, 'horizontal', 40, true, true);
    expect(result).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 40 },
      { x: 100, y: 40 },
      { x: 100, y: 0 },
    ]);
  });

  it('falls back to a plain slide for an interior segment', () => {
    const result = reshapeAnchoredSegment(path, 1, 'vertical', 70, true, true);
    expect(result).toEqual([
      { x: 0, y: 0 },
      { x: 70, y: 0 },
      { x: 70, y: 40 },
      { x: 100, y: 40 },
    ]);
  });

  it('does not mutate the input', () => {
    const snapshot = path.map((p) => ({ ...p }));
    reshapeAnchoredSegment(path, 2, 'horizontal', 80, true, true);
    expect(path).toEqual(snapshot);
  });
});

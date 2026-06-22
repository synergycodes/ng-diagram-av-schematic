import { describe, expect, it } from 'vitest';
import { deletePoint, insertPoint, reflowEndpoint, segmentMidpoint } from './index';

describe('insertPoint', () => {
  it('inserts at the given index without mutating the input', () => {
    const original = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const result = insertPoint(original, 1, { x: 50, y: 0 });

    expect(result).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(original).toHaveLength(2);
  });
});

describe('deletePoint', () => {
  it('removes the point at the given index without mutating the input', () => {
    const original = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ];
    const result = deletePoint(original, 1);

    expect(result).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(original).toHaveLength(3);
  });
});

describe('segmentMidpoint', () => {
  it('returns the average of two points', () => {
    expect(segmentMidpoint({ x: 0, y: 0 }, { x: 100, y: 200 })).toEqual({ x: 50, y: 100 });
  });
});

describe('reflowEndpoint', () => {
  const interiorPath = [
    { x: 0, y: 0 },
    { x: 80, y: 0 },
    { x: 80, y: 200 },
    { x: 220, y: 200 },
    { x: 300, y: 200 },
  ];

  it('moves the source endpoint and aligns the first interior bend in y', () => {
    const result = reflowEndpoint(interiorPath, 'source', { x: -40, y: 60 }, 'horizontal');

    expect(result).toEqual([
      { x: -40, y: 60 },
      { x: 80, y: 60 },
      { x: 80, y: 200 },
      { x: 220, y: 200 },
      { x: 300, y: 200 },
    ]);
  });

  it('moves the target endpoint and aligns the last interior bend in y', () => {
    const result = reflowEndpoint(interiorPath, 'target', { x: 360, y: 140 }, 'horizontal');

    expect(result).toEqual([
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 200 },
      { x: 220, y: 140 },
      { x: 360, y: 140 },
    ]);
  });

  it('preserves all other interior bend coordinates', () => {
    const result = reflowEndpoint(interiorPath, 'source', { x: 99, y: 11 }, 'horizontal');

    expect(result?.[2]).toEqual({ x: 80, y: 200 });
    expect(result?.[3]).toEqual({ x: 220, y: 200 });
  });

  it('returns null when the edge has fewer than 3 points', () => {
    const tooShort = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];

    expect(reflowEndpoint(tooShort, 'source', { x: 5, y: 5 }, 'horizontal')).toBeNull();
  });

  it('does not mutate the input array', () => {
    const snapshot = JSON.stringify(interiorPath);
    reflowEndpoint(interiorPath, 'source', { x: 9, y: 9 }, 'horizontal');
    expect(JSON.stringify(interiorPath)).toBe(snapshot);
  });
});

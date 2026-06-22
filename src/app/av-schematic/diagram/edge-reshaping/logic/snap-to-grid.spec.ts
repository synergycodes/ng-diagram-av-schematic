import { describe, expect, it } from 'vitest';
import { snapToGrid } from './snap-to-grid';

describe('snapToGrid', () => {
  const grid = { x: 10, y: 10 };

  it('returns a slice unchanged when the path has fewer than 4 points (L-shape)', () => {
    const lShape = [
      { x: 3, y: 7 },
      { x: 207, y: 7 },
      { x: 207, y: 213 },
    ];
    const result = snapToGrid(lShape, grid, 'horizontal');
    expect(result).toEqual(lShape);
    expect(result).not.toBe(lShape);
  });

  it('leaves source and target endpoints untouched', () => {
    const path = [
      { x: 3, y: 7 },
      { x: 78, y: 7 },
      { x: 78, y: 197 },
      { x: 223, y: 197 },
    ];
    const result = snapToGrid(path, grid, 'horizontal');
    expect(result[0]).toEqual({ x: 3, y: 7 });
    expect(result[3]).toEqual({ x: 223, y: 197 });
  });

  describe('horizontal source — first/last bend port-aligned axis preserved', () => {
    it('keeps first bend.y aligned with source.y and last bend.y aligned with target.y', () => {
      const path = [
        { x: 3, y: 7 },
        { x: 78, y: 7 },
        { x: 78, y: 197 },
        { x: 223, y: 197 },
      ];
      const result = snapToGrid(path, grid, 'horizontal');
      expect(result[1].y).toBe(7);
      expect(result[2].y).toBe(197);
    });

    it('snaps the shared x of the interior vertical segment', () => {
      const path = [
        { x: 3, y: 7 },
        { x: 78, y: 7 },
        { x: 78, y: 197 },
        { x: 223, y: 197 },
      ];
      const result = snapToGrid(path, grid, 'horizontal');
      expect(result[1].x).toBe(80);
      expect(result[2].x).toBe(80);
    });

    it('snaps the shared coord of every interior segment without breaking the port-aligned axis', () => {
      const path = [
        { x: 0, y: 0 },
        { x: 53, y: 0 },
        { x: 53, y: 47 },
        { x: 142, y: 47 },
        { x: 142, y: 100 },
        { x: 200, y: 100 },
      ];
      const result = snapToGrid(path, grid, 'horizontal');
      expect(result[0]).toEqual({ x: 0, y: 0 });
      expect(result[5]).toEqual({ x: 200, y: 100 });
      expect(result[1].y).toBe(0);
      expect(result[4].y).toBe(100);
      expect(result[1].x).toBe(50);
      expect(result[2].x).toBe(50);
      expect(result[2].y).toBe(50);
      expect(result[3].y).toBe(50);
      expect(result[3].x).toBe(140);
      expect(result[4].x).toBe(140);
    });
  });

  describe('vertical source — first/last bend port-aligned axis preserved', () => {
    it('keeps first bend.x aligned with source.x and last bend.x aligned with target.x', () => {
      const path = [
        { x: 7, y: 3 },
        { x: 7, y: 78 },
        { x: 197, y: 78 },
        { x: 197, y: 223 },
      ];
      const result = snapToGrid(path, grid, 'vertical');
      expect(result[1].x).toBe(7);
      expect(result[2].x).toBe(197);
    });

    it('snaps the shared y of the interior horizontal segment', () => {
      const path = [
        { x: 7, y: 3 },
        { x: 7, y: 78 },
        { x: 197, y: 78 },
        { x: 197, y: 223 },
      ];
      const result = snapToGrid(path, grid, 'vertical');
      expect(result[1].y).toBe(80);
      expect(result[2].y).toBe(80);
    });
  });

  describe('dangling (free) ends', () => {
    it('snaps a dangling target stub that would otherwise be left aligned', () => {
      const path = [
        { x: 3, y: 7 },
        { x: 78, y: 7 },
        { x: 78, y: 213 },
      ];
      const result = snapToGrid(path, grid, 'horizontal', { targetFree: true });
      // last (vertical) segment's shared x snaps; endpoint is no longer pinned
      expect(result[1].x).toBe(80);
      expect(result[2].x).toBe(80);
    });

    it('leaves a connected end alone while snapping the dangling end', () => {
      const path = [
        { x: 3, y: 7 },
        { x: 78, y: 7 },
        { x: 78, y: 213 },
      ];
      const result = snapToGrid(path, grid, 'horizontal', { targetFree: true });
      expect(result[0]).toEqual({ x: 3, y: 7 });
    });

    it('snaps a dangling source stub', () => {
      const path = [
        { x: 3, y: 7 },
        { x: 3, y: 78 },
        { x: 197, y: 78 },
      ];
      const result = snapToGrid(path, grid, 'vertical', { sourceFree: true });
      expect(result[0].x).toBe(0);
      expect(result[1].x).toBe(0);
    });
  });

  it('does not mutate the input', () => {
    const path = [
      { x: 3, y: 7 },
      { x: 78, y: 7 },
      { x: 78, y: 197 },
      { x: 223, y: 197 },
    ];
    const snapshot = JSON.stringify(path);
    snapToGrid(path, grid, 'horizontal');
    expect(JSON.stringify(path)).toBe(snapshot);
  });

  it('honours per-axis grid steps', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 53, y: 0 },
      { x: 53, y: 47 },
      { x: 200, y: 47 },
      { x: 200, y: 100 },
      { x: 300, y: 100 },
    ];
    const result = snapToGrid(path, { x: 25, y: 5 }, 'horizontal');
    expect(result[1].x).toBe(50);
    expect(result[2].x).toBe(50);
    expect(result[2].y).toBe(45);
    expect(result[3].y).toBe(45);
    expect(result[3].x).toBe(200);
    expect(result[4].x).toBe(200);
  });
});

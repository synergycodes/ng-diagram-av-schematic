import { describe, expect, it } from 'vitest';
import { getDefaultMinInteriorBends } from './get-default-min-interior-bends';

describe('getDefaultMinInteriorBends', () => {
  it('returns 2 for matching orientations (Z-shape, U-shape)', () => {
    expect(getDefaultMinInteriorBends('horizontal', 'horizontal')).toBe(2);
    expect(getDefaultMinInteriorBends('vertical', 'vertical')).toBe(2);
  });

  it('returns 1 for perpendicular orientations (L-shape)', () => {
    expect(getDefaultMinInteriorBends('horizontal', 'vertical')).toBe(1);
    expect(getDefaultMinInteriorBends('vertical', 'horizontal')).toBe(1);
  });

  it('returns 0 for same-orientation ports aligned on the perpendicular axis', () => {
    expect(
      getDefaultMinInteriorBends('horizontal', 'horizontal', { x: 0, y: 160 }, { x: 300, y: 160 }),
    ).toBe(0);
    expect(
      getDefaultMinInteriorBends('vertical', 'vertical', { x: 200, y: 0 }, { x: 200, y: 300 }),
    ).toBe(0);
  });

  it('keeps 2 for same-orientation ports that are not aligned', () => {
    expect(
      getDefaultMinInteriorBends('horizontal', 'horizontal', { x: 0, y: 160 }, { x: 300, y: 240 }),
    ).toBe(2);
  });

  it('treats near-aligned endpoints within tolerance as aligned', () => {
    expect(
      getDefaultMinInteriorBends('horizontal', 'horizontal', { x: 0, y: 160 }, { x: 300, y: 163 }),
    ).toBe(0);
  });
});

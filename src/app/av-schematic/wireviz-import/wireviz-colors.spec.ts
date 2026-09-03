import { describe, expect, it } from 'vitest';
import {
  WIREVIZ_COLOR_CODES,
  isWireColorPairCoherent,
  normalizeWireVizHexColor,
  resolveWireColor,
  wireVizCodeForColor,
} from './wireviz-colors';

describe('WireViz colors', () => {
  it('offers every documented single-color token', () => {
    expect(Object.keys(WIREVIZ_COLOR_CODES)).toEqual([
      'BK',
      'WH',
      'GY',
      'PK',
      'RD',
      'OG',
      'YE',
      'OL',
      'GN',
      'TQ',
      'LB',
      'BU',
      'VT',
      'BN',
      'BG',
      'IV',
      'SL',
      'CU',
      'SN',
      'SR',
      'GD',
    ]);
    expect(WIREVIZ_COLOR_CODES['OR']).toBeUndefined();
  });

  it('resolves palette tokens case-insensitively', () => {
    expect(resolveWireColor('og')).toEqual({ color: '#f2820d', colorCode: 'OG' });
  });

  it('preserves a WireViz-compatible custom hex token', () => {
    expect(resolveWireColor('#12abef')).toEqual({ color: '#12abef' });
    expect(normalizeWireVizHexColor('#abc')).toBe('#AABBCC');
  });

  it('preserves an unrendered WireViz token for a lossless round-trip', () => {
    expect(resolveWireColor('whbk')).toEqual({ colorCode: 'WHBK' });
  });

  it('derives an emittable token from palette and custom CSS hex colors', () => {
    expect(wireVizCodeForColor('#f7d417')).toBe('YE');
    expect(wireVizCodeForColor('#123456')).toBe('#123456');
    expect(wireVizCodeForColor('rebeccapurple')).toBeUndefined();
  });

  it('checks render-color coherence for known and hexadecimal tokens', () => {
    expect(isWireColorPairCoherent('#f7d417', 'YE')).toBe(true);
    expect(isWireColorPairCoherent('#abc', '#AABBCC')).toBe(true);
    expect(isWireColorPairCoherent('rebeccapurple', 'YE')).toBe(false);
    expect(isWireColorPairCoherent(undefined, '#123456')).toBe(true);
  });

  it('leaves opaque WireViz tokens valid when no single render color is known', () => {
    expect(isWireColorPairCoherent(undefined, 'WHBK')).toBe(true);
    expect(isWireColorPairCoherent('#ffffff', 'WHBK')).toBe(true);
  });
});

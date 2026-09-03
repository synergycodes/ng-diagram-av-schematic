import { describe, expect, it } from 'vitest';
import { collectNetIds, dimWireColor, edgeIdsInNet, resolveNetEmphasis } from './net-emphasis';

describe('resolveNetEmphasis', () => {
  it('highlights every wire in the selected net and dims the rest', () => {
    expect(resolveNetEmphasis('motor', 'motor', true)).toBe('highlighted');
    expect(resolveNetEmphasis('logic', 'motor', true)).toBe('dimmed');
    expect(resolveNetEmphasis(undefined, 'motor', true)).toBe('dimmed');
  });

  it('keeps unrelated wires normal when dimming is disabled', () => {
    expect(resolveNetEmphasis('logic', 'motor', false)).toBe('normal');
  });
});

describe('net grouping', () => {
  const wires = [
    { id: 'w3', netId: 'logic' },
    { id: 'w1', netId: 'motor' },
    { id: 'w2', netId: 'motor' },
    { id: 'w4' },
  ];

  it('lists stable distinct net ids', () => {
    expect(collectNetIds(wires)).toEqual(['logic', 'motor']);
  });

  it('returns every physical wire belonging to one net', () => {
    expect(edgeIdsInNet(wires, 'motor')).toEqual(['w1', 'w2']);
  });
});

describe('dimWireColor', () => {
  it('keeps a literal hex hue with reduced opacity', () => {
    expect(dimWireColor('#abc')).toBe('#aabbcc59');
    expect(dimWireColor('#123456')).toBe('#12345659');
  });
});

import { describe, expect, it } from 'vitest';
import { describeWireColorEmission } from './wireviz-color-report';

describe('describeWireColorEmission', () => {
  it('emits a stored WireViz palette color', () => {
    expect(describeWireColorEmission({ color: '#f7d417', colorCode: 'YE' })).toEqual({
      kind: 'palette',
      code: 'YE',
      color: '#f7d417',
    });
  });

  it('fills the render color from a known WireViz token', () => {
    expect(describeWireColorEmission({ colorCode: 'YE' })).toEqual({
      kind: 'palette',
      code: 'YE',
      color: '#f7d417',
    });
  });

  it('emits a custom hexadecimal color as a WireViz hex token', () => {
    expect(describeWireColorEmission({ color: '#123456' })).toEqual({
      kind: 'custom-emittable',
      color: '#123456',
      token: '#123456',
    });
  });

  it('normalizes a stored WireViz hex token even when no render color is present', () => {
    expect(describeWireColorEmission({ colorCode: '#abc' })).toEqual({
      kind: 'custom-emittable',
      color: '#AABBCC',
      token: '#AABBCC',
    });
  });

  it('keeps an unrendered imported token emittable without calling it custom', () => {
    expect(describeWireColorEmission({ colorCode: 'WHBK' })).toEqual({
      kind: 'wireviz-opaque',
      color: undefined,
      token: 'WHBK',
    });
  });

  it('reports a CSS color that WireViz cannot express', () => {
    expect(describeWireColorEmission({ color: 'rebeccapurple' })).toEqual({
      kind: 'custom-unemittable',
      color: 'rebeccapurple',
    });
  });

  it('does not collapse an explicit custom RGB onto an equal palette entry', () => {
    expect(describeWireColorEmission({ color: '#e2231a' })).toEqual({
      kind: 'custom-emittable',
      color: '#e2231a',
      token: '#E2231A',
    });
  });
});

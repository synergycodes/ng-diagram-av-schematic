import { describe, expect, it } from 'vitest';
import { stringifyYamlSubset } from './wireviz-yaml-emit';
import { parseYamlSubset, WireVizYamlError, type YamlValue } from './wireviz-yaml';

describe('parseYamlSubset', () => {
  it('parses a flat mapping', () => {
    expect(parseYamlSubset('a: 1\nb: two\nc: true')).toEqual({ a: 1, b: 'two', c: true });
  });

  it('parses nested mappings', () => {
    const yaml = ['connectors:', '  NANO:', '    type: Arduino Nano'].join('\n');
    expect(parseYamlSubset(yaml)).toEqual({ connectors: { NANO: { type: 'Arduino Nano' } } });
  });

  it('parses inline flow sequences, including quoted items', () => {
    expect(parseYamlSubset('pins: [D8, D9, "5V"]')).toEqual({ pins: ['D8', 'D9', '5V'] });
  });

  it('strips comments outside of quotes', () => {
    const yaml = [
      'a: 1 # trailing comment',
      '# full line comment',
      'b: "value # not a comment"',
    ].join('\n');
    expect(parseYamlSubset(yaml)).toEqual({ a: 1, b: 'value # not a comment' });
  });

  it('parses a plain sequence of scalars', () => {
    const yaml = ['colors:', '  - RD', '  - BK'].join('\n');
    expect(parseYamlSubset(yaml)).toEqual({ colors: ['RD', 'BK'] });
  });

  it('parses a sequence of single-key mappings', () => {
    const yaml = ['items:', '  - NANO: [D9]', '  - W1: [1]'].join('\n');
    expect(parseYamlSubset(yaml)).toEqual({ items: [{ NANO: ['D9'] }, { W1: [1] }] });
  });

  it('expands compacted multi-dash lines into a list of lists (WireViz connections shape)', () => {
    const yaml = [
      'connections:',
      '  - - NANO: [D9]',
      '    - W1: [1]',
      '    - TB6612FNG: [PWMA]',
      '  - - NANO: [D8]',
      '    - W2: [1]',
      '    - TB6612FNG: [AIN1]',
    ].join('\n');

    expect(parseYamlSubset(yaml)).toEqual({
      connections: [
        [{ NANO: ['D9'] }, { W1: [1] }, { TB6612FNG: ['PWMA'] }],
        [{ NANO: ['D8'] }, { W2: [1] }, { TB6612FNG: ['AIN1'] }],
      ],
    });
  });

  it('rejects tabs used for indentation', () => {
    expect(() => parseYamlSubset('a:\n\t- 1')).toThrow(WireVizYamlError);
  });

  it('rejects a duplicate key in a flat mapping', () => {
    expect(() => parseYamlSubset('a: 1\nb: 2\na: 3')).toThrow(WireVizYamlError);
  });

  it('rejects a duplicate key in a nested mapping', () => {
    const yaml = ['connectors:', '  NANO:', '    type: Arduino Nano', '    type: duplicate'].join(
      '\n',
    );
    expect(() => parseYamlSubset(yaml)).toThrow(WireVizYamlError);
  });

  it('rejects a duplicate key introduced by an inline-then-continuation mapping', () => {
    const yaml = ['items:', '  - NANO: [D9]', '    NANO: [D8]'].join('\n');
    expect(() => parseYamlSubset(yaml)).toThrow(WireVizYamlError);
  });

  it.each(['__proto__', 'constructor', 'prototype'])('rejects the dangerous key "%s"', (key) => {
    expect(() => parseYamlSubset(`${key}: 1`)).toThrow(WireVizYamlError);
  });

  it('rejects a dangerous key nested inside a mapping', () => {
    const yaml = ['connectors:', '  __proto__:', '    type: x'].join('\n');
    expect(() => parseYamlSubset(yaml)).toThrow(WireVizYamlError);
  });

  it('does not let a dangerous key pollute the shared Object prototype', () => {
    expect(() => parseYamlSubset('__proto__: 1')).toThrow(WireVizYamlError);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('rejects unconsumed trailing content after the top-level value', () => {
    // "b" is indented under "a: 1", but "a" already has a scalar value, so
    // the extra indentation is not a valid nested block for any key.
    const yaml = ['a: 1', '  b: 2'].join('\n');
    expect(() => parseYamlSubset(yaml)).toThrow(WireVizYamlError);
  });

  it('rejects a document that dedents below the first line before ending', () => {
    const yaml = ['  a: 1', 'b: 2'].join('\n');
    expect(() => parseYamlSubset(yaml)).toThrow(WireVizYamlError);
  });
});

describe('stringifyYamlSubset', () => {
  it('round-trips nested mappings and connection sets', () => {
    const value: YamlValue = {
      connectors: { A: { pins: ['1'], subtype: 'revision-a' } },
      connections: [[{ A: ['1'] }, { B: ['P'] }]],
    };
    expect(parseYamlSubset(stringifyYamlSubset(value))).toEqual(value);
  });

  it('quotes numeric-looking strings so unknown fields keep their scalar type', () => {
    const value: YamlValue = { custom: '1', negative: '-2', decimal: '0.50' };
    const yaml = stringifyYamlSubset(value);
    expect(yaml).toContain('custom: "1"');
    expect(parseYamlSubset(yaml)).toEqual(value);
  });

  it('round-trips empty mappings and quoted keys with apostrophes', () => {
    const value: YamlValue = { extras: { 'owner\'s "bag"': {} } };
    expect(parseYamlSubset(stringifyYamlSubset(value))).toEqual(value);
  });
});

import { describe, expect, it } from 'vitest';
import { OPERATIONAL_LIMITS } from '../diagram/model/operational-limits.mjs';
import { MINIMAL_TWO_NETS_WIREVIZ_YAML } from './fixtures/minimal-two-nets.fixture';
import { MULTIDROP_RAIL_WIREVIZ_YAML } from './fixtures/multidrop-rail.fixture';
import { parseWireVizDocument, WireVizModelError } from './wireviz-model';
import { entriesWithCode } from './wireviz-report';
import { parseYamlSubset, type YamlValue } from './wireviz-yaml';

const parseFixture = () => parseWireVizDocument(parseYamlSubset(MINIMAL_TWO_NETS_WIREVIZ_YAML));

describe('parseWireVizDocument', () => {
  it('parses the two connectors and conductors declared in the issue #1 fixture', () => {
    const doc = parseFixture();
    expect(doc.connectors.map((connector) => connector.name).sort()).toEqual(['NANO', 'TB6612FNG']);
    expect(doc.conductors).toHaveLength(2);
  });

  it('links the correct pins and cable wire for the PWM conductor', () => {
    const pwm = parseFixture().conductors.find((conductor) => conductor.wire?.cable === 'W1');
    expect(pwm).toMatchObject({
      from: { connector: 'NANO', pin: 'D9' },
      to: { connector: 'TB6612FNG', pin: 'PWMA' },
      wire: { cable: 'W1', wireIndex: 1 },
    });
  });

  it('accepts reuse of one pin across connection sets as a fan-out', () => {
    const doc = parseWireVizDocument(parseYamlSubset(MULTIDROP_RAIL_WIREVIZ_YAML));
    expect(doc.conductors).toHaveLength(3);
    expect(
      doc.conductors.filter(
        (conductor) =>
          conductor.from.connector === 'RAIL_5V' || conductor.to.connector === 'RAIL_5V',
      ),
    ).toHaveLength(3);
  });

  it('preserves connector variants, cable attributes and unknown fields', () => {
    const doc = parseWireVizDocument(parseYamlSubset(MULTIDROP_RAIL_WIREVIZ_YAML));
    const supply = doc.connectors.find((connector) => connector.name === 'SUPPLY');
    const cable = doc.cables.find((candidate) => candidate.name === 'HARNESS');

    expect(supply).toMatchObject({
      type: 'XT30',
      subtype: 'female',
      pinLabels: ['5V source'],
      color: 'BK',
      manufacturer: 'Amass',
      mpn: 'XT30U-F',
      showName: false,
      extras: { 'x-source-tag': '1' },
    });
    expect(cable).toMatchObject({
      wireCount: 3,
      colors: ['RD', 'YE', 'BU'],
      wireLabels: ['feed', 'sensor', 'motor'],
      gauge: '0.50 mm2',
      length: '0.25 m',
      notes: 'Main 5 V fan-out',
      colorCode: 'DIN',
      extras: { shield: false, 'x-batch': ['alpha', 'beta'] },
    });
    expect(doc.extras).toEqual({ metadata: { title: 'Issue 2 multidrop rail' } });
    expect(entriesWithCode(doc.report, 'unknown-field').length).toBeGreaterThanOrEqual(4);
    expect(doc.cables.find((candidate) => candidate.name === 'SPARE')).toMatchObject({
      wireCount: 2,
      colors: ['#a1b2c3', 'GY'],
      wireLabels: ['unused-a', 'unused-b'],
    });
  });

  it('normalizes repeated cable colors to WireViz effective semantics', () => {
    const raw: YamlValue = {
      connectors: { A: { pins: [1, 2, 3] }, B: { pins: [1, 2, 3] } },
      cables: { C: { wirecount: 3, colors: ['RD'] } },
      connections: [[{ A: ['1-3'] }, { C: ['1-3'] }, { B: ['1-3'] }]],
    };
    const doc = parseWireVizDocument(raw);
    expect(doc.cables[0].colors).toEqual(['RD', 'RD', 'RD']);
    expect(entriesWithCode(doc.report, 'colors-normalized')).toHaveLength(1);
  });

  it('rejects mismatched parallel-connection widths instead of inventing a broadcast', () => {
    const raw: YamlValue = {
      connectors: {
        SOURCE: { pins: ['OUT'] },
        LOAD: { pins: ['A', 'B'] },
      },
      cables: { C1: { wirecount: 2, colors: ['RD', 'BK'] } },
      connections: [[{ SOURCE: ['OUT'] }, { C1: [1, 2] }, { LOAD: ['A', 'B'] }]],
    };
    expect(() => parseWireVizDocument(raw)).toThrow(/expected 2/);
  });

  it('infers numbered designators from pinlabels alone', () => {
    const raw: YamlValue = {
      connectors: { X1: { pinlabels: ['VCC', 'GND'] } },
      connections: [[{ X1: ['VCC'] }]],
    };
    const doc = parseWireVizDocument(raw);
    expect(doc.connectors[0].pins).toEqual(['1', '2']);
    expect(doc.connectors[0].pinLabels).toEqual(['VCC', 'GND']);
    expect(entriesWithCode(doc.report, 'inferred-pins')).toHaveLength(1);
  });

  it('resolves a pinlabel to its positional pin designator', () => {
    const raw: YamlValue = {
      connectors: {
        A: { pins: [1, 2], pinlabels: ['POWER', 'RETURN'] },
        B: { pins: ['P'] },
      },
      connections: [[{ A: ['RETURN'] }, '--', { B: ['P'] }]],
    };

    expect(parseWireVizDocument(raw).conductors[0].from).toEqual({ connector: 'A', pin: '2' });
  });

  it('rejects a pin reference that collides between a designator and another pinlabel', () => {
    const raw: YamlValue = {
      connectors: {
        A: { pins: [1, 2], pinlabels: ['POWER', '1'] },
        B: { pins: ['P'] },
      },
      connections: [[{ A: [1] }, '--', { B: ['P'] }]],
    };

    expect(() => parseWireVizDocument(raw)).toThrow(/ambiguous/);
  });

  it('resolves cable conductors by number, wirelabel and unambiguous color', () => {
    const raw: YamlValue = {
      connectors: {
        A: { pins: [1, 2, 3] },
        B: { pins: [1, 2, 3] },
      },
      cables: {
        C: {
          wirecount: 3,
          colors: ['RD', 'YE', 'BU'],
          wirelabels: ['feed', 'sensor', 'motor'],
        },
      },
      connections: [
        [{ A: [1] }, { C: ['feed'] }, { B: [1] }],
        [{ A: [2] }, { C: ['YE'] }, { B: [2] }],
        [{ A: [3] }, { C: [3] }, { B: [3] }],
      ],
    };

    expect(
      parseWireVizDocument(raw).conductors.map((conductor) => conductor.wire?.wireIndex),
    ).toEqual([1, 2, 3]);
  });

  it('rejects an ambiguous cable alias across number, wirelabel or repeated color', () => {
    const numericCollision: YamlValue = {
      connectors: { A: { pins: ['P'] }, B: { pins: ['P'] } },
      cables: { C: { wirecount: 2, colors: ['RD', 'YE'], wirelabels: ['2', 'other'] } },
      connections: [[{ A: ['P'] }, { C: ['2'] }, { B: ['P'] }]],
    };
    const colorCollision: YamlValue = {
      connectors: { A: { pins: ['P'] }, B: { pins: ['P'] } },
      cables: { C: { wirecount: 2, colors: ['RD', 'RD'] } },
      connections: [[{ A: ['P'] }, { C: ['RD'] }, { B: ['P'] }]],
    };

    expect(() => parseWireVizDocument(numericCollision)).toThrow(/ambiguous/);
    expect(() => parseWireVizDocument(colorCollision)).toThrow(/ambiguous/);
  });

  it('imports connector loops as explicit internal conductors using pinlabels', () => {
    const raw: YamlValue = {
      connectors: {
        X1: {
          pins: [1, 2, 3],
          pinlabels: ['IN', 'BUS-A', 'BUS-B'],
          loops: [['BUS-A', 'BUS-B']],
        },
      },
      connections: [],
    };
    const doc = parseWireVizDocument(raw);

    expect(doc.connectors[0].loops).toEqual([['2', '3']]);
    expect(doc.conductors).toEqual([
      expect.objectContaining({
        kind: 'loop',
        from: { connector: 'X1', pin: '2' },
        to: { connector: 'X1', pin: '3' },
      }),
    ]);
    expect(entriesWithCode(doc.report, 'loop-detected')).toHaveLength(1);
  });

  it('rejects duplicate or malformed connector loops', () => {
    const duplicate: YamlValue = {
      connectors: {
        X1: {
          pins: [1, 2],
          loops: [
            [1, 2],
            [2, 1],
          ],
        },
      },
      connections: [],
    };
    const selfLoop: YamlValue = {
      connectors: { X1: { pins: [1, 2], loops: [[1, 1]] } },
      connections: [],
    };

    expect(() => parseWireVizDocument(duplicate)).toThrow(/duplicate loop/);
    expect(() => parseWireVizDocument(selfLoop)).toThrow(/both ends/);
  });

  it('expands descending WireViz ranges', () => {
    const raw: YamlValue = {
      connectors: { A: { pins: [9, 8, 7] }, B: { pins: [9, 8, 7] } },
      cables: { C: { wirecount: 3 } },
      connections: [[{ A: ['9-7'] }, { C: ['3-1'] }, { B: ['9-7'] }]],
    };
    const doc = parseWireVizDocument(raw);
    expect(doc.conductors.map((conductor) => conductor.wire?.wireIndex)).toEqual([3, 2, 1]);
  });

  it('keeps a multi-pin style simple connector electrically distinct', () => {
    const raw: YamlValue = {
      connectors: { X1: { style: 'simple', pins: [1, 2] } },
      connections: [],
    };
    const connector = parseWireVizDocument(raw).connectors[0];
    expect(connector.isJunction).toBe(false);
    expect(connector.pins).toEqual(['1', '2']);
  });

  it('accepts a direct connector-to-connector link through a WireViz arrow', () => {
    const raw: YamlValue = {
      connectors: { A: { pins: ['P'] }, B: { pins: ['P'] } },
      connections: [[{ A: ['P'] }, '-->', { B: ['P'] }]],
    };
    expect(parseWireVizDocument(raw).conductors[0]).toMatchObject({
      from: { connector: 'A', pin: 'P' },
      to: { connector: 'B', pin: 'P' },
    });
    expect(parseWireVizDocument(raw).conductors[0].wire).toBeUndefined();
    expect(parseWireVizDocument(raw).conductors[0].link).toBe('-->');
  });

  it('rejects a connection referencing an undeclared pin', () => {
    const raw: YamlValue = {
      connectors: { NANO: { pins: ['D9'] }, TB6612FNG: { pins: ['PWMA'] } },
      cables: { W1: { colors: ['YE'] } },
      connections: [[{ NANO: ['D2'] }, { W1: [1] }, { TB6612FNG: ['PWMA'] }]],
    };
    expect(() => parseWireVizDocument(raw)).toThrow(WireVizModelError);
  });

  it('rejects object values instead of coercing them into pin labels', () => {
    const raw: YamlValue = {
      connectors: { NANO: { pins: [{ unexpected: 'D9' }] } },
      connections: [],
    };
    expect(() => parseWireVizDocument(raw)).toThrow(WireVizModelError);
  });

  it('rejects a connection set that ends on a cable', () => {
    const raw: YamlValue = {
      connectors: { NANO: { pins: ['D9'] } },
      cables: { W1: { colors: ['YE'] } },
      connections: [[{ NANO: ['D9'] }, { W1: [1] }]],
    };
    expect(() => parseWireVizDocument(raw)).toThrow(WireVizModelError);
  });

  it('rejects a wire index out of range for the cable', () => {
    const raw: YamlValue = {
      connectors: { A: { pins: ['P'] }, B: { pins: ['P'] } },
      cables: { W1: { colors: ['YE'] } },
      connections: [[{ A: ['P'] }, { W1: [2] }, { B: ['P'] }]],
    };
    expect(() => parseWireVizDocument(raw)).toThrow(WireVizModelError);
  });

  it('rejects a recognized boolean field with the wrong type', () => {
    const raw: YamlValue = {
      connectors: { A: { pins: ['P'], show_name: 'false' } },
      connections: [],
    };
    expect(() => parseWireVizDocument(raw)).toThrow(/show_name/);
  });

  it('rejects connector and cable declarations with the same name', () => {
    const raw: YamlValue = {
      connectors: { SHARED: { pins: ['P'] } },
      cables: { SHARED: { wirecount: 1 } },
      connections: [],
    };
    expect(() => parseWireVizDocument(raw)).toThrow(/both connector and cable/);
  });

  it('rejects dangerous keys even when they are nested in an unknown field', () => {
    const raw = JSON.parse(
      '{"connectors":{"A":{"pins":["P"],"x":{"constructor":"bad"}}},"connections":[]}',
    ) as YamlValue;
    expect(() => parseWireVizDocument(raw)).toThrow(/dangerous/);
  });

  it.each([
    ['below', OPERATIONAL_LIMITS.maxPinsPerComponent - 1, true],
    ['at', OPERATIONAL_LIMITS.maxPinsPerComponent, true],
    ['above', OPERATIONAL_LIMITS.maxPinsPerComponent + 1, false],
  ] as const)('enforces the pin-count limit %s the boundary', (_label, pinCount, accepted) => {
    const raw: YamlValue = {
      connectors: { X1: { pincount: pinCount } },
      connections: [],
    };
    const parse = () => parseWireVizDocument(raw);
    if (accepted) expect(parse).not.toThrow();
    else expect(parse).toThrow(/pin count.*operational limit/);
  });

  it.each([
    ['below', OPERATIONAL_LIMITS.maxWiresPerCable - 1, true],
    ['at', OPERATIONAL_LIMITS.maxWiresPerCable, true],
    ['above', OPERATIONAL_LIMITS.maxWiresPerCable + 1, false],
  ] as const)('enforces the wire-count limit %s the boundary', (_label, wireCount, accepted) => {
    const raw: YamlValue = {
      connectors: {},
      cables: { C: { wirecount: wireCount, colors: ['RD'] } },
      connections: [],
    };
    const parse = () => parseWireVizDocument(raw);
    if (accepted) expect(parse).not.toThrow();
    else expect(parse).toThrow(/wire count.*operational limit/);
  });

  it.each([
    ['below', OPERATIONAL_LIMITS.maxExpandedRange - 1, true],
    ['at', OPERATIONAL_LIMITS.maxExpandedRange, true],
    ['above', OPERATIONAL_LIMITS.maxExpandedRange + 1, false],
  ] as const)('enforces the range-expansion limit %s the boundary', (_label, width, accepted) => {
    const pins = Array.from(
      { length: Math.min(width, OPERATIONAL_LIMITS.maxPinsPerComponent) },
      (_, i) => i + 1,
    );
    const raw: YamlValue = {
      connectors: { A: { pins }, B: { pins } },
      connections: [[{ A: [`1-${width}`] }, '--', { B: [`1-${width}`] }]],
    };
    const parse = () => parseWireVizDocument(raw);
    if (accepted) expect(parse).not.toThrow();
    else expect(parse).toThrow(/range expansion.*operational limit/);
  });

  it.each([
    ['below', OPERATIONAL_LIMITS.maxTotalEntities - 1, true],
    ['at', OPERATIONAL_LIMITS.maxTotalEntities, true],
    ['above', OPERATIONAL_LIMITS.maxTotalEntities + 1, false],
  ] as const)('enforces the total-entity limit %s the boundary', (_label, total, accepted) => {
    const raw = wireVizCableBudgetDocument(total);
    const parse = () => parseWireVizDocument(raw);
    if (accepted) expect(parse).not.toThrow();
    else expect(parse).toThrow(/total entity.*operational limit/);
  });

  it('rejects unsafe integer counts and range endpoints', () => {
    expect(() =>
      parseWireVizDocument({
        connectors: { X1: { pincount: Number.MAX_SAFE_INTEGER + 1 } },
        connections: [],
      }),
    ).toThrow(/safe positive integer/);
    expect(() =>
      parseWireVizDocument({
        connectors: { A: { pins: [1] }, B: { pins: [1] } },
        connections: [[{ A: [`1-${Number.MAX_SAFE_INTEGER + 1}`] }, '--', { B: [1] }]],
      }),
    ).toThrow(/safe integer/);
  });
});

function wireVizCableBudgetDocument(total: number): YamlValue {
  const cables: Record<string, YamlValue> = {};
  let remaining = total;
  let index = 0;
  while (remaining >= 2) {
    const wireCount = Math.min(OPERATIONAL_LIMITS.maxWiresPerCable, remaining - 1);
    cables[`C${index++}`] = { wirecount: wireCount };
    remaining -= wireCount + 1;
  }
  if (remaining === 1) cables[`C${index}`] = { wirecount: 1 };
  return { connectors: {}, cables, connections: [] };
}

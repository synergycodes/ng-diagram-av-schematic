import { describe, expect, it } from 'vitest';
import { DxfDocument } from './dxf-document';
import { DxfCircle, DxfLwPolyline, DxfText } from './dxf-entity';
import { formatCoord } from './dxf-format';
import { DxfLayer } from './dxf-layer';
import { DxfTextStyle } from './dxf-text-style';
import { DxfWriter } from './dxf-writer';

/**
 * AutoCAD parses DXF strictly according to the declared $ACADVER and rejects
 * R2000+ files missing any piece of the structural skeleton ("Invalid or
 * incomplete DXF input -- drawing discarded"). Online viewers are lenient, so
 * these regressions only surface when a user opens the export in real
 * AutoCAD - this spec encodes the requirements at the tag level instead.
 *
 * The parsing helpers are deliberately unforgiving: they fail on unterminated
 * sections/tables, broken code/value framing, and records missing their own
 * 0/<TYPE> marker, so a structural regression cannot hide inside a lenient
 * helper while the assertions stay green.
 */

interface Pair {
  readonly code: number;
  readonly value: string;
}

const parsePairs = (dxf: string): Pair[] => {
  const lines = dxf.split('\n');
  // Strict code/value framing: an odd line count or a non-numeric code line
  // means a value (e.g. unsanitized text) corrupted the pairing.
  expect(lines.length % 2, 'even code/value line count').toBe(0);
  const pairs: Pair[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    expect(lines[i], `numeric group code at line ${i + 1}`).toMatch(/^\s*-?\d+$/);
    pairs.push({ code: Number(lines[i].trim()), value: lines[i + 1] });
  }
  return pairs;
};

const sectionOf = (pairs: readonly Pair[], name: string): Pair[] => {
  const start = pairs.findIndex(
    (pair, i) =>
      pair.code === 0 &&
      pair.value === 'SECTION' &&
      pairs[i + 1]?.code === 2 &&
      pairs[i + 1]?.value === name,
  );
  expect(start, `SECTION ${name} exists`).toBeGreaterThanOrEqual(0);
  const slice: Pair[] = [];
  for (let i = start + 2; i < pairs.length; i++) {
    const pair = pairs[i];
    if (pair.code === 0 && pair.value === 'ENDSEC') {
      return slice;
    }
    if (pair.code === 0 && pair.value === 'SECTION') {
      throw new Error(`SECTION ${name} not closed by ENDSEC before the next SECTION`);
    }
    slice.push(pair);
  }
  throw new Error(`SECTION ${name} has no ENDSEC`);
};

const tableOf = (tablesSection: readonly Pair[], name: string): Pair[] => {
  const start = tablesSection.findIndex(
    (pair, i) =>
      pair.code === 0 &&
      pair.value === 'TABLE' &&
      tablesSection[i + 1]?.code === 2 &&
      tablesSection[i + 1]?.value === name,
  );
  expect(start, `TABLE ${name} exists`).toBeGreaterThanOrEqual(0);
  const slice: Pair[] = [];
  for (let i = start + 2; i < tablesSection.length; i++) {
    const pair = tablesSection[i];
    if (pair.code === 0 && pair.value === 'ENDTAB') {
      return slice;
    }
    if (pair.code === 0 && (pair.value === 'TABLE' || pair.value === 'SECTION')) {
      throw new Error(`TABLE ${name} not closed by ENDTAB before the next table/section`);
    }
    slice.push(pair);
  }
  throw new Error(`TABLE ${name} has no ENDTAB`);
};

/**
 * Split a section/table slice into its records: each record starts at its own
 * 0/<recordType> marker and runs to the next code-0 group. Groups belonging
 * to a record whose marker is missing are attributed to the previous record,
 * so name/structure assertions on the returned records catch dropped markers.
 */
const recordsOf = (slice: readonly Pair[], recordType: string): Pair[][] => {
  const records: Pair[][] = [];
  let current: Pair[] | undefined;
  for (const pair of slice) {
    if (pair.code === 0) {
      current = pair.value === recordType ? [] : undefined;
      if (current) {
        records.push(current);
      }
      continue;
    }
    current?.push(pair);
  }
  return records;
};

const recordNames = (slice: readonly Pair[], recordType: string): (string | undefined)[] =>
  recordsOf(slice, recordType).map((record) => record.find((pair) => pair.code === 2)?.value);

const buildDoc = (): DxfDocument => {
  const doc = new DxfDocument();
  doc.setHeaderVar('$ACADVER', [{ code: 1, value: 'AC1027' }]);
  doc.setHeaderVar('$EXTMIN', [
    { code: 10, value: formatCoord(0) },
    { code: 20, value: formatCoord(0) },
    { code: 30, value: formatCoord(0) },
  ]);
  doc.setHeaderVar('$EXTMAX', [
    { code: 10, value: formatCoord(570) },
    { code: 20, value: formatCoord(234) },
    { code: 30, value: formatCoord(0) },
  ]);
  doc.addLayer(new DxfLayer('DEVICES', 7));
  doc.addLayer(new DxfLayer('WIRES', 7));
  // BOLD first, so the DIMSTYLE test can verify DIMTXSTY binds to the style
  // named Standard rather than to the first registered style.
  doc.addTextStyle(new DxfTextStyle('BOLD', true));
  doc.addTextStyle(new DxfTextStyle('STANDARD'));
  doc.addEntity(
    new DxfLwPolyline(
      'DEVICES',
      [
        { x: 15, y: 189 },
        { x: 87, y: 189 },
        { x: 87, y: 153 },
      ],
      true,
      undefined,
      25,
    ),
  );
  doc.addEntity(new DxfCircle('DEVICES', 42, 43, 2.5, undefined, 25));
  doc.addEntity(new DxfText('DEVICES', 'MIC-1', 51, 184, 4.2, 'BOLD', 1, 2));
  doc.addEntity(new DxfText('WIRES', 'W-001', 98, 159, 3));
  // Exercises sanitizeDxfText: % must not survive as a %%-format code and
  // control characters must not break the code/value line framing.
  doc.addEntity(new DxfText('WIRES', '50%\nA\tB', 10, 10, 3, 'STANDARD', 2, 3));
  return doc;
};

const dxf = new DxfWriter().serialize(buildDoc());
const pairs = parsePairs(dxf);
const tables = sectionOf(pairs, 'TABLES');

describe('DxfWriter AutoCAD skeleton', () => {
  it('emits the sections of an R2000+ file in order and terminates with EOF', () => {
    const names: string[] = [];
    pairs.forEach((pair, i) => {
      if (pair.code === 0 && pair.value === 'SECTION') {
        names.push(pairs[i + 1].value);
      }
    });
    expect(names).toEqual(['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS']);
    expect(pairs.at(-1)).toEqual({ code: 0, value: 'EOF' });
    // Every section closes: sectionOf throws on a missing/late ENDSEC.
    for (const name of names) {
      sectionOf(pairs, name);
    }
  });

  it('writes every symbol table AutoCAD requires in R2000+ files', () => {
    for (const name of [
      'VPORT',
      'LTYPE',
      'LAYER',
      'STYLE',
      'VIEW',
      'UCS',
      'APPID',
      'DIMSTYLE',
      'BLOCK_RECORD',
    ]) {
      tableOf(tables, name);
    }
  });

  it('registers every XDATA application name (group 1001) in the APPID table', () => {
    const used = new Set(pairs.filter((pair) => pair.code === 1001).map((pair) => pair.value));
    expect(used.size).toBeGreaterThan(0);
    const registered = recordNames(tableOf(tables, 'APPID'), 'APPID');
    for (const name of used) {
      expect(registered, `appid ${name} registered`).toContain(name);
    }
  });

  it('always defines layer 0 alongside the document layers', () => {
    const layers = recordNames(tableOf(tables, 'LAYER'), 'LAYER');
    expect(layers).toEqual(['0', 'DEVICES', 'WIRES']);
  });

  it('gives every LAYER record the R2000+ lineweight and plot-style trailer', () => {
    const layers = recordsOf(tableOf(tables, 'LAYER'), 'LAYER');
    expect(layers.length).toBe(3);
    for (const record of layers) {
      expect(record.some((pair) => pair.code === 370)).toBe(true);
      // Resolution of the 390 pointer is covered by the handles test.
      expect(record.some((pair) => pair.code === 390)).toBe(true);
    }
  });

  it('defines the mandatory ByBlock, ByLayer and Continuous linetypes', () => {
    const linetypes = recordNames(tableOf(tables, 'LTYPE'), 'LTYPE');
    expect(linetypes).toEqual(['ByBlock', 'ByLayer', 'Continuous']);
  });

  it('defines model/paper space block records and matching block definitions', () => {
    const records = recordNames(tableOf(tables, 'BLOCK_RECORD'), 'BLOCK_RECORD');
    expect(records).toEqual(['*Model_Space', '*Paper_Space']);
    const defined = recordNames(sectionOf(pairs, 'BLOCKS'), 'BLOCK');
    expect(defined).toContain('*Model_Space');
    expect(defined).toContain('*Paper_Space');
  });

  it('writes the DIMSTYLE record with its handle in group 105, bound to the STANDARD style', () => {
    const records = recordsOf(tableOf(tables, 'DIMSTYLE'), 'DIMSTYLE');
    expect(records.length).toBe(1);
    const record = records[0];
    expect(record.find((pair) => pair.code === 2)?.value).toBe('Standard');
    // DIMSTYLE records carry their handle in group 105, not 5.
    expect(record.some((pair) => pair.code === 105)).toBe(true);
    expect(record.some((pair) => pair.code === 5)).toBe(false);
    // DIMTXSTY (340) points at the style named Standard (the fixture
    // registers BOLD first).
    const styles = recordsOf(tableOf(tables, 'STYLE'), 'STYLE');
    const standard = styles.find((r) => r.find((pair) => pair.code === 2)?.value === 'STANDARD');
    const standardHandle = standard?.find((pair) => pair.code === 5)?.value;
    expect(standardHandle).toBeDefined();
    expect(record.find((pair) => pair.code === 340)?.value).toBe(standardHandle);
  });

  it('writes the named-object dictionary tree with well-formed Model and Layout1 layouts', () => {
    const objects = sectionOf(pairs, 'OBJECTS');
    const dictEntries = objects.filter((pair) => pair.code === 3).map((pair) => pair.value);
    for (const entry of ['ACAD_GROUP', 'ACAD_LAYOUT', 'ACAD_PLOTSTYLENAME']) {
      expect(dictEntries).toContain(entry);
    }
    const layouts = recordsOf(objects, 'LAYOUT');
    const names = layouts.map((record) => {
      // Each LAYOUT must carry AcDbPlotSettings followed by AcDbLayout; the
      // layout name is the first group 1 AFTER its own AcDbLayout marker.
      const plot = record.findIndex(
        (pair) => pair.code === 100 && pair.value === 'AcDbPlotSettings',
      );
      const marker = record.findIndex((pair) => pair.code === 100 && pair.value === 'AcDbLayout');
      expect(plot, 'AcDbPlotSettings subclass present').toBeGreaterThanOrEqual(0);
      expect(marker, 'AcDbLayout subclass after plot settings').toBeGreaterThan(plot);
      return record.slice(marker + 1).find((pair) => pair.code === 1)?.value;
    });
    expect([...names].sort()).toEqual(['Layout1', 'Model']);
  });

  it('keeps handles unique, resolvable and below $HANDSEED', () => {
    const defined = new Set<string>();
    let handseed: number | undefined;
    pairs.forEach((pair, i) => {
      const isHandseedValue = pairs[i - 1]?.code === 9 && pairs[i - 1]?.value === '$HANDSEED';
      if (isHandseedValue) {
        handseed = parseInt(pair.value, 16);
        return;
      }
      if (pair.code === 5 || pair.code === 105) {
        expect(defined.has(pair.value), `duplicate handle ${pair.value}`).toBe(false);
        defined.add(pair.value);
      }
    });
    if (handseed === undefined) {
      throw new Error('$HANDSEED missing from HEADER');
    }
    for (const handle of defined) {
      expect(parseInt(handle, 16)).toBeLessThan(handseed);
    }
    // Every pointer (owner / hard reference) must resolve to a defined handle.
    for (const pair of pairs) {
      if ([330, 340, 350, 390].includes(pair.code) && pair.value !== '0') {
        expect(defined.has(pair.value), `dangling reference ${pair.code}/${pair.value}`).toBe(true);
      }
    }
  });

  it('serializes TEXT justification faithfully, with 3D points and a spec-shaped subclass split', () => {
    const texts = recordsOf(sectionOf(pairs, 'ENTITIES'), 'TEXT');
    // Expected 72/73 values mirror the DxfText constructor args in buildDoc.
    const expected = [
      { halign: '1', valign: '2' }, // MIC-1
      { halign: '0', valign: '0' }, // W-001
      { halign: '2', valign: '3' }, // sanitize probe
    ];
    expect(texts.length).toBe(expected.length);
    texts.forEach((record, t) => {
      expect(record.some((pair) => pair.code === 30)).toBe(true);
      const markers = record
        .map((pair, i) => (pair.code === 100 && pair.value === 'AcDbText' ? i : -1))
        .filter((i) => i >= 0);
      expect(markers.length).toBe(2);
      // Only group 73 is valid after the second AcDbText subclass marker.
      expect(record.slice(markers[1] + 1).map((pair) => pair.code)).toEqual([73]);
      expect(record.find((pair) => pair.code === 72)?.value).toBe(expected[t].halign);
      expect(record.at(-1)).toEqual({ code: 73, value: expected[t].valign });
      const aligned = expected[t].halign !== '0' || expected[t].valign !== '0';
      if (aligned) {
        // The alignment point belongs inside the first AcDbText subclass.
        for (const code of [11, 21, 31]) {
          const index = record.findIndex((pair) => pair.code === code);
          expect(index, `group ${code} after first AcDbText marker`).toBeGreaterThan(markers[0]);
          expect(index, `group ${code} before second AcDbText marker`).toBeLessThan(markers[1]);
        }
      }
    });
  });

  it('serializes physical holes as spec-shaped CIRCLE entities', () => {
    const circles = recordsOf(sectionOf(pairs, 'ENTITIES'), 'CIRCLE');
    expect(circles).toHaveLength(1);
    expect(circles[0]).toEqual(
      expect.arrayContaining([
        { code: 100, value: 'AcDbCircle' },
        { code: 10, value: formatCoord(42) },
        { code: 20, value: formatCoord(43) },
        { code: 30, value: formatCoord(0) },
        { code: 40, value: formatCoord(2.5) },
        { code: 370, value: '25' },
      ]),
    );
  });

  it('sanitizes TEXT content that would break group framing or trigger %% format codes', () => {
    const texts = recordsOf(sectionOf(pairs, 'ENTITIES'), 'TEXT');
    const values = texts.map((record) => record.find((pair) => pair.code === 1)?.value);
    // Input '50%\nA\tB': % escaped to %%%, newline/tab collapsed to spaces.
    expect(values).toContain('50%%% A B');
  });

  it('attaches TrueType XDATA under the registered ACAD appid, closing each STYLE record', () => {
    const styles = recordsOf(tableOf(tables, 'STYLE'), 'STYLE');
    expect(styles.length).toBe(2);
    for (const record of styles) {
      const xdataStart = record.findIndex((pair) => pair.code >= 1000);
      expect(record[xdataStart], 'XDATA opens with the registered appid').toEqual({
        code: 1001,
        value: 'ACAD',
      });
      // XDATA must close the record: no regular group may follow it.
      expect(record.slice(xdataStart).every((pair) => pair.code >= 1000)).toBe(true);
    }
    const flags = styles.map((record) => record.find((pair) => pair.code === 1071)?.value);
    expect(flags).toEqual([String(0x2000000), '0']); // BOLD registered first
  });
});

// Shared adversarial corpus for the TypeScript and plain-Node validators.

import { OPERATIONAL_LIMITS } from './operational-limits.mjs';

function holes(rows, cols) {
  return Array.from({ length: rows * cols }, (_, index) => ({
    row: Math.floor(index / cols),
    col: index % cols,
  }));
}

function basePhysicalProject() {
  const junctionId = 'copper:board-17/trace%3Avcc';
  return {
    formatVersion: 2,
    electrical: {
      components: [
        {
          id: 'link-1',
          deviceId: 'LINK-1',
          manufacturer: 'project',
          model: 'link',
          pins: [
            { id: 'a', label: 'A', direction: 'input' },
            { id: 'b', label: 'B', direction: 'output' },
          ],
        },
      ],
      junctions: [{ id: junctionId, label: 'VCC rail', kind: 'rail', wirevizName: junctionId }],
      cables: [],
      nets: [
        {
          id: 'net-authored',
          name: 'AUTHORED',
          endpoints: [
            { kind: 'pin', componentId: 'link-1', pinId: 'a' },
            { kind: 'pin', componentId: 'link-1', pinId: 'b' },
            { kind: 'junction', junctionId },
          ],
          conductors: [
            {
              id: 'binding:link-1/a',
              from: { kind: 'pin', componentId: 'link-1', pinId: 'a' },
              to: { kind: 'junction', junctionId },
            },
            {
              id: 'binding:link-1/b',
              from: { kind: 'pin', componentId: 'link-1', pinId: 'b' },
              to: { kind: 'junction', junctionId },
            },
          ],
        },
      ],
    },
    layout: {
      boards: [
        {
          id: 'board-17',
          label: 'Board 17',
          rows: 3,
          cols: 4,
          pitch: 17,
          holes: holes(3, 4),
          holeDiameter: 5,
          traces: [
            {
              id: 'vcc',
              label: 'L3',
              net: 'VCC',
              segments: [{ from: { row: 2, col: 0 }, to: { row: 2, col: 3 } }],
            },
          ],
          position: { x: 10, y: 20 },
        },
      ],
      components: [
        {
          componentId: 'link-1',
          position: { x: 999, y: -999 },
          boardId: 'board-17',
          footprintId: 'inline-link',
          footprint: {
            id: 'inline-link',
            label: 'Inline link',
            rows: 1,
            cols: 2,
            pins: [
              { id: 'a', label: 'A', cell: { row: 0, col: 0 }, primary: true },
              { id: 'b', label: 'B', cell: { row: 0, col: 1 } },
            ],
            shapes: [{ kind: 'line', x1: 0, y1: 0, x2: 1, y2: 0, stroke: 'lead' }],
            bodyCells: [],
          },
          placement: { boardId: 'board-17', anchor: { row: 2, col: 1 }, rotation: 0 },
          pinHoles: [
            { pinId: 'a', hole: { row: 0, col: 0 } },
            { pinId: 'b', hole: { row: 0, col: 1 } },
          ],
        },
      ],
      junctions: [
        {
          junctionId,
          position: { x: -1, y: -1 },
          taps: 4,
          boardId: 'board-17',
          hole: { row: 2, col: 0 },
          boardPort: 'trace:vcc',
        },
      ],
      conductors: [
        { conductorId: 'binding:link-1/a', toTap: 1, physicalBinding: true },
        { conductorId: 'binding:link-1/b', toTap: 2, physicalBinding: true },
      ],
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseDetachedFootprintProject() {
  const raw = basePhysicalProject();
  const layout = raw.layout.components[0];
  delete layout.boardId;
  delete layout.placement;
  delete layout.pinHoles;
  layout.footprintRotation = 90;
  layout.footprintPitch = 17;
  raw.electrical.junctions = [];
  raw.electrical.nets = [];
  raw.layout.junctions = [];
  raw.layout.conductors = [];
  return raw;
}

function changed(name, change) {
  const raw = basePhysicalProject();
  change(raw);
  return { name, accepted: false, raw };
}

function changedDetached(name, change) {
  const raw = baseDetachedFootprintProject();
  change(raw);
  return { name, accepted: false, raw };
}

const completeGridWithoutHoleList = basePhysicalProject();
delete completeGridWithoutHoleList.layout.boards[0].holes;

const boardWithCenterGapAndNotes = basePhysicalProject();
boardWithCenterGapAndNotes.layout.boards[0].centerGap = 12;
boardWithCenterGapAndNotes.layout.boards[0].notes = 'Canal central e bulk incorporado';

const boardWithRowLabelsAndInternalTrace = basePhysicalProject();
boardWithRowLabelsAndInternalTrace.layout.boards[0].rowLabels = ['J', '', 'A'];
boardWithRowLabelsAndInternalTrace.layout.boards[0].traces[0].internal = true;

// A board that persists the solderless-breadboard look: light plastic, a
// moulded channel and printed +/- rails. Everything the renderer reads for
// that surface has to be on the board itself, which is what the surface rules
// below enforce.
export function breadboardSurfaceProject() {
  const raw = basePhysicalProject();
  raw.layout.boards[0].surface = 'breadboard';
  raw.layout.boards[0].centerGap = 12;
  raw.layout.boards[0].rowLabels = ['top+', '', 'A'];
  return raw;
}

const breadboardSurface = breadboardSurfaceProject();

const perfboardSurface = basePhysicalProject();
perfboardSurface.layout.boards[0].surface = 'perfboard';

/**
 * One ordinary wire landing on copper sealed inside a board body - a
 * breadboard column clip. There is no `trace:<id>` pad for such a group, so
 * the conductor has to name the hole it lands on with a tap index.
 */
function internalCopperLandingProject() {
  const junctionId = 'copper:bb-1/trace%3Aclip';
  return {
    formatVersion: 2,
    electrical: {
      components: [
        {
          id: 'probe-1',
          deviceId: 'PROBE-1',
          manufacturer: 'project',
          model: 'probe',
          pins: [{ id: 'p', label: 'P', direction: 'output' }],
        },
      ],
      junctions: [{ id: junctionId, label: 'B1-A1', kind: 'rail', wirevizName: junctionId }],
      cables: [],
      nets: [
        {
          id: 'net-probe',
          name: 'PROBE',
          endpoints: [
            { kind: 'pin', componentId: 'probe-1', pinId: 'p' },
            { kind: 'junction', junctionId },
          ],
          conductors: [
            {
              id: 'w-probe',
              from: { kind: 'pin', componentId: 'probe-1', pinId: 'p' },
              to: { kind: 'junction', junctionId },
            },
          ],
        },
      ],
    },
    layout: {
      boards: [
        {
          id: 'bb-1',
          label: 'Mini breadboard',
          surface: 'breadboard',
          rows: 4,
          cols: 2,
          pitch: 20,
          centerGap: 40,
          rowLabels: ['top+', 'B', 'A', 'top-'],
          holes: [
            { row: 0, col: 0 },
            { row: 1, col: 0 },
            { row: 2, col: 0 },
            { row: 3, col: 0 },
          ],
          traces: [
            {
              id: 'clip',
              label: 'B1-A1',
              internal: true,
              segments: [{ from: { row: 1, col: 0 }, to: { row: 2, col: 0 } }],
            },
          ],
          position: { x: 0, y: 0 },
        },
      ],
      components: [{ componentId: 'probe-1', position: { x: 400, y: 0 } }],
      junctions: [
        {
          junctionId,
          position: { x: -1, y: -1 },
          taps: 2,
          boardId: 'bb-1',
          hole: { row: 1, col: 0 },
          boardPort: 'trace:clip',
        },
      ],
      conductors: [{ conductorId: 'w-probe', toTap: 1 }],
    },
  };
}

function internalCopper(change) {
  const raw = internalCopperLandingProject();
  change(raw);
  return raw;
}

function breadboard(change) {
  const raw = breadboardSurfaceProject();
  change(raw);
  return raw;
}

/** Current-format jumper whose optional bends are expressed in its breadboard's space. */
export function boardJumperProject() {
  const raw = breadboardSurfaceProject();
  raw.formatVersion = 4;
  for (const board of raw.layout.boards) board.visualPlane = 7;
  for (const component of raw.layout.components) component.visualPlane = 10;
  for (const junction of raw.layout.junctions) junction.visualPlane = 30;
  for (const conductor of raw.layout.conductors) conductor.visualPlane = 20;

  const fromJunction = 'copper:board-17/hole%3A0%3A0';
  const toJunction = 'copper:board-17/hole%3A1%3A2';
  raw.electrical.junctions.push(
    { id: fromJunction, label: 'top+1', kind: 'junction', wirevizName: fromJunction },
    { id: toJunction, label: 'L2-C3', kind: 'junction', wirevizName: toJunction },
  );
  raw.electrical.nets.push({
    id: 'net-jumper',
    name: 'JUMPER_SIGNAL',
    endpoints: [
      { kind: 'junction', junctionId: fromJunction },
      { kind: 'junction', junctionId: toJunction },
    ],
    conductors: [
      {
        id: 'jumper-1',
        from: { kind: 'junction', junctionId: fromJunction },
        to: { kind: 'junction', junctionId: toJunction },
        wireType: 'jumper',
        color: '#ff0000',
      },
    ],
  });
  raw.layout.junctions.push(
    {
      junctionId: fromJunction,
      position: { x: -1, y: -1 },
      visualPlane: 30,
      taps: 1,
      boardId: 'board-17',
      hole: { row: 0, col: 0 },
      boardPort: 'hole:0:0',
    },
    {
      junctionId: toJunction,
      position: { x: -1, y: -1 },
      visualPlane: 30,
      taps: 1,
      boardId: 'board-17',
      hole: { row: 1, col: 2 },
      boardPort: 'hole:1:2',
    },
  );
  raw.layout.conductors.push({
    conductorId: 'jumper-1',
    visualPlane: 8,
    boardJumper: { boardId: 'board-17' },
  });
  return raw;
}

function jumperChanged(name, change) {
  const raw = boardJumperProject();
  change(raw);
  return { name, accepted: false, raw };
}

const emptyBoard = {
  formatVersion: 2,
  electrical: { components: [], junctions: [], cables: [], nets: [] },
  layout: {
    boards: [
      {
        id: 'empty-board',
        label: 'Empty board',
        rows: 2,
        cols: 2,
        pitch: 17,
        holes: [],
        position: { x: 0, y: 0 },
      },
    ],
    components: [],
    junctions: [],
    conductors: [],
  },
};

export const canonicalValidationCorpus = [
  {
    name: 'accepts, normalizes and preserves authored net names over copper labels',
    accepted: true,
    raw: basePhysicalProject(),
  },
  {
    name: 'accepts an omitted hole list as a complete rectangular grid',
    accepted: true,
    raw: completeGridWithoutHoleList,
  },
  {
    name: 'accepts centerGap and notes on a physical board',
    accepted: true,
    raw: boardWithCenterGapAndNotes,
  },
  {
    name: 'accepts printed row labels and copper grouped inside the board body',
    accepted: true,
    raw: boardWithRowLabelsAndInternalTrace,
  },
  {
    name: 'accepts a persisted solderless-breadboard surface',
    accepted: true,
    raw: breadboardSurface,
  },
  {
    name: 'accepts an explicitly declared perfboard surface',
    accepted: true,
    raw: perfboardSurface,
  },
  {
    name: 'accepts a board-local jumper route on a breadboard',
    accepted: true,
    raw: boardJumperProject(),
  },
  {
    name: 'accepts a wire that names the internal-copper hole it lands on',
    accepted: true,
    raw: internalCopperLandingProject(),
  },
  {
    name: 'accepts an explicit empty hole list as a board with no holes',
    accepted: true,
    raw: emptyBoard,
  },
  {
    name: 'accepts retained footprint geometry without a placement',
    accepted: true,
    raw: baseDetachedFootprintProject(),
  },
  changed('rejects footprintId without an embedded footprint', (raw) => {
    delete raw.layout.components[0].footprint;
  }),
  changedDetached('rejects footprint rotation without an embedded footprint', (raw) => {
    delete raw.layout.components[0].footprint;
    delete raw.layout.components[0].footprintId;
  }),
  changedDetached('rejects footprint pitch without an embedded footprint', (raw) => {
    delete raw.layout.components[0].footprint;
    delete raw.layout.components[0].footprintId;
    delete raw.layout.components[0].footprintRotation;
  }),
  changedDetached('rejects an invalid detached footprint rotation', (raw) => {
    raw.layout.components[0].footprintRotation = 45;
  }),
  changedDetached('rejects a non-positive detached footprint pitch', (raw) => {
    raw.layout.components[0].footprintPitch = 0;
  }),
  changedDetached('rejects a detached footprint pitch above the operational limit', (raw) => {
    raw.layout.components[0].footprintPitch = OPERATIONAL_LIMITS.maxBoardPitch + 1;
  }),
  changed('rejects footprint rotation together with placement', (raw) => {
    raw.layout.components[0].footprintRotation = 90;
  }),
  changed('rejects footprint pitch together with placement', (raw) => {
    raw.layout.components[0].footprintPitch = 17;
  }),
  changed('rejects a mismatched embedded footprint id', (raw) => {
    raw.layout.components[0].footprint.id = 'different-footprint';
  }),
  changed('rejects a placement beyond board bounds', (raw) => {
    raw.layout.components[0].placement.anchor.col = 3;
  }),
  changed('rejects an occupied hole omitted by a sparse board', (raw) => {
    raw.layout.boards[0].holes = raw.layout.boards[0].holes.filter(
      (hole) => hole.row !== 2 || hole.col !== 2,
    );
  }),
  changed('rejects colliding manual hole claims', (raw) => {
    raw.electrical.components.push({
      id: 'probe',
      deviceId: 'PROBE',
      manufacturer: '',
      model: '',
      pins: [{ id: 'p', label: 'P', direction: 'input' }],
    });
    raw.layout.components.push({
      componentId: 'probe',
      position: { x: 0, y: 0 },
      boardId: 'board-17',
      pinHoles: [{ pinId: 'p', hole: { row: 2, col: 1 } }],
    });
  }),
  changed('rejects a component pin absent from its footprint', (raw) => {
    raw.layout.components[0].footprint.pins[0].id = 'unknown-pin';
  }),
  changed('rejects a footprint pin cell outside its box', (raw) => {
    raw.layout.components[0].footprint.pins[1].cell.col = 2;
  }),
  changed('rejects a missing pin-to-copper binding', (raw) => {
    raw.layout.conductors.pop();
  }),
  changed('rejects a boardPort for a missing trace', (raw) => {
    raw.layout.junctions[0].boardPort = 'trace:missing';
  }),
  changed('rejects dimensions above the operational limit', (raw) => {
    raw.layout.boards[0].rows = 129;
  }),
  changed('rejects a hole diameter larger than pitch', (raw) => {
    raw.layout.boards[0].holeDiameter = 18;
  }),
  changed('rejects a negative centerGap', (raw) => {
    raw.layout.boards[0].centerGap = -1;
  }),
  changed('rejects a zero centerGap', (raw) => {
    raw.layout.boards[0].centerGap = 0;
  }),
  changed('rejects a non-numeric centerGap', (raw) => {
    raw.layout.boards[0].centerGap = '12';
  }),
  changed('rejects a centerGap above the board-pitch limit', (raw) => {
    raw.layout.boards[0].centerGap = OPERATIONAL_LIMITS.maxBoardPitch + 1;
  }),
  changed('rejects non-string board notes', (raw) => {
    raw.layout.boards[0].notes = ['bulk'];
  }),
  changed('rejects a row label list shorter than the row count', (raw) => {
    raw.layout.boards[0].rowLabels = ['J', 'A'];
  }),
  changed('rejects a row label list longer than the row count', (raw) => {
    raw.layout.boards[0].rowLabels = ['J', 'I', 'A', 'B'];
  }),
  changed('rejects non-string row labels', (raw) => {
    raw.layout.boards[0].rowLabels = ['J', 3, 'A'];
  }),
  changed('rejects a non-boolean internal trace flag', (raw) => {
    raw.layout.boards[0].traces[0].internal = 'yes';
  }),
  {
    name: 'rejects a wire on internal copper with no tap, which renders no port',
    accepted: false,
    raw: internalCopper((raw) => {
      delete raw.layout.conductors[0].toTap;
    }),
  },
  {
    name: 'rejects a wire on internal copper whose layout entry is missing entirely',
    accepted: false,
    raw: internalCopper((raw) => {
      raw.layout.conductors = [];
    }),
  },
  {
    name: 'rejects a wire on internal copper with a tap past the end of the group',
    accepted: false,
    raw: internalCopper((raw) => {
      raw.layout.conductors[0].toTap = 2;
    }),
  },
  changed('rejects an unknown board surface', (raw) => {
    raw.layout.boards[0].surface = 'protoboard';
  }),
  changed('rejects a misspelled board surface instead of falling back', (raw) => {
    raw.layout.boards[0].surface = 'breadbord';
  }),
  changed('rejects a non-string board surface', (raw) => {
    raw.layout.boards[0].surface = 2;
  }),
  changed('rejects an empty board surface', (raw) => {
    raw.layout.boards[0].surface = '';
  }),
  {
    name: 'rejects a breadboard surface with no printed row labels',
    accepted: false,
    raw: breadboard((raw) => {
      delete raw.layout.boards[0].rowLabels;
    }),
  },
  {
    name: 'rejects a breadboard surface with no central channel',
    accepted: false,
    raw: breadboard((raw) => {
      delete raw.layout.boards[0].centerGap;
    }),
  },
  {
    name: 'rejects a breadboard surface that names no power rail',
    accepted: false,
    raw: breadboard((raw) => {
      raw.layout.boards[0].rowLabels = ['J', '', 'A'];
    }),
  },
  changed('rejects a diagonal trace', (raw) => {
    raw.layout.boards[0].traces[0].segments[0].to = { row: 1, col: 3 };
  }),
  changed('rejects overlapping traces', (raw) => {
    raw.layout.boards[0].traces.push({
      id: 'overlap',
      label: 'Overlap',
      segments: [{ from: { row: 1, col: 1 }, to: { row: 2, col: 1 } }],
    });
  }),
  changed('rejects one electrical net that shorts distinct named copper', (raw) => {
    const junctionId = 'copper:board-17/trace%3Agnd';
    raw.layout.boards[0].traces.push({
      id: 'gnd',
      label: 'L2',
      net: 'GND',
      segments: [{ from: { row: 1, col: 0 }, to: { row: 1, col: 3 } }],
    });
    raw.electrical.junctions.push({
      id: junctionId,
      label: 'GND rail',
      kind: 'rail',
      wirevizName: junctionId,
    });
    raw.electrical.nets[0].endpoints.push({ kind: 'junction', junctionId });
    raw.electrical.nets[0].conductors.push({
      id: 'copper-short',
      from: { kind: 'junction', junctionId: raw.electrical.junctions[0].id },
      to: { kind: 'junction', junctionId },
    });
    raw.layout.junctions.push({
      junctionId,
      position: { x: -1, y: -1 },
      taps: 4,
      boardId: 'board-17',
      hole: { row: 1, col: 0 },
      boardPort: 'trace:gnd',
    });
    raw.layout.conductors.push({ conductorId: 'copper-short' });
  }),
  changed('rejects an invalid footprint shape paint', (raw) => {
    raw.layout.components[0].footprint.shapes[0].stroke = 'invisible';
  }),
  jumperChanged('rejects a board jumper owned by a missing board', (raw) => {
    raw.layout.conductors.at(-1).boardJumper.boardId = 'missing-board';
  }),
  jumperChanged('rejects a board jumper at the same plane as its board surface', (raw) => {
    raw.layout.conductors.at(-1).visualPlane = 7;
  }),
  jumperChanged('rejects duplicated full points on a board jumper', (raw) => {
    const layout = raw.layout.conductors.at(-1);
    layout.routingMode = 'manual';
    layout.points = [
      { x: 16, y: 16 },
      { x: 50, y: 33 },
    ];
  }),
  jumperChanged('rejects a board jumper connected outside its owner', (raw) => {
    raw.electrical.nets.at(-1).conductors[0].to = {
      kind: 'junction',
      junctionId: raw.electrical.junctions[0].id,
    };
    raw.electrical.nets.at(-1).endpoints[1] = {
      kind: 'junction',
      junctionId: raw.electrical.junctions[0].id,
    };
  }),
];

export { basePhysicalProject };

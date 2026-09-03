import { type Edge, type Node } from 'ng-diagram';
import { resolveWireColor } from '../../wireviz-import/wireviz-colors';
import { allHoles } from '../model/board-geometry';
import { breadboardRowIndex, createBreadboard830 } from '../model/breadboard';
import { rowTrace } from '../model/board-trace';
import { junctionTapPortId } from '../model/canonical-project';
import { cloneFootprint, getFootprint } from '../model/footprint';
import { placementNodePosition, syncPortHolesToPlacement } from '../model/footprint-geometry';
import { holePortId, tracePortId } from '../model/board-ports';
import {
  EdgeTemplateType,
  NodeTemplateType,
  type BoardHole,
  type BoardNodeData,
  type BoardRotation,
  type DeviceNodeData,
  type DevicePort,
  type JunctionNodeData,
  type WireEdgeData,
} from '../model/interfaces';

/**
 * Physical board fixtures for issue #3.
 *
 * These are the boards the Talus-Droid actually has, described with the same
 * generic `BoardNodeData` - nothing here is a special case in the model, the
 * numbers are just different:
 *
 * | fixture        | grid    | traces                                       |
 * |----------------|---------|----------------------------------------------|
 * | placa A        | 6 x 11  | six full-width rails, one per power net      |
 * | protoboard sup.| 18 x 63 | 830-point breadboard: 126 column groups + 4 buses |
 * | placa de origem| 6 x 28  | none (uncut perfboard the pieces are cut from)|
 * | peca E         | 6 x 3   | UART divider node (a jumper) + a short L6 GND|
 * | peca G         | 6 x 4   | L1 = GND_SYS, L6 = VBAT_SYS                  |
 *
 * Row/column addresses are 0-indexed here; the `L1..L6` / `C1..C11` names the
 * hardware notes use are 1-indexed and live in each trace's `label`. The
 * breadboard names its rows instead (`rowLabels`), so its holes read `J10` and
 * `top+:12` while still being addressed by the same `{row, col}`.
 *
 * Source for the geometry and nets: the ressolda plan for 2026-08-11 and
 * talus-core#339. See docs/physical-footprints.md.
 */

export const BOARD_PITCH = 20;

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

/** The six power rails of placa A, top to bottom, exactly as documented. */
export const PLACA_A_RAILS: readonly (readonly [label: string, net: string])[] = [
  ['L1', 'GND_SYS'],
  ['L2', 'GND_MOT'],
  ['L3', '5V_LOGIC'],
  ['L4', '5V_PI'],
  ['L5', '12V_KIN'],
  ['L6', '8V_MOT'],
];

export const PLACA_A_BOARD: BoardNodeData = {
  type: 'board',
  boardId: 'board-a',
  label: 'Placa A (6x11) - distribuição do topo',
  rows: 6,
  cols: 11,
  pitch: BOARD_PITCH,
  traces: PLACA_A_RAILS.map(([label, net], row) =>
    rowTrace(`a-${label.toLowerCase()}`, label, row, 11, net),
  ),
};

export const PLACA_ORIGEM_BOARD: BoardNodeData = {
  type: 'board',
  boardId: 'placa-origem',
  label: 'Placa de origem (6x28) - perfurada, sem trilhas',
  rows: 6,
  cols: 28,
  pitch: BOARD_PITCH,
  traces: [],
};

/**
 * Mounted upper protoboard: the full-size 830-point solderless breadboard the
 * Talus-Droid actually carries, not a generic perfboard rectangle.
 *
 * Its 630 terminal holes, 200 bus holes, column groups and buses all come from
 * `model/breadboard.ts`; nothing about it is special-cased here, and it shares
 * the same `pitch` as every other physical board so a footprint seats on it
 * exactly like on the others.
 */
export const PROTOBOARD_SUPERIOR_BOARD: BoardNodeData = createBreadboard830({
  boardId: 'protoboard-superior',
  label: 'Protoboard superior (830 pontos)',
  notes:
    'Capacitores bulk incorporados: 470 uF/25 V no VM da TB6612 e 470 uF/16 V na entrada do Pi.',
  pitch: BOARD_PITCH,
});

export const PECA_G_BOARD: BoardNodeData = {
  type: 'board',
  boardId: 'peca-g',
  label: 'Peça G (6x4) - distribuição da base',
  rows: 6,
  cols: 4,
  pitch: BOARD_PITCH,
  traces: [rowTrace('g-l1', 'L1', 0, 4, 'GND_SYS'), rowTrace('g-l6', 'L6', 5, 4, 'VBAT_SYS')],
};

/**
 * Peca E is the one piece whose copper is not a pair of rails: the UART
 * divider needs its junction to be a *jumper* between two holes that are not
 * neighbours (L1-C3 to L3-C1), which is why `BoardTrace.segments` allows
 * disjoint runs. Its rows are otherwise bare, or R1 and R2 would be shorted
 * out by the very trace they sit on.
 */
export const PECA_E_BOARD: BoardNodeData = {
  type: 'board',
  boardId: 'peca-e',
  label: 'Peça E (6x3) - divisor de nível do UART',
  rows: 6,
  cols: 3,
  pitch: BOARD_PITCH,
  holes: allHoles({ rows: 6, cols: 3 }),
  traces: [
    {
      id: 'e-node',
      label: 'no UART',
      segments: [
        { from: { row: 0, col: 2 }, to: { row: 0, col: 2 } },
        { from: { row: 2, col: 0 }, to: { row: 2, col: 0 } },
      ],
    },
    {
      id: 'e-gnd',
      label: 'L6',
      net: 'GND_SYS',
      segments: [
        { from: { row: 5, col: 0 }, to: { row: 5, col: 2 } },
        { from: { row: 2, col: 2 }, to: { row: 2, col: 2 } },
      ],
    },
  ],
};

export const PHYSICAL_BOARDS: readonly BoardNodeData[] = [
  PROTOBOARD_SUPERIOR_BOARD,
  PLACA_ORIGEM_BOARD,
  PECA_E_BOARD,
  PECA_G_BOARD,
];

/**
 * Where each board node sits on the shared canvas.
 *
 * The 830-point breadboard is 1272 x 412 px at the shared pitch, so the small
 * pieces sit in a row above it and the cut pieces below; the bodies are laid
 * out not to overlap, which `physical-boards.fixture.spec.ts` asserts.
 */
export const BOARD_POSITIONS: Readonly<Record<string, { x: number; y: number }>> = {
  'board-a': { x: 60, y: 60 },
  'placa-origem': { x: 400, y: 60 },
  'protoboard-superior': { x: 60, y: 300 },
  'peca-e': { x: 60, y: 800 },
  'peca-g': { x: 260, y: 800 },
};

function boardNode(data: BoardNodeData): Node<BoardNodeData> {
  return {
    id: data.boardId,
    type: NodeTemplateType.BoardNode,
    position: BOARD_POSITIONS[data.boardId] ?? { x: 0, y: 0 },
    data,
  };
}

export const PHYSICAL_BOARD_NODES: Node<BoardNodeData>[] = PHYSICAL_BOARDS.map(boardNode);

// ---------------------------------------------------------------------------
// Seated (footprinted) components
// ---------------------------------------------------------------------------

interface SeatedSpec {
  id: string;
  deviceId: string;
  manufacturer: string;
  model: string;
  category: string;
  footprintId: string;
  boardId: string;
  anchor: BoardHole;
  rotation: BoardRotation;
  ports: DevicePort[];
}

/**
 * Builds a seated component node.
 *
 * The node's `position` is *derived* from its placement rather than authored,
 * so a fixture can never claim a seat its pixels don't match; likewise the
 * per-pin `hole` addresses come from `syncPortHolesToPlacement`. Anchor +
 * rotation are the only geometry actually written down here.
 */
function seatedNode(spec: SeatedSpec): Node<DeviceNodeData> {
  const board = ALL_BOARDS_BY_ID.get(spec.boardId);
  const footprint = getFootprint(spec.footprintId);
  if (!board || !footprint) {
    throw new Error(`fixture "${spec.id}": unknown board or footprint`);
  }
  const placement = { boardId: spec.boardId, anchor: spec.anchor, rotation: spec.rotation };
  const data = syncPortHolesToPlacement({
    type: 'device',
    deviceId: spec.deviceId,
    manufacturer: spec.manufacturer,
    model: spec.model,
    category: spec.category,
    location: board.label,
    boardId: spec.boardId,
    footprintId: spec.footprintId,
    footprint: cloneFootprint(footprint),
    placement,
    ports: spec.ports,
  });
  return {
    id: spec.id,
    type: NodeTemplateType.FootprintNode,
    position: placementNodePosition(
      { board, position: BOARD_POSITIONS[spec.boardId] ?? { x: 0, y: 0 } },
      placement,
    ),
    data,
  };
}

export const ALL_BOARDS_BY_ID: ReadonlyMap<string, BoardNodeData> = new Map(
  [PLACA_A_BOARD, ...PHYSICAL_BOARDS].map((board) => [board.boardId, board]),
);

const axialPorts = (labelA: string, labelB: string): DevicePort[] => [
  { id: 'a', label: labelA, direction: 'input', connectorType: 'Signal' },
  { id: 'b', label: labelB, direction: 'output', connectorType: 'Signal' },
];

export const SEATED_COMPONENT_NODES: Node<DeviceNodeData>[] = [
  seatedNode({
    id: 'res-e-r1',
    deviceId: 'R1',
    manufacturer: 'generico',
    model: '1 kOhm',
    category: 'passive',
    footprintId: 'resistor-1k',
    boardId: 'peca-e',
    anchor: { row: 0, col: 0 },
    rotation: 0,
    ports: axialPorts('TX Nano', 'no'),
  }),
  seatedNode({
    id: 'res-e-r2',
    deviceId: 'R2',
    manufacturer: 'generico',
    model: '1,8 kOhm',
    category: 'passive',
    footprintId: 'resistor-1k8',
    boardId: 'peca-e',
    anchor: { row: 2, col: 0 },
    rotation: 180,
    // At 180 deg pin b lands on L3-C1 (the divider junction) and pin a on
    // L3-C3 (the jumper down to GND_SYS).
    ports: axialPorts('GND', 'no'),
  }),
  seatedNode({
    id: 'tb6612-2',
    deviceId: 'DRV-2',
    manufacturer: 'Toshiba',
    model: 'TB6612FNG',
    category: 'motor-driver',
    footprintId: 'tb6612fng',
    boardId: 'placa-origem',
    anchor: { row: 0, col: 2 },
    rotation: 0,
    ports: [
      { id: 'vm', label: 'VM', direction: 'input', connectorType: 'Power' },
      { id: 'vcc', label: 'VCC', direction: 'input', connectorType: 'Power' },
      { id: 'gnd', label: 'GND', direction: 'input', connectorType: 'Power' },
      { id: 'pwma', label: 'PWMA', direction: 'input', connectorType: 'PWM' },
      { id: 'ain1', label: 'AIN1', direction: 'input', connectorType: 'GPIO' },
      { id: 'ain2', label: 'AIN2', direction: 'input', connectorType: 'GPIO' },
      { id: 'stby', label: 'STBY', direction: 'input', connectorType: 'GPIO' },
      { id: 'ao1', label: 'AO1', direction: 'output', connectorType: 'Motor' },
      { id: 'ao2', label: 'AO2', direction: 'output', connectorType: 'Motor' },
    ],
  }),
];

// ---------------------------------------------------------------------------
// Components that live beside the boards, on the same canvas
// ---------------------------------------------------------------------------

/**
 * Not everything is seated. The XL4015 converter and the Hall module hang off
 * the boards through wires - and, in the Nano's case, cannot be seated at all:
 * its 0.6" row span needs 7 rows and every board here has 6. That is a real
 * property of the hardware, reported by `validatePlacement` rather than
 * papered over by shrinking the footprint.
 */
export const EXTERNAL_COMPONENT_NODES: Node<DeviceNodeData>[] = [
  {
    id: 'xl4015-1',
    type: NodeTemplateType.DeviceNode,
    position: { x: 1420, y: 620 },
    data: {
      type: 'device',
      deviceId: 'CONV-1',
      manufacturer: 'generico',
      model: 'XL4015E1',
      category: 'converter',
      location: 'Base',
      ports: [
        { id: 'in-plus', label: 'IN+', direction: 'input', connectorType: 'Power' },
        { id: 'in-minus', label: 'IN-', direction: 'input', connectorType: 'Power' },
        { id: 'out-plus', label: 'OUT+', direction: 'output', connectorType: 'Power' },
        { id: 'out-minus', label: 'OUT-', direction: 'output', connectorType: 'Power' },
      ],
    },
  },
  {
    id: 'hall-left',
    type: NodeTemplateType.DeviceNode,
    position: { x: 1420, y: 380 },
    data: {
      type: 'device',
      deviceId: 'HALL-1',
      manufacturer: 'generico',
      model: 'LM393 Hall',
      category: 'sensor',
      location: 'Roda esquerda',
      ports: [
        { id: 'vcc', label: 'VCC', direction: 'input', connectorType: 'Power' },
        { id: 'gnd', label: 'GND', direction: 'input', connectorType: 'Power' },
        { id: 'do', label: 'DO', direction: 'output', connectorType: 'GPIO' },
      ],
    },
  },
];

/**
 * The reference draws two links toward these devices but does not identify
 * either physical pin. Standalone one-tap junctions keep that uncertainty
 * explicit while leaving a visible, connectable endpoint beside each device.
 */
export const PROTOBOARD_ENDPOINT_NODES: Node<JunctionNodeData>[] = [
  {
    id: 'proto-endpoint-tb6612',
    type: NodeTemplateType.JunctionNode,
    position: { x: 1420, y: 80 },
    data: {
      type: 'junction',
      junctionId: 'proto-endpoint-tb6612',
      label: 'TB6612 · terminal provisório',
      kind: 'junction',
      taps: 1,
      notes: 'Pino ainda não documentado na fonte.',
    },
  },
  {
    id: 'proto-endpoint-nano',
    type: NodeTemplateType.JunctionNode,
    position: { x: 1420, y: 190 },
    data: {
      type: 'junction',
      junctionId: 'proto-endpoint-nano',
      label: 'Nano · terminal provisório',
      kind: 'junction',
      taps: 1,
      notes: 'Pino ainda não documentado na fonte.',
    },
  },
];

// ---------------------------------------------------------------------------
// Wires onto holes and traces
// ---------------------------------------------------------------------------

interface WireSpec {
  id: string;
  wireId: string;
  colorCode: string;
  netName: string;
  wireType?: string;
  source: [nodeId: string, portId: string];
  target: [nodeId: string, portId: string];
}

function wireEdge(spec: WireSpec): Edge<WireEdgeData> {
  return {
    id: spec.id,
    type: EdgeTemplateType.WireEdge,
    source: spec.source[0],
    sourcePort: spec.source[1],
    target: spec.target[0],
    targetPort: spec.target[1],
    data: {
      type: 'wire',
      wireId: spec.wireId,
      wireType: spec.wireType ?? 'power',
      netName: spec.netName,
      ...resolveWireColor(spec.colorCode),
    },
  };
}

/**
 * The two documented jumpers left column 18 of the old 6 x 18 rectangle, on
 * the rows `L2` and `L4` - one row above and one row below the channel. On the
 * real breadboard those are `I18` (second terminal row above the channel) and
 * `E18` (first below it), which keeps the source's position relative to the
 * channel and puts each jumper on a different column group, exactly as the two
 * independent signals require.
 */
export const PROTOBOARD_TB6612_HOLE: BoardHole = { row: breadboardRowIndex('I'), col: 17 };
export const PROTOBOARD_NANO_HOLE: BoardHole = { row: breadboardRowIndex('E'), col: 17 };

/** The two explicit links drawn from the mounted protoboard in the reference artifact. */
export const PROTOBOARD_JUMPER_EDGES: Edge<WireEdgeData>[] = [
  wireEdge({
    id: 'jumper-proto-nano',
    wireId: 'J-PROTO-NANO',
    colorCode: 'TQ',
    netName: 'PROTO_NANO_SIGNAL',
    wireType: 'signal',
    source: ['protoboard-superior', holePortId(PROTOBOARD_NANO_HOLE)],
    target: ['proto-endpoint-nano', junctionTapPortId(0)],
  }),
  wireEdge({
    id: 'jumper-proto-tb6612',
    wireId: 'J-PROTO-TB6612',
    colorCode: 'YE',
    netName: 'PROTO_TB6612_SIGNAL',
    wireType: 'signal',
    source: ['protoboard-superior', holePortId(PROTOBOARD_TB6612_HOLE)],
    target: ['proto-endpoint-tb6612', junctionTapPortId(0)],
  }),
];

/**
 * Board landings use `trace:*` or `hole:*` ports; the two provisional links
 * use explicit one-tap junctions. In both cases the association lives in the
 * edge itself and round-trips without a side table.
 */
export const PHYSICAL_WIRE_EDGES: Edge<WireEdgeData>[] = [
  ...PROTOBOARD_JUMPER_EDGES,
  wireEdge({
    id: 'w-g-vbat',
    wireId: 'W-G1',
    colorCode: 'RD',
    netName: 'VBAT_SYS',
    source: ['xl4015-1', 'in-plus'],
    target: ['peca-g', tracePortId('g-l6')],
  }),
  wireEdge({
    id: 'w-g-gnd',
    wireId: 'W-G2',
    colorCode: 'BK',
    netName: 'GND_SYS',
    source: ['xl4015-1', 'in-minus'],
    target: ['peca-g', tracePortId('g-l1')],
  }),
  wireEdge({
    id: 'w-hall-gnd',
    wireId: 'W-H1',
    colorCode: 'BK',
    netName: 'GND_SYS',
    source: ['hall-left', 'gnd'],
    target: ['peca-g', tracePortId('g-l1')],
  }),
  // A bare hole, not a trace: placa de origem has no copper at all, so this
  // endpoint is the hole itself.
  wireEdge({
    id: 'w-hall-do',
    wireId: 'W-H2',
    colorCode: 'YE',
    netName: 'HALL_L',
    source: ['hall-left', 'do'],
    target: ['placa-origem', holePortId({ row: 2, col: 24 })],
  }),
];

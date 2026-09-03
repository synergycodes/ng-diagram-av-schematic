import { type Edge, type Node } from 'ng-diagram';
import {
  MINIMAL_TWO_NETS_PLACEMENT,
  MINIMAL_TWO_NETS_WIREVIZ_YAML,
} from '../wireviz-import/fixtures/minimal-two-nets.fixture';
import { importWireViz } from '../wireviz-import/import-wireviz';
import { fromCanonicalProject, toCanonicalProject } from './model/canonical-project';
import {
  EXTERNAL_COMPONENT_NODES,
  PHYSICAL_BOARD_NODES,
  PROTOBOARD_ENDPOINT_NODES,
  PHYSICAL_WIRE_EDGES,
  PLACA_A_BOARD,
  SEATED_COMPONENT_NODES,
} from './fixtures/physical-boards.fixture';
import {
  NodeTemplateType,
  type AvSchematicEdgeData,
  type AvSchematicNodeData,
  type BoardNodeData,
  type DeviceNodeData,
} from './model/interfaces';
import { applyVisualZOrder } from './model/visual-planes';

/**
 * Tracer bullet seed (issue #1 / talus-wiring-editor): board A (6 x 11
 * holes), an Arduino Nano and a TB6612FNG breakout, and the two nets
 * produced by actually importing the minimal WireViz fixture below - this
 * is the real import pipeline running at load time, not hand-authored
 * edges that happen to match it.
 *
 * Issue #3 adds the physical layer on the same canvas: board A now carries
 * its six real copper rails, and the placa de origem plus pecas E/G and
 * their seated footprints come from `fixtures/physical-boards.fixture.ts`.
 *
 * Board A having copper is why the tracer devices below only address a hole
 * for the pins that genuinely belong to a rail. A rail is one electrical
 * point across its whole row, so parking five different signals on one row
 * would short them together - see docs/physical-footprints.md.
 *
 * See docs/wiring-tracer-bullet.md for the integration decision this seed
 * exercises, and docs/wireviz-import-limits.md for the parser's supported
 * subset.
 */

const boardA: Node<BoardNodeData> = {
  id: 'board-a',
  type: NodeTemplateType.BoardNode,
  position: { x: 60, y: 60 },
  data: PLACA_A_BOARD,
};

// Nano and TB6612FNG are positioned so their illustrated cards overlap board
// A's own footprint (x: 60..292, y: 60..192 for rows=6/cols=11/pitch=20 - see
// board-geometry.ts::boardSize) in the visual plane. `nodes` below keeps the
// persistent default keeps the board behind components and wires. Still just
// one ng-diagram canvas: the board is an ordinary node, not a background layer.
const nano: Node<DeviceNodeData> = {
  id: 'nano-1',
  type: NodeTemplateType.DeviceNode,
  position: { x: 70, y: 66 },
  data: {
    type: 'device',
    deviceId: 'NANO-1',
    manufacturer: 'Arduino',
    model: 'Nano',
    category: 'microcontroller',
    location: 'Board A',
    boardId: 'board-a',
    ports: [
      { id: 'vin', label: 'VIN', direction: 'input', connectorType: 'Power' },
      { id: 'd9', label: 'D9', direction: 'output', connectorType: 'PWM' },
      { id: 'd8', label: 'D8', direction: 'output', connectorType: 'GPIO' },
      // L1 is GND_SYS and L3 is 5V_LOGIC on placa A; both of these pins really
      // do belong to those rails, so addressing them is not a short.
      {
        id: 'gnd',
        label: 'GND',
        direction: 'output',
        connectorType: 'Power',
        hole: { row: 0, col: 1 },
      },
      {
        id: '5v',
        label: '5V',
        direction: 'output',
        connectorType: 'Power',
        hole: { row: 2, col: 1 },
      },
    ],
  },
};

const tb6612: Node<DeviceNodeData> = {
  id: 'tb6612-1',
  type: NodeTemplateType.DeviceNode,
  position: { x: 185, y: 66 },
  data: {
    type: 'device',
    deviceId: 'DRV-1',
    manufacturer: 'Toshiba',
    model: 'TB6612FNG',
    category: 'motor-driver',
    location: 'Board A',
    boardId: 'board-a',
    ports: [
      { id: 'pwma', label: 'PWMA', direction: 'input', connectorType: 'PWM' },
      { id: 'ain1', label: 'AIN1', direction: 'input', connectorType: 'GPIO' },
      { id: 'stby', label: 'STBY', direction: 'input', connectorType: 'GPIO' },
      // L3 is 5V_LOGIC (shared with the Nano's 5V, one net) and L2 is GND_MOT.
      {
        id: 'vcc',
        label: 'VCC',
        direction: 'input',
        connectorType: 'Power',
        hole: { row: 2, col: 6 },
      },
      {
        id: 'gnd',
        label: 'GND',
        direction: 'input',
        connectorType: 'Power',
        hole: { row: 1, col: 6 },
      },
      { id: 'ao1', label: 'AO1', direction: 'output', connectorType: 'Motor' },
      { id: 'ao2', label: 'AO2', direction: 'output', connectorType: 'Motor' },
    ],
  },
};

const baseNodes: Node<AvSchematicNodeData>[] = [boardA, nano, tb6612];
const baseProject = toCanonicalProject(baseNodes, []);
const imported = importWireViz(MINIMAL_TWO_NETS_WIREVIZ_YAML, {
  placement: MINIMAL_TWO_NETS_PLACEMENT,
  components: baseProject.electrical.components,
});
const importedModel = fromCanonicalProject({
  ...baseProject,
  electrical: imported.electrical,
});

// Physical boards go first so their bodies render behind everything seated on
// them; seated and external components follow. Same single canvas, same
// coordinate plane, same `Node[]` array as the tracer-bullet nodes.
const nodes: Node<AvSchematicNodeData>[] = [
  ...PHYSICAL_BOARD_NODES,
  ...importedModel.nodes,
  ...PROTOBOARD_ENDPOINT_NODES,
  ...SEATED_COMPONENT_NODES,
  ...EXTERNAL_COMPONENT_NODES,
];

// Give the direction-line net (W2) a manual bend, demonstrating that manually
// routed points survive being produced by the WireViz import (they're just
// ordinary edge points from here on - edge-reshaping owns editing them).
const edges: Edge<AvSchematicEdgeData>[] = [
  ...importedModel.edges.map((edge) =>
    edge.data.wireId === 'W2'
      ? ({
          ...edge,
          routingMode: 'manual',
          points: [
            { x: 178, y: 100 },
            { x: 200, y: 100 },
            { x: 200, y: 150 },
            { x: 185, y: 150 },
          ],
        } satisfies Edge<AvSchematicEdgeData>)
      : edge,
  ),
  ...PHYSICAL_WIRE_EDGES,
];

const orderedModel = applyVisualZOrder(nodes, edges);

export const diagramModel: {
  nodes: Node<AvSchematicNodeData>[];
  edges: Edge<AvSchematicEdgeData>[];
} = orderedModel;

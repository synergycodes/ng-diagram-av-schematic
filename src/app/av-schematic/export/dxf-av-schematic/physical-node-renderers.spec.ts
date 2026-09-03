import { type Edge, type Node } from 'ng-diagram';
import { describe, expect, it } from 'vitest';
import { holeLocalPoint } from '../../diagram/model/board-geometry';
import { breadboardRowIndex, createBreadboard830 } from '../../diagram/model/breadboard';
import {
  footprintNodeSize,
  footprintPinHoles,
  placementNodePosition,
} from '../../diagram/model/footprint-geometry';
import { RESISTOR_1K_FOOTPRINT, type Footprint } from '../../diagram/model/footprint';
import {
  EdgeTemplateType,
  NodeTemplateType,
  type BoardNodeData,
  type DeviceNodeData,
  type WireEdgeData,
} from '../../diagram/model/interfaces';
import { DxfCircle, DxfLwPolyline, DxfText } from '../dxf/dxf-entity';
import { CoordinateMapper } from '../dxf/dxf-coordinate-mapper';
import { DxfExporter } from '../dxf/dxf-exporter';
import { buildAvDxfConfig } from './av-dxf-config';
import { DIAGRAM_PADDING, DXF_SCALE_MM_PER_PX, LAYERS } from './av-dxf-constants';

const footprint: Footprint = {
  id: 'vertical-link',
  label: 'Vertical link',
  rows: 1,
  cols: 2,
  pins: [
    { id: 'a', label: 'A', cell: { row: 0, col: 0 }, primary: true },
    { id: 'b', label: 'B', cell: { row: 0, col: 1 } },
  ],
  shapes: [{ kind: 'line', x1: 0, y1: 0, x2: 1, y2: 0, stroke: 'lead' }],
  bodyCells: [],
};

const board: Node<BoardNodeData> = {
  id: 'board-17',
  type: NodeTemplateType.BoardNode,
  position: { x: 100, y: 200 },
  data: {
    type: 'board',
    boardId: 'board-17',
    label: 'Board 17',
    rows: 2,
    cols: 3,
    pitch: 17,
    traces: [
      {
        id: 'vcc',
        label: 'L1',
        net: 'VCC',
        segments: [{ from: { row: 0, col: 0 }, to: { row: 0, col: 2 } }],
      },
    ],
  },
};

const placement = {
  boardId: board.data.boardId,
  anchor: { row: 0, col: 0 },
  rotation: 90 as const,
};

const component: Node<DeviceNodeData> = {
  id: 'link-1',
  type: NodeTemplateType.FootprintNode,
  position: placementNodePosition({ board: board.data, position: board.position }, placement),
  data: {
    type: 'device',
    deviceId: 'LINK-1',
    manufacturer: 'project',
    model: 'vertical-link',
    boardId: board.data.boardId,
    footprintId: footprint.id,
    footprint,
    placement,
    ports: [
      { id: 'a', label: 'A', direction: 'input' },
      { id: 'b', label: 'B', direction: 'output' },
    ],
  },
};

const sourcePoint = { x: 116, y: 216 };
const targetPoint = { x: 150, y: 216 };
const edge: Edge<WireEdgeData> = {
  id: 'wire-1',
  type: EdgeTemplateType.WireEdge,
  source: component.id,
  sourcePort: 'a',
  target: board.id,
  targetPort: 'hole:0:2',
  points: [sourcePoint, targetPoint],
  data: { type: 'wire', wireId: 'W-PHYSICAL' },
};
const jumper: Edge<WireEdgeData> = {
  id: 'jumper-1',
  type: EdgeTemplateType.WireEdge,
  source: board.id,
  sourcePort: 'hole:0:0',
  target: board.id,
  targetPort: 'hole:1:2',
  routing: 'polyline',
  routingMode: 'manual',
  points: [
    { x: 116, y: 216 },
    { x: 150, y: 233 },
  ],
  data: { type: 'wire', wireId: 'J1', jumperBoardId: board.data.boardId },
};

const detachedComponent: Node<DeviceNodeData> = {
  ...component,
  id: 'link-detached',
  position: { x: 210, y: 100 },
  data: {
    ...component.data,
    deviceId: 'LINK-DETACHED',
    boardId: undefined,
    placement: undefined,
    footprintRotation: 90,
    footprintPitch: 17,
  },
};
const detachedSourcePoint = {
  x: detachedComponent.position.x + 12.75,
  y: detachedComponent.position.y + 12.75,
};
const detachedSecondPinPoint = {
  x: detachedSourcePoint.x,
  y: detachedSourcePoint.y + 17,
};
const detachedTargetPoint = { x: 150, y: 233 };
const detachedEdge: Edge<WireEdgeData> = {
  ...edge,
  id: 'wire-detached',
  source: detachedComponent.id,
  points: [detachedSourcePoint, detachedTargetPoint],
  data: { type: 'wire', wireId: 'W-DETACHED' },
};

describe('physical DXF renderers', () => {
  const bounds = { x: 0, y: 0, width: 400, height: 400 };
  const doc = new DxfExporter(buildAvDxfConfig()).export(
    [board, component],
    [edge, jumper],
    bounds,
  );
  const mapper = CoordinateMapper.fromScale(bounds, DXF_SCALE_MM_PER_PX, DIAGRAM_PADDING);

  it('registers separate layers and renders every board hole at pitch 17', () => {
    expect(doc.getLayers().map((layer) => layer.name)).toEqual([
      LAYERS.BOARDS,
      LAYERS.DEVICES,
      LAYERS.FOOTPRINTS,
      LAYERS.WIRES,
      LAYERS.JUMPERS,
    ]);
    const holes = doc
      .getEntities()
      .filter(
        (entity): entity is DxfCircle =>
          entity instanceof DxfCircle && entity.layerName === LAYERS.BOARDS,
      );
    expect(holes).toHaveLength(6);
    expect(holes.map((hole) => [hole.x, hole.y])).toContainEqual(
      Object.values(mapper.mapPoint(150, 233)),
    );
  });

  it('rotates footprint geometry in board pitch without using generic card geometry', () => {
    const shapeLine = doc
      .getEntities()
      .find(
        (entity): entity is DxfLwPolyline =>
          entity instanceof DxfLwPolyline &&
          entity.layerName === LAYERS.FOOTPRINTS &&
          !entity.closed,
      );
    expect(shapeLine?.points).toEqual([
      mapper.mapPoint(sourcePoint.x, sourcePoint.y),
      mapper.mapPoint(sourcePoint.x, sourcePoint.y + board.data.pitch),
    ]);
  });

  it('keeps board and footprint wire endpoints on their exact physical centers', () => {
    const wire = doc
      .getEntities()
      .find(
        (entity): entity is DxfLwPolyline =>
          entity instanceof DxfLwPolyline && entity.layerName === LAYERS.WIRES,
      );
    expect(wire?.points).toEqual([
      mapper.mapPoint(sourcePoint.x, sourcePoint.y),
      mapper.mapPoint(targetPoint.x, targetPoint.y),
    ]);
  });

  it('exports board-owned jumpers on their own DXF layer', () => {
    const exported = doc
      .getEntities()
      .find(
        (entity): entity is DxfLwPolyline =>
          entity instanceof DxfLwPolyline && entity.layerName === LAYERS.JUMPERS,
      );
    expect(exported?.points).toEqual([mapper.mapPoint(116, 216), mapper.mapPoint(150, 233)]);
  });
});

describe('detached footprint DXF rendering', () => {
  const bounds = { x: 0, y: 0, width: 400, height: 400 };
  const doc = new DxfExporter(buildAvDxfConfig()).export(
    [board, detachedComponent],
    [detachedEdge],
    bounds,
  );
  const mapper = CoordinateMapper.fromScale(bounds, DXF_SCALE_MM_PER_PX, DIAGRAM_PADDING);

  it('places pads with the retained footprint rotation and pitch', () => {
    const pads = doc
      .getEntities()
      .filter(
        (entity): entity is DxfCircle =>
          entity instanceof DxfCircle && entity.layerName === LAYERS.FOOTPRINTS,
      );

    expect(pads.map((pad) => ({ x: pad.x, y: pad.y }))).toEqual([
      mapper.mapPoint(detachedSourcePoint.x, detachedSourcePoint.y),
      mapper.mapPoint(detachedSecondPinPoint.x, detachedSecondPinPoint.y),
    ]);
  });

  it('keeps the wire endpoint on the retained physical pad center', () => {
    const wire = doc
      .getEntities()
      .find(
        (entity): entity is DxfLwPolyline =>
          entity instanceof DxfLwPolyline && entity.layerName === LAYERS.WIRES,
      );

    expect(wire?.points).toEqual([
      mapper.mapPoint(detachedSourcePoint.x, detachedSourcePoint.y),
      mapper.mapPoint(detachedTargetPoint.x, detachedTargetPoint.y),
    ]);
  });

  it('labels the detached footprint with its retained rotation', () => {
    const caption = doc
      .getEntities()
      .find(
        (entity): entity is DxfText =>
          entity instanceof DxfText && entity.layerName === LAYERS.FOOTPRINTS,
      );

    expect(caption?.text).toBe('LINK-DETACHED vertical-link 90 deg');
  });
});

/**
 * The drawing has to agree with the canvas about the board's central channel
 * and about what copper is even visible. Both were wrong: the footprint
 * renderer duplicated the rotation without the gap, and the board renderer
 * exported the 130 sealed groups of a breadboard as if they were pads.
 */
describe('breadboard DXF rendering', () => {
  const PITCH = 20;
  const breadboardNode: Node<BoardNodeData> = {
    id: 'bb',
    type: NodeTemplateType.BoardNode,
    position: { x: 60, y: 40 },
    data: createBreadboard830({ boardId: 'bb', label: 'Breadboard 830', pitch: PITCH }),
  };

  /** A two-row link seated across the trench: one pin in F, one in E. */
  const straddler: Footprint = {
    id: 'straddler',
    label: 'Straddler',
    rows: 2,
    cols: 1,
    pins: [
      { id: 'top', label: 'TOP', cell: { row: 0, col: 0 }, primary: true },
      { id: 'bottom', label: 'BOTTOM', cell: { row: 1, col: 0 } },
    ],
    shapes: [{ kind: 'line', x1: 0, y1: 0, x2: 0, y2: 1, stroke: 'lead' }],
    bodyCells: [],
  };

  const straddlePlacement = {
    boardId: 'bb',
    anchor: { row: breadboardRowIndex('F'), col: 4 },
    rotation: 0 as const,
  };

  const straddleNode: Node<DeviceNodeData> = {
    id: 'straddle-1',
    type: NodeTemplateType.FootprintNode,
    position: placementNodePosition(
      { board: breadboardNode.data, position: breadboardNode.position },
      straddlePlacement,
    ),
    data: {
      type: 'device',
      deviceId: 'STRADDLE-1',
      manufacturer: 'project',
      model: 'straddler',
      boardId: 'bb',
      footprintId: straddler.id,
      footprint: straddler,
      placement: straddlePlacement,
      ports: [
        { id: 'top', label: 'TOP', direction: 'input' },
        { id: 'bottom', label: 'BOTTOM', direction: 'output' },
      ],
    },
  };

  const bounds = { x: 0, y: 0, width: 2000, height: 800 };
  const doc = new DxfExporter(buildAvDxfConfig()).export(
    [breadboardNode, straddleNode],
    [],
    bounds,
  );
  const mapper = CoordinateMapper.fromScale(bounds, DXF_SCALE_MM_PER_PX, DIAGRAM_PADDING);

  const resistorPlacement = {
    boardId: 'bb',
    anchor: { row: breadboardRowIndex('E'), col: 10 },
    rotation: 0 as const,
  };
  const resistorNode: Node<DeviceNodeData> = {
    id: 'resistor-below',
    type: NodeTemplateType.FootprintNode,
    position: placementNodePosition(
      { board: breadboardNode.data, position: breadboardNode.position },
      resistorPlacement,
    ),
    data: {
      type: 'device',
      deviceId: 'R1',
      manufacturer: 'generic',
      model: '1 kOhm',
      boardId: 'bb',
      footprintId: RESISTOR_1K_FOOTPRINT.id,
      footprint: RESISTOR_1K_FOOTPRINT,
      placement: resistorPlacement,
      ports: [
        { id: 'a', label: '1', direction: 'input' },
        { id: 'b', label: '2', direction: 'output' },
      ],
    },
  };

  it('exports no copper for the groups sealed inside the plastic', () => {
    const copper = doc
      .getEntities()
      .filter(
        (entity): entity is DxfLwPolyline =>
          entity instanceof DxfLwPolyline && entity.layerName === LAYERS.BOARDS,
      );
    // Only the board outline: no run, no bridge for any of the 130 internal
    // groups, which have no exposed pad to draw.
    expect(copper).toHaveLength(1);
    expect(copper[0].closed).toBe(true);

    const labels = doc
      .getEntities()
      .filter(
        (entity): entity is DxfText =>
          entity instanceof DxfText && entity.layerName === LAYERS.BOARDS,
      );
    expect(labels.map((label) => label.text)).toEqual(['Breadboard 830']);
  });

  it('still exports all 830 holes', () => {
    const holes = doc
      .getEntities()
      .filter(
        (entity): entity is DxfCircle =>
          entity instanceof DxfCircle && entity.layerName === LAYERS.BOARDS,
      );
    expect(holes).toHaveLength(830);
  });

  it('puts a seated footprint pad on the hole it is actually in, across the channel', () => {
    const pads = doc
      .getEntities()
      .filter(
        (entity): entity is DxfCircle =>
          entity instanceof DxfCircle && entity.layerName === LAYERS.FOOTPRINTS,
      );

    const expected = footprintPinHoles(straddler, straddlePlacement).map((pin) => {
      const local = holeLocalPoint(breadboardNode.data, pin.hole);
      return mapper.mapPoint(
        breadboardNode.position.x + local.x,
        breadboardNode.position.y + local.y,
      );
    });
    expect(pads.map((pad) => ({ x: pad.x, y: pad.y }))).toEqual(expected);
  });

  it('stretches the exported body across the trench instead of leaving it behind', () => {
    const lead = doc
      .getEntities()
      .find(
        (entity): entity is DxfLwPolyline =>
          entity instanceof DxfLwPolyline &&
          entity.layerName === LAYERS.FOOTPRINTS &&
          !entity.closed,
      );
    const holes = footprintPinHoles(straddler, straddlePlacement);
    const points = holes.map((pin) => {
      const local = holeLocalPoint(breadboardNode.data, pin.hole);
      return mapper.mapPoint(
        breadboardNode.position.x + local.x,
        breadboardNode.position.y + local.y,
      );
    });
    // The lead runs hole to hole - three pitches apart, not one.
    expect(lead?.points).toEqual(points);
  });

  it('keeps negative resistor artwork inside its rigid DXF outline below the channel', () => {
    const resistorDoc = new DxfExporter(buildAvDxfConfig()).export(
      [breadboardNode, resistorNode],
      [],
      bounds,
    );
    const closed = resistorDoc
      .getEntities()
      .filter(
        (entity): entity is DxfLwPolyline =>
          entity instanceof DxfLwPolyline &&
          entity.layerName === LAYERS.FOOTPRINTS &&
          entity.closed,
      );
    const outline = closed[0];
    const label = resistorDoc
      .getEntities()
      .find(
        (entity): entity is DxfText =>
          entity instanceof DxfText &&
          entity.layerName === LAYERS.FOOTPRINTS &&
          entity.text === '1k',
      );
    if (!outline || !label) throw new Error('resistor outline or label not rendered');

    const xs = outline.points.map((point) => point.x);
    const ys = outline.points.map((point) => point.y);
    const rigidSize = footprintNodeSize(RESISTOR_1K_FOOTPRINT, 0, PITCH);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(mapper.mapLength(rigidSize.width));
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(mapper.mapLength(rigidSize.height));
    expect(label.x).toBeGreaterThanOrEqual(Math.min(...xs));
    expect(label.x).toBeLessThanOrEqual(Math.max(...xs));
    expect(label.y).toBeGreaterThanOrEqual(Math.min(...ys));
    expect(label.y).toBeLessThanOrEqual(Math.max(...ys));
  });
});

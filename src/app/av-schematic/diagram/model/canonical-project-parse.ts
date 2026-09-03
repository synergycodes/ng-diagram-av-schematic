import {
  findHoleCollisions,
  holeLocalPoint,
  holeKey,
  isBoardHoleAvailable,
  isHoleInBounds,
  type BoardHoleClaim,
} from './board-geometry';
import {
  boardCopperJunctionId,
  holePortId,
  isBoardPortId,
  parseHolePortId,
  parseTracePortId,
  physicalBindingConductorId,
  tracePortId,
} from './board-ports';
import { findTraceDefects, findTraceOverlaps, traceForHole, traceHoles } from './board-trace';
import {
  buildNets,
  CANONICAL_FORMAT_VERSION,
  CanonicalProjectError,
  endpointKey,
  type CanonicalBoard,
  type CanonicalCable,
  type CanonicalComponent,
  type CanonicalComponentLayout,
  type CanonicalConductor,
  type CanonicalConductorLayout,
  type CanonicalJunction,
  type CanonicalJunctionLayout,
  type CanonicalNet,
  type CanonicalNetEndpoint,
  type CanonicalPin,
  type CanonicalPinPlacement,
  type CanonicalPoint,
  type CanonicalProjectV4,
  type CanonicalRoutingMode,
} from './canonical-project';
import {
  footprintOccupiedHoles,
  footprintPinHoles,
  placementNodePosition,
} from './footprint-geometry';
import {
  type Footprint,
  type FootprintCell,
  type FootprintPaint,
  type FootprintShape,
} from './footprint';
import {
  BOARD_SURFACES,
  type BoardHole,
  type BoardRotation,
  type BoardSurface,
  type BoardTrace,
  type BoardTraceSegment,
  isBoardSurface,
  type DevicePlacement,
  type JunctionKind,
  type PortDirection,
  type PreservedFields,
  type PreservedValue,
  type WireVizLinkStyle,
} from './interfaces';
import { groupConductorsIntoNets } from './net-grouping';
import { OPERATIONAL_LIMITS } from './operational-limits.mjs';
import { normalizeOrthogonalPersistedRoute } from './persisted-wire-route.mjs';
import {
  isDangerousObjectKey,
  WIREVIZ_CABLE_CANONICAL_KEYS,
  WIREVIZ_CONNECTOR_CANONICAL_KEYS,
} from './wireviz-schema-keys';
import { isWireColorPairCoherent } from './wire-colors';
import { defaultVisualPlane, isValidVisualPlane } from './visual-planes';

/**
 * Untrusted JSON (disk, network) -> the current canonical project.
 *
 * Every field is checked explicitly, every failure throws a labeled
 * `CanonicalProjectError`, no blind casts -- the same discipline as
 * `wireviz-import/wireviz-model.ts`. Used by the storage client after a GET
 * and mirrored by the local service before a PUT reaches disk
 * (`server/canonical-project-validate.mjs`).
 *
 * A stored **v1** project is accepted and migrated rather than rejected:
 * that is the point of having a version in the format. The migration is also
 * where the issue #2 fix becomes visible on old data -- v1 stored one entry
 * per wire, so several v1 "nets" sharing a pin were really one multi-drop
 * net, and grouping them by connectivity is exactly what recovers it.
 */

const ALLOWED_ROUTING_MODES: readonly CanonicalRoutingMode[] = ['manual'];
const ALLOWED_PORT_DIRECTIONS: readonly PortDirection[] = ['input', 'output'];
const ALLOWED_JUNCTION_KINDS: readonly JunctionKind[] = ['junction', 'rail'];
const ALLOWED_ENDPOINT_KINDS = ['pin', 'junction'] as const;
const ALLOWED_WIREVIZ_LINKS: readonly WireVizLinkStyle[] = ['--', '<--', '<-->', '-->'];
const ALLOWED_BOARD_ROTATIONS: readonly BoardRotation[] = [0, 90, 180, 270];
const ALLOWED_FOOTPRINT_PAINTS: readonly FootprintPaint[] = [
  'none',
  'body',
  'body-alt',
  'accent',
  'lead',
  'silk',
  'polarity',
];
const ALLOWED_TEXT_ANCHORS = ['start', 'middle', 'end'] as const;

export function parseCanonicalProject(raw: unknown): CanonicalProjectV4 {
  const root = expectRecord(raw, 'project');
  const version = root['formatVersion'];

  if (version === 1) return migrateV1(parseV1(root));
  if (version === 2) return parseCurrent(root, true, false);
  if (version === 3) return parseCurrent(root, false, false);
  if (version === CANONICAL_FORMAT_VERSION) return parseCurrent(root, false, true);

  throw new CanonicalProjectError(
    `project.formatVersion: expected 1, 2, 3 or ${CANONICAL_FORMAT_VERSION}, got ${JSON.stringify(version)}`,
  );
}

// ---------------------------------------------------------------------------
// v2/v3/v4 shared structure
// ---------------------------------------------------------------------------

function parseCurrent(
  root: Record<string, unknown>,
  migrateVisualPlanes: boolean,
  readBoardJumpers: boolean,
): CanonicalProjectV4 {
  const electricalRaw = expectRecord(root['electrical'], 'project.electrical');
  const layoutRaw = expectRecord(root['layout'], 'project.layout');
  preflightV2(electricalRaw, layoutRaw);

  const components = expectArray(electricalRaw['components'], 'project.electrical.components').map(
    (value, i) => parseComponent(value, `project.electrical.components[${i}]`),
  );
  const junctions = expectArray(electricalRaw['junctions'], 'project.electrical.junctions').map(
    (value, i) => parseJunction(value, `project.electrical.junctions[${i}]`),
  );
  const cables = expectArray(electricalRaw['cables'], 'project.electrical.cables').map((value, i) =>
    parseCable(value, `project.electrical.cables[${i}]`),
  );
  const nets = expectArray(electricalRaw['nets'], 'project.electrical.nets').map((value, i) =>
    parseNet(value, `project.electrical.nets[${i}]`),
  );

  const boards = expectArray(layoutRaw['boards'], 'project.layout.boards').map((value, i) =>
    parseBoard(
      value,
      `project.layout.boards[${i}]`,
      migrateVisualPlanes ? defaultVisualPlane('board') : undefined,
    ),
  );
  const componentLayouts = expectArray(layoutRaw['components'], 'project.layout.components').map(
    (value, i) =>
      parseComponentLayout(
        value,
        `project.layout.components[${i}]`,
        migrateVisualPlanes ? defaultVisualPlane('component') : undefined,
      ),
  );
  const junctionLayouts = expectArray(layoutRaw['junctions'], 'project.layout.junctions').map(
    (value, i) =>
      parseJunctionLayout(
        value,
        `project.layout.junctions[${i}]`,
        migrateVisualPlanes ? defaultVisualPlane('junction') : undefined,
      ),
  );
  const conductorLayouts = expectArray(layoutRaw['conductors'], 'project.layout.conductors').map(
    (value, i) =>
      parseConductorLayout(
        value,
        `project.layout.conductors[${i}]`,
        migrateVisualPlanes ? defaultVisualPlane('conductor') : undefined,
        readBoardJumpers,
      ),
  );

  const project: CanonicalProjectV4 = {
    formatVersion: CANONICAL_FORMAT_VERSION,
    electrical: { components, junctions, cables, nets },
    layout: {
      boards,
      components: componentLayouts,
      junctions: junctionLayouts,
      conductors: conductorLayouts,
    },
  };

  validateProject(project);
  return project;
}

/**
 * Counts every collection entry that the parser will materialize before any
 * output array is built. Besides electrical identities and cable wire slots,
 * the budget includes endpoint and layout records plus their nested points.
 */
function preflightV2(
  electricalRaw: Record<string, unknown>,
  layoutRaw: Record<string, unknown>,
): void {
  const components = expectArray(electricalRaw['components'], 'project.electrical.components');
  const junctions = expectArray(electricalRaw['junctions'], 'project.electrical.junctions');
  const cables = expectArray(electricalRaw['cables'], 'project.electrical.cables');
  const nets = expectArray(electricalRaw['nets'], 'project.electrical.nets');
  const boards = expectArray(layoutRaw['boards'], 'project.layout.boards');
  const componentLayouts = expectArray(layoutRaw['components'], 'project.layout.components');
  const junctionLayouts = expectArray(layoutRaw['junctions'], 'project.layout.junctions');
  const conductorLayouts = expectArray(layoutRaw['conductors'], 'project.layout.conductors');
  const budget = new CanonicalEntityBudget();

  budget.add(boards.length, 'project.layout.boards');
  budget.add(components.length, 'project.electrical.components');
  budget.add(junctions.length, 'project.electrical.junctions');
  budget.add(cables.length, 'project.electrical.cables');
  budget.add(nets.length, 'project.electrical.nets');
  budget.add(componentLayouts.length, 'project.layout.components');
  budget.add(junctionLayouts.length, 'project.layout.junctions');
  budget.add(conductorLayouts.length, 'project.layout.conductors');

  boards.forEach((raw, index) => {
    const label = `project.layout.boards[${index}]`;
    const board = expectRecord(raw, label);
    if (board['holes'] !== undefined) {
      const holes = expectArray(board['holes'], `${label}.holes`);
      assertCollectionLimit(
        holes.length,
        OPERATIONAL_LIMITS.maxBoardHoles,
        `${label}.holes`,
        'hole count',
      );
      budget.add(holes.length, `${label}.holes`);
    }
    if (board['traces'] !== undefined) {
      const traces = expectArray(board['traces'], `${label}.traces`);
      let segmentCount = 0;
      assertCollectionLimit(
        traces.length,
        OPERATIONAL_LIMITS.maxBoardTraces,
        `${label}.traces`,
        'trace count',
      );
      budget.add(traces.length, `${label}.traces`);
      traces.forEach((traceRaw, traceIndex) => {
        const traceLabel = `${label}.traces[${traceIndex}].segments`;
        const segments = expectArray(expectRecord(traceRaw, traceLabel)['segments'], traceLabel);
        assertCollectionLimit(
          segments.length,
          OPERATIONAL_LIMITS.maxTraceSegmentsPerBoard,
          traceLabel,
          'segment count',
        );
        segmentCount += segments.length;
        budget.add(segments.length, traceLabel);
      });
      assertCollectionLimit(
        segmentCount,
        OPERATIONAL_LIMITS.maxTraceSegmentsPerBoard,
        `${label}.traces`,
        'total segment count',
      );
    }
  });

  components.forEach((raw, index) => {
    const label = `project.electrical.components[${index}].pins`;
    const pins = expectArray(
      expectRecord(raw, `project.electrical.components[${index}]`)['pins'],
      label,
    );
    assertCollectionLimit(pins.length, OPERATIONAL_LIMITS.maxPinsPerComponent, label, 'pin count');
    budget.add(pins.length, label);
  });

  cables.forEach((raw, index) => {
    const label = `project.electrical.cables[${index}].wireCount`;
    const cable = expectRecord(raw, `project.electrical.cables[${index}]`);
    const wireCount = expectBoundedPositiveInteger(
      cable['wireCount'],
      label,
      OPERATIONAL_LIMITS.maxWiresPerCable,
      'wire count',
    );
    const colorsLabel = `project.electrical.cables[${index}].colors`;
    const colors = expectArray(cable['colors'], colorsLabel);
    if (colors.length > wireCount) {
      throw new CanonicalProjectError(
        `${colorsLabel}: has ${colors.length} entries but wireCount is ${wireCount}`,
      );
    }
    const wireLabelsLabel = `project.electrical.cables[${index}].wireLabels`;
    if (cable['wireLabels'] !== undefined) {
      const wireLabels = expectArray(cable['wireLabels'], wireLabelsLabel);
      if (wireLabels.length > wireCount) {
        throw new CanonicalProjectError(
          `${wireLabelsLabel}: has ${wireLabels.length} entries but wireCount is ${wireCount}`,
        );
      }
      budget.add(wireLabels.length, wireLabelsLabel);
    }
    budget.add(wireCount, label);
  });

  nets.forEach((raw, index) => {
    const netLabel = `project.electrical.nets[${index}]`;
    const net = expectRecord(raw, netLabel);
    const endpointsLabel = `${netLabel}.endpoints`;
    const conductorsLabel = `${netLabel}.conductors`;
    budget.add(expectArray(net['endpoints'], endpointsLabel).length, endpointsLabel);
    budget.add(expectArray(net['conductors'], conductorsLabel).length, conductorsLabel);
  });

  componentLayouts.forEach((raw, index) => {
    const label = `project.layout.components[${index}].pinHoles`;
    const layout = expectRecord(raw, `project.layout.components[${index}]`);
    if (layout['pinHoles'] !== undefined) {
      budget.add(expectArray(layout['pinHoles'], label).length, label);
    }
    if (layout['footprint'] !== undefined) {
      const footprintLabel = `project.layout.components[${index}].footprint`;
      const footprint = expectRecord(layout['footprint'], footprintLabel);
      const pins = expectArray(footprint['pins'], `${footprintLabel}.pins`);
      assertCollectionLimit(
        pins.length,
        OPERATIONAL_LIMITS.maxPinsPerComponent,
        `${footprintLabel}.pins`,
        'pin count',
      );
      budget.add(pins.length, `${footprintLabel}.pins`);
      const shapes = expectArray(footprint['shapes'], `${footprintLabel}.shapes`);
      assertCollectionLimit(
        shapes.length,
        OPERATIONAL_LIMITS.maxFootprintShapes,
        `${footprintLabel}.shapes`,
        'shape count',
      );
      budget.add(shapes.length, `${footprintLabel}.shapes`);
      if (footprint['bodyCells'] !== undefined) {
        const cells = expectArray(footprint['bodyCells'], `${footprintLabel}.bodyCells`);
        assertCollectionLimit(
          cells.length,
          OPERATIONAL_LIMITS.maxBoardHoles,
          `${footprintLabel}.bodyCells`,
          'body cell count',
        );
        budget.add(cells.length, `${footprintLabel}.bodyCells`);
      }
    }
  });

  junctionLayouts.forEach((raw, index) => {
    const label = `project.layout.junctions[${index}].taps`;
    const layout = expectRecord(raw, `project.layout.junctions[${index}]`);
    expectBoundedPositiveInteger(
      layout['taps'],
      label,
      OPERATIONAL_LIMITS.maxJunctionTaps,
      'junction tap count',
    );
  });

  conductorLayouts.forEach((raw, index) => {
    const label = `project.layout.conductors[${index}].points`;
    const layout = expectRecord(raw, `project.layout.conductors[${index}]`);
    if (layout['points'] !== undefined) {
      budget.add(expectArray(layout['points'], label).length, label);
    }
    if (layout['boardJumper'] !== undefined) {
      const jumper = expectRecord(
        layout['boardJumper'],
        `project.layout.conductors[${index}].boardJumper`,
      );
      if (jumper['bends'] !== undefined) {
        const bendsLabel = `project.layout.conductors[${index}].boardJumper.bends`;
        budget.add(expectArray(jumper['bends'], bendsLabel).length, bendsLabel);
      }
    }
  });
}

/**
 * Cross-checks everything that a single-entry parse cannot: id uniqueness
 * across sections, references that must resolve, holes that must fit their
 * board, taps that must exist, and -- the invariant the whole net model rests
 * on -- that each declared net really is one connected group and that no
 * endpoint belongs to two nets at once.
 */
function validateProject(project: CanonicalProjectV4): void {
  const { components, junctions, cables, nets } = project.electrical;
  const { boards } = project.layout;

  const nodeIds = new Set<string>();
  const claimId = (id: string, label: string): void => {
    if (nodeIds.has(id)) {
      throw new CanonicalProjectError(`${label}: duplicate node id "${id}"`);
    }
    nodeIds.add(id);
  };

  const boardsById = new Map<string, CanonicalBoard>();
  for (const board of boards) {
    claimId(board.id, 'project.layout.boards');
    validateBoard(board);
    boardsById.set(board.id, board);
  }

  const componentsById = new Map<string, CanonicalComponent>();
  for (const component of components) {
    claimId(component.id, 'project.electrical.components');
    componentsById.set(component.id, component);

    const pinIds = new Set<string>();
    for (const pin of component.pins) {
      if (pinIds.has(pin.id)) {
        throw new CanonicalProjectError(
          `project.electrical.components "${component.id}".pins: duplicate id "${pin.id}"`,
        );
      }
      pinIds.add(pin.id);
    }
  }

  const junctionsById = new Map<string, CanonicalJunction>();
  for (const junction of junctions) {
    claimId(junction.id, 'project.electrical.junctions');
    junctionsById.set(junction.id, junction);
  }

  const cablesByName = new Map<string, CanonicalCable>();
  for (const cable of cables) {
    if (cablesByName.has(cable.name)) {
      throw new CanonicalProjectError(`project.electrical.cables: duplicate name "${cable.name}"`);
    }
    cablesByName.set(cable.name, cable);
  }

  const netIds = new Set<string>();
  const conductorIds = new Set<string>();
  const endpointOwner = new Map<string, string>();

  for (const net of nets) {
    if (netIds.has(net.id)) {
      throw new CanonicalProjectError(`project.electrical.nets: duplicate id "${net.id}"`);
    }
    netIds.add(net.id);

    const label = `project.electrical.nets "${net.id}"`;
    if (net.conductors.length === 0) {
      throw new CanonicalProjectError(`${label}: a net must have at least one conductor`);
    }

    const declared = new Set<string>();
    for (const endpoint of net.endpoints) {
      const key = endpointKey(endpoint);
      if (declared.has(key)) {
        throw new CanonicalProjectError(`${label}.endpoints: duplicate endpoint "${key}"`);
      }
      declared.add(key);
      resolveEndpoint(endpoint, componentsById, junctionsById, `${label}.endpoints`);

      const owner = endpointOwner.get(key);
      if (owner !== undefined && owner !== net.id) {
        throw new CanonicalProjectError(
          `${label}.endpoints: "${key}" already belongs to net "${owner}" (an endpoint cannot be on two nets)`,
        );
      }
      endpointOwner.set(key, net.id);
    }

    const touched = new Set<string>();
    for (const conductor of net.conductors) {
      if (conductorIds.has(conductor.id)) {
        throw new CanonicalProjectError(
          `project.electrical.nets: duplicate conductor id "${conductor.id}"`,
        );
      }
      conductorIds.add(conductor.id);

      const conductorLabel = `${label}.conductors "${conductor.id}"`;
      const fromKey = endpointKey(conductor.from);
      const toKey = endpointKey(conductor.to);
      if (fromKey === toKey) {
        throw new CanonicalProjectError(`${conductorLabel}: both ends are the same endpoint`);
      }
      for (const key of [fromKey, toKey]) {
        if (!declared.has(key)) {
          throw new CanonicalProjectError(
            `${conductorLabel}: endpoint "${key}" is not listed in the net's endpoints`,
          );
        }
        touched.add(key);
      }

      if (conductor.cable) {
        if (conductor.wirevizLoop) {
          throw new CanonicalProjectError(
            `${conductorLabel}: an internal WireViz loop cannot reference a cable`,
          );
        }
        if (conductor.wirevizLink !== undefined) {
          throw new CanonicalProjectError(
            `${conductorLabel}: wirevizLink is only valid when the conductor has no cable`,
          );
        }
        const cable = cablesByName.get(conductor.cable.name);
        if (!cable) {
          throw new CanonicalProjectError(
            `${conductorLabel}: no cable "${conductor.cable.name}" in project.electrical.cables`,
          );
        }
        if (conductor.cable.wireIndex > cable.wireCount) {
          throw new CanonicalProjectError(
            `${conductorLabel}: wire index ${conductor.cable.wireIndex} is out of range (1..${cable.wireCount})`,
          );
        }
      }
      if (conductor.wirevizLoop) {
        if (conductor.wirevizLink !== undefined) {
          throw new CanonicalProjectError(
            `${conductorLabel}: an internal WireViz loop cannot declare wirevizLink`,
          );
        }
        if (
          conductor.from.kind !== 'pin' ||
          conductor.to.kind !== 'pin' ||
          conductor.from.componentId !== conductor.to.componentId
        ) {
          throw new CanonicalProjectError(
            `${conductorLabel}: an internal WireViz loop must join two pins of one component`,
          );
        }
      }
    }

    for (const key of declared) {
      if (!touched.has(key)) {
        throw new CanonicalProjectError(
          `${label}.endpoints: "${key}" is declared but no conductor reaches it`,
        );
      }
    }

    const groups = groupConductorsIntoNets(
      net.conductors.map((conductor) => ({
        fromKey: endpointKey(conductor.from),
        toKey: endpointKey(conductor.to),
      })),
    );
    if (groups.length > 1) {
      throw new CanonicalProjectError(
        `${label}: conductors form ${groups.length} disconnected groups; a net must be a single connected group`,
      );
    }
  }

  validateLayout(project, boardsById, componentsById, junctionsById, conductorIds);
}

function validateLayout(
  project: CanonicalProjectV4,
  boardsById: ReadonlyMap<string, CanonicalBoard>,
  componentsById: ReadonlyMap<string, CanonicalComponent>,
  junctionsById: ReadonlyMap<string, CanonicalJunction>,
  conductorIds: ReadonlySet<string>,
): void {
  const seenComponentLayouts = new Set<string>();
  const physicalClaims: BoardHoleClaim[] = [];
  for (const layout of project.layout.components) {
    const label = `project.layout.components "${layout.componentId}"`;
    if (seenComponentLayouts.has(layout.componentId)) {
      throw new CanonicalProjectError(`${label}: duplicate layout entry`);
    }
    seenComponentLayouts.add(layout.componentId);

    const component = componentsById.get(layout.componentId);
    if (!component) {
      throw new CanonicalProjectError(`${label}: no such component in project.electrical`);
    }

    if (layout.boardId !== undefined && !boardsById.has(layout.boardId)) {
      throw new CanonicalProjectError(
        `${label}: boardId "${layout.boardId}" does not match any board in the project`,
      );
    }

    if (layout.footprintId !== undefined && layout.footprint === undefined) {
      throw new CanonicalProjectError(
        `${label}: footprintId requires an embedded footprint definition`,
      );
    }
    if (layout.footprint !== undefined) {
      validateFootprint(layout.footprint, `${label}.footprint`);
      if (layout.footprintId === undefined) {
        throw new CanonicalProjectError(`${label}: footprint requires footprintId`);
      }
      if (layout.footprint.id !== layout.footprintId) {
        throw new CanonicalProjectError(
          `${label}: footprint id "${layout.footprint.id}" differs from footprintId "${layout.footprintId}"`,
        );
      }
      const footprintPinIds = new Set(layout.footprint.pins.map((pin) => pin.id));
      for (const pin of component.pins) {
        if (!footprintPinIds.has(pin.id)) {
          throw new CanonicalProjectError(
            `${label}.footprint: no physical pin for electrical pin "${pin.id}"`,
          );
        }
      }
    }
    if (layout.placement !== undefined && layout.footprint === undefined) {
      throw new CanonicalProjectError(`${label}: placement requires a footprint`);
    }
    if (
      (layout.footprintRotation !== undefined || layout.footprintPitch !== undefined) &&
      layout.footprint === undefined
    ) {
      throw new CanonicalProjectError(`${label}: footprint display geometry requires a footprint`);
    }
    if (
      layout.placement !== undefined &&
      (layout.footprintRotation !== undefined || layout.footprintPitch !== undefined)
    ) {
      throw new CanonicalProjectError(
        `${label}: placement cannot be combined with footprint display geometry`,
      );
    }

    if (layout.placement && layout.footprint) {
      const board = boardsById.get(layout.placement.boardId);
      if (!board) {
        throw new CanonicalProjectError(
          `${label}.placement: no board "${layout.placement.boardId}"`,
        );
      }
      if (layout.boardId !== undefined && layout.boardId !== layout.placement.boardId) {
        throw new CanonicalProjectError(
          `${label}: boardId and placement.boardId must identify the same board`,
        );
      }
      const occupied = footprintOccupiedHoles(layout.footprint, layout.placement);
      const unavailable = occupied.filter((hole) => !isBoardHoleAvailable(board, hole));
      if (unavailable.length > 0) {
        const first = unavailable[0];
        throw new CanonicalProjectError(
          `${label}.placement: hole {row: ${first?.row ?? -1}, col: ${first?.col ?? -1}} is not available on board "${board.id}"`,
        );
      }
      layout.boardId = layout.placement.boardId;
      layout.position = placementNodePosition(
        { board, position: board.position },
        layout.placement,
      );
      const footprintHoles = new Map(
        footprintPinHoles(layout.footprint, layout.placement).map((pin) => [pin.pinId, pin.hole]),
      );
      layout.pinHoles = component.pins.flatMap((pin) => {
        const hole = footprintHoles.get(pin.id);
        return hole ? [{ pinId: pin.id, hole: { ...hole } }] : [];
      });
      physicalClaims.push(
        ...occupied.map((hole) => ({ boardId: board.id, ownerId: layout.componentId, hole })),
      );
    }

    const seenPins = new Set<string>();
    for (const placement of layout.pinHoles ?? []) {
      if (seenPins.has(placement.pinId)) {
        throw new CanonicalProjectError(`${label}.pinHoles: duplicate pin "${placement.pinId}"`);
      }
      seenPins.add(placement.pinId);
      if (!component.pins.some((pin) => pin.id === placement.pinId)) {
        throw new CanonicalProjectError(`${label}.pinHoles: no pin "${placement.pinId}"`);
      }
      validateHole(
        placement.hole,
        layout.boardId,
        boardsById,
        `${label}.pinHoles "${placement.pinId}"`,
      );
      if (!layout.placement && layout.boardId) {
        physicalClaims.push({
          boardId: layout.boardId,
          ownerId: `${layout.componentId}:${placement.pinId}`,
          hole: placement.hole,
        });
      }
    }
  }

  const collisions = findHoleCollisions(physicalClaims);
  if (collisions.length > 0) {
    const first = collisions[0]?.[0];
    const owners = collisions[0]?.map((claim) => claim.ownerId).join(', ') ?? '';
    throw new CanonicalProjectError(
      `project.layout.components: board "${first?.boardId ?? ''}" hole ` +
        `{row: ${first?.hole.row ?? -1}, col: ${first?.hole.col ?? -1}} is occupied by ${owners}`,
    );
  }

  const seenJunctionLayouts = new Set<string>();
  const tapsByJunction = new Map<string, number>();
  const boardPortsByJunction = new Map<string, ResolvedBoardPort>();
  for (const layout of project.layout.junctions) {
    const label = `project.layout.junctions "${layout.junctionId}"`;
    if (seenJunctionLayouts.has(layout.junctionId)) {
      throw new CanonicalProjectError(`${label}: duplicate layout entry`);
    }
    seenJunctionLayouts.add(layout.junctionId);

    if (!junctionsById.has(layout.junctionId)) {
      throw new CanonicalProjectError(`${label}: no such junction in project.electrical`);
    }
    if (layout.boardId !== undefined && !boardsById.has(layout.boardId)) {
      throw new CanonicalProjectError(
        `${label}: boardId "${layout.boardId}" does not match any board in the project`,
      );
    }
    if (layout.hole) {
      validateHole(layout.hole, layout.boardId, boardsById, label);
    }
    if (layout.boardPort !== undefined) {
      if (!layout.boardId) {
        throw new CanonicalProjectError(`${label}.boardPort: requires boardId`);
      }
      if (!isBoardPortId(layout.boardPort)) {
        throw new CanonicalProjectError(`${label}.boardPort: invalid board port id`);
      }
      const board = boardsById.get(layout.boardId);
      if (!board) {
        throw new CanonicalProjectError(`${label}.boardPort: unknown board "${layout.boardId}"`);
      }
      const hole = parseHolePortId(layout.boardPort);
      const traceId = parseTracePortId(layout.boardPort);
      const trace = traceId
        ? board.traces?.find((candidate) => candidate.id === traceId)
        : undefined;
      if (traceId && !trace) {
        throw new CanonicalProjectError(`${label}.boardPort: unknown trace "${traceId}"`);
      }
      if (hole && !isBoardHoleAvailable(board, hole)) {
        throw new CanonicalProjectError(`${label}.boardPort: unavailable hole`);
      }
      if (hole && traceForHole(board, hole)) {
        throw new CanonicalProjectError(
          `${label}.boardPort: a hole on a trace must use that trace port`,
        );
      }
      const holes = trace ? traceHoles(trace) : hole ? [hole] : [];
      if (holes.length === 0) {
        throw new CanonicalProjectError(`${label}.boardPort: port has no physical hole`);
      }
      const expectedId = boardCopperJunctionId(layout.boardId, layout.boardPort);
      if (layout.junctionId !== expectedId) {
        throw new CanonicalProjectError(
          `${label}: expected deterministic junction id "${expectedId}"`,
        );
      }
      const anchor = holes[0];
      if (!anchor) throw new CanonicalProjectError(`${label}.boardPort: port has no anchor`);
      const anchorPoint = holeLocalPoint(board, anchor);
      layout.hole = { ...anchor };
      layout.taps = holes.length;
      layout.position = {
        x: board.position.x + anchorPoint.x,
        y: board.position.y + anchorPoint.y,
      };
      boardPortsByJunction.set(layout.junctionId, {
        boardId: layout.boardId,
        portId: layout.boardPort,
        holes,
        netLabel: trace?.net,
        internal: trace?.internal === true,
      });
    }
    tapsByJunction.set(layout.junctionId, layout.taps);
  }

  validateCopperNetLabels(project, boardPortsByJunction);

  const conductorsById = new Map<string, CanonicalConductor>();
  for (const net of project.electrical.nets) {
    for (const conductor of net.conductors) conductorsById.set(conductor.id, conductor);
  }

  const seenConductorLayouts = new Set<string>();
  for (const layout of project.layout.conductors) {
    const label = `project.layout.conductors "${layout.conductorId}"`;
    if (seenConductorLayouts.has(layout.conductorId)) {
      throw new CanonicalProjectError(`${label}: duplicate layout entry`);
    }
    seenConductorLayouts.add(layout.conductorId);

    if (!conductorIds.has(layout.conductorId)) {
      throw new CanonicalProjectError(`${label}: no such conductor in project.electrical`);
    }

    const conductor = conductorsById.get(layout.conductorId);
    validateTap(layout.fromTap, conductor?.from, tapsByJunction, `${label}.fromTap`);
    validateTap(layout.toTap, conductor?.to, tapsByJunction, `${label}.toTap`);
    if (layout.physicalBinding) {
      if (!conductor) throw new CanonicalProjectError(`${label}: missing conductor`);
      validatePhysicalBinding(
        layout,
        conductor,
        project.layout.components,
        boardsById,
        boardPortsByJunction,
        label,
      );
    }
    if (layout.boardJumper) {
      if (!conductor) throw new CanonicalProjectError(`${label}: missing conductor`);
      validateBoardJumper(layout, conductor, boardsById, boardPortsByJunction, label);
    }
  }

  validateInternalCopperTaps(project, boardPortsByJunction);
  validatePhysicalBindingCoverage(project);
}

/** A junction resolved to one board port: which copper, where, and how it is reachable. */
interface ResolvedBoardPort {
  boardId: string;
  portId: string;
  holes: BoardHole[];
  netLabel?: string;
  /** Copper inside the board body, which has no landing pad of its own. */
  internal: boolean;
}

function validateBoardJumper(
  layout: CanonicalConductorLayout,
  conductor: CanonicalConductor,
  boardsById: ReadonlyMap<string, CanonicalBoard>,
  boardPortsByJunction: ReadonlyMap<string, ResolvedBoardPort>,
  label: string,
): void {
  const boardId = layout.boardJumper?.boardId;
  const board = boardId ? boardsById.get(boardId) : undefined;
  if (!board) {
    throw new CanonicalProjectError(`${label}.boardJumper.boardId: no board "${boardId ?? ''}"`);
  }
  if (board.surface !== 'breadboard') {
    throw new CanonicalProjectError(
      `${label}.boardJumper.boardId: board "${board.id}" is not a breadboard`,
    );
  }
  if (layout.physicalBinding) {
    throw new CanonicalProjectError(`${label}: a board jumper cannot be a physical binding`);
  }
  if (layout.routingMode !== undefined || layout.points !== undefined) {
    throw new CanonicalProjectError(
      `${label}: boardJumper derives endpoints and cannot contain routingMode or points`,
    );
  }
  if (layout.visualPlane <= board.visualPlane) {
    throw new CanonicalProjectError(
      `${label}.visualPlane: a board jumper must be strictly above its board`,
    );
  }

  const sourceHole = boardJumperEndpointHole(
    conductor.from,
    layout.fromTap,
    board,
    boardPortsByJunction,
    `${label}.from`,
  );
  const targetHole = boardJumperEndpointHole(
    conductor.to,
    layout.toTap,
    board,
    boardPortsByJunction,
    `${label}.to`,
  );
  // Resolve both ends here even though their coordinates are intentionally
  // absent from boardJumper. This guarantees reload can derive them from the
  // exact taps and board holes.
  void sourceHole;
  void targetHole;
}

function boardJumperEndpointHole(
  endpoint: CanonicalNetEndpoint,
  tap: number | undefined,
  board: CanonicalBoard,
  boardPortsByJunction: ReadonlyMap<string, ResolvedBoardPort>,
  label: string,
): BoardHole {
  if (endpoint.kind !== 'junction') {
    throw new CanonicalProjectError(`${label}: a board jumper endpoint must be a board hole`);
  }
  const resolved = boardPortsByJunction.get(endpoint.junctionId);
  if (resolved?.boardId !== board.id) {
    throw new CanonicalProjectError(`${label}: endpoint is not on board "${board.id}"`);
  }
  if (resolved.holes.length > 1 && tap === undefined) {
    throw new CanonicalProjectError(`${label}: endpoint must identify one hole with a tap index`);
  }
  const hole = resolved.holes[tap ?? 0];
  if (!hole) throw new CanonicalProjectError(`${label}: endpoint hole cannot be resolved`);
  return hole;
}

/**
 * Copper sealed inside a board body has no pad to land on.
 *
 * `BoardNodeComponent` mints a `trace:<id>` port only for *exposed* copper, so
 * a conductor that lands on an internal group - a breadboard column clip or
 * one of its buses - has to say which of the group's holes it lands on. Its
 * tap index is that answer, and without it `fromCanonicalProject` would rebuild
 * the edge pointing at a `trace:<id>` port that is never rendered: a wire
 * silently attached to nothing.
 *
 * Physical bindings already pin the exact tap (see `validatePhysicalBinding`);
 * this covers every ordinary conductor, including one whose layout entry is
 * missing entirely.
 */
function validateInternalCopperTaps(
  project: CanonicalProjectV4,
  boardPortsByJunction: ReadonlyMap<string, ResolvedBoardPort>,
): void {
  const layoutsByConductor = new Map(
    project.layout.conductors.map((layout) => [layout.conductorId, layout]),
  );
  for (const net of project.electrical.nets) {
    for (const conductor of net.conductors) {
      const layout = layoutsByConductor.get(conductor.id);
      const label = `project.layout.conductors "${conductor.id}"`;
      requireInternalCopperTap(
        conductor.from,
        layout?.fromTap,
        boardPortsByJunction,
        `${label}.fromTap`,
      );
      requireInternalCopperTap(conductor.to, layout?.toTap, boardPortsByJunction, `${label}.toTap`);
    }
  }
}

function requireInternalCopperTap(
  endpoint: CanonicalNetEndpoint,
  tap: number | undefined,
  boardPortsByJunction: ReadonlyMap<string, ResolvedBoardPort>,
  label: string,
): void {
  if (endpoint.kind !== 'junction') return;
  if (!boardPortsByJunction.get(endpoint.junctionId)?.internal) return;
  if (tap !== undefined) return;
  throw new CanonicalProjectError(
    `${label}: copper inside the board body has no landing pad, so this end must name the ` +
      `hole it lands on with a tap index`,
  );
}

function validateCopperNetLabels(
  project: CanonicalProjectV4,
  boardPortsByJunction: ReadonlyMap<string, { netLabel?: string }>,
): void {
  for (const net of project.electrical.nets) {
    const labels = [
      ...new Set(
        net.endpoints
          .filter((endpoint) => endpoint.kind === 'junction')
          .map((endpoint) => boardPortsByJunction.get(endpoint.junctionId)?.netLabel)
          .filter((label): label is string => !!label),
      ),
    ].sort();
    if (labels.length > 1) {
      throw new CanonicalProjectError(
        `project.electrical.nets "${net.id}": physically joins incompatible copper labels ` +
          labels.join(', '),
      );
    }
  }
}

function validateBoard(board: CanonicalBoard): void {
  const label = `project.layout.boards "${board.id}"`;
  if (board.holeDiameter !== undefined && board.holeDiameter > board.pitch) {
    throw new CanonicalProjectError(`${label}.holeDiameter: cannot exceed board pitch`);
  }
  validateBoardSurface(board, label);
  if (board.rowLabels !== undefined && board.rowLabels.length !== board.rows) {
    throw new CanonicalProjectError(
      `${label}.rowLabels: ${board.rowLabels.length} entries for ${board.rows} rows`,
    );
  }
  if (board.holes === undefined && board.rows * board.cols > OPERATIONAL_LIMITS.maxBoardHoles) {
    throw new CanonicalProjectError(
      `${label}: implicit hole count ${board.rows * board.cols} exceeds operational limit of ` +
        `${OPERATIONAL_LIMITS.maxBoardHoles}; use an explicit sparse holes list`,
    );
  }

  const holeKeys = new Set<string>();
  for (const hole of board.holes ?? []) {
    const key = holeKey(hole);
    if (holeKeys.has(key)) throw new CanonicalProjectError(`${label}.holes: duplicate "${key}"`);
    holeKeys.add(key);
    if (!isHoleInBounds(board, hole)) {
      throw new CanonicalProjectError(`${label}.holes: "${key}" is outside the board grid`);
    }
  }

  const traceIds = new Set<string>();
  for (const trace of board.traces ?? []) {
    if (traceIds.has(trace.id)) {
      throw new CanonicalProjectError(`${label}.traces: duplicate id "${trace.id}"`);
    }
    traceIds.add(trace.id);
    if (trace.segments.length === 0) {
      throw new CanonicalProjectError(`${label}.traces "${trace.id}": requires a segment`);
    }
    for (const [segmentIndex, segment] of trace.segments.entries()) {
      if (segment.from.row !== segment.to.row && segment.from.col !== segment.to.col) {
        throw new CanonicalProjectError(
          `${label}.traces "${trace.id}" segment ${segmentIndex}: diagonal`,
        );
      }
      for (const endpoint of [segment.from, segment.to]) {
        if (!isBoardHoleAvailable(board, endpoint)) {
          throw new CanonicalProjectError(
            `${label}.traces "${trace.id}" segment ${segmentIndex}: unavailable endpoint ` +
              `{row: ${endpoint.row}, col: ${endpoint.col}}`,
          );
        }
      }
    }
    const tapCount = traceHoles(trace).length;
    if (tapCount > OPERATIONAL_LIMITS.maxJunctionTaps) {
      throw new CanonicalProjectError(
        `${label}.traces "${trace.id}": ${tapCount} holes exceed junction tap limit ` +
          `${OPERATIONAL_LIMITS.maxJunctionTaps}`,
      );
    }
  }
  const defect = findTraceDefects(board)[0];
  if (defect) {
    throw new CanonicalProjectError(
      `${label}.traces "${defect.traceId}" segment ${defect.segmentIndex}: ${defect.reason} at ` +
        `{row: ${defect.hole.row}, col: ${defect.hole.col}}`,
    );
  }
  const overlap = findTraceOverlaps(board)[0];
  if (overlap) {
    throw new CanonicalProjectError(
      `${label}.traces: ${overlap.traceIds.join(', ')} overlap at ` +
        `{row: ${overlap.hole.row}, col: ${overlap.hole.col}}`,
    );
  }
}

function validateFootprint(footprint: Footprint, label: string): void {
  const pinIds = new Set<string>();
  const occupiedPinCells = new Set<string>();
  for (const pin of footprint.pins) {
    if (pinIds.has(pin.id)) {
      throw new CanonicalProjectError(`${label}.pins: duplicate id "${pin.id}"`);
    }
    pinIds.add(pin.id);
    validateFootprintCell(pin.cell, footprint, `${label}.pins "${pin.id}".cell`);
    const cellKey = holeKey(pin.cell);
    if (occupiedPinCells.has(cellKey)) {
      throw new CanonicalProjectError(`${label}.pins: two pins occupy cell "${cellKey}"`);
    }
    occupiedPinCells.add(cellKey);
  }
  const bodyCells = new Set<string>();
  for (const cell of footprint.bodyCells ?? []) {
    validateFootprintCell(cell, footprint, `${label}.bodyCells`);
    const key = holeKey(cell);
    if (bodyCells.has(key)) {
      throw new CanonicalProjectError(`${label}.bodyCells: duplicate cell "${key}"`);
    }
    bodyCells.add(key);
  }
}

function validateFootprintCell(cell: FootprintCell, footprint: Footprint, label: string): void {
  if (cell.row >= footprint.rows || cell.col >= footprint.cols) {
    throw new CanonicalProjectError(
      `${label}: {row: ${cell.row}, col: ${cell.col}} is outside ${footprint.rows} x ${footprint.cols}`,
    );
  }
}

function validatePhysicalBinding(
  layout: CanonicalConductorLayout,
  conductor: CanonicalConductor,
  componentLayouts: readonly CanonicalComponentLayout[],
  boardsById: ReadonlyMap<string, CanonicalBoard>,
  boardPortsByJunction: ReadonlyMap<string, ResolvedBoardPort>,
  label: string,
): void {
  if (
    layout.routingMode !== undefined ||
    layout.points !== undefined ||
    layout.boardJumper !== undefined
  ) {
    throw new CanonicalProjectError(`${label}: a physical binding cannot have a visible route`);
  }
  const pin =
    conductor.from.kind === 'pin'
      ? conductor.from
      : conductor.to.kind === 'pin'
        ? conductor.to
        : null;
  const junction =
    conductor.from.kind === 'junction'
      ? conductor.from
      : conductor.to.kind === 'junction'
        ? conductor.to
        : null;
  if (!pin || !junction) {
    throw new CanonicalProjectError(
      `${label}: a physical binding must join one pin to one junction`,
    );
  }
  const expectedId = physicalBindingConductorId(pin.componentId, pin.pinId);
  if (conductor.id !== expectedId) {
    throw new CanonicalProjectError(`${label}: expected deterministic id "${expectedId}"`);
  }
  const componentLayout = componentLayouts.find(
    (candidate) => candidate.componentId === pin.componentId,
  );
  if (!componentLayout) {
    throw new CanonicalProjectError(`${label}: pin component has no layout`);
  }
  const pinHole =
    componentLayout.placement && componentLayout.footprint
      ? footprintPinHoles(componentLayout.footprint, componentLayout.placement).find(
          (candidate) => candidate.pinId === pin.pinId,
        )?.hole
      : componentLayout.pinHoles?.find((candidate) => candidate.pinId === pin.pinId)?.hole;
  const physicalBoardId = componentLayout.placement?.boardId ?? componentLayout.boardId;
  const board = physicalBoardId ? boardsById.get(physicalBoardId) : undefined;
  if (!pinHole || !board) {
    throw new CanonicalProjectError(`${label}: cannot resolve the pin's board hole`);
  }
  const trace = traceForHole(board, pinHole);
  const expectedPort = trace ? tracePortId(trace.id) : holePortId(pinHole);
  const expectedJunctionId = boardCopperJunctionId(board.id, expectedPort);
  if (junction.junctionId !== expectedJunctionId) {
    throw new CanonicalProjectError(
      `${label}: pin resolves to junction "${expectedJunctionId}", not "${junction.junctionId}"`,
    );
  }
  const boardPort = boardPortsByJunction.get(junction.junctionId);
  if (boardPort?.portId !== expectedPort) {
    throw new CanonicalProjectError(`${label}: junction has no matching boardPort layout`);
  }
  const expectedTap = trace
    ? traceHoles(trace).findIndex((hole) => hole.row === pinHole.row && hole.col === pinHole.col)
    : undefined;
  const actualTap = conductor.from.kind === 'junction' ? layout.fromTap : layout.toTap;
  if (actualTap !== expectedTap) {
    throw new CanonicalProjectError(
      `${label}: expected copper tap ${String(expectedTap)}, got ${String(actualTap)}`,
    );
  }
}

function validatePhysicalBindingCoverage(project: CanonicalProjectV4): void {
  const bound = new Set(
    project.layout.conductors
      .filter((layout) => layout.physicalBinding)
      .map((layout) => layout.conductorId),
  );
  const componentsById = new Map(
    project.electrical.components.map((component) => [component.id, component]),
  );
  for (const layout of project.layout.components) {
    if (!layout.placement || !layout.footprint) continue;
    const component = componentsById.get(layout.componentId);
    if (!component) continue;
    for (const pin of component.pins) {
      const id = physicalBindingConductorId(component.id, pin.id);
      if (!bound.has(id)) {
        throw new CanonicalProjectError(
          `project.layout.components "${component.id}": missing physical binding "${id}"`,
        );
      }
    }
  }
}

/**
 * A hole address is only meaningful relative to one specific board, so
 * anything carrying a hole must declare which board -- this checks the
 * address fits *that* board's grid, not merely some board in the project.
 */
function validateHole(
  hole: BoardHole,
  boardId: string | undefined,
  boardsById: ReadonlyMap<string, CanonicalBoard>,
  label: string,
): void {
  if (boardId === undefined) {
    throw new CanonicalProjectError(`${label}.hole: a hole was given but no boardId`);
  }
  const board = boardsById.get(boardId);
  if (!board || !isBoardHoleAvailable(board, hole)) {
    throw new CanonicalProjectError(
      `${label}.hole: {row: ${hole.row}, col: ${hole.col}} does not fit board "${boardId}"`,
    );
  }
}

function validateTap(
  tap: number | undefined,
  endpoint: CanonicalNetEndpoint | undefined,
  tapsByJunction: ReadonlyMap<string, number>,
  label: string,
): void {
  if (tap === undefined) return;
  if (endpoint?.kind !== 'junction') {
    throw new CanonicalProjectError(`${label}: this end is not a junction, so it has no tap`);
  }
  // A junction with no layout entry renders with a single tap (see
  // fromCanonicalProject), so tap 0 is the only valid index in that case.
  const taps = tapsByJunction.get(endpoint.junctionId) ?? 1;
  if (tap >= taps) {
    throw new CanonicalProjectError(
      `${label}: tap ${tap} is out of range for junction "${endpoint.junctionId}" (${taps} taps)`,
    );
  }
}

function resolveEndpoint(
  endpoint: CanonicalNetEndpoint,
  componentsById: ReadonlyMap<string, CanonicalComponent>,
  junctionsById: ReadonlyMap<string, CanonicalJunction>,
  label: string,
): void {
  if (endpoint.kind === 'junction') {
    if (!junctionsById.has(endpoint.junctionId)) {
      throw new CanonicalProjectError(`${label}: no junction "${endpoint.junctionId}"`);
    }
    return;
  }
  const component = componentsById.get(endpoint.componentId);
  if (!component) {
    throw new CanonicalProjectError(`${label}: no component "${endpoint.componentId}"`);
  }
  if (!component.pins.some((pin) => pin.id === endpoint.pinId)) {
    throw new CanonicalProjectError(
      `${label}: component "${endpoint.componentId}" has no pin "${endpoint.pinId}"`,
    );
  }
}

// ---------------------------------------------------------------------------
// v2 entry parsers
// ---------------------------------------------------------------------------

function parseComponent(raw: unknown, label: string): CanonicalComponent {
  const obj = expectRecord(raw, label);
  const pins = expectArray(obj['pins'], `${label}.pins`).map((p, i) =>
    parsePin(p, `${label}.pins[${i}]`),
  );

  const pinIds = new Set<string>();
  for (const pin of pins) {
    if (pinIds.has(pin.id)) {
      throw new CanonicalProjectError(`${label}.pins: duplicate id "${pin.id}"`);
    }
    pinIds.add(pin.id);
  }

  return {
    id: expectNonEmptyString(obj['id'], `${label}.id`),
    deviceId: expectString(obj['deviceId'], `${label}.deviceId`),
    manufacturer: expectString(obj['manufacturer'], `${label}.manufacturer`),
    model: expectString(obj['model'], `${label}.model`),
    category: expectOptionalString(obj['category'], `${label}.category`),
    location: expectOptionalString(obj['location'], `${label}.location`),
    wirevizName: expectOptionalString(obj['wirevizName'], `${label}.wirevizName`),
    wirevizType: expectOptionalString(obj['wirevizType'], `${label}.wirevizType`),
    wirevizSubtype: expectOptionalString(obj['wirevizSubtype'], `${label}.wirevizSubtype`),
    wirevizColor: expectOptionalString(obj['wirevizColor'], `${label}.wirevizColor`),
    wirevizManufacturer: expectOptionalString(
      obj['wirevizManufacturer'],
      `${label}.wirevizManufacturer`,
    ),
    wirevizMpn: expectOptionalString(obj['wirevizMpn'], `${label}.wirevizMpn`),
    wirevizStyle: expectOptionalString(obj['wirevizStyle'], `${label}.wirevizStyle`),
    wirevizShowName: expectOptionalBoolean(obj['wirevizShowName'], `${label}.wirevizShowName`),
    notes: expectOptionalString(obj['notes'], `${label}.notes`),
    wirevizExtras: expectOptionalPreservedFields(
      obj['wirevizExtras'],
      `${label}.wirevizExtras`,
      WIREVIZ_CONNECTOR_CANONICAL_KEYS,
    ),
    pins,
  };
}

function parsePin(raw: unknown, label: string): CanonicalPin {
  const obj = expectRecord(raw, label);
  return {
    id: expectNonEmptyString(obj['id'], `${label}.id`),
    label: expectString(obj['label'], `${label}.label`),
    direction: expectOneOf(obj['direction'], ALLOWED_PORT_DIRECTIONS, `${label}.direction`),
    connectorType: expectOptionalString(obj['connectorType'], `${label}.connectorType`),
    wirevizDesignator: expectOptionalString(obj['wirevizDesignator'], `${label}.wirevizDesignator`),
    wirevizLabel: expectOptionalString(obj['wirevizLabel'], `${label}.wirevizLabel`),
  };
}

function parseJunction(raw: unknown, label: string): CanonicalJunction {
  const obj = expectRecord(raw, label);
  return {
    id: expectNonEmptyString(obj['id'], `${label}.id`),
    label: expectString(obj['label'], `${label}.label`),
    kind: expectOneOf(obj['kind'], ALLOWED_JUNCTION_KINDS, `${label}.kind`),
    notes: expectOptionalString(obj['notes'], `${label}.notes`),
    wirevizName: expectOptionalString(obj['wirevizName'], `${label}.wirevizName`),
    wirevizType: expectOptionalString(obj['wirevizType'], `${label}.wirevizType`),
    wirevizSubtype: expectOptionalString(obj['wirevizSubtype'], `${label}.wirevizSubtype`),
    wirevizColor: expectOptionalString(obj['wirevizColor'], `${label}.wirevizColor`),
    wirevizManufacturer: expectOptionalString(
      obj['wirevizManufacturer'],
      `${label}.wirevizManufacturer`,
    ),
    wirevizMpn: expectOptionalString(obj['wirevizMpn'], `${label}.wirevizMpn`),
    wirevizStyle: expectOptionalString(obj['wirevizStyle'], `${label}.wirevizStyle`),
    wirevizShowName: expectOptionalBoolean(obj['wirevizShowName'], `${label}.wirevizShowName`),
    wirevizExtras: expectOptionalPreservedFields(
      obj['wirevizExtras'],
      `${label}.wirevizExtras`,
      WIREVIZ_CONNECTOR_CANONICAL_KEYS,
    ),
  };
}

function parseCable(raw: unknown, label: string): CanonicalCable {
  const obj = expectRecord(raw, label);
  const wireCount = expectBoundedPositiveInteger(
    obj['wireCount'],
    `${label}.wireCount`,
    OPERATIONAL_LIMITS.maxWiresPerCable,
    'wire count',
  );
  const colors = expectArray(obj['colors'], `${label}.colors`).map((value, i) =>
    expectString(value, `${label}.colors[${i}]`),
  );
  if (colors.length > wireCount) {
    throw new CanonicalProjectError(
      `${label}.colors: has ${colors.length} entries but wireCount is ${wireCount}`,
    );
  }
  while (colors.length < wireCount) colors.push('');
  const wireLabels =
    obj['wireLabels'] === undefined
      ? undefined
      : expectArray(obj['wireLabels'], `${label}.wireLabels`).map((value, i) =>
          expectString(value, `${label}.wireLabels[${i}]`),
        );
  if (wireLabels && wireLabels.length > wireCount) {
    throw new CanonicalProjectError(
      `${label}.wireLabels: has ${wireLabels.length} entries but wireCount is ${wireCount}`,
    );
  }
  if (wireLabels) while (wireLabels.length < wireCount) wireLabels.push('');

  return {
    name: expectNonEmptyString(obj['name'], `${label}.name`),
    wireCount,
    colors,
    wireLabels,
    gauge: expectOptionalString(obj['gauge'], `${label}.gauge`),
    length: expectOptionalString(obj['length'], `${label}.length`),
    notes: expectOptionalString(obj['notes'], `${label}.notes`),
    type: expectOptionalString(obj['type'], `${label}.type`),
    manufacturer: expectOptionalString(obj['manufacturer'], `${label}.manufacturer`),
    mpn: expectOptionalString(obj['mpn'], `${label}.mpn`),
    colorCode: expectOptionalString(obj['colorCode'], `${label}.colorCode`),
    wirevizExtras: expectOptionalPreservedFields(
      obj['wirevizExtras'],
      `${label}.wirevizExtras`,
      WIREVIZ_CABLE_CANONICAL_KEYS,
    ),
  };
}

function parseNet(raw: unknown, label: string): CanonicalNet {
  const obj = expectRecord(raw, label);
  return {
    id: expectNonEmptyString(obj['id'], `${label}.id`),
    name: expectString(obj['name'], `${label}.name`),
    endpoints: expectArray(obj['endpoints'], `${label}.endpoints`).map((value, i) =>
      parseEndpoint(value, `${label}.endpoints[${i}]`),
    ),
    conductors: expectArray(obj['conductors'], `${label}.conductors`).map((value, i) =>
      parseConductor(value, `${label}.conductors[${i}]`),
    ),
  };
}

function parseEndpoint(raw: unknown, label: string): CanonicalNetEndpoint {
  const obj = expectRecord(raw, label);
  const kind = expectOneOf(obj['kind'], ALLOWED_ENDPOINT_KINDS, `${label}.kind`);
  if (kind === 'junction') {
    return { kind, junctionId: expectNonEmptyString(obj['junctionId'], `${label}.junctionId`) };
  }
  return {
    kind,
    componentId: expectNonEmptyString(obj['componentId'], `${label}.componentId`),
    pinId: expectNonEmptyString(obj['pinId'], `${label}.pinId`),
  };
}

function parseConductor(raw: unknown, label: string): CanonicalConductor {
  const obj = expectRecord(raw, label);
  const cableRaw = obj['cable'];
  const color = expectOptionalString(obj['color'], `${label}.color`);
  const colorCode = expectOptionalString(obj['colorCode'], `${label}.colorCode`);
  if (!isWireColorPairCoherent(color, colorCode)) {
    throw new CanonicalProjectError(`${label}: color does not match colorCode`);
  }
  return {
    id: expectNonEmptyString(obj['id'], `${label}.id`),
    from: parseEndpoint(obj['from'], `${label}.from`),
    to: parseEndpoint(obj['to'], `${label}.to`),
    cable:
      cableRaw === undefined
        ? undefined
        : (() => {
            const cable = expectRecord(cableRaw, `${label}.cable`);
            return {
              name: expectNonEmptyString(cable['name'], `${label}.cable.name`),
              wireIndex: expectPositiveInteger(cable['wireIndex'], `${label}.cable.wireIndex`),
            };
          })(),
    wireType: expectOptionalString(obj['wireType'], `${label}.wireType`),
    color,
    colorCode,
    gauge: expectOptionalString(obj['gauge'], `${label}.gauge`),
    length: expectOptionalString(obj['length'], `${label}.length`),
    notes: expectOptionalString(obj['notes'], `${label}.notes`),
    wirevizLink:
      obj['wirevizLink'] === undefined
        ? undefined
        : expectOneOf(obj['wirevizLink'], ALLOWED_WIREVIZ_LINKS, `${label}.wirevizLink`),
    wirevizLoop: expectOptionalBoolean(obj['wirevizLoop'], `${label}.wirevizLoop`),
  };
}

function parseBoard(raw: unknown, label: string, fallbackVisualPlane?: number): CanonicalBoard {
  const obj = expectRecord(raw, label);
  return {
    id: expectNonEmptyString(obj['id'], `${label}.id`),
    label: expectString(obj['label'], `${label}.label`),
    notes: expectOptionalString(obj['notes'], `${label}.notes`),
    surface:
      obj['surface'] === undefined
        ? undefined
        : parseBoardSurface(obj['surface'], `${label}.surface`),
    rows: expectBoundedPositiveInteger(
      obj['rows'],
      `${label}.rows`,
      OPERATIONAL_LIMITS.maxBoardRows,
      'row count',
    ),
    cols: expectBoundedPositiveInteger(
      obj['cols'],
      `${label}.cols`,
      OPERATIONAL_LIMITS.maxBoardCols,
      'column count',
    ),
    pitch: expectBoundedPositiveFiniteNumber(
      obj['pitch'],
      `${label}.pitch`,
      OPERATIONAL_LIMITS.maxBoardPitch,
      'pitch',
    ),
    centerGap:
      obj['centerGap'] === undefined
        ? undefined
        : expectBoundedPositiveFiniteNumber(
            obj['centerGap'],
            `${label}.centerGap`,
            OPERATIONAL_LIMITS.maxBoardPitch,
            'central gap',
          ),
    rowLabels:
      obj['rowLabels'] === undefined
        ? undefined
        : expectArray(obj['rowLabels'], `${label}.rowLabels`).map((rowLabel, index) =>
            expectString(rowLabel, `${label}.rowLabels[${index}]`),
          ),
    holes:
      obj['holes'] === undefined
        ? undefined
        : expectArray(obj['holes'], `${label}.holes`).map((hole, index) =>
            expectHole(hole, `${label}.holes[${index}]`),
          ),
    holeDiameter:
      obj['holeDiameter'] === undefined
        ? undefined
        : expectBoundedPositiveFiniteNumber(
            obj['holeDiameter'],
            `${label}.holeDiameter`,
            OPERATIONAL_LIMITS.maxBoardPitch,
            'hole diameter',
          ),
    traces:
      obj['traces'] === undefined
        ? undefined
        : expectArray(obj['traces'], `${label}.traces`).map((trace, index) =>
            parseBoardTrace(trace, `${label}.traces[${index}]`),
          ),
    position: expectPoint(obj['position'], `${label}.position`),
    visualPlane: parseVisualPlane(obj['visualPlane'], `${label}.visualPlane`, fallbackVisualPlane),
  };
}

function parseBoardTrace(raw: unknown, label: string): BoardTrace {
  const obj = expectRecord(raw, label);
  return {
    id: expectNonEmptyString(obj['id'], `${label}.id`),
    label: expectString(obj['label'], `${label}.label`),
    net: expectOptionalString(obj['net'], `${label}.net`),
    internal: expectOptionalBoolean(obj['internal'], `${label}.internal`),
    segments: expectArray(obj['segments'], `${label}.segments`).map((segment, index) =>
      parseBoardTraceSegment(segment, `${label}.segments[${index}]`),
    ),
  };
}

function parseBoardTraceSegment(raw: unknown, label: string): BoardTraceSegment {
  const obj = expectRecord(raw, label);
  return {
    from: expectHole(obj['from'], `${label}.from`),
    to: expectHole(obj['to'], `${label}.to`),
  };
}

function parseComponentLayout(
  raw: unknown,
  label: string,
  fallbackVisualPlane?: number,
): CanonicalComponentLayout {
  const obj = expectRecord(raw, label);
  return {
    componentId: expectNonEmptyString(obj['componentId'], `${label}.componentId`),
    position: expectPoint(obj['position'], `${label}.position`),
    visualPlane: parseVisualPlane(obj['visualPlane'], `${label}.visualPlane`, fallbackVisualPlane),
    boardId: expectOptionalString(obj['boardId'], `${label}.boardId`),
    footprintId: expectOptionalString(obj['footprintId'], `${label}.footprintId`),
    footprint:
      obj['footprint'] === undefined
        ? undefined
        : parseFootprint(obj['footprint'], `${label}.footprint`),
    placement:
      obj['placement'] === undefined
        ? undefined
        : parseDevicePlacement(obj['placement'], `${label}.placement`),
    footprintRotation:
      obj['footprintRotation'] === undefined
        ? undefined
        : parseBoardRotation(obj['footprintRotation'], `${label}.footprintRotation`),
    footprintPitch:
      obj['footprintPitch'] === undefined
        ? undefined
        : expectBoundedPositiveFiniteNumber(
            obj['footprintPitch'],
            `${label}.footprintPitch`,
            OPERATIONAL_LIMITS.maxBoardPitch,
            'pitch',
          ),
    pinHoles:
      obj['pinHoles'] === undefined
        ? undefined
        : expectArray(obj['pinHoles'], `${label}.pinHoles`).map((value, i) =>
            parsePinPlacement(value, `${label}.pinHoles[${i}]`),
          ),
  };
}

function parseDevicePlacement(raw: unknown, label: string): DevicePlacement {
  const obj = expectRecord(raw, label);
  const rotation = parseBoardRotation(obj['rotation'], `${label}.rotation`);
  return {
    boardId: expectNonEmptyString(obj['boardId'], `${label}.boardId`),
    anchor: expectHole(obj['anchor'], `${label}.anchor`),
    rotation,
  };
}

/**
 * A closed set, deliberately: an unknown surface is rejected rather than
 * quietly falling back to `perfboard`. A save that says `breadbord` is a bug
 * in whatever wrote it, and repainting the board brown would hide it.
 */
/**
 * What a board must actually carry to be drawn as a solderless breadboard.
 *
 * The surface is a rendering claim, and the renderer takes it literally: the
 * plastic, the moulded channel and the printed rail bands are all read off
 * `centerGap` and `rowLabels`. A board that declares `breadboard` without them
 * would come back as a blank light rectangle - silently wrong, and only
 * visible to a human looking at the canvas. Rejecting it at the boundary keeps
 * "estritamente validada" true for the variant itself, not just its spelling.
 */
function validateBoardSurface(board: CanonicalBoard, label: string): void {
  if (board.surface !== 'breadboard') return;
  if (board.rowLabels === undefined) {
    throw new CanonicalProjectError(
      `${label}.surface: a breadboard must print its rows via rowLabels`,
    );
  }
  if (board.centerGap === undefined) {
    throw new CanonicalProjectError(
      `${label}.surface: a breadboard must declare its central channel via centerGap`,
    );
  }
  if (!board.rowLabels.some((rowLabel) => rowLabel.endsWith('+') || rowLabel.endsWith('-'))) {
    throw new CanonicalProjectError(
      `${label}.surface: a breadboard must name at least one +/- power rail`,
    );
  }
}

function parseBoardSurface(raw: unknown, label: string): BoardSurface {
  if (!isBoardSurface(raw)) {
    throw new CanonicalProjectError(`${label}: expected one of ${BOARD_SURFACES.join(', ')}`);
  }
  return raw;
}

function parseBoardRotation(raw: unknown, label: string): BoardRotation {
  const rotation = expectFiniteNumber(raw, label);
  if (!ALLOWED_BOARD_ROTATIONS.includes(rotation as BoardRotation)) {
    throw new CanonicalProjectError(`${label}: expected 0, 90, 180 or 270`);
  }
  return rotation as BoardRotation;
}

function parseFootprint(raw: unknown, label: string): Footprint {
  const obj = expectRecord(raw, label);
  return {
    id: expectNonEmptyString(obj['id'], `${label}.id`),
    label: expectString(obj['label'], `${label}.label`),
    rows: expectBoundedPositiveInteger(
      obj['rows'],
      `${label}.rows`,
      OPERATIONAL_LIMITS.maxFootprintRows,
      'row count',
    ),
    cols: expectBoundedPositiveInteger(
      obj['cols'],
      `${label}.cols`,
      OPERATIONAL_LIMITS.maxFootprintCols,
      'column count',
    ),
    pins: expectArray(obj['pins'], `${label}.pins`).map((pin, index) =>
      parseFootprintPin(pin, `${label}.pins[${index}]`),
    ),
    shapes: expectArray(obj['shapes'], `${label}.shapes`).map((shape, index) =>
      parseFootprintShape(shape, `${label}.shapes[${index}]`),
    ),
    bodyCells:
      obj['bodyCells'] === undefined
        ? undefined
        : expectArray(obj['bodyCells'], `${label}.bodyCells`).map((cell, index) =>
            parseFootprintCell(cell, `${label}.bodyCells[${index}]`),
          ),
  };
}

function parseFootprintPin(raw: unknown, label: string): Footprint['pins'][number] {
  const obj = expectRecord(raw, label);
  return {
    id: expectNonEmptyString(obj['id'], `${label}.id`),
    label: expectString(obj['label'], `${label}.label`),
    cell: parseFootprintCell(obj['cell'], `${label}.cell`),
    primary: expectOptionalBoolean(obj['primary'], `${label}.primary`),
  };
}

function parseFootprintCell(raw: unknown, label: string): FootprintCell {
  return expectHole(raw, label);
}

function parseFootprintShape(raw: unknown, label: string): FootprintShape {
  const obj = expectRecord(raw, label);
  const kind = expectOneOf(
    obj['kind'],
    ['rect', 'circle', 'line', 'text'] as const,
    `${label}.kind`,
  );
  if (kind === 'rect') {
    return {
      kind,
      x: expectFiniteNumber(obj['x'], `${label}.x`),
      y: expectFiniteNumber(obj['y'], `${label}.y`),
      width: expectPositiveFiniteNumber(obj['width'], `${label}.width`),
      height: expectPositiveFiniteNumber(obj['height'], `${label}.height`),
      rx:
        obj['rx'] === undefined
          ? undefined
          : expectNonNegativeFiniteNumber(obj['rx'], `${label}.rx`),
      fill: expectOptionalPaint(obj['fill'], `${label}.fill`),
      stroke: expectOptionalPaint(obj['stroke'], `${label}.stroke`),
    };
  }
  if (kind === 'circle') {
    return {
      kind,
      cx: expectFiniteNumber(obj['cx'], `${label}.cx`),
      cy: expectFiniteNumber(obj['cy'], `${label}.cy`),
      r: expectPositiveFiniteNumber(obj['r'], `${label}.r`),
      fill: expectOptionalPaint(obj['fill'], `${label}.fill`),
      stroke: expectOptionalPaint(obj['stroke'], `${label}.stroke`),
    };
  }
  if (kind === 'line') {
    return {
      kind,
      x1: expectFiniteNumber(obj['x1'], `${label}.x1`),
      y1: expectFiniteNumber(obj['y1'], `${label}.y1`),
      x2: expectFiniteNumber(obj['x2'], `${label}.x2`),
      y2: expectFiniteNumber(obj['y2'], `${label}.y2`),
      stroke: expectOptionalPaint(obj['stroke'], `${label}.stroke`),
      width:
        obj['width'] === undefined
          ? undefined
          : expectPositiveFiniteNumber(obj['width'], `${label}.width`),
    };
  }
  return {
    kind,
    x: expectFiniteNumber(obj['x'], `${label}.x`),
    y: expectFiniteNumber(obj['y'], `${label}.y`),
    text: expectString(obj['text'], `${label}.text`),
    size:
      obj['size'] === undefined
        ? undefined
        : expectPositiveFiniteNumber(obj['size'], `${label}.size`),
    anchor:
      obj['anchor'] === undefined
        ? undefined
        : expectOneOf(obj['anchor'], ALLOWED_TEXT_ANCHORS, `${label}.anchor`),
    fill: expectOptionalPaint(obj['fill'], `${label}.fill`),
  };
}

function expectOptionalPaint(raw: unknown, label: string): FootprintPaint | undefined {
  return raw === undefined ? undefined : expectOneOf(raw, ALLOWED_FOOTPRINT_PAINTS, label);
}

function parsePinPlacement(raw: unknown, label: string): CanonicalPinPlacement {
  const obj = expectRecord(raw, label);
  return {
    pinId: expectNonEmptyString(obj['pinId'], `${label}.pinId`),
    hole: expectHole(obj['hole'], `${label}.hole`),
  };
}

function parseJunctionLayout(
  raw: unknown,
  label: string,
  fallbackVisualPlane?: number,
): CanonicalJunctionLayout {
  const obj = expectRecord(raw, label);
  return {
    junctionId: expectNonEmptyString(obj['junctionId'], `${label}.junctionId`),
    position: expectPoint(obj['position'], `${label}.position`),
    visualPlane: parseVisualPlane(obj['visualPlane'], `${label}.visualPlane`, fallbackVisualPlane),
    taps: expectBoundedPositiveInteger(
      obj['taps'],
      `${label}.taps`,
      OPERATIONAL_LIMITS.maxJunctionTaps,
      'junction tap count',
    ),
    boardId: expectOptionalString(obj['boardId'], `${label}.boardId`),
    hole: obj['hole'] === undefined ? undefined : expectHole(obj['hole'], `${label}.hole`),
    boardPort: expectOptionalString(obj['boardPort'], `${label}.boardPort`),
  };
}

function parseConductorLayout(
  raw: unknown,
  label: string,
  fallbackVisualPlane?: number,
  readBoardJumpers = true,
): CanonicalConductorLayout {
  const obj = expectRecord(raw, label);
  const routingMode =
    obj['routingMode'] === undefined
      ? undefined
      : expectOneOf(obj['routingMode'], ALLOWED_ROUTING_MODES, `${label}.routingMode`);
  const parsedPoints =
    obj['points'] === undefined
      ? undefined
      : expectArray(obj['points'], `${label}.points`).map((p, i) =>
          expectPoint(p, `${label}.points[${i}]`),
        );
  const points = validateManualRoute(routingMode, parsedPoints, label);
  if (readBoardJumpers && obj['boardId'] !== undefined) {
    throw new CanonicalProjectError(
      `${label}.boardId: use boardJumper.boardId for board-local conductors`,
    );
  }
  const boardJumper =
    readBoardJumpers && obj['boardJumper'] !== undefined
      ? parseBoardJumperLayout(obj['boardJumper'], `${label}.boardJumper`)
      : undefined;
  if (boardJumper && (routingMode !== undefined || points !== undefined)) {
    throw new CanonicalProjectError(
      `${label}: boardJumper derives endpoints and cannot contain routingMode or points`,
    );
  }

  return {
    conductorId: expectNonEmptyString(obj['conductorId'], `${label}.conductorId`),
    visualPlane: parseVisualPlane(obj['visualPlane'], `${label}.visualPlane`, fallbackVisualPlane),
    boardJumper,
    routingMode,
    points,
    fromTap:
      obj['fromTap'] === undefined
        ? undefined
        : expectNonNegativeInteger(obj['fromTap'], `${label}.fromTap`),
    toTap:
      obj['toTap'] === undefined
        ? undefined
        : expectNonNegativeInteger(obj['toTap'], `${label}.toTap`),
    physicalBinding: expectOptionalBoolean(obj['physicalBinding'], `${label}.physicalBinding`),
  };
}

function parseBoardJumperLayout(
  raw: unknown,
  label: string,
): CanonicalConductorLayout['boardJumper'] {
  const obj = expectRecord(raw, label);
  const bends =
    obj['bends'] === undefined
      ? undefined
      : expectArray(obj['bends'], `${label}.bends`).map((point, index) =>
          expectPoint(point, `${label}.bends[${index}]`),
        );
  return {
    boardId: expectNonEmptyString(obj['boardId'], `${label}.boardId`),
    bends: bends?.length ? bends : undefined,
  };
}

function validateManualRoute(
  routingMode: CanonicalRoutingMode | undefined,
  points: readonly CanonicalPoint[] | undefined,
  label: string,
): CanonicalPoint[] | undefined {
  if (routingMode === undefined) {
    if (points !== undefined) {
      throw new CanonicalProjectError(`${label}.points: points require routingMode "manual"`);
    }
    return undefined;
  }
  if (!points || points.length < 2) {
    throw new CanonicalProjectError(`${label}: manual routing requires at least 2 points`);
  }
  const normalized = normalizeOrthogonalPersistedRoute(points);
  if (!normalized || normalized.length < 2) {
    throw new CanonicalProjectError(`${label}.points: route is not orthogonal`);
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// v1 -> current migration
// ---------------------------------------------------------------------------

interface LegacyPin extends CanonicalPin {
  hole?: BoardHole;
}

interface LegacyComponent {
  id: string;
  deviceId: string;
  manufacturer: string;
  model: string;
  category?: string;
  location?: string;
  boardId?: string;
  position: CanonicalPoint;
  pins: LegacyPin[];
}

interface LegacyNet {
  id: string;
  wireId: string;
  wireType?: string;
  netId?: string;
  color?: string;
  colorCode?: string;
  gauge?: string;
  length?: string;
  note?: string;
  source: { componentId: string; pinId: string };
  target: { componentId: string; pinId: string };
  routingMode?: CanonicalRoutingMode;
  points?: CanonicalPoint[];
}

interface LegacyProject {
  boards: CanonicalBoard[];
  components: LegacyComponent[];
  nets: LegacyNet[];
}

function parseV1(root: Record<string, unknown>): LegacyProject {
  preflightV1(root);
  return {
    boards: expectArray(root['boards'], 'project.boards').map((b, i) =>
      parseBoard(b, `project.boards[${i}]`, defaultVisualPlane('board')),
    ),
    components: expectArray(root['components'], 'project.components').map((c, i) =>
      parseLegacyComponent(c, `project.components[${i}]`),
    ),
    nets: expectArray(root['nets'], 'project.nets').map((n, i) =>
      parseLegacyNet(n, `project.nets[${i}]`),
    ),
  };
}

function preflightV1(root: Record<string, unknown>): void {
  const boards = expectArray(root['boards'], 'project.boards');
  const components = expectArray(root['components'], 'project.components');
  const nets = expectArray(root['nets'], 'project.nets');
  const budget = new CanonicalEntityBudget();

  budget.add(boards.length, 'project.boards');
  // Migration materializes electrical and layout component records.
  budget.add(components.length * 2, 'project.components');
  // Worst case per legacy net: conductor, conductor layout, two endpoints,
  // net, cable and cable wire slot. Shared nets/cables only reduce the total.
  budget.add(nets.length * 7, 'project.nets');

  boards.forEach((raw, index) => {
    const label = `project.boards[${index}]`;
    const board = expectRecord(raw, label);
    if (board['holes'] !== undefined) {
      const holes = expectArray(board['holes'], `${label}.holes`);
      assertCollectionLimit(
        holes.length,
        OPERATIONAL_LIMITS.maxBoardHoles,
        `${label}.holes`,
        'hole count',
      );
      budget.add(holes.length, `${label}.holes`);
    }
    if (board['traces'] !== undefined) {
      const traces = expectArray(board['traces'], `${label}.traces`);
      let segmentCount = 0;
      assertCollectionLimit(
        traces.length,
        OPERATIONAL_LIMITS.maxBoardTraces,
        `${label}.traces`,
        'trace count',
      );
      budget.add(traces.length, `${label}.traces`);
      for (const [traceIndex, traceRaw] of traces.entries()) {
        const segmentsLabel = `${label}.traces[${traceIndex}].segments`;
        const segments = expectArray(
          expectRecord(traceRaw, `${label}.traces[${traceIndex}]`)['segments'],
          segmentsLabel,
        );
        assertCollectionLimit(
          segments.length,
          OPERATIONAL_LIMITS.maxTraceSegmentsPerBoard,
          segmentsLabel,
          'segment count',
        );
        segmentCount += segments.length;
        budget.add(segments.length, segmentsLabel);
      }
      assertCollectionLimit(
        segmentCount,
        OPERATIONAL_LIMITS.maxTraceSegmentsPerBoard,
        `${label}.traces`,
        'total segment count',
      );
    }
  });

  components.forEach((raw, index) => {
    const label = `project.components[${index}].pins`;
    const pins = expectArray(expectRecord(raw, `project.components[${index}]`)['pins'], label);
    assertCollectionLimit(pins.length, OPERATIONAL_LIMITS.maxPinsPerComponent, label, 'pin count');
    budget.add(pins.length, label);
    let placedPins = 0;
    pins.forEach((pin, pinIndex) => {
      if (
        expectRecord(pin, `project.components[${index}].pins[${pinIndex}]`)['hole'] !== undefined
      ) {
        placedPins++;
      }
    });
    budget.add(placedPins, `${label}.holes`);
  });

  nets.forEach((raw, index) => {
    const label = `project.nets[${index}].points`;
    const net = expectRecord(raw, `project.nets[${index}]`);
    if (net['points'] !== undefined) {
      budget.add(expectArray(net['points'], label).length, label);
    }
  });
}

function parseLegacyComponent(raw: unknown, label: string): LegacyComponent {
  const obj = expectRecord(raw, label);
  return {
    id: expectNonEmptyString(obj['id'], `${label}.id`),
    deviceId: expectString(obj['deviceId'], `${label}.deviceId`),
    manufacturer: expectString(obj['manufacturer'], `${label}.manufacturer`),
    model: expectString(obj['model'], `${label}.model`),
    category: expectOptionalString(obj['category'], `${label}.category`),
    location: expectOptionalString(obj['location'], `${label}.location`),
    boardId: expectOptionalString(obj['boardId'], `${label}.boardId`),
    position: expectPoint(obj['position'], `${label}.position`),
    pins: expectArray(obj['pins'], `${label}.pins`).map((p, i) => {
      const pinLabel = `${label}.pins[${i}]`;
      const pinObj = expectRecord(p, pinLabel);
      return {
        ...parsePin(p, pinLabel),
        hole:
          pinObj['hole'] === undefined ? undefined : expectHole(pinObj['hole'], `${pinLabel}.hole`),
      };
    }),
  };
}

function parseLegacyNet(raw: unknown, label: string): LegacyNet {
  const obj = expectRecord(raw, label);
  const color = expectOptionalString(obj['color'], `${label}.color`);
  const colorCode = expectOptionalString(obj['colorCode'], `${label}.colorCode`);
  if (!isWireColorPairCoherent(color, colorCode)) {
    throw new CanonicalProjectError(`${label}: color does not match colorCode`);
  }
  const endpoint = (value: unknown, endpointLabel: string) => {
    const e = expectRecord(value, endpointLabel);
    return {
      componentId: expectNonEmptyString(e['componentId'], `${endpointLabel}.componentId`),
      pinId: expectNonEmptyString(e['pinId'], `${endpointLabel}.pinId`),
    };
  };

  return {
    id: expectNonEmptyString(obj['id'], `${label}.id`),
    wireId: expectString(obj['wireId'], `${label}.wireId`),
    wireType: expectOptionalString(obj['wireType'], `${label}.wireType`),
    netId: expectOptionalString(obj['netId'], `${label}.netId`),
    color,
    colorCode,
    gauge: expectOptionalString(obj['gauge'], `${label}.gauge`),
    length: expectOptionalString(obj['length'], `${label}.length`),
    note: expectOptionalString(obj['note'], `${label}.note`),
    source: endpoint(obj['source'], `${label}.source`),
    target: endpoint(obj['target'], `${label}.target`),
    routingMode:
      obj['routingMode'] === undefined
        ? undefined
        : expectOneOf(obj['routingMode'], ALLOWED_ROUTING_MODES, `${label}.routingMode`),
    points:
      obj['points'] === undefined
        ? undefined
        : expectArray(obj['points'], `${label}.points`).map((p, i) =>
            expectPoint(p, `${label}.points[${i}]`),
          ),
  };
}

/**
 * Rewrites a v1 project into the current format without losing anything it could express.
 *
 * The interesting part is what it *gains*: v1 stored one record per wire, so
 * a pin shared by several records was a multi-drop net the format had no way
 * to name. Grouping the migrated conductors by connectivity recovers those
 * nets, which is why an old saved project opens with its rails already
 * correct instead of as a pile of unrelated two-pin wires.
 */
function migrateV1(legacy: LegacyProject): CanonicalProjectV4 {
  const components: CanonicalComponent[] = legacy.components.map((component) => ({
    id: component.id,
    deviceId: component.deviceId,
    manufacturer: component.manufacturer,
    model: component.model,
    category: component.category,
    location: component.location,
    pins: component.pins.map((pin) => ({
      id: pin.id,
      label: pin.label,
      direction: pin.direction,
      connectorType: pin.connectorType,
    })),
  }));

  const componentLayouts: CanonicalComponentLayout[] = legacy.components.map((component) => {
    const pinHoles: CanonicalPinPlacement[] = [];
    for (const pin of component.pins) {
      if (pin.hole !== undefined) pinHoles.push({ pinId: pin.id, hole: pin.hole });
    }
    return {
      componentId: component.id,
      position: component.position,
      visualPlane: defaultVisualPlane('component'),
      boardId: component.boardId,
      pinHoles: pinHoles.length > 0 ? pinHoles : undefined,
    };
  });

  const conductors: CanonicalConductor[] = legacy.nets.map((net) => ({
    id: net.id,
    from: { kind: 'pin', componentId: net.source.componentId, pinId: net.source.pinId },
    to: { kind: 'pin', componentId: net.target.componentId, pinId: net.target.pinId },
    cable: net.wireId ? { name: net.wireId, wireIndex: 1 } : undefined,
    wireType: net.wireType,
    color: net.color,
    colorCode: net.colorCode,
    gauge: net.gauge,
    length: net.length,
    notes: net.note,
  }));

  const conductorLayouts: CanonicalConductorLayout[] = legacy.nets.map((net) => {
    // Early v1 snapshots wrote rendered/manual points before routingMode was
    // consistently persisted. Recover a valid orthogonal route when possible;
    // a malformed legacy route falls back to automatic routing without
    // rejecting the rest of the project.
    const normalized = net.points ? normalizeOrthogonalPersistedRoute(net.points) : null;
    const points = normalized && normalized.length >= 2 ? normalized : undefined;
    return {
      conductorId: net.id,
      visualPlane: defaultVisualPlane('conductor'),
      routingMode: points ? 'manual' : undefined,
      points,
    };
  });

  // v1 had no cable registry: each wire carried its own color inline, and
  // `wireId` was the cable name. One cable per distinct wireId, single wire.
  const cables = new Map<string, CanonicalCable>();
  for (const net of [...legacy.nets].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!net.wireId) continue;
    const color = net.colorCode ?? net.color;
    const existing = cables.get(net.wireId);
    if (existing) {
      const current = existing.colors[0];
      if (current && color && current !== color) {
        throw new CanonicalProjectError(
          `project.nets: cabo legado "${net.wireId}" possui cores contraditórias ` +
            `("${current}" e "${color}")`,
        );
      }
      if (!current && color) existing.colors[0] = color;
    } else {
      cables.set(net.wireId, {
        name: net.wireId,
        wireCount: 1,
        colors: [color ?? ''],
      });
    }
  }

  const nameHints = new Map<string, string>();
  for (const net of legacy.nets) {
    if (net.netId) nameHints.set(net.id, net.netId);
  }

  const project: CanonicalProjectV4 = {
    formatVersion: CANONICAL_FORMAT_VERSION,
    electrical: {
      components,
      junctions: [],
      cables: [...cables.values()].sort((a, b) => (a.name < b.name ? -1 : 1)),
      nets: buildNets(conductors, nameHints),
    },
    layout: {
      boards: legacy.boards,
      components: componentLayouts,
      junctions: [],
      conductors: conductorLayouts,
    },
  };

  validateProject(project);
  return project;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function expectHole(raw: unknown, label: string): BoardHole {
  const obj = expectRecord(raw, label);
  return {
    row: expectNonNegativeInteger(obj['row'], `${label}.row`),
    col: expectNonNegativeInteger(obj['col'], `${label}.col`),
  };
}

function expectPoint(raw: unknown, label: string): CanonicalPoint {
  const obj = expectRecord(raw, label);
  return {
    x: expectFiniteNumber(obj['x'], `${label}.x`),
    y: expectFiniteNumber(obj['y'], `${label}.y`),
  };
}

function parseVisualPlane(raw: unknown, label: string, fallback?: number): number {
  const value =
    raw === undefined && fallback !== undefined ? fallback : expectFiniteNumber(raw, label);
  if (!isValidVisualPlane(value)) {
    throw new CanonicalProjectError(
      `${label}: expected an integer between ${-OPERATIONAL_LIMITS.maxVisualPlane} and ${OPERATIONAL_LIMITS.maxVisualPlane}`,
    );
  }
  return value;
}

function expectRecord(raw: unknown, label: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CanonicalProjectError(`${label}: expected an object`);
  }
  return raw as Record<string, unknown>;
}

function expectArray(raw: unknown, label: string): unknown[] {
  if (!Array.isArray(raw)) {
    throw new CanonicalProjectError(`${label}: expected an array`);
  }
  return raw;
}

function expectString(raw: unknown, label: string): string {
  if (typeof raw !== 'string') {
    throw new CanonicalProjectError(`${label}: expected a string, got ${typeof raw}`);
  }
  return raw;
}

function expectNonEmptyString(raw: unknown, label: string): string {
  const value = expectString(raw, label);
  if (value.length === 0) {
    throw new CanonicalProjectError(`${label}: expected a non-empty string`);
  }
  return value;
}

function expectOptionalString(raw: unknown, label: string): string | undefined {
  if (raw === undefined) return undefined;
  return expectString(raw, label);
}

function expectOptionalBoolean(raw: unknown, label: string): boolean | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'boolean') {
    throw new CanonicalProjectError(`${label}: expected a boolean, got ${typeof raw}`);
  }
  return raw;
}

/**
 * Uninterpreted fields are still validated as JSON-safe data: a function, a
 * `undefined` hole or a cyclic object would break both serialization and the
 * WireViz re-emit, so they are rejected here rather than at write time.
 */
function expectOptionalPreservedFields(
  raw: unknown,
  label: string,
  reserved: ReadonlySet<string>,
): PreservedFields | undefined {
  if (raw === undefined) return undefined;
  const obj = expectRecord(raw, label);
  const result: Record<string, PreservedValue> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isDangerousObjectKey(key)) {
      throw new CanonicalProjectError(`${label}.${key}: dangerous key is not allowed`);
    }
    if (reserved.has(key)) {
      throw new CanonicalProjectError(
        `${label}.${key}: a preserved extra cannot replace a canonical WireViz field`,
      );
    }
    result[key] = expectPreservedValue(value, `${label}.${key}`);
  }
  return result;
}

function expectPreservedValue(raw: unknown, label: string): PreservedValue {
  if (raw === null) return null;
  if (typeof raw === 'string' || typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return expectFiniteNumber(raw, label);
  if (Array.isArray(raw)) {
    return raw.map((value, i) => expectPreservedValue(value, `${label}[${i}]`));
  }
  if (typeof raw === 'object') {
    const result: Record<string, PreservedValue> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (isDangerousObjectKey(key)) {
        throw new CanonicalProjectError(`${label}.${key}: dangerous key is not allowed`);
      }
      result[key] = expectPreservedValue(value, `${label}.${key}`);
    }
    return result;
  }
  throw new CanonicalProjectError(`${label}: expected a JSON-serializable value`);
}

function expectFiniteNumber(raw: unknown, label: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new CanonicalProjectError(
      `${label}: expected a finite number, got ${JSON.stringify(raw)}`,
    );
  }
  return raw;
}

function expectPositiveFiniteNumber(raw: unknown, label: string): number {
  const value = expectFiniteNumber(raw, label);
  if (value <= 0) {
    throw new CanonicalProjectError(`${label}: expected a positive number, got ${value}`);
  }
  return value;
}

function expectNonNegativeFiniteNumber(raw: unknown, label: string): number {
  const value = expectFiniteNumber(raw, label);
  if (value < 0) {
    throw new CanonicalProjectError(`${label}: expected a non-negative number, got ${value}`);
  }
  return value;
}

function expectBoundedPositiveFiniteNumber(
  raw: unknown,
  label: string,
  limit: number,
  kind: string,
): number {
  const value = expectPositiveFiniteNumber(raw, label);
  if (value > limit) {
    throw new CanonicalProjectError(
      `${label}: ${kind} ${value} exceeds operational limit of ${limit}`,
    );
  }
  return value;
}

function expectPositiveInteger(raw: unknown, label: string): number {
  const value = expectFiniteNumber(raw, label);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CanonicalProjectError(`${label}: expected a safe positive integer, got ${value}`);
  }
  return value;
}

function expectNonNegativeInteger(raw: unknown, label: string): number {
  const value = expectFiniteNumber(raw, label);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CanonicalProjectError(`${label}: expected a safe non-negative integer, got ${value}`);
  }
  return value;
}

function expectBoundedPositiveInteger(
  raw: unknown,
  label: string,
  limit: number,
  kind: string,
): number {
  const value = expectPositiveInteger(raw, label);
  if (value > limit) {
    throw new CanonicalProjectError(
      `${label}: ${kind} ${value} exceeds operational limit of ${limit}`,
    );
  }
  return value;
}

function assertCollectionLimit(length: number, limit: number, label: string, kind: string): void {
  if (length > limit) {
    throw new CanonicalProjectError(
      `${label}: ${kind} ${length} exceeds operational limit of ${limit}`,
    );
  }
}

class CanonicalEntityBudget {
  private total = 0;

  add(count: number, label: string): void {
    const next = this.total + count;
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(next)) {
      throw new CanonicalProjectError(`${label}: total entity count must be a safe integer`);
    }
    if (next > OPERATIONAL_LIMITS.maxTotalEntities) {
      throw new CanonicalProjectError(
        `${label}: total entity count ${next} exceeds operational limit of ` +
          `${OPERATIONAL_LIMITS.maxTotalEntities}`,
      );
    }
    this.total = next;
  }
}

function expectOneOf<T extends string>(raw: unknown, allowed: readonly T[], label: string): T {
  if (typeof raw !== 'string' || !(allowed as readonly string[]).includes(raw)) {
    throw new CanonicalProjectError(
      `${label}: expected one of ${allowed.map((v) => `"${v}"`).join(', ')}, got ${JSON.stringify(raw)}`,
    );
  }
  return raw as T;
}

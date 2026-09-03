import { type Edge, type Node, type Point } from 'ng-diagram';
import { holeLocalPoint, holesEqual, isBoardHoleAvailable } from './board-geometry';
import {
  boardCopperJunctionId,
  boardPortLabel,
  holePortId,
  isBoardPortId,
  parseHolePortId,
  parseTracePortId,
  physicalBindingConductorId,
  tracePortId,
} from './board-ports';
import { traceForHole, traceHoles } from './board-trace';
import { cloneFootprint, resolveFootprint, type Footprint } from './footprint';
import {
  devicePortHoles,
  placementNodePosition,
  syncPortHolesToPlacement,
} from './footprint-geometry';
import { isBoardNode, isDeviceNode, isJunctionNode, isWireEdge } from './guards';
import {
  EdgeTemplateType,
  NodeTemplateType,
  type AvSchematicNodeData,
  type BoardHole,
  type BoardNodeData,
  type BoardRotation,
  type BoardSurface,
  type BoardTrace,
  type DeviceNodeData,
  type DevicePlacement,
  type JunctionKind,
  type JunctionNodeData,
  type PortDirection,
  type PreservedFields,
  type WireEdgeData,
  type WireVizLinkStyle,
} from './interfaces';
import { endpointKeysOf, groupConductorsIntoNets } from './net-grouping';
import { normalizeOrthogonalPersistedRoute } from './persisted-wire-route.mjs';
import { canonicalColorValue, isWireColorPairCoherent, resolveWireColor } from './wire-colors';
import {
  applyVisualZOrder,
  defaultVisualPlane,
  MAX_VISUAL_PLANE,
  visualPlaneOf,
} from './visual-planes';
import { boardLocalPoints, boardWorldPoints } from './board-jumper';

/**
 * Canonical, serializable project format (v4). Visual planes were added in
 * v3 without entering the electrical section or the DXF layer vocabulary;
 * v4 adds board ownership for local jumper routes.
 *
 * Two structural changes relative to v1 were required by issue #2:
 *
 * 1. **A net is no longer a wire.** v1's `nets[]` was really a list of
 *    two-endpoint edges, so a net touching three pins could only be
 *    expressed as several unrelated entries -- and a pin appearing in two of
 *    them looked like an invalid reuse. v2 has real nets: `endpoints[]` (two
 *    or more) plus the `conductors[]` that join them, with junctions and
 *    rails as first-class electrical elements.
 *
 * 2. **Electrical semantics and visual geometry are separate sections.**
 *    `electrical` holds pins, connectivity, the WireViz cable representation,
 *    and conductor-owned inspection values that must survive project
 *    save/reload. `layout` holds everything WireViz has no vocabulary for --
 *    board grids, node positions, which board hole a pin
 *    occupies, which visual tap of a rail a conductor lands on, and manual
 *    wire routing points. A WireViz export reads `electrical` and never
 *    needs to discard geometry, because geometry was never mixed in.
 *
 * `formatVersion` identifies the contract; `canonical-project-parse.ts`
 * accepts a stored v1 file and migrates it, so the format can keep moving
 * without orphaning saved projects.
 *
 * v3 adds `visualPlane` only to layout records. It is deliberately absent
 * from electrical records and independent from the semantic DXF layers.
 * v4 adds `boardJumper` to conductor layout. It stores only the owning board
 * and optional board-local bends; endpoints remain derived from the
 * conductor's junction taps and board holes.
 */
export const CANONICAL_FORMAT_VERSION = 4;

export interface CanonicalProjectV4 {
  formatVersion: 4;
  electrical: CanonicalElectrical;
  layout: CanonicalLayout;
}

/** Compatibility aliases kept while current-format consumers migrate names. */
export type CanonicalProjectV3 = CanonicalProjectV4;
export type CanonicalProjectV2 = CanonicalProjectV4;

// ---------------------------------------------------------------------------
// Electrical section -- everything WireViz can express
// ---------------------------------------------------------------------------

export interface CanonicalElectrical {
  components: CanonicalComponent[];
  junctions: CanonicalJunction[];
  cables: CanonicalCable[];
  nets: CanonicalNet[];
}

/**
 * Note on document-level WireViz keys (`metadata`, `options`, `tweak`, ...):
 * they are *reported* by the importer, never stored here. Connector and cable
 * extras have a home because a component/junction/cable record exists to hang
 * them on; a document-level key has no counterpart in a canvas that can hold
 * several imports at once, and inventing a project-wide bag that only one
 * import path could ever fill would preserve them asymmetrically -- kept when
 * a project is assembled programmatically, silently dropped the moment the
 * user edits and saves. See docs/wireviz-round-trip.md.
 */

export interface CanonicalPin {
  id: string;
  label: string;
  direction: PortDirection;
  connectorType?: string;
  wirevizDesignator?: string;
  wirevizLabel?: string;
}

export interface CanonicalComponent {
  id: string;
  deviceId: string;
  manufacturer: string;
  model: string;
  category?: string;
  location?: string;
  /** Name this component takes as a WireViz `connectors.<name>` entry. */
  wirevizName?: string;
  wirevizType?: string;
  /** WireViz connector *variant*. Preserved verbatim across the round-trip. */
  wirevizSubtype?: string;
  wirevizColor?: string;
  wirevizManufacturer?: string;
  wirevizMpn?: string;
  wirevizStyle?: string;
  wirevizShowName?: boolean;
  notes?: string;
  wirevizExtras?: PreservedFields;
  pins: CanonicalPin[];
}

/**
 * A splice or rail: one electrical point where conductors of a net meet.
 * How many tap positions it is *drawn* with lives in `layout`, never here --
 * see `JunctionNodeData` for why that separation is what makes a rail
 * survive a WireViz round-trip intact.
 */
export interface CanonicalJunction {
  id: string;
  label: string;
  kind: JunctionKind;
  notes?: string;
  wirevizName?: string;
  wirevizType?: string;
  wirevizSubtype?: string;
  wirevizColor?: string;
  wirevizManufacturer?: string;
  wirevizMpn?: string;
  wirevizStyle?: string;
  wirevizShowName?: boolean;
  wirevizExtras?: PreservedFields;
}

/**
 * A cable shaped like WireViz's own `cables.<name>` entry. Gauge, length and
 * notes here are the shared/export representation; editable values also live
 * on each conductor so a dense harness is not flattened. `colors[i]`
 * describes WireViz wire `i + 1`; conductor color keeps the local intent.
 *
 * A color entry is either a WireViz abbreviation (`"YE"`) or a CSS hex value.
 * WireViz's exact six-digit RGB form (`"#ff00aa"`) is re-emitted byte for
 * byte. Other hex shapes are kept here verbatim and reported -- never silently
 * swapped for the nearest standard code -- see
 * `wireviz-import/export-wireviz.ts`.
 */
export interface CanonicalCable {
  name: string;
  wireCount: number;
  colors: string[];
  /** Positional WireViz `wirelabels`, including labels for unused conductors. */
  wireLabels?: string[];
  gauge?: string;
  length?: string;
  notes?: string;
  type?: string;
  manufacturer?: string;
  mpn?: string;
  /** WireViz `color_code`: which color *standard* the abbreviations follow. */
  colorCode?: string;
  wirevizExtras?: PreservedFields;
}

export type CanonicalNetEndpoint =
  | { kind: 'pin'; componentId: string; pinId: string }
  | { kind: 'junction'; junctionId: string };

export interface CanonicalConductorCableRef {
  name: string;
  /** 1-based, matching WireViz's own wire numbering. */
  wireIndex: number;
}

export interface CanonicalConductor {
  id: string;
  from: CanonicalNetEndpoint;
  to: CanonicalNetEndpoint;
  /** Absent means a direct connector-to-connector link with no cable. */
  cable?: CanonicalConductorCableRef;
  /** App-level classification (audio/power/control/...). No WireViz equivalent. */
  wireType?: string;
  /** Effective render color owned by this physical conductor. */
  color?: string;
  /** Lossless WireViz token (palette, RGB or imported opaque token), when present. */
  colorCode?: string;
  /** Per-conductor inspection metadata owned by this physical connection. */
  gauge?: string;
  length?: string;
  notes?: string;
  /** WireViz pin-level arrow for a direct link. Absent direct links export as `--`. */
  wirevizLink?: WireVizLinkStyle;
  /** Internal short declared by WireViz `connectors.<name>.loops`. */
  wirevizLoop?: boolean;
}

export interface CanonicalNet {
  id: string;
  name: string;
  /** Every endpoint the net touches. Three or more means multi-drop. */
  endpoints: CanonicalNetEndpoint[];
  conductors: CanonicalConductor[];
}

// ---------------------------------------------------------------------------
// Layout section -- everything WireViz has no vocabulary for
// ---------------------------------------------------------------------------

export interface CanonicalPoint {
  x: number;
  y: number;
}

export interface CanonicalLayout {
  boards: CanonicalBoard[];
  components: CanonicalComponentLayout[];
  junctions: CanonicalJunctionLayout[];
  conductors: CanonicalConductorLayout[];
}

/**
 * A physical board. Everything here is geometry - how many holes, how far
 * apart, which of them exist, and where the copper runs - which is why the
 * whole record lives in `layout` and never in `electrical`. Copper that a
 * conductor actually lands on becomes an ordinary `CanonicalJunction`; see
 * `CanonicalJunctionLayout.boardPort`.
 */
export interface CanonicalBoard {
  id: string;
  label: string;
  notes?: string;
  /**
   * How the board body is built and drawn. Absent means `perfboard`, which is
   * what every project written before this field existed is.
   */
  surface?: BoardSurface;
  rows: number;
  cols: number;
  pitch: number;
  /** Optional extra clearance between the upper and lower row halves. */
  centerGap?: number;
  /** Printed name of each row, top to bottom; exactly `rows` entries when present. */
  rowLabels?: string[];
  /** Explicit hole list for an irregular board. Absent means the full rows x cols grid. */
  holes?: BoardHole[];
  /** Drawn hole diameter in px. Absent falls back to `DEFAULT_HOLE_DIAMETER`. */
  holeDiameter?: number;
  /** Copper traces. A board with no traces is a plain perfboard. */
  traces?: BoardTrace[];
  position: CanonicalPoint;
  visualPlane: number;
}

export interface CanonicalPinPlacement {
  pinId: string;
  hole: BoardHole;
}

export interface CanonicalComponentLayout {
  componentId: string;
  position: CanonicalPoint;
  visualPlane: number;
  /** See `DeviceNodeData.boardId` -- required iff any `pinHoles` entry is present. */
  boardId?: string;
  /**
   * Physical footprint this component is drawn with. Illustration and cell
   * geometry are layout, not electrical: the pins themselves stay in
   * `electrical.components[].pins`, which is what WireViz can express.
   */
  footprintId?: string;
  /** Embedded definition, so a reload never depends on the app's fixture catalog. */
  footprint?: Footprint;
  /** Seat on a board. Only meaningful together with `footprintId`. */
  placement?: DevicePlacement;
  /** Visual rotation retained while the footprint is not seated. */
  footprintRotation?: BoardRotation;
  /** Visual pitch retained while the footprint is not seated. */
  footprintPitch?: number;
  pinHoles?: CanonicalPinPlacement[];
}

export interface CanonicalJunctionLayout {
  junctionId: string;
  position: CanonicalPoint;
  visualPlane: number;
  /** Visual tap positions to draw (>= 1). Electrically they are all one point. */
  taps: number;
  boardId?: string;
  hole?: BoardHole;
  /**
   * Board node port this junction is *drawn as* (`hole:<row>:<col>` or
   * `trace:<traceId>`), instead of being drawn as its own junction node.
   *
   * A solder point in a board hole, and a copper trace joining several holes,
   * are both exactly what `CanonicalJunction` already means: one electrical
   * point several conductors meet at. Only the way it is drawn differs, and
   * "how it is drawn" is precisely what `layout` is for. Requires `boardId`.
   */
  boardPort?: string;
}

/**
 * The only routing mode this project ever persists explicitly. Absence means
 * "auto" (ng-diagram's default router output) -- canonicalized as undefined
 * rather than as an explicit `'auto'` string, so the format has one way to
 * say "no manual points".
 */
export type CanonicalRoutingMode = 'manual';

export interface CanonicalBoardJumperLayout {
  boardId: string;
  /** Optional intermediate route points in board-local coordinates. */
  bends?: CanonicalPoint[];
}

export interface CanonicalConductorLayout {
  conductorId: string;
  visualPlane: number;
  /** Board-local jumper identity and optional shape; endpoints are not duplicated here. */
  boardJumper?: CanonicalBoardJumperLayout;
  routingMode?: CanonicalRoutingMode;
  points?: CanonicalPoint[];
  /** 0-based visual tap each end lands on, when that end is a junction. */
  fromTap?: number;
  toTap?: number;
  /** Hidden pin-to-copper solder association generated from a physical placement. */
  physicalBinding?: boolean;
}

export class CanonicalProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalProjectError';
  }
}

// ---------------------------------------------------------------------------
// Endpoint identity
// ---------------------------------------------------------------------------

/**
 * Stable, comparable key for an endpoint.
 *
 * `encodeURIComponent` escapes `/`, so the separator can never be produced
 * by an id -- two different endpoints can never collide onto one key, which
 * is what makes net grouping and the round-trip comparison trustworthy.
 */
export function endpointKey(endpoint: CanonicalNetEndpoint): string {
  return endpoint.kind === 'pin'
    ? `pin:${encodeURIComponent(endpoint.componentId)}/${encodeURIComponent(endpoint.pinId)}`
    : `junction:${encodeURIComponent(endpoint.junctionId)}`;
}

export function endpointsEqual(a: CanonicalNetEndpoint, b: CanonicalNetEndpoint): boolean {
  return endpointKey(a) === endpointKey(b);
}

/** ng-diagram port id for a junction's visual tap. */
export function junctionTapPortId(tapIndex: number): string {
  return `tap-${tapIndex}`;
}

/** Inverse of `junctionTapPortId`; `undefined` for anything that is not a tap port. */
export function junctionTapIndex(portId: string | undefined): number | undefined {
  if (!portId) return undefined;
  const match = /^tap-(\d+)$/.exec(portId);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

/**
 * Collision-free ASCII fragment for ids derived from imported names.
 *
 * Slugification is not enough here: `A/B` and `A B` both become `a-b`, and
 * that can turn two distinct conductors into the same diagram id. Encoding
 * every Unicode code point as hex keeps the result deterministic and
 * reversible without relying on a runtime-specific hash.
 */
export function stableIdFragment(value: string): string {
  const parts: string[] = [];
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined) parts.push(codePoint.toString(16));
  }
  return parts.join('-') || '0';
}

// ---------------------------------------------------------------------------
// Model -> canonical
// ---------------------------------------------------------------------------

interface ConductorDraft {
  conductor: CanonicalConductor;
  layout: CanonicalConductorLayout;
  authoredNetNameHint?: string;
  copperNetNameHint?: string;
}

/**
 * Groups conductors into nets by connectivity.
 *
 * This is the single place nets come into existence -- used when serializing
 * the live model, when migrating a v1 project, and when importing a WireViz
 * document -- so all three routes agree by construction on what counts as one
 * net.
 *
 * `nameHints` carries authored/imported names and always wins over
 * `fallbackNameHints`, which carries copper labels. Within each priority the
 * smallest hint wins, so a physical merge is deterministic whichever wire was
 * drawn first. Diagnostics report competing authored names before save.
 */
export function buildNets(
  conductors: readonly CanonicalConductor[],
  nameHints?: ReadonlyMap<string, string>,
  fallbackNameHints?: ReadonlyMap<string, string>,
): CanonicalNet[] {
  const keyed = conductors.map((conductor) => ({
    conductor,
    fromKey: endpointKey(conductor.from),
    toKey: endpointKey(conductor.to),
  }));

  const endpointsByKey = new Map<string, CanonicalNetEndpoint>();
  for (const entry of keyed) {
    endpointsByKey.set(entry.fromKey, entry.conductor.from);
    endpointsByKey.set(entry.toKey, entry.conductor.to);
  }

  return groupConductorsIntoNets(keyed).map((group) => {
    const keys = endpointKeysOf(group);
    const endpoints = keys.map((key) => {
      const endpoint = endpointsByKey.get(key);
      if (!endpoint) {
        throw new CanonicalProjectError(`net endpoint "${key}" could not be resolved`);
      }
      return endpoint;
    });

    const id = `net-${stableIdFragment(keys[0])}`;
    const hints = group
      .map((entry) => nameHints?.get(entry.conductor.id))
      .filter((hint): hint is string => !!hint)
      .sort();
    const fallbackHints = group
      .map((entry) => fallbackNameHints?.get(entry.conductor.id))
      .filter((hint): hint is string => !!hint)
      .sort();

    return {
      id,
      name: hints[0] ?? fallbackHints[0] ?? id,
      endpoints,
      conductors: group.map((entry) => entry.conductor).sort(byId),
    };
  });
}

/**
 * Serializes the live diagram model into the canonical format.
 *
 * Nets are *derived* here, never read off the edges: conductors are grouped
 * by connectivity (`net-grouping.ts`), so a wire drawn between two existing
 * nets merges them and deleting it splits them again, with no separate net
 * registry to keep in sync. `WireEdgeData.netId` is only a denormalized
 * label and is recomputed on every serialization.
 *
 * Every collection comes out sorted by id, so two models that are equal up
 * to insertion order serialize to byte-identical JSON.
 */
export function toCanonicalProject(
  nodes: readonly Node[],
  edges: readonly Edge[],
  cableInventory: readonly CanonicalCable[] = [],
): CanonicalProjectV4 {
  const deviceNodes = nodes.filter(isDeviceNode);
  const junctionNodes = nodes.filter(isJunctionNode);
  const boardNodes = nodes.filter(isBoardNode);

  const nodeKinds = new Map<string, 'device' | 'junction' | 'board'>();
  for (const node of deviceNodes) nodeKinds.set(node.id, 'device');
  for (const node of junctionNodes) nodeKinds.set(node.id, 'junction');
  for (const node of boardNodes) nodeKinds.set(node.id, 'board');

  const copper = new BoardCopperJunctions(boardNodes);
  const boardNodesById = new Map(boardNodes.map((board) => [board.data.boardId, board]));
  const wireEdges = edges.filter(isWireEdge);
  const drafts = [
    ...wireEdges.map((edge) => toConductorDraft(edge, nodeKinds, copper, boardNodesById)),
    ...physicalBindingDrafts(deviceNodes, boardNodes, copper),
  ];

  const conductorIds = new Set<string>();
  const authoredNameHints = new Map<string, string>();
  const copperNameHints = new Map<string, string>();
  for (const draft of drafts) {
    if (conductorIds.has(draft.conductor.id)) {
      throw new CanonicalProjectError(`duplicate conductor id "${draft.conductor.id}"`);
    }
    conductorIds.add(draft.conductor.id);
    if (draft.authoredNetNameHint) {
      authoredNameHints.set(draft.conductor.id, draft.authoredNetNameHint);
    }
    if (draft.copperNetNameHint) {
      copperNameHints.set(draft.conductor.id, draft.copperNetNameHint);
    }
  }
  const nets = buildNets(
    drafts.map((draft) => draft.conductor),
    authoredNameHints,
    copperNameHints,
  );

  return {
    formatVersion: CANONICAL_FORMAT_VERSION,
    electrical: {
      components: deviceNodes.map(toCanonicalComponent).sort(byId),
      junctions: [...junctionNodes.map(toCanonicalJunction), ...copper.junctions()].sort(byId),
      cables: buildCables(wireEdges, cableInventory),
      nets,
    },
    layout: {
      boards: boardNodes.map(toCanonicalBoard).sort(byId),
      components: deviceNodes.map(toComponentLayout).sort(byKey((c) => c.componentId)),
      junctions: [...junctionNodes.map(toJunctionLayout), ...copper.layouts()].sort(
        byKey((j) => j.junctionId),
      ),
      conductors: drafts.map((draft) => draft.layout).sort(byKey((c) => c.conductorId)),
    },
  };
}

/**
 * Materializes one `CanonicalJunction` per board hole or trace a conductor
 * actually lands on.
 *
 * Unused copper stays pure geometry on the board record: minting a junction
 * for all 168 holes of a 6 x 28 board would bloat every save and, worse,
 * invent electrical points nothing is connected to. The junction only comes
 * into existence when something is soldered there - which is also the moment
 * it becomes true that "conductors meet here".
 */
class BoardCopperJunctions {
  private readonly boardsById: ReadonlyMap<string, Node<BoardNodeData>>;
  private readonly used = new Map<
    string,
    { junction: CanonicalJunction; layout: CanonicalJunctionLayout; netLabel?: string }
  >();

  constructor(boardNodes: readonly Node<BoardNodeData>[]) {
    this.boardsById = new Map(boardNodes.map((node) => [node.id, node]));
  }

  /** Resolves a board node port into the junction endpoint that represents it. */
  resolve(
    edgeId: string,
    side: 'source' | 'target',
    boardNodeId: string,
    portId: string,
  ): { endpoint: CanonicalNetEndpoint; tap?: number; netLabel?: string } {
    const board = this.boardsById.get(boardNodeId);
    if (!board) {
      throw new CanonicalProjectError(`edge "${edgeId}".${side}: no board "${boardNodeId}"`);
    }
    if (!isBoardPortId(portId)) {
      throw new CanonicalProjectError(
        `edge "${edgeId}".${side}: "${portId}" is not a board hole or trace port`,
      );
    }

    const hole = resolveBoardPortHole(board.data, portId);
    if (!hole) {
      throw new CanonicalProjectError(
        `edge "${edgeId}".${side}: board "${board.data.boardId}" has no port "${portId}"`,
      );
    }

    const requestedTraceId = parseTracePortId(portId);
    const trace = requestedTraceId
      ? board.data.traces?.find((candidate) => candidate.id === requestedTraceId)
      : traceForHole(board.data, hole);
    const canonicalPortId = trace ? tracePortId(trace.id) : holePortId(hole);
    const traceHoleList = trace ? traceHoles(trace) : [hole];
    const tap =
      trace && requestedTraceId === null
        ? traceHoleList.findIndex((candidate) => holesEqual(candidate, hole))
        : undefined;
    if (tap !== undefined && tap < 0) {
      throw new CanonicalProjectError(
        `edge "${edgeId}".${side}: hole is not part of trace "${trace?.id ?? ''}"`,
      );
    }

    const junctionId = boardCopperJunctionId(board.data.boardId, canonicalPortId);
    const existing = this.used.get(junctionId);
    if (existing) {
      return { endpoint: { kind: 'junction', junctionId }, tap, netLabel: existing.netLabel };
    }

    const anchorHole = traceHoleList[0];
    if (!anchorHole) {
      throw new Error(`Board port "${canonicalPortId}" has no physical hole`);
    }
    const local = holeLocalPoint(board.data, anchorHole);
    this.used.set(junctionId, {
      junction: {
        id: junctionId,
        label: boardPortLabel(canonicalPortId, trace?.label, board.data.rowLabels),
        wirevizName: junctionId,
        // A trace joins several holes into one point, which is exactly what a
        // rail is; a bare hole is a single splice point.
        kind: trace ? 'rail' : 'junction',
      },
      layout: {
        junctionId,
        position: { x: board.position.x + local.x, y: board.position.y + local.y },
        visualPlane: defaultVisualPlane('junction'),
        // A trace uses its holes as visual taps. Conductor layout keeps the
        // exact landing hole while electrical identity stays one junction.
        taps: traceHoleList.length,
        boardId: board.data.boardId,
        hole: anchorHole,
        boardPort: canonicalPortId,
      },
      netLabel: trace?.net,
    });
    return { endpoint: { kind: 'junction', junctionId }, tap, netLabel: trace?.net };
  }

  junctions(): CanonicalJunction[] {
    return [...this.used.values()].map((entry) => entry.junction);
  }

  layouts(): CanonicalJunctionLayout[] {
    return [...this.used.values()].map((entry) => entry.layout);
  }
}

/** The hole a board port addresses: itself for a hole, the first hole for a trace. */
export function resolveBoardPortHole(board: BoardNodeData, portId: string): BoardHole | undefined {
  const hole = parseHolePortId(portId);
  if (hole) return isBoardHoleAvailable(board, hole) ? hole : undefined;
  const traceId = parseTracePortId(portId);
  if (!traceId) return undefined;
  const trace = board.traces?.find((candidate) => candidate.id === traceId);
  return trace ? traceHoles(trace)[0] : undefined;
}

function physicalBindingDrafts(
  deviceNodes: readonly Node<DeviceNodeData>[],
  boardNodes: readonly Node<BoardNodeData>[],
  copper: BoardCopperJunctions,
): ConductorDraft[] {
  const boardsById = new Map(boardNodes.map((board) => [board.data.boardId, board]));
  const drafts: ConductorDraft[] = [];

  for (const node of deviceNodes) {
    const holes = devicePortHoles(node.data);
    if (holes.size === 0) continue;
    const boardId = node.data.placement?.boardId ?? node.data.boardId;
    const board = boardId ? boardsById.get(boardId) : undefined;
    if (!board) {
      throw new CanonicalProjectError(
        `component "${node.id}": physical pin holes require an existing board`,
      );
    }

    for (const port of node.data.ports) {
      const hole = holes.get(port.id);
      if (!hole) continue;
      const conductorId = physicalBindingConductorId(node.id, port.id);
      const resolved = copper.resolve(conductorId, 'target', board.id, holePortId(hole));
      drafts.push({
        conductor: {
          id: conductorId,
          from: { kind: 'pin', componentId: node.id, pinId: port.id },
          to: resolved.endpoint,
        },
        layout: {
          conductorId,
          toTap: resolved.tap,
          physicalBinding: true,
          visualPlane: defaultVisualPlane('conductor'),
        },
        copperNetNameHint: resolved.netLabel,
      });
    }
  }

  return drafts;
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function byKey<T>(key: (value: T) => string): (a: T, b: T) => number {
  return (a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
}

function toConductorDraft(
  edge: Edge<WireEdgeData>,
  nodeKinds: ReadonlyMap<string, 'device' | 'junction' | 'board'>,
  copper: BoardCopperJunctions,
  boardNodesById: ReadonlyMap<string, Node<BoardNodeData>>,
): ConductorDraft {
  if (!edge.source || !edge.sourcePort || !edge.target || !edge.targetPort) {
    throw new CanonicalProjectError(
      `edge "${edge.id}" is not fully connected (dangling edges are not exportable)`,
    );
  }

  const from = toEndpoint(edge.id, 'source', edge.source, edge.sourcePort, nodeKinds, copper);
  const to = toEndpoint(edge.id, 'target', edge.target, edge.targetPort, nodeKinds, copper);
  if (endpointsEqual(from.endpoint, to.endpoint)) {
    throw new CanonicalProjectError(`edge "${edge.id}": both ends resolve to the same endpoint`);
  }
  if (!isWireColorPairCoherent(edge.data.color, edge.data.colorCode)) {
    throw new CanonicalProjectError(`edge "${edge.id}": color does not match colorCode`);
  }

  const conductor: CanonicalConductor = {
    id: edge.id,
    from: from.endpoint,
    to: to.endpoint,
    cable: edge.data.wireId
      ? { name: edge.data.wireId, wireIndex: edge.data.wireIndex ?? 1 }
      : undefined,
    wireType: edge.data.wireType,
    color: edge.data.color,
    colorCode: edge.data.colorCode,
    gauge: edge.data.gauge,
    length: edge.data.length,
    notes: edge.data.notes,
    wirevizLink: edge.data.wirevizLink,
    wirevizLoop: edge.data.wirevizLoop,
  };

  const jumperBoardId = edge.data.jumperBoardId;
  const jumperBoard = jumperBoardId ? boardNodesById.get(jumperBoardId) : undefined;
  if (jumperBoardId) validateLiveBoardJumper(edge, jumperBoard);
  const manual = edge.routingMode === 'manual';
  const worldPoints = manual
    ? jumperBoard
      ? normalizeBoardJumperRoute(edge.id, edge.points)
      : normalizeManualRoute(edge.id, edge.points)
    : undefined;
  const localPoints =
    worldPoints && jumperBoard ? boardLocalPoints(jumperBoard, worldPoints) : undefined;
  const bends = localPoints?.slice(1, -1);
  const layout: CanonicalConductorLayout = {
    conductorId: edge.id,
    visualPlane: jumperBoard ? boardJumperVisualPlane(edge, jumperBoard) : visualPlaneOf(edge),
    ...(jumperBoardId
      ? { boardJumper: { boardId: jumperBoardId, bends: bends?.length ? bends : undefined } }
      : {
          // Only 'manual' is a meaningful persisted state; anything else
          // canonicalizes to absence.
          routingMode: manual ? ('manual' as const) : undefined,
          points: worldPoints,
        }),
    fromTap: from.tap,
    toTap: to.tap,
  };

  const copperHint = from.netLabel ?? to.netLabel;
  return {
    conductor,
    layout,
    authoredNetNameHint: edge.data.netName,
    copperNetNameHint: copperHint,
  };
}

function boardJumperVisualPlane(edge: Edge, board: Node<BoardNodeData>): number {
  const boardPlane = visualPlaneOf(board);
  if (boardPlane >= MAX_VISUAL_PLANE) {
    throw new CanonicalProjectError(
      `edge "${edge.id}": jumper board must be below visual plane ${MAX_VISUAL_PLANE}`,
    );
  }
  return Math.max(visualPlaneOf(edge), boardPlane + 1);
}

function validateLiveBoardJumper(
  edge: Edge<WireEdgeData>,
  board: Node<BoardNodeData> | undefined,
): asserts board is Node<BoardNodeData> {
  const label = `edge "${edge.id}"`;
  if (!board) {
    throw new CanonicalProjectError(`${label}: no jumper board "${edge.data.jumperBoardId}"`);
  }
  if (board.data.surface !== 'breadboard') {
    throw new CanonicalProjectError(`${label}: a board jumper requires a breadboard owner`);
  }
  if (edge.source !== board.id || edge.target !== board.id) {
    throw new CanonicalProjectError(
      `${label}: both jumper ends must belong to board "${board.id}"`,
    );
  }
  const sourceHole = edge.sourcePort ? parseHolePortId(edge.sourcePort) : null;
  const targetHole = edge.targetPort ? parseHolePortId(edge.targetPort) : null;
  if (
    !sourceHole ||
    !targetHole ||
    !isBoardHoleAvailable(board.data, sourceHole) ||
    !isBoardHoleAvailable(board.data, targetHole)
  ) {
    throw new CanonicalProjectError(`${label}: jumper ends must be available board holes`);
  }
  if (edge.routingMode !== 'manual') {
    throw new CanonicalProjectError(`${label}: a board jumper requires a manual local route`);
  }
  const first = edge.points?.[0];
  const last = edge.points?.[edge.points.length - 1];
  const [expectedSource, expectedTarget] = boardWorldPoints(board, [
    holeLocalPoint(board.data, sourceHole),
    holeLocalPoint(board.data, targetHole),
  ]);
  if (!pointsNear(first, expectedSource) || !pointsNear(last, expectedTarget)) {
    throw new CanonicalProjectError(`${label}: jumper route endpoints must match its board holes`);
  }
}

function pointsNear(actual: Point | undefined, expected: Point): boolean {
  return (
    !!actual && Math.abs(actual.x - expected.x) <= 0.5 && Math.abs(actual.y - expected.y) <= 0.5
  );
}

function normalizeManualRoute(
  edgeId: string,
  points: readonly Point[] | undefined,
): CanonicalPoint[] {
  if (!points || points.length < 2) {
    throw new CanonicalProjectError(`edge "${edgeId}": manual routing requires at least 2 points`);
  }
  const normalized = normalizeOrthogonalPersistedRoute(points);
  if (!normalized || normalized.length < 2) {
    throw new CanonicalProjectError(`edge "${edgeId}": manual route is not orthogonal`);
  }
  return normalized.map(toCanonicalPoint);
}

function normalizeBoardJumperRoute(
  edgeId: string,
  points: readonly Point[] | undefined,
): CanonicalPoint[] {
  if (!points || points.length < 2) {
    throw new CanonicalProjectError(`edge "${edgeId}": board jumper requires at least 2 points`);
  }
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new CanonicalProjectError(`edge "${edgeId}": board jumper route has invalid points`);
  }
  return points.map(toCanonicalPoint);
}

function toEndpoint(
  edgeId: string,
  side: 'source' | 'target',
  nodeId: string,
  portId: string,
  nodeKinds: ReadonlyMap<string, 'device' | 'junction' | 'board'>,
  copper: BoardCopperJunctions,
): { endpoint: CanonicalNetEndpoint; tap?: number; netLabel?: string } {
  const kind = nodeKinds.get(nodeId);
  if (kind === 'device') {
    return { endpoint: { kind: 'pin', componentId: nodeId, pinId: portId } };
  }
  if (kind === 'junction') {
    return { endpoint: { kind: 'junction', junctionId: nodeId }, tap: junctionTapIndex(portId) };
  }
  if (kind === 'board') {
    const resolved = copper.resolve(edgeId, side, nodeId, portId);
    return { endpoint: resolved.endpoint, tap: resolved.tap, netLabel: resolved.netLabel };
  }
  throw new CanonicalProjectError(
    `edge "${edgeId}".${side}: node "${nodeId}" is not a device, a junction or a board`,
  );
}

/**
 * Re-normalizes the cable attributes denormalized onto every edge back into
 * one entry per cable name.
 *
 * Edges are visited in id order, so the result does not depend on model
 * ordering. Imported cable metadata fills inventory fields that are not
 * editable per conductor. Live edge color and inspection metadata are
 * reconciled after all conductors are known, so stale edge copies cannot win.
 */
function buildCables(
  edges: readonly Edge<WireEdgeData>[],
  cableInventory: readonly CanonicalCable[],
): CanonicalCable[] {
  const byName = new Map<string, CanonicalCable>();
  const edgesByName = new Map<string, Edge<WireEdgeData>[]>();

  for (const edge of [...edges].sort(byId)) {
    const name = edge.data.wireId;
    if (!name) continue;

    const wireIndex = edge.data.wireIndex ?? 1;
    const existing = byName.get(name);
    const importedColors = edge.data.cableColors ? [...edge.data.cableColors] : [];
    const importedWireLabels = edge.data.cableWireLabels
      ? [...edge.data.cableWireLabels]
      : undefined;
    const cable: CanonicalCable = existing ?? {
      name,
      wireCount: Math.max(
        edge.data.cableWireCount ?? 0,
        importedColors.length,
        importedWireLabels?.length ?? 0,
        wireIndex,
      ),
      colors: importedColors,
      wireLabels: importedWireLabels,
      type: edge.data.cableType,
      manufacturer: edge.data.manufacturer,
      mpn: edge.data.mpn,
      colorCode: edge.data.cableColorCode,
      wirevizExtras: edge.data.cableExtras,
    };

    mergeCableString(cable, 'type', edge.data.cableType, edge.id);
    mergeCableString(cable, 'manufacturer', edge.data.manufacturer, edge.id);
    mergeCableString(cable, 'mpn', edge.data.mpn, edge.id);
    mergeCableString(cable, 'colorCode', edge.data.cableColorCode, edge.id);
    mergeCableExtras(cable, edge.data.cableExtras, edge.id);
    mergeCableWireLabels(cable, importedWireLabels, edge.id);

    cable.wireCount = Math.max(
      cable.wireCount,
      edge.data.cableWireCount ?? 0,
      importedColors.length,
      importedWireLabels?.length ?? 0,
      wireIndex,
    );
    for (let i = 0; i < importedColors.length; i++) {
      const incoming = importedColors[i];
      const current = cable.colors[i];
      // Edge copies can be stale after editing one conductor. Treat the full
      // imported list as fallback inventory; the live color for each used
      // slot is applied authoritatively after all edges are collected.
      if (!current && incoming) cable.colors[i] = incoming;
    }

    byName.set(name, cable);
    const cableEdges = edgesByName.get(name) ?? [];
    cableEdges.push(edge);
    edgesByName.set(name, cableEdges);
  }

  // The diagram has no edge to hang a completely disconnected cable on.
  // Keep the project-level inventory as a lossless fallback. For a connected
  // cable, live edge data wins while the inventory fills attributes and
  // currently unused slots that an edge may not carry.
  for (const cable of cableInventory) {
    const live = byName.get(cable.name);
    if (live) mergeInventoryCable(live, cable);
    else byName.set(cable.name, cloneCable(cable));
  }

  for (const [name, cableEdges] of edgesByName) {
    const cable = byName.get(name);
    if (!cable) continue;

    const colorsByIndex = new Map<number, string>();
    for (const edge of cableEdges) {
      const wireIndex = edge.data.wireIndex ?? 1;
      const color = canonicalColorValue({ color: edge.data.color, colorCode: edge.data.colorCode });
      const serialized = color ?? '';
      const previous = colorsByIndex.get(wireIndex);
      if (previous !== undefined && previous !== serialized) {
        throw new CanonicalProjectError(
          `cabo "${name}": cores contraditorias no condutor ${wireIndex} ` +
            `("${previous}" e "${serialized}")`,
        );
      }
      colorsByIndex.set(wireIndex, serialized);
    }
    for (const [wireIndex, color] of colorsByIndex) cable.colors[wireIndex - 1] = color;

    reconcileSharedInspectionField(cable, cableEdges, 'gauge');
    reconcileSharedInspectionField(cable, cableEdges, 'length');
    reconcileSharedInspectionField(cable, cableEdges, 'notes');
  }

  // A sparse `colors` array (wire 2 colored, wire 1 not) would serialize to
  // JSON nulls, so gaps are filled with '' -- the same "no color" signal an
  // absent WireViz color entry carries.
  for (const cable of byName.values()) {
    for (let i = 0; i < cable.wireCount; i++) {
      cable.colors[i] ??= '';
    }
    cable.colors.length = cable.wireCount;
    if (cable.wireLabels) {
      while (cable.wireLabels.length < cable.wireCount) cable.wireLabels.push('');
      cable.wireLabels.length = cable.wireCount;
    }
  }

  return [...byName.values()].sort(byKey((cable) => cable.name));
}

type InspectionField = 'gauge' | 'length' | 'notes';

/**
 * WireViz can express these fields only once per cable. Keep a cable-level
 * value in sync when all connected conductors agree. When they differ, remove
 * the cable-level fallback: a stale imported value would otherwise make a
 * deliberately cleared conductor inherit it again after save and reload.
 */
function reconcileSharedInspectionField(
  cable: CanonicalCable,
  edges: readonly Edge<WireEdgeData>[],
  key: InspectionField,
): void {
  if (edges.length === 0) return;
  const value = edges[0].data[key];
  if (edges.every((edge) => edge.data[key] === value)) {
    cable[key] = value;
  } else {
    clearInspectionField(cable, key);
  }
}

function clearInspectionField(cable: CanonicalCable, key: InspectionField): void {
  switch (key) {
    case 'gauge':
      delete cable.gauge;
      break;
    case 'length':
      delete cable.length;
      break;
    case 'notes':
      delete cable.notes;
      break;
  }
}

function mergeInventoryCable(live: CanonicalCable, inventory: CanonicalCable): void {
  live.wireCount = Math.max(live.wireCount, inventory.wireCount);
  for (let index = 0; index < inventory.wireCount; index++) {
    if (!live.colors[index] && inventory.colors[index]) {
      live.colors[index] = inventory.colors[index];
    }
  }
  if (inventory.wireLabels) {
    if (!live.wireLabels) live.wireLabels = [...inventory.wireLabels];
    else {
      for (let index = 0; index < inventory.wireLabels.length; index++) {
        if (!live.wireLabels[index] && inventory.wireLabels[index]) {
          live.wireLabels[index] = inventory.wireLabels[index];
        }
      }
    }
  }

  const stringKeys: readonly (CableStringKey | InspectionField)[] = [
    'gauge',
    'length',
    'notes',
    'type',
    'manufacturer',
    'mpn',
    'colorCode',
  ];
  for (const key of stringKeys) {
    live[key] ??= inventory[key];
  }
  if (live.wirevizExtras === undefined && inventory.wirevizExtras !== undefined) {
    live.wirevizExtras = { ...inventory.wirevizExtras };
  }
}

function mergeCableWireLabels(
  cable: CanonicalCable,
  incoming: readonly string[] | undefined,
  edgeId: string,
): void {
  if (incoming === undefined) return;
  if (cable.wireLabels === undefined) {
    cable.wireLabels = [...incoming];
    return;
  }
  const width = Math.max(cable.wireLabels.length, incoming.length);
  for (let index = 0; index < width; index++) {
    const current = cable.wireLabels[index];
    const next = incoming[index];
    if (current && next && current !== next) {
      throw new CanonicalProjectError(
        `cabo "${cable.name}": a aresta "${edgeId}" contradiz o wirelabel do condutor ` +
          `${index + 1} ("${current}" e "${next}")`,
      );
    }
    if (!current && next) cable.wireLabels[index] = next;
  }
}

function cloneCable(cable: CanonicalCable): CanonicalCable {
  return {
    ...cable,
    colors: [...cable.colors],
    wireLabels: cable.wireLabels ? [...cable.wireLabels] : undefined,
    wirevizExtras: cable.wirevizExtras ? { ...cable.wirevizExtras } : undefined,
  };
}

type CableStringKey = 'type' | 'manufacturer' | 'mpn' | 'colorCode';

function mergeCableString(
  cable: CanonicalCable,
  key: CableStringKey,
  incoming: string | undefined,
  edgeId: string,
): void {
  if (incoming === undefined) return;
  const current = cable[key];
  if (current === undefined) {
    cable[key] = incoming;
    return;
  }
  if (current !== incoming) {
    throw new CanonicalProjectError(
      `cabo "${cable.name}": a aresta "${edgeId}" declara ${key}="${incoming}", ` +
        `mas outro condutor declara "${current}"`,
    );
  }
}

function mergeCableExtras(
  cable: CanonicalCable,
  incoming: PreservedFields | undefined,
  edgeId: string,
): void {
  if (incoming === undefined) return;
  if (cable.wirevizExtras === undefined) {
    cable.wirevizExtras = incoming;
    return;
  }
  if (stableJson(cable.wirevizExtras) !== stableJson(incoming)) {
    throw new CanonicalProjectError(
      `cabo "${cable.name}": a aresta "${edgeId}" possui campos WireViz preservados contraditórios`,
    );
  }
}

function stableJson(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, inner: unknown) => {
    if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) return inner;
    const record = inner as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = record[key];
    return sorted;
  });
  if (serialized === undefined) {
    throw new CanonicalProjectError('cannot serialize preserved WireViz fields');
  }
  return serialized;
}

function toCanonicalComponent(node: Node<DeviceNodeData>): CanonicalComponent {
  return {
    id: node.id,
    deviceId: node.data.deviceId,
    manufacturer: node.data.manufacturer,
    model: node.data.model,
    category: node.data.category,
    location: node.data.location,
    wirevizName: node.data.wirevizName,
    wirevizType: node.data.wirevizType,
    wirevizSubtype: node.data.wirevizSubtype,
    wirevizColor: node.data.wirevizColor,
    wirevizManufacturer: node.data.wirevizManufacturer,
    wirevizMpn: node.data.wirevizMpn,
    wirevizStyle: node.data.wirevizStyle,
    wirevizShowName: node.data.wirevizShowName,
    notes: node.data.notes,
    wirevizExtras: node.data.wirevizExtras,
    pins: node.data.ports.map((port) => ({
      id: port.id,
      label: port.label,
      direction: port.direction,
      connectorType: port.connectorType,
      wirevizDesignator: port.wirevizDesignator,
      wirevizLabel: port.wirevizLabel,
    })),
  };
}

function toComponentLayout(node: Node<DeviceNodeData>): CanonicalComponentLayout {
  const pinHoles: CanonicalPinPlacement[] = [];
  for (const port of node.data.ports) {
    if (port.hole !== undefined) pinHoles.push({ pinId: port.id, hole: { ...port.hole } });
  }
  const footprint = resolveFootprint(node.data);

  return {
    componentId: node.id,
    position: toCanonicalPoint(node.position),
    visualPlane: visualPlaneOf(node),
    boardId: node.data.boardId,
    footprintId: node.data.footprintId,
    footprint: footprint ? cloneFootprint(footprint) : undefined,
    placement: node.data.placement ? clonePlacement(node.data.placement) : undefined,
    footprintRotation: node.data.placement ? undefined : node.data.footprintRotation,
    footprintPitch: node.data.placement ? undefined : node.data.footprintPitch,
    pinHoles: pinHoles.length > 0 ? pinHoles : undefined,
  };
}

function clonePlacement(placement: DevicePlacement): DevicePlacement {
  return {
    boardId: placement.boardId,
    anchor: { ...placement.anchor },
    rotation: placement.rotation,
  };
}

export function cloneBoardTrace(trace: BoardTrace): BoardTrace {
  return {
    ...trace,
    segments: trace.segments.map((segment) => ({
      from: { ...segment.from },
      to: { ...segment.to },
    })),
  };
}

function toCanonicalJunction(node: Node<JunctionNodeData>): CanonicalJunction {
  return {
    id: node.id,
    label: node.data.label,
    kind: node.data.kind,
    notes: node.data.notes,
    wirevizName: node.data.wirevizName,
    wirevizType: node.data.wirevizType,
    wirevizSubtype: node.data.wirevizSubtype,
    wirevizColor: node.data.wirevizColor,
    wirevizManufacturer: node.data.wirevizManufacturer,
    wirevizMpn: node.data.wirevizMpn,
    wirevizStyle: node.data.wirevizStyle,
    wirevizShowName: node.data.wirevizShowName,
    wirevizExtras: node.data.wirevizExtras,
  };
}

function toJunctionLayout(node: Node<JunctionNodeData>): CanonicalJunctionLayout {
  return {
    junctionId: node.id,
    position: toCanonicalPoint(node.position),
    visualPlane: visualPlaneOf(node),
    taps: node.data.taps,
    boardId: node.data.boardId,
    hole: node.data.hole,
  };
}

function toCanonicalBoard(node: Node<BoardNodeData>): CanonicalBoard {
  return {
    id: node.data.boardId,
    label: node.data.label,
    notes: node.data.notes,
    surface: node.data.surface,
    rows: node.data.rows,
    cols: node.data.cols,
    pitch: node.data.pitch,
    centerGap: node.data.centerGap,
    rowLabels: node.data.rowLabels ? [...node.data.rowLabels] : undefined,
    holes: node.data.holes?.map((hole) => ({ ...hole })),
    holeDiameter: node.data.holeDiameter,
    traces: node.data.traces?.map(cloneBoardTrace),
    position: toCanonicalPoint(node.position),
    visualPlane: visualPlaneOf(node),
  };
}

function toCanonicalPoint(point: Point): CanonicalPoint {
  return { x: point.x, y: point.y };
}

// ---------------------------------------------------------------------------
// Canonical -> model
// ---------------------------------------------------------------------------

const DEFAULT_POSITION: CanonicalPoint = { x: 0, y: 0 };

/**
 * Rebuilds an ng-diagram node/edge model from a canonical project snapshot.
 *
 * The two sections are merged here and only here: `electrical` supplies
 * identity and connectivity, `layout` supplies position, board holes, tap
 * assignment and manual routes. A missing layout entry is not an error -- a
 * project that was just imported from WireViz has electrical content and no
 * geometry yet -- it falls back to the origin with a single tap.
 *
 * Persistent visual planes are mapped to explicit ng-diagram z-order values.
 * Type and id are deterministic tie breakers inside each plane.
 */
export function fromCanonicalProject(project: CanonicalProjectV4): {
  nodes: Node<AvSchematicNodeData>[];
  edges: Edge<WireEdgeData>[];
  /** Cable records that have no standalone ng-diagram element. */
  cableInventory: CanonicalCable[];
} {
  const componentLayouts = new Map(project.layout.components.map((c) => [c.componentId, c]));
  const junctionLayouts = new Map(project.layout.junctions.map((j) => [j.junctionId, j]));
  const conductorLayouts = new Map(project.layout.conductors.map((c) => [c.conductorId, c]));
  const cables = new Map(project.electrical.cables.map((cable) => [cable.name, cable]));

  const netByJunction = new Map<string, CanonicalNet>();
  for (const net of project.electrical.nets) {
    for (const endpoint of net.endpoints) {
      if (endpoint.kind === 'junction') netByJunction.set(endpoint.junctionId, net);
    }
  }

  const boardNodes = project.layout.boards.map(fromCanonicalBoard);
  const boardIds = new Set(boardNodes.map((node) => node.data.boardId));
  const boardsById = new Map(boardNodes.map((node) => [node.data.boardId, node]));

  // A junction drawn as a board port has no node of its own: it *is* the
  // board's hole/trace port. A layout that points at a board this project no
  // longer contains falls back to an ordinary junction node rather than
  // dropping the electrical point on the floor.
  const copperPorts = new Map<string, BoardCopperPort>();
  for (const layout of project.layout.junctions) {
    if (!layout.boardPort || !layout.boardId || !boardIds.has(layout.boardId)) continue;
    const board = boardsById.get(layout.boardId);
    const traceId = parseTracePortId(layout.boardPort);
    const trace = traceId
      ? board?.data.traces?.find((candidate) => candidate.id === traceId)
      : undefined;
    copperPorts.set(layout.junctionId, {
      boardId: layout.boardId,
      portId: layout.boardPort,
      tapPortIds: trace?.segments.length
        ? traceHoles(trace).map((hole) => holePortId(hole))
        : undefined,
      holes: trace
        ? traceHoles(trace)
        : (() => {
            const hole = parseHolePortId(layout.boardPort);
            return hole ? [hole] : [];
          })(),
    });
  }

  const componentNodes = project.electrical.components.map((component) =>
    fromCanonicalComponent(component, componentLayouts.get(component.id), boardsById),
  );
  const junctionNodes = project.electrical.junctions
    .filter((junction) => !copperPorts.has(junction.id))
    .map((junction) =>
      fromCanonicalJunction(
        junction,
        junctionLayouts.get(junction.id),
        netByJunction.get(junction.id),
      ),
    );

  const edges = project.electrical.nets.flatMap((net) =>
    net.conductors.flatMap((conductor) => {
      const layout = conductorLayouts.get(conductor.id);
      return layout?.physicalBinding
        ? []
        : [fromCanonicalConductor(conductor, net, layout, cables, copperPorts, boardsById)];
    }),
  );

  const ordered = applyVisualZOrder([...boardNodes, ...componentNodes, ...junctionNodes], edges);
  return {
    nodes: ordered.nodes,
    edges: ordered.edges,
    cableInventory: project.electrical.cables.map(cloneCable),
  };
}

function fromCanonicalBoard(board: CanonicalBoard): Node<BoardNodeData> {
  return {
    id: board.id,
    type: NodeTemplateType.BoardNode,
    position: board.position,
    zOrder: board.visualPlane,
    data: {
      type: 'board',
      boardId: board.id,
      label: board.label,
      notes: board.notes,
      surface: board.surface,
      rows: board.rows,
      cols: board.cols,
      pitch: board.pitch,
      centerGap: board.centerGap,
      rowLabels: board.rowLabels ? [...board.rowLabels] : undefined,
      holes: board.holes?.map((hole) => ({ ...hole })),
      holeDiameter: board.holeDiameter,
      traces: board.traces?.map(cloneBoardTrace),
      visualPlane: board.visualPlane,
    },
  };
}

function fromCanonicalComponent(
  component: CanonicalComponent,
  layout: CanonicalComponentLayout | undefined,
  boardsById: ReadonlyMap<string, Node<BoardNodeData>>,
): Node<DeviceNodeData> {
  const holesByPin = new Map((layout?.pinHoles ?? []).map((entry) => [entry.pinId, entry.hole]));
  const footprint = layout?.footprint ? cloneFootprint(layout.footprint) : undefined;
  const placement = layout?.placement ? clonePlacement(layout.placement) : undefined;
  const physical = !!layout?.footprintId && !!footprint;

  const board = placement ? boardsById.get(placement.boardId) : undefined;
  const data: DeviceNodeData = {
    type: 'device',
    visualPlane: layout?.visualPlane ?? defaultVisualPlane('component'),
    footprintId: layout?.footprintId,
    footprint,
    placement,
    footprintRotation: placement?.rotation ?? layout?.footprintRotation,
    footprintPitch: board?.data.pitch ?? layout?.footprintPitch,
    deviceId: component.deviceId,
    manufacturer: component.manufacturer,
    model: component.model,
    category: component.category,
    location: component.location,
    boardId: layout?.boardId,
    wirevizName: component.wirevizName,
    wirevizType: component.wirevizType,
    wirevizSubtype: component.wirevizSubtype,
    wirevizColor: component.wirevizColor,
    wirevizManufacturer: component.wirevizManufacturer,
    wirevizMpn: component.wirevizMpn,
    wirevizStyle: component.wirevizStyle,
    wirevizShowName: component.wirevizShowName,
    notes: component.notes,
    wirevizExtras: component.wirevizExtras,
    ports: component.pins.map((pin) => ({
      id: pin.id,
      label: pin.label,
      direction: pin.direction,
      connectorType: pin.connectorType,
      wirevizDesignator: pin.wirevizDesignator,
      wirevizLabel: pin.wirevizLabel,
      hole: holesByPin.get(pin.id),
    })),
  };

  return {
    id: component.id,
    // Footprint identity controls the renderer independently of whether the
    // component is currently seated on a board.
    type: physical ? NodeTemplateType.FootprintNode : NodeTemplateType.DeviceNode,
    position:
      physical && board && placement
        ? placementNodePosition({ board: board.data, position: board.position }, placement)
        : (layout?.position ?? DEFAULT_POSITION),
    zOrder: data.visualPlane,
    data: physical && placement ? syncPortHolesToPlacement(data) : data,
  };
}

function fromCanonicalJunction(
  junction: CanonicalJunction,
  layout: CanonicalJunctionLayout | undefined,
  net: CanonicalNet | undefined,
): Node<JunctionNodeData> {
  return {
    id: junction.id,
    type: NodeTemplateType.JunctionNode,
    position: layout?.position ?? DEFAULT_POSITION,
    zOrder: layout?.visualPlane ?? defaultVisualPlane('junction'),
    data: {
      type: 'junction',
      visualPlane: layout?.visualPlane ?? defaultVisualPlane('junction'),
      junctionId: junction.id,
      label: junction.label,
      kind: junction.kind,
      taps: layout?.taps ?? 1,
      notes: junction.notes,
      netId: net?.id,
      netName: net?.name,
      wirevizName: junction.wirevizName,
      wirevizType: junction.wirevizType,
      wirevizSubtype: junction.wirevizSubtype,
      wirevizColor: junction.wirevizColor,
      wirevizManufacturer: junction.wirevizManufacturer,
      wirevizMpn: junction.wirevizMpn,
      wirevizStyle: junction.wirevizStyle,
      wirevizShowName: junction.wirevizShowName,
      wirevizExtras: junction.wirevizExtras,
      boardId: layout?.boardId,
      hole: layout?.hole,
    },
  };
}

function fromCanonicalConductor(
  conductor: CanonicalConductor,
  net: CanonicalNet,
  layout: CanonicalConductorLayout | undefined,
  cables: ReadonlyMap<string, CanonicalCable>,
  copperPorts: ReadonlyMap<string, BoardCopperPort>,
  boardsById: ReadonlyMap<string, Node<BoardNodeData>>,
): Edge<WireEdgeData> {
  const cable = conductor.cable ? cables.get(conductor.cable.name) : undefined;
  const cableColor = resolveWireColor(cable?.colors[(conductor.cable?.wireIndex ?? 1) - 1]);
  const conductorColor = resolveWireColor(conductor.colorCode);
  const hasConductorColor = conductor.color !== undefined || conductor.colorCode !== undefined;
  const color = conductor.color ?? conductorColor.color ?? cableColor.color;
  const colorCode = conductor.colorCode ?? (hasConductorColor ? undefined : cableColor.colorCode);
  const source = endpointNodeId(conductor.from, copperPorts);
  const sourcePort = endpointPortId(conductor.from, layout?.fromTap, copperPorts);
  const target = endpointNodeId(conductor.to, copperPorts);
  const targetPort = endpointPortId(conductor.to, layout?.toTap, copperPorts);
  const normalizedRoute =
    layout?.routingMode === 'manual' && layout.points
      ? normalizeOrthogonalPersistedRoute(layout.points)
      : null;
  const localPoints = normalizedRoute && normalizedRoute.length >= 2 ? normalizedRoute : undefined;
  const jumperBoardId = layout?.boardJumper?.boardId;
  const jumperBoard = jumperBoardId ? boardsById.get(jumperBoardId) : undefined;
  const sourceHole = layout?.boardJumper
    ? endpointBoardHole(conductor.from, layout.fromTap, copperPorts)
    : undefined;
  const targetHole = layout?.boardJumper
    ? endpointBoardHole(conductor.to, layout.toTap, copperPorts)
    : undefined;
  const jumperLocalPoints =
    jumperBoard && sourceHole && targetHole
      ? [
          holeLocalPoint(jumperBoard.data, sourceHole),
          ...(layout?.boardJumper?.bends ?? []),
          holeLocalPoint(jumperBoard.data, targetHole),
        ]
      : undefined;
  const manualPoints =
    jumperBoard && jumperLocalPoints
      ? boardWorldPoints(jumperBoard, jumperLocalPoints)
      : localPoints;

  return {
    id: conductor.id,
    type: EdgeTemplateType.WireEdge,
    source,
    sourcePort,
    target,
    targetPort,
    routingMode: manualPoints ? 'manual' : undefined,
    routing: layout?.boardJumper ? 'polyline' : undefined,
    points: manualPoints,
    zOrder: layout?.visualPlane ?? defaultVisualPlane('conductor'),
    data: {
      type: 'wire',
      visualPlane: layout?.visualPlane ?? defaultVisualPlane('conductor'),
      wireId: conductor.cable?.name ?? '',
      jumperBoardId,
      wireIndex: conductor.cable?.wireIndex,
      cableWireCount: cable?.wireCount,
      cableColors: cable ? [...cable.colors] : undefined,
      cableWireLabels: cable?.wireLabels ? [...cable.wireLabels] : undefined,
      wireType: conductor.wireType,
      gauge: conductor.gauge ?? cable?.gauge,
      length: conductor.length ?? cable?.length,
      notes: conductor.notes ?? cable?.notes,
      wirevizLink: conductor.wirevizLink,
      wirevizLoop: conductor.wirevizLoop,
      netId: net.id,
      netName: net.name,
      color,
      colorCode,
      cableType: cable?.type,
      manufacturer: cable?.manufacturer,
      mpn: cable?.mpn,
      cableColorCode: cable?.colorCode,
      cableExtras: cable?.wirevizExtras,
    },
  };
}

/** Where a junction that is drawn as board copper actually lands. */
export interface BoardCopperPort {
  boardId: string;
  portId: string;
  tapPortIds?: string[];
  holes: BoardHole[];
}

function endpointBoardHole(
  endpoint: CanonicalNetEndpoint,
  tap: number | undefined,
  copperPorts: ReadonlyMap<string, BoardCopperPort>,
): BoardHole | undefined {
  if (endpoint.kind !== 'junction') return undefined;
  return copperPorts.get(endpoint.junctionId)?.holes[tap ?? 0];
}

function endpointNodeId(
  endpoint: CanonicalNetEndpoint,
  copperPorts: ReadonlyMap<string, BoardCopperPort>,
): string {
  if (endpoint.kind === 'pin') return endpoint.componentId;
  return copperPorts.get(endpoint.junctionId)?.boardId ?? endpoint.junctionId;
}

function endpointPortId(
  endpoint: CanonicalNetEndpoint,
  tap: number | undefined,
  copperPorts: ReadonlyMap<string, BoardCopperPort>,
): string {
  if (endpoint.kind === 'pin') return endpoint.pinId;
  const copper = copperPorts.get(endpoint.junctionId);
  if (!copper) return junctionTapPortId(tap ?? 0);
  return tap === undefined ? copper.portId : (copper.tapPortIds?.[tap] ?? copper.portId);
}

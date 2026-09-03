import { type JsonValue } from '../../shared/utils/json-value';
import { type Footprint } from './footprint';

export enum NodeTemplateType {
  DeviceNode = 'deviceNode',
  BoardNode = 'boardNode',
  JunctionNode = 'junctionNode',
  /**
   * A device drawn as a physical footprint, whether seated on a board or free
   * on the canvas, instead of as the generic AV card. Same `DeviceNodeData`
   * payload - only the template differs, so the properties sidebar, DXF export,
   * `generateDeviceId` and every other subsystem that keys on
   * `data.type === 'device'` keep working unchanged.
   */
  FootprintNode = 'footprintNode',
}

export enum EdgeTemplateType {
  WireEdge = 'wireEdge',
}

export type PortDirection = 'input' | 'output';

/** Persisted drawing plane. Greater values render above lower values. */
export interface VisualPlaneData {
  visualPlane?: number;
}

/** WireViz pin-level link used when two connector pins mate without a cable. */
export type WireVizLinkStyle = '--' | '<--' | '<-->' | '-->';

/**
 * A JSON-safe value preserved verbatim from an imported document.
 *
 * An alias of the shared `JsonValue` -- the same underlying type the YAML
 * subset parser uses -- so a field read from a document and a field stored in
 * the model stay assignable to each other. The alias exists to name the
 * *role*: "carried without being interpreted", which is not a YAML concern.
 */
export type PreservedValue = JsonValue;

/** Uninterpreted fields kept so a round-trip can write them back unchanged. */
export type PreservedFields = Readonly<Record<string, PreservedValue>>;

/**
 * A hole address on a physical board's grid (0-indexed, row then column).
 *
 * Boards are described row-major from their top-left hole, so `{row: 0, col: 0}`
 * is the hole the board's own illustration anchors on. Human-facing labels are
 * 1-indexed (`L1..L6` x `C1..C11`); those live
 * in `BoardTrace.label` / `BoardTrace.net`, never in the addresses themselves.
 *
 * Optional on `DevicePort` -- only pins meant to align with a board's hole grid
 * carry one. For a device with a `placement`, per-pin holes are *derived* from
 * the placement and the footprint (see `deviceHoleClaims`), and the
 * stored `hole` is the resolved result; for a device without one, the stored
 * `hole` is the only address there is (the issue #1 tracer-bullet path).
 */
export interface BoardHole {
  row: number;
  col: number;
}

export interface DevicePort {
  id: string;
  label: string;
  direction: PortDirection;
  connectorType?: string;
  /** Original WireViz pin designator, kept independently from the editor label/id. */
  wirevizDesignator?: string;
  /** Original positional `pinlabels` value, when the source document declared one. */
  wirevizLabel?: string;
  hole?: BoardHole;
}

/** WireViz connector metadata that is orthogonal to the editor's own device fields. */
export interface WireVizConnectorMetadata {
  /** Name this element takes as a WireViz `connectors.<name>` entry. */
  wirevizName?: string;
  /** WireViz connector family. */
  wirevizType?: string;
  /** WireViz connector variant. */
  wirevizSubtype?: string;
  wirevizColor?: string;
  wirevizManufacturer?: string;
  wirevizMpn?: string;
  wirevizStyle?: string;
  wirevizShowName?: boolean;
  /** WireViz connector keys this codebase does not interpret. */
  wirevizExtras?: PreservedFields;
}

/**
 * How far a footprint is turned on the board, clockwise, in degrees. Only
 * multiples of 90 exist: a through-hole part can only be seated on the hole
 * grid at right angles, so anything else would put its pins between holes.
 */
export type BoardRotation = 0 | 90 | 180 | 270;

export const BOARD_ROTATIONS: readonly BoardRotation[] = [0, 90, 180, 270];

/**
 * Where a footprinted component is seated on a board.
 *
 * `anchor` is the board hole that the *rotated* footprint's top-left bounding
 * box cell lands on - so the whole placement is `(board, anchor, rotation)` and
 * every pin position follows from the footprint. Keeping the anchor (rather
 * than a pixel position) as the stored truth is what makes "encaixado" mean
 * something: a placement can only ever address whole holes.
 */
export interface DevicePlacement {
  /** `BoardNodeData.boardId` this component is seated on. */
  boardId: string;
  anchor: BoardHole;
  rotation: BoardRotation;
}

export interface DeviceNodeData extends WireVizConnectorMetadata, VisualPlaneData {
  type: 'device';
  deviceId: string;
  manufacturer: string;
  model: string;
  category?: string;
  location?: string;
  /**
   * The physical board this device's holes are addressed against (a
   * `BoardNodeData.boardId`). Required for validation whenever any of this
   * device's `ports` carries a `hole` -- a hole address is only meaningful
   * relative to one specific board's grid. Devices with no holed ports may
   * omit it. When `placement` is set it always agrees with `placement.boardId`.
   */
  boardId?: string;
  notes?: string;
  /**
   * Physical footprint this device is drawn and seated with (a key of
   * `FOOTPRINTS`). Absent for devices that are just generic AV cards, and for
   * the issue #1 tracer-bullet devices whose pin holes are hand-addressed.
   */
  footprintId?: string;
  /**
   * Project-owned definition for `footprintId`.
   *
   * New physical saves carry this value so reload does not depend on the
   * application fixture catalog. The built-in catalog remains a fallback for
   * palette items and legacy in-memory nodes.
   */
  footprint?: Footprint;
  /** Seat on a board. Only meaningful together with `footprintId`. */
  placement?: DevicePlacement;
  /** Visual rotation retained while the footprint is not seated on a board. */
  footprintRotation?: BoardRotation;
  /** Visual pitch retained while the footprint is not seated on a board. */
  footprintPitch?: number;
  ports: DevicePort[];
}

/**
 * One axis-aligned run of holes joined by a copper trace. `from` and `to` are
 * inclusive and must share a row or a column -- a diagonal run has no physical
 * meaning on a hole grid.
 */
export interface BoardTraceSegment {
  from: BoardHole;
  to: BoardHole;
}

/**
 * A trilha: a set of holes on one board that are electrically one point.
 *
 * Segments (rather than an explicit hole list) keep a full-width rail on a
 * 6 x 28 board one line of data instead of 28, and still express the L-shaped
 * runs and vertical bridges that the real Talus-Droid pieces use (see peca E's
 * bridge from L1-C3 down to L3-C1 in docs/physical-footprints.md).
 */
export interface BoardTrace {
  id: string;
  /** Human-facing name, e.g. `"L1"`. */
  label: string;
  /** Electrical net this trace carries, e.g. `"GND_SYS"`. Free of a net when bare copper. */
  net?: string;
  /**
   * Grouping that lives inside the board body instead of on its face.
   *
   * A solderless breadboard has no exposed copper at all: its column groups
   * and buses are spring clips under the plastic. They are still one
   * electrical point, so they are still traces -- but they carry no visible
   * run to label and no landing pad of their own, so the renderer draws them
   * faintly and mints no `trace:<id>` port for them. Every connection to an
   * internal group goes through one of its holes, which is what the hardware
   * physically allows.
   */
  internal?: boolean;
  segments: BoardTraceSegment[];
}

/**
 * How a board's body is physically built, and therefore how it is drawn.
 *
 * `perfboard` is a bare drilled board: opaque brown substrate, exposed copper
 * on its face, nothing printed. `breadboard` is a solderless plastic block:
 * light body, a recessed central channel, coloured power-rail bands and
 * silk-screened row/column markings, with every conductor hidden as a spring
 * clip inside the body.
 *
 * This is a *visual* variant only - it changes no address, no port and no
 * electrical fact. It is persisted (a reopened project must look the way it
 * was saved, without having to guess "830 holes therefore breadboard") and it
 * is closed: a value outside this union is rejected by both validators rather
 * than silently falling back, so a typo can never quietly repaint a board.
 */
export type BoardSurface = 'perfboard' | 'breadboard';

/** Every accepted `BoardSurface`, in the order the validators report them. */
export const BOARD_SURFACES: readonly BoardSurface[] = ['perfboard', 'breadboard'];

/** The surface a board without an explicit one is drawn with. */
export const DEFAULT_BOARD_SURFACE: BoardSurface = 'perfboard';

export function isBoardSurface(value: unknown): value is BoardSurface {
  return typeof value === 'string' && (BOARD_SURFACES as readonly string[]).includes(value);
}

/**
 * A physical board with an addressable rows x cols hole grid.
 *
 * Nothing here presumes a particular size or a particular kind of board: the
 * 6 x 11 placa A, the 830-point solderless breadboard, the uncut 6 x 28 origin
 * perfboard and the small 6 x 3 / 6 x 4 pecas E/G are all the same type with
 * different numbers. Rendered as its
 * own node so it shares the single ng-diagram canvas/coordinate plane with
 * devices and wires -- not a second canvas, not a background image.
 */
export interface BoardNodeData extends VisualPlaneData {
  type: 'board';
  boardId: string;
  label: string;
  /**
   * How the board body is drawn. Absent means `perfboard`, which is what every
   * project saved before this field existed is - so an old save reopens
   * looking exactly as it did.
   */
  surface?: BoardSurface;
  /** Human-facing assembly notes kept with the board across project saves. */
  notes?: string;
  rows: number;
  cols: number;
  /** Distance between adjacent holes, in diagram px (both axes). */
  pitch: number;
  /** Extra vertical clearance between the two row halves, for a protoboard channel. */
  centerGap?: number;
  /**
   * Human-facing name of each row, top to bottom, when the hardware prints
   * one -- `"J"`, `"top+"` and so on for a solderless breadboard.
   *
   * Exactly `rows` entries when present; an empty string is a row the board
   * does not name (a blank spacer row, or a plain perfboard row that keeps the
   * default `L<n>` address). Addresses stay `{row, col}` either way: this is
   * the label layer only, so a reopened project shows `J10` without having to
   * recognize the board as a breadboard.
   */
  rowLabels?: string[];
  /**
   * Explicit holes present on the board. Absence means the complete rectangular
   * `rows x cols` grid, preserving the compact representation used by earlier
   * projects. Supplying the list allows cut-outs and irregular perfboards; an
   * empty list deliberately means that the board has no holes.
   */
  holes?: BoardHole[];
  /** Drawn hole diameter in px. Defaults to `DEFAULT_HOLE_DIAMETER` when absent. */
  holeDiameter?: number;
  /** Copper traces on this board. A board with no traces is a plain perfboard. */
  traces?: BoardTrace[];
}

/**
 * `junction` is a splice/ferrule: one electrical point where several
 * conductors of the same net meet. `rail` is the same thing drawn as a bus
 * bar with several physical tap positions -- still a *single* electrical
 * point. The distinction is deliberately visual, because that is the only
 * honest way to round-trip it: the editor rail has no distinct named pin per
 * visual tap, so WireViz's one-pin `style: simple` connector is its lossless
 * form. WireViz `loops` are modeled separately when a real multi-pin connector
 * declares internal connectivity. Keeping the rail electrically single-point
 * means export -> import never splits it into separate nets.
 */
export type JunctionKind = 'junction' | 'rail';

/**
 * An explicit junction / rail / fan-out point on the canvas.
 *
 * Fan-out is not a node type: it is what a junction (or any pin) does when
 * more than one conductor of the same net lands on it. `netId`/`netName`
 * below are a denormalized label of the net the junction currently belongs
 * to, refreshed whenever the project is (de)serialized -- the authoritative
 * net membership always comes from the conductor graph
 * (`model/net-grouping.ts`).
 */
export interface JunctionNodeData extends WireVizConnectorMetadata, VisualPlaneData {
  type: 'junction';
  junctionId: string;
  label: string;
  kind: JunctionKind;
  /**
   * Number of visual tap positions to render (>= 1). Purely geometric: every
   * tap is the same electrical point. Conductors record which tap they land
   * on in the project's layout section, never in its electrical section.
   */
  taps: number;
  notes?: string;
  /** Denormalized net label, for on-canvas inspection. Not authoritative. */
  netId?: string;
  netName?: string;
  boardId?: string;
  hole?: BoardHole;
}

/**
 * One physical conductor, used by the canvas and the properties sidebar.
 *
 * Identity, inspection metadata and the effective render color are local to
 * this edge. The canonical v2 serializer writes them onto the matching
 * `CanonicalConductor`, writes routing onto its `CanonicalConductorLayout`,
 * and reconciles the color with the referenced cable slot for WireViz. Cable
 * attributes remain an export/import representation without flattening a net.
 */
export interface WireEdgeData extends VisualPlaneData {
  type: 'wire';
  wireId: string;
  /**
   * Board that owns this conductor as a surface jumper.
   *
   * ng-diagram renders `Edge.points` in world coordinates, but canonical
   * persistence translates a jumper route to/from this board's local space.
   * Keeping ownership explicit prevents a same-board wire from being guessed
   * from ids or geometry and lets board movement carry every bend atomically.
   */
  jumperBoardId?: string;
  /** 1-based wire index within `wireId`'s cable. Absent means wire 1. */
  wireIndex?: number;
  /** Full imported cable cardinality, including currently unused conductors. */
  cableWireCount?: number;
  /** Full imported color list, including colors of currently unused conductors. */
  cableColors?: string[];
  /** Full imported wire-label list, including currently unused conductors. */
  cableWireLabels?: string[];
  wireType?: string;
  /** WireViz arrow used by a direct pin-to-pin link; absent defaults to `--`. */
  wirevizLink?: WireVizLinkStyle;
  /** True when this edge represents a WireViz connector `loops` pair. */
  wirevizLoop?: boolean;
  /** Electrical net this conductor belongs to. Derived from connectivity, not authored. */
  netId?: string;
  netName?: string;
  /** Resolved CSS color for the wire stroke. Exact six-digit RGB is also valid WireViz. */
  color?: string;
  /** WireViz color abbreviation (e.g. "YE") when the color has one. */
  colorCode?: string;
  /** Cross-section / gauge inspected for this conductor. */
  gauge?: string;
  /** Physical length inspected for this conductor. */
  length?: string;
  /** Free-form observation for this conductor. */
  notes?: string;
  /** WireViz `cables.<name>.type`. */
  cableType?: string;
  manufacturer?: string;
  mpn?: string;
  /** WireViz `cables.<name>.color_code` (the color *standard*, e.g. "DIN"). */
  cableColorCode?: string;
  /** WireViz cable keys this codebase does not interpret; re-emitted unchanged on export. */
  cableExtras?: PreservedFields;
}

export type AvSchematicNodeData = DeviceNodeData | BoardNodeData | JunctionNodeData;
export type AvSchematicEdgeData = WireEdgeData;

import { type BoardHole } from './interfaces';

/**
 * Port ids on a board node.
 *
 * A board is an ordinary ng-diagram node, so "a wire lands on hole L2-C5" is
 * expressed the only way the engine understands: an edge whose `target` is the
 * board node and whose `targetPort` is a port id. Encoding the hole address
 * into the id (rather than keeping a side table) means the association is
 * carried by the edge itself - so it round-trips through save/reload for free,
 * with no extra field to keep in sync.
 *
 * Two shapes exist:
 *   `hole:<row>:<col>`  a single hole
 *   `trace:<traceId>`   the whole trilha, anchored on its first hole
 */

export const HOLE_PORT_PREFIX = 'hole:';
export const TRACE_PORT_PREFIX = 'trace:';

export function holePortId(hole: BoardHole): string {
  return `${HOLE_PORT_PREFIX}${hole.row}:${hole.col}`;
}

export function tracePortId(traceId: string): string {
  return `${TRACE_PORT_PREFIX}${traceId}`;
}

export function isHolePortId(portId: string): boolean {
  return portId.startsWith(HOLE_PORT_PREFIX);
}

export function isTracePortId(portId: string): boolean {
  return portId.startsWith(TRACE_PORT_PREFIX);
}

export function isBoardPortId(portId: string): boolean {
  return isHolePortId(portId) || isTracePortId(portId);
}

/** Parses `hole:<row>:<col>` back into an address. Returns null for anything else. */
export function parseHolePortId(portId: string): BoardHole | null {
  if (!isHolePortId(portId)) return null;
  const match = /^(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(portId.slice(HOLE_PORT_PREFIX.length));
  if (!match) return null;
  const row = Number(match[1]);
  const col = Number(match[2]);
  if (!Number.isSafeInteger(row) || !Number.isSafeInteger(col)) return null;
  return { row, col };
}

/** Parses `trace:<traceId>` back into the trace id. Returns null for anything else. */
export function parseTracePortId(portId: string): string | null {
  if (!isTracePortId(portId)) return null;
  const traceId = portId.slice(TRACE_PORT_PREFIX.length);
  return traceId.length > 0 ? traceId : null;
}

/**
 * Prefix of the junction id a board port takes in the canonical project.
 *
 * A hole (or a trace) that a conductor lands on *is* an electrical junction:
 * one point where conductors meet. Format v2 stores it as one, and the
 * layout entry records which board port it is drawn as
 * (`CanonicalJunctionLayout.boardPort`). The prefix keeps these ids from ever
 * colliding with a user-visible node id, and makes them recognizable in a
 * saved file.
 */
export const BOARD_COPPER_JUNCTION_PREFIX = 'copper:';

export function boardCopperJunctionId(boardId: string, portId: string): string {
  return `${BOARD_COPPER_JUNCTION_PREFIX}${encodeURIComponent(boardId)}/${encodeURIComponent(portId)}`;
}

export function isBoardCopperJunctionId(junctionId: string): boolean {
  return junctionId.startsWith(BOARD_COPPER_JUNCTION_PREFIX);
}

/** Deterministic id for the hidden conductor that solders one pin to a board hole. */
export const PHYSICAL_BINDING_CONDUCTOR_PREFIX = 'binding:';

export function physicalBindingConductorId(componentId: string, pinId: string): string {
  return `${PHYSICAL_BINDING_CONDUCTOR_PREFIX}${encodeURIComponent(componentId)}/${encodeURIComponent(pinId)}`;
}

export function isPhysicalBindingConductorId(conductorId: string): boolean {
  return conductorId.startsWith(PHYSICAL_BINDING_CONDUCTOR_PREFIX);
}

/**
 * Human-facing address of one hole.
 *
 * Default form is the 1-indexed `L<row>-C<col>` the hardware notes use. When
 * the board names its rows (`BoardNodeData.rowLabels`), the printed address
 * wins: a one-letter row reads `J10`, a longer name keeps a separator so it
 * cannot be misread as one token (`top+:12`) - the same two shapes a
 * solderless breadboard is labeled with. Addresses themselves never change;
 * only how they are written.
 */
export function boardHoleLabel(hole: BoardHole, rowLabels?: readonly string[]): string {
  const rowLabel = rowLabels?.[hole.row];
  if (!rowLabel) return `L${hole.row + 1}-C${hole.col + 1}`;
  return `${rowLabel}${rowLabel.length === 1 ? '' : ':'}${hole.col + 1}`;
}

/**
 * Human-facing name of a board port, 1-indexed the way the hardware notes are
 * (`L1-C2`, or the board's own row labels). Falls back to the raw port id for
 * anything unrecognized so an unexpected value is still visible rather than
 * blank.
 */
export function boardPortLabel(
  portId: string,
  traceLabel?: string,
  rowLabels?: readonly string[],
): string {
  const hole = parseHolePortId(portId);
  if (hole) {
    const address = boardHoleLabel(hole, rowLabels);
    return traceLabel ? `${address} (${traceLabel})` : address;
  }
  const traceId = parseTracePortId(portId);
  if (traceId) return traceLabel ?? traceId;
  return portId;
}

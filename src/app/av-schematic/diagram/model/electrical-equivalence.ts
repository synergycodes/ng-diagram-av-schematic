import {
  endpointKey,
  type CanonicalCable,
  type CanonicalElectrical,
  type CanonicalNetEndpoint,
} from './canonical-project';
import { type PreservedFields, type PreservedValue } from './interfaces';
import { canonicalColorValue } from './wire-colors';

/**
 * Order-independent electrical fingerprint of a project.
 *
 * A WireViz round-trip is not expected to reproduce the original YAML byte
 * for byte -- connection sets come back in a different order, quoting differs,
 * a comment is gone. Comparing text would therefore test the serializer's
 * formatting rather than whether the circuit survived. This module reduces a
 * project to what is electrically true about it, with every collection sorted
 * by a stable key, so two snapshots compare equal exactly when they describe
 * the same circuit.
 *
 * Deliberately excluded, and why:
 *
 *   - **conductor ids** -- regenerated on import; identity comes from the pair
 *     of endpoints and the wire, not from a name;
 *   - **net ids and names** -- derived labels with no WireViz counterpart;
 *   - **junction kind** -- rail versus junction is visual; both are one
 *     electrical point and WireViz writes both as a one-pin connector;
 *   - **pin direction, connectorType, category, location** -- editor fields a
 *     WireViz document never carried, so demanding them back would make the
 *     comparison fail for a reason that has nothing to do with the circuit;
 *   - **everything in the project's `layout` section** -- geometry, by
 *     definition not electrical.
 *
 * Everything a WireViz document *can* express is included, so losing a
 * gauge, a length, a note, a color, a connector subtype or a preserved
 * unknown field fails the comparison.
 */
export interface ElectricalSnapshot {
  components: SnapshotComponent[];
  junctions: SnapshotJunction[];
  /** Full cable inventory, including disconnected cables and unused slots. */
  cables: SnapshotCable[];
  nets: SnapshotNet[];
}

export interface SnapshotCable {
  id: string;
  wireCount: number;
  colors: string[];
  wireLabels?: string[];
  gauge?: string;
  length?: string;
  notes?: string;
  type?: string;
  manufacturer?: string;
  mpn?: string;
  colorCode?: string;
  extras?: PreservedValue;
}

export interface SnapshotComponent {
  id: string;
  wirevizName?: string;
  wirevizType?: string;
  wirevizSubtype?: string;
  wirevizColor?: string;
  wirevizManufacturer?: string;
  wirevizMpn?: string;
  wirevizStyle?: string;
  wirevizShowName?: boolean;
  notes?: string;
  extras?: PreservedValue;
  pins: {
    id: string;
    label: string;
    wirevizDesignator?: string;
    wirevizLabel?: string;
  }[];
}

export interface SnapshotJunction {
  id: string;
  wirevizName?: string;
  wirevizType?: string;
  wirevizSubtype?: string;
  wirevizColor?: string;
  wirevizManufacturer?: string;
  wirevizMpn?: string;
  wirevizStyle?: string;
  wirevizShowName?: boolean;
  notes?: string;
  extras?: PreservedValue;
}

export interface SnapshotConductor {
  /** The two endpoint keys, sorted -- a conductor has no direction. */
  endpoints: [string, string];
  cable?: string;
  wireIndex?: number;
  wirevizLink?: string;
  wirevizLoop?: boolean;
  wireType?: string;
  color?: string;
  gauge?: string;
  length?: string;
  notes?: string;
  cableType?: string;
  manufacturer?: string;
  mpn?: string;
  colorCode?: string;
  cableExtras?: PreservedValue;
}

export interface SnapshotNet {
  endpoints: string[];
  conductors: SnapshotConductor[];
}

export function toElectricalSnapshot(electrical: CanonicalElectrical): ElectricalSnapshot {
  const cables = new Map(electrical.cables.map((cable) => [cable.name, cable]));

  const components = electrical.components
    .map((component) => ({
      id: component.id,
      wirevizName: component.wirevizName,
      wirevizType: component.wirevizType,
      wirevizSubtype: component.wirevizSubtype,
      wirevizColor: component.wirevizColor,
      wirevizManufacturer: component.wirevizManufacturer,
      wirevizMpn: component.wirevizMpn,
      wirevizStyle: component.wirevizStyle,
      wirevizShowName: component.wirevizShowName,
      notes: component.notes,
      extras: normalizeExtras(component.wirevizExtras),
      pins: component.pins
        .map((pin) => ({
          id: pin.id,
          label: pin.label,
          wirevizDesignator: pin.wirevizDesignator,
          wirevizLabel: pin.wirevizLabel,
        }))
        .sort(by((pin) => pin.id)),
    }))
    .sort(by((component) => component.id));

  const junctions = electrical.junctions
    .map((junction) => ({
      id: junction.id,
      wirevizName: junction.wirevizName,
      wirevizType: junction.wirevizType,
      wirevizSubtype: junction.wirevizSubtype,
      wirevizColor: junction.wirevizColor,
      wirevizManufacturer: junction.wirevizManufacturer,
      wirevizMpn: junction.wirevizMpn,
      wirevizStyle: junction.wirevizStyle,
      wirevizShowName: junction.wirevizShowName,
      notes: junction.notes,
      extras: normalizeExtras(junction.wirevizExtras),
    }))
    .sort(by((junction) => junction.id));

  const cableSnapshots: SnapshotCable[] = electrical.cables
    .map((cable) => ({
      id: cable.name,
      wireCount: cable.wireCount,
      colors: Array.from({ length: cable.wireCount }, (_, index) => cable.colors[index] ?? ''),
      wireLabels: cable.wireLabels
        ? Array.from({ length: cable.wireCount }, (_, index) => cable.wireLabels?.[index] ?? '')
        : undefined,
      gauge: cable.gauge,
      length: cable.length,
      notes: cable.notes,
      type: cable.type,
      manufacturer: cable.manufacturer,
      mpn: cable.mpn,
      colorCode: cable.colorCode,
      extras: normalizeExtras(cable.wirevizExtras),
    }))
    .sort(by((cable) => cable.id));

  const nets = electrical.nets
    .map((net) => ({
      endpoints: net.endpoints.map(endpointKey).sort(),
      conductors: net.conductors
        .map((conductor) =>
          toSnapshotConductor(
            conductor.from,
            conductor.to,
            conductor.cable,
            conductor.wirevizLink,
            conductor.wirevizLoop,
            conductor.wireType,
            conductor.color,
            conductor.colorCode,
            conductor.gauge,
            conductor.length,
            conductor.notes,
            cables,
          ),
        )
        .sort(by(conductorSortKey)),
    }))
    .sort(by((net) => net.endpoints.join('|')));

  return { components, junctions, cables: cableSnapshots, nets };
}

function toSnapshotConductor(
  from: CanonicalNetEndpoint,
  to: CanonicalNetEndpoint,
  cableRef: { name: string; wireIndex: number } | undefined,
  wirevizLink: string | undefined,
  wirevizLoop: boolean | undefined,
  wireType: string | undefined,
  color: string | undefined,
  conductorColorCode: string | undefined,
  gauge: string | undefined,
  length: string | undefined,
  notes: string | undefined,
  cables: ReadonlyMap<string, CanonicalCable>,
): SnapshotConductor {
  const fromKey = endpointKey(from);
  const toKey = endpointKey(to);
  const endpoints = [fromKey, toKey].sort() as [string, string];
  const cable = cableRef ? cables.get(cableRef.name) : undefined;

  return {
    endpoints,
    cable: cableRef?.name,
    wireIndex: cableRef?.wireIndex,
    wirevizLink: cableRef
      ? undefined
      : normalizeLinkDirection(wirevizLink ?? '--', fromKey <= toKey),
    wirevizLoop: wirevizLoop === true ? true : undefined,
    wireType,
    // An empty color slot and an absent one mean the same thing ("no color"),
    // so they must not read as a difference.
    color: emptyToUndefined(
      canonicalColorValue({ color, colorCode: conductorColorCode }) ??
        cable?.colors[(cableRef?.wireIndex ?? 1) - 1],
    ),
    gauge: gauge ?? cable?.gauge,
    length: length ?? cable?.length,
    notes: notes ?? cable?.notes,
    cableType: cable?.type,
    manufacturer: cable?.manufacturer,
    mpn: cable?.mpn,
    colorCode: cable?.colorCode,
    cableExtras: normalizeExtras(cable?.wirevizExtras),
  };
}

function normalizeLinkDirection(link: string, followsSortedEndpoints: boolean): string {
  if (followsSortedEndpoints) return link;
  if (link === '-->') return '<--';
  if (link === '<--') return '-->';
  return link;
}

function conductorSortKey(conductor: SnapshotConductor): string {
  return stable(conductor);
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === '') return undefined;
  return value;
}

function by<T>(key: (value: T) => string): (a: T, b: T) => number {
  return (a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
}

/** Recursively sorts object keys, so two equal bags compare equal whatever order they were built in. */
function normalizeExtras(extras: PreservedFields | undefined): PreservedValue | undefined {
  if (!extras || Object.keys(extras).length === 0) return undefined;
  return normalizeValue(extras);
}

function normalizeValue(value: PreservedValue): PreservedValue {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, PreservedValue> = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = normalizeValue(value[key]);
    }
    return result;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export function electricallyEquivalent(a: CanonicalElectrical, b: CanonicalElectrical): boolean {
  return snapshotsEqual(toElectricalSnapshot(a), toElectricalSnapshot(b));
}

export function snapshotsEqual(a: ElectricalSnapshot, b: ElectricalSnapshot): boolean {
  return stable(a) === stable(b);
}

/**
 * Human-readable differences, most useful line first. Empty means the two
 * projects are electrically the same circuit.
 */
export function diffSnapshots(a: ElectricalSnapshot, b: ElectricalSnapshot): string[] {
  const differences: string[] = [];

  differences.push(...diffById('component', a.components, b.components));
  differences.push(...diffById('junction', a.junctions, b.junctions));
  differences.push(...diffById('cable', a.cables, b.cables));

  const netsA = new Map(a.nets.map((net) => [net.endpoints.join('|'), net]));
  const netsB = new Map(b.nets.map((net) => [net.endpoints.join('|'), net]));

  for (const [key, net] of netsA) {
    const other = netsB.get(key);
    if (!other) {
      differences.push(`net missing on the right: {${key}} (${net.conductors.length} conductors)`);
      continue;
    }
    if (stable(net) !== stable(other)) {
      differences.push(`net {${key}} differs: ${stable(net)} != ${stable(other)}`);
    }
  }
  for (const key of netsB.keys()) {
    if (!netsA.has(key)) differences.push(`net missing on the left: {${key}}`);
  }

  return differences;
}

function diffById<T extends { id: string }>(kind: string, a: T[], b: T[]): string[] {
  const differences: string[] = [];
  const byIdB = new Map(b.map((item) => [item.id, item]));

  for (const item of a) {
    const other = byIdB.get(item.id);
    if (!other) {
      differences.push(`${kind} missing on the right: "${item.id}"`);
      continue;
    }
    if (stable(item) !== stable(other)) {
      differences.push(`${kind} "${item.id}" differs: ${stable(item)} != ${stable(other)}`);
    }
  }
  const byIdA = new Set(a.map((item) => item.id));
  for (const item of b) {
    if (!byIdA.has(item.id)) differences.push(`${kind} missing on the left: "${item.id}"`);
  }

  return differences;
}

/**
 * `JSON.stringify` with keys sorted at every level, so an `undefined` field
 * and an absent one compare equal and property order never matters.
 */
function stable(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, inner: unknown) => {
    if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) return inner;
    const record = inner as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] !== undefined) sorted[key] = record[key];
    }
    return sorted;
  });
  if (serialized === undefined) {
    throw new Error('cannot serialize an electrical snapshot');
  }
  return serialized;
}

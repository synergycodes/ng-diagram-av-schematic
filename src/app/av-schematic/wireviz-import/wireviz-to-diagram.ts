import {
  buildNets,
  endpointKey,
  stableIdFragment,
  type CanonicalCable,
  type CanonicalComponent,
  type CanonicalConductor,
  type CanonicalElectrical,
  type CanonicalJunction,
  type CanonicalNetEndpoint,
  type CanonicalPin,
} from '../diagram/model/canonical-project';
import { conductorDegreeByEndpoint } from '../diagram/model/net-grouping';
import { type PortDirection } from '../diagram/model/interfaces';
import { resolveWireColor } from '../diagram/model/wire-colors';
import {
  WireVizReportBuilder,
  type WireVizCompatibilityReport,
  type WireVizReportEntry,
} from './wireviz-report';
import { type WireVizConnector, type WireVizDocument, type WireVizPinRef } from './wireviz-model';

/**
 * Maps a WireViz connector name to the id of the project element that
 * represents it. Without an entry, the connector is materialized as a new
 * element whose id is derived from its name -- the importer never guesses an
 * existing node from a similar-looking name.
 */
export type WireVizPlacement = Readonly<Record<string, string>>;

export class WireVizImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WireVizImportError';
  }
}

export interface WireVizImportOptions {
  placement?: WireVizPlacement;
  /**
   * Components already in the project. A connector placed onto one of these
   * keeps that component's own pin ids, labels, directions and metadata --
   * importing a net must not rewrite the device it lands on.
   */
  components?: readonly CanonicalComponent[];
  junctions?: readonly CanonicalJunction[];
}

export interface WireVizImportResult {
  electrical: CanonicalElectrical;
  /** The document's own report plus everything this conversion observed. */
  report: WireVizCompatibilityReport;
}

/**
 * Turns a parsed WireViz document into the electrical section of a canonical
 * project: components (or junctions) for its connectors, cables, and nets
 * derived from connectivity.
 *
 * Multi-drop falls out of the last step rather than being special-cased: a
 * pin referenced by several connection sets simply ends up shared by several
 * conductors, and `buildNets` puts every conductor that touches it in one
 * net. That is why the same pin appearing twice is a fan-out here and not a
 * port collision.
 *
 * Only the electrical half is produced. Geometry -- where these nodes sit,
 * which board hole a pin occupies, how a wire is routed -- is the caller's to
 * supply, because WireViz has no vocabulary for it.
 */
export function wirevizToElectrical(
  doc: WireVizDocument,
  options: WireVizImportOptions = {},
): WireVizImportResult {
  const report = new WireVizReportBuilder();
  for (const entry of doc.report.entries) replay(report, entry);

  const existingComponents = new Map((options.components ?? []).map((c) => [c.id, c]));
  const existingJunctions = new Map((options.junctions ?? []).map((j) => [j.id, j]));

  const targets = resolveTargets(
    doc,
    options.placement ?? {},
    existingComponents,
    existingJunctions,
  );

  const components: CanonicalComponent[] = [];
  const junctions: CanonicalJunction[] = [];
  for (const connector of doc.connectors) {
    const target = targets.get(connector.name);
    if (!target) continue;
    if (target.kind === 'junction') {
      junctions.push(buildJunction(connector, target.id, existingJunctions.get(target.id)));
    } else {
      components.push(buildComponent(connector, target.id, existingComponents.get(target.id)));
    }
  }

  const cables: CanonicalCable[] = doc.cables.map((cable) => ({
    name: cable.name,
    wireCount: cable.wireCount,
    colors: [...cable.colors],
    wireLabels: cable.wireLabels ? [...cable.wireLabels] : undefined,
    gauge: cable.gauge,
    length: cable.length,
    notes: cable.notes,
    type: cable.type,
    manufacturer: cable.manufacturer,
    mpn: cable.mpn,
    colorCode: cable.colorCode,
    wirevizExtras: Object.keys(cable.extras).length > 0 ? cable.extras : undefined,
  }));
  const cablesByName = new Map(cables.map((cable) => [cable.name, cable]));

  const componentsById = new Map(components.map((c) => [c.id, c]));
  const conductors = doc.conductors.map((conductor) => {
    const from = toEndpoint(conductor.from, targets, componentsById);
    const to = toEndpoint(conductor.to, targets, componentsById);
    const cable = conductor.wire ? cablesByName.get(conductor.wire.cable) : undefined;
    const color = resolveWireColor(cable?.colors[(conductor.wire?.wireIndex ?? 1) - 1]);
    return {
      id: conductorId(from, to, conductor.wire, conductor.link, conductor.kind === 'loop'),
      from,
      to,
      cable: conductor.wire
        ? { name: conductor.wire.cable, wireIndex: conductor.wire.wireIndex }
        : undefined,
      color: color.color,
      colorCode: color.colorCode,
      gauge: cable?.gauge,
      length: cable?.length,
      notes: cable?.notes,
      wirevizLink: conductor.link,
      wirevizLoop: conductor.kind === 'loop' ? true : undefined,
    } satisfies CanonicalConductor;
  });

  assertUniqueConductorIds(conductors);

  const nets = buildNets(conductors);
  reportTopology(nets, report);

  return {
    electrical: {
      components: [...components].sort(byId),
      junctions: [...junctions].sort(byId),
      cables: cables.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
      nets,
    },
    report: report.build(),
  };
}

function replay(report: WireVizReportBuilder, entry: WireVizReportEntry): void {
  report.add(entry.severity, entry.code, entry.path, entry.message);
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Connector -> component / junction
// ---------------------------------------------------------------------------

interface Target {
  id: string;
  kind: 'component' | 'junction';
}

function resolveTargets(
  doc: WireVizDocument,
  placement: WireVizPlacement,
  existingComponents: ReadonlyMap<string, CanonicalComponent>,
  existingJunctions: ReadonlyMap<string, CanonicalJunction>,
): Map<string, Target> {
  const targets = new Map<string, Target>();
  const claimed = new Map<string, string>();
  const baseCounts = new Map<string, number>();

  for (const connector of doc.connectors) {
    if (placement[connector.name] !== undefined) continue;
    const base = slugId(connector.name);
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
  }

  for (const connector of doc.connectors) {
    const base = slugId(connector.name);
    const id =
      placement[connector.name] ??
      (baseCounts.get(base) === 1 ? base : `${base}-${stableIdFragment(connector.name)}`);

    const owner = claimed.get(id);
    if (owner !== undefined) {
      throw new WireVizImportError(
        `WireViz connectors "${owner}" and "${connector.name}" both resolve to element id "${id}"`,
      );
    }
    claimed.set(id, connector.name);

    if (existingJunctions.has(id) && !connector.isJunction) {
      throw new WireVizImportError(
        `WireViz connector "${connector.name}" cannot be placed on junction "${id}": ` +
          'only a one-pin style: simple connector can represent one electrical point',
      );
    }

    // An explicit placement onto an element the project already has wins over
    // the document's own idea of what the connector is: the project knows
    // whether that node is a device or a junction, the YAML only hints.
    const kind: Target['kind'] = existingJunctions.has(id)
      ? 'junction'
      : existingComponents.has(id)
        ? 'component'
        : connector.isJunction
          ? 'junction'
          : 'component';

    targets.set(connector.name, { id, kind });
  }

  return targets;
}

/**
 * A junction is a single electrical point. The document parser only marks a
 * one-pin `style: simple` connector as a junction; a multi-pin connector is
 * kept as a component because collapsing its distinct pins would create a
 * short circuit that the YAML never declared. Rail-versus-junction is a
 * visual project choice and therefore comes only from an existing element.
 */
function buildJunction(
  connector: WireVizConnector,
  id: string,
  existing: CanonicalJunction | undefined,
): CanonicalJunction {
  return {
    id,
    label: existing?.label ?? connector.name,
    kind: existing?.kind ?? 'junction',
    notes: connector.notes ?? existing?.notes,
    wirevizName: connector.name,
    wirevizType: connector.type ?? existing?.wirevizType,
    wirevizSubtype: connector.subtype ?? existing?.wirevizSubtype,
    wirevizColor: connector.color ?? existing?.wirevizColor,
    wirevizManufacturer: connector.manufacturer ?? existing?.wirevizManufacturer,
    wirevizMpn: connector.mpn ?? existing?.wirevizMpn,
    wirevizStyle: connector.style ?? existing?.wirevizStyle,
    wirevizShowName: connector.showName ?? existing?.wirevizShowName,
    wirevizExtras:
      Object.keys(connector.extras).length > 0 ? connector.extras : existing?.wirevizExtras,
  };
}

/**
 * Synthesized pins default to `output` because a WireViz document says
 * nothing about signal direction -- it is a wiring description, not a
 * schematic. A connector placed onto an existing component keeps that
 * component's directions untouched.
 */
const SYNTHESIZED_PIN_DIRECTION: PortDirection = 'output';

function buildComponent(
  connector: WireVizConnector,
  id: string,
  existing: CanonicalComponent | undefined,
): CanonicalComponent {
  const pins: CanonicalPin[] = existing ? existing.pins.map((pin) => ({ ...pin })) : [];
  const matchablePins = [...pins];
  const known = new Set(pins.map((pin) => pin.id));
  const claimed = new Map<string, string>();

  connector.pins.forEach((designator, index) => {
    const pinLabel = connector.pinLabels?.[index];
    const matched = findPlacedPin(
      matchablePins,
      designator,
      pinLabel,
      `connector "${connector.name}" pin "${designator}"`,
    );
    if (matched) {
      const owner = claimed.get(matched.id);
      if (owner !== undefined) {
        throw new WireVizImportError(
          `connector "${connector.name}": WireViz pins "${owner}" and "${designator}" ` +
            `both resolve to local pin "${matched.id}"`,
        );
      }
      claimed.set(matched.id, designator);
      const matchedIndex = pins.indexOf(matched);
      const generatedLocalAlias =
        matched.wirevizDesignator === undefined &&
        (designator === matched.id || designator === matched.label) &&
        (pinLabel === undefined || pinLabel === matched.label);
      const generatedRedundantLabel =
        matched.wirevizDesignator === designator &&
        matched.wirevizLabel === undefined &&
        pinLabel === matched.label;
      pins[matchedIndex] = {
        ...matched,
        wirevizDesignator: generatedLocalAlias ? undefined : designator,
        wirevizLabel: generatedLocalAlias || generatedRedundantLabel ? undefined : pinLabel,
      };
      return;
    }
    const pinId = uniquePinId(slugId(designator), known);
    known.add(pinId);
    pins.push({
      id: pinId,
      label: pinLabel ?? designator,
      direction: SYNTHESIZED_PIN_DIRECTION,
      wirevizDesignator: designator,
      wirevizLabel: pinLabel,
    });
  });

  return {
    id,
    deviceId: existing?.deviceId ?? connector.name,
    manufacturer: existing?.manufacturer ?? connector.manufacturer ?? '',
    model: existing?.model ?? connector.mpn ?? connector.type ?? '',
    category: existing?.category,
    location: existing?.location,
    wirevizName: connector.name,
    wirevizType: connector.type ?? existing?.wirevizType,
    wirevizSubtype: connector.subtype ?? existing?.wirevizSubtype,
    wirevizColor: connector.color ?? existing?.wirevizColor,
    wirevizManufacturer: connector.manufacturer ?? existing?.wirevizManufacturer,
    wirevizMpn: connector.mpn ?? existing?.wirevizMpn,
    wirevizStyle: connector.style ?? existing?.wirevizStyle,
    wirevizShowName: connector.showName ?? existing?.wirevizShowName,
    notes: connector.notes ?? existing?.notes,
    wirevizExtras:
      Object.keys(connector.extras).length > 0 ? connector.extras : existing?.wirevizExtras,
    pins,
  };
}

/**
 * A preserved WireViz designator wins on reimport. On first placement, the
 * positional pinlabel and the designator must resolve to one unambiguous
 * local pin; disagreeing aliases are a collision, never a reason to pick one
 * silently or synthesize a duplicate pin.
 */
function findPlacedPin(
  pins: readonly CanonicalPin[],
  designator: string,
  pinLabel: string | undefined,
  label: string,
): CanonicalPin | undefined {
  const preserved = uniqueAliasMatch(
    pins,
    (pin) => pin.wirevizDesignator === designator,
    designator,
    `${label} preserved WireViz designator`,
  );
  if (preserved) return preserved;

  const positional = pinLabel
    ? uniqueAliasMatch(
        pins,
        (pin) => pin.label === pinLabel || pin.id === pinLabel,
        pinLabel,
        `${label} positional pinlabel`,
      )
    : undefined;
  const localDesignator = uniqueAliasMatch(
    pins,
    (pin) => pin.label === designator || pin.id === designator,
    designator,
    `${label} designator`,
  );

  if (positional && localDesignator && positional.id !== localDesignator.id) {
    throw new WireVizImportError(
      `${label}: positional pinlabel "${pinLabel}" resolves to local pin "${positional.id}", ` +
        `but designator "${designator}" resolves to "${localDesignator.id}"`,
    );
  }
  return positional ?? localDesignator;
}

function uniqueAliasMatch(
  pins: readonly CanonicalPin[],
  predicate: (pin: CanonicalPin) => boolean,
  alias: string,
  label: string,
): CanonicalPin | undefined {
  const matches = pins.filter(predicate);
  if (matches.length > 1) {
    throw new WireVizImportError(
      `${label} "${alias}" matches multiple local pins (${matches.map((pin) => pin.id).join(', ')})`,
    );
  }
  return matches[0];
}

function findImportedPin(
  pins: readonly CanonicalPin[],
  designator: string,
  label: string,
): CanonicalPin | undefined {
  return findPlacedPin(pins, designator, undefined, label);
}

function uniquePinId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// ---------------------------------------------------------------------------
// Conductors
// ---------------------------------------------------------------------------

function toEndpoint(
  ref: WireVizPinRef,
  targets: ReadonlyMap<string, Target>,
  componentsById: ReadonlyMap<string, CanonicalComponent>,
): CanonicalNetEndpoint {
  const target = targets.get(ref.connector);
  if (!target) {
    throw new WireVizImportError(`no element resolved for WireViz connector "${ref.connector}"`);
  }
  if (target.kind === 'junction') {
    return { kind: 'junction', junctionId: target.id };
  }

  const component = componentsById.get(target.id);
  const pin = component
    ? findImportedPin(component.pins, ref.pin, `component "${component.id}"`)
    : undefined;
  if (!component || !pin) {
    throw new WireVizImportError(
      `pin "${ref.pin}" of WireViz connector "${ref.connector}" has no matching pin ` +
        `on component "${target.id}"`,
    );
  }
  return { kind: 'pin', componentId: component.id, pinId: pin.id };
}

/**
 * Deterministic, order-independent conductor id: the two endpoint keys
 * sorted, plus the wire or direct-link style it uses. Re-importing the same
 * document -- or a re-exported copy with connection sets in another order --
 * therefore produces the same ids, which is what lets stored geometry keyed
 * by conductor id survive a reimport.
 */
function conductorId(
  from: CanonicalNetEndpoint,
  to: CanonicalNetEndpoint,
  wire: { cable: string; wireIndex: number } | undefined,
  link: string | undefined,
  wirevizLoop: boolean,
): string {
  const fromKey = endpointKey(from);
  const toKey = endpointKey(to);
  const keys = [fromKey, toKey].sort();
  const normalizedLink =
    fromKey <= toKey ? link : link === '-->' ? '<--' : link === '<--' ? '-->' : link;
  const pathPart = wirevizLoop
    ? '--loop'
    : wire
      ? `--c-${stableIdFragment(wire.cable)}-${wire.wireIndex}`
      : `--l-${stableIdFragment(normalizedLink ?? '--')}`;
  return `cond-${stableIdFragment(keys[0])}--${stableIdFragment(keys[1])}${pathPart}`;
}

function assertUniqueConductorIds(conductors: readonly CanonicalConductor[]): void {
  const seen = new Set<string>();
  for (const conductor of conductors) {
    if (seen.has(conductor.id)) {
      throw new WireVizImportError(`two conductors resolve to the same id "${conductor.id}"`);
    }
    seen.add(conductor.id);
  }
}

/**
 * Records what the resulting topology looks like. Multi-drop and fan-out are
 * reported as information, never as problems -- recognizing them as legitimate
 * is the entire point of this slice.
 */
function reportTopology(
  nets: readonly {
    id: string;
    endpoints: readonly CanonicalNetEndpoint[];
    conductors: readonly CanonicalConductor[];
  }[],
  report: WireVizReportBuilder,
): void {
  for (const net of nets) {
    if (net.endpoints.length < 3) continue;

    const degrees = conductorDegreeByEndpoint(
      net.conductors.map((conductor) => ({
        fromKey: endpointKey(conductor.from),
        toKey: endpointKey(conductor.to),
      })),
    );
    const fanouts = [...degrees.entries()]
      .filter(([, degree]) => degree > 1)
      .map(([key]) => key)
      .sort();

    report.info(
      'multidrop-net',
      `nets.${net.id}`,
      `Net multi-drop com ${net.endpoints.length} endpoints e ${net.conductors.length} condutores` +
        (fanouts.length > 0 ? `; pontos de fan-out: ${fanouts.join(', ')}` : ''),
    );
  }
}

function slugId(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'x'
  );
}

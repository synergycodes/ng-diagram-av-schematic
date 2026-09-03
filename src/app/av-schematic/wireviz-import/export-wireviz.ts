import {
  type CanonicalCable,
  type CanonicalComponent,
  type CanonicalConductor,
  type CanonicalElectrical,
  type CanonicalJunction,
  type CanonicalNetEndpoint,
  type CanonicalPin,
} from '../diagram/model/canonical-project';
import { isCssHexColor, isWireVizColorCode, isWireVizRgbColor } from '../diagram/model/wire-colors';
import {
  isDangerousObjectKey,
  WIREVIZ_CABLE_CANONICAL_KEYS,
  WIREVIZ_CONNECTOR_CANONICAL_KEYS,
} from '../diagram/model/wireviz-schema-keys';
import { WireVizReportBuilder, type WireVizCompatibilityReport } from './wireviz-report';
import { stringifyYamlSubset } from './wireviz-yaml-emit';
import { type YamlValue } from './wireviz-yaml';

/**
 * Writes the electrical section of a canonical project back out as a WireViz
 * document.
 *
 * The export reads `electrical` only. It never has to decide what to discard
 * from the geometry side, because geometry lives in the project's other
 * section and was never mixed in -- the one thing it does is say so, once, in
 * the report.
 *
 * Multi-drop needs no special construct: one connection set is emitted per
 * conductor, and a pin shared by several conductors simply appears in
 * several sets. That is exactly the shape the importer reads back as a
 * single net, which is what makes the round-trip closed.
 *
 * Clean-room implementation for this repository -- see docs/license-matrix.md.
 */
export interface WireVizExportResult {
  yaml: string;
  /** The emitted document as a plain value, before serialization. Handy in tests. */
  document: YamlValue;
  report: WireVizCompatibilityReport;
}

export class WireVizExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WireVizExportError';
  }
}

export function exportWireViz(electrical: CanonicalElectrical): WireVizExportResult {
  const report = new WireVizReportBuilder();
  const names = resolveNames(electrical);
  const conductorsByCable = collectConductorsByCable(electrical);

  const connectors: Record<string, YamlValue> = {};
  const designators = new Map<string, Map<string, string>>();
  const loopsByComponent = collectLoops(electrical);

  for (const component of [...electrical.components].sort(byName(names))) {
    const name = requireName(names, component.id);
    const { entry, byPinId } = emitComponent(
      component,
      name,
      loopsByComponent.get(component.id) ?? [],
      report,
    );
    connectors[name] = entry;
    designators.set(component.id, byPinId);
  }

  for (const junction of [...electrical.junctions].sort(byName(names))) {
    const name = requireName(names, junction.id);
    connectors[name] = emitJunction(junction, name, report);
  }

  const cables: Record<string, YamlValue> = {};
  for (const cable of [...electrical.cables].sort((a, b) => compare(a.name, b.name))) {
    const effective = effectiveCableForExport(
      cable,
      conductorsByCable.get(cable.name) ?? [],
      report,
    );
    cables[cable.name] = emitCable(effective, report);
  }

  const connections: YamlValue[] = [];
  const nets = [...electrical.nets].sort((a, b) => compare(a.id, b.id));
  for (const net of nets) {
    for (const conductor of [...net.conductors].sort((a, b) => compare(a.id, b.id))) {
      if (conductor.wireType) {
        report.info(
          'field-not-representable',
          `nets.${net.id}.conductors.${conductor.id}.wireType`,
          `A classificação "${conductor.wireType}" é um campo do editor sem equivalente ` +
            'WireViz; permanece apenas no projeto.',
        );
      }

      if (!conductor.cable) reportDirectLinkInspectionMetadata(net.id, conductor, report);

      if (conductor.wirevizLoop) continue;

      const set: YamlValue[] = [ref(conductor.from, names, designators)];
      if (conductor.cable) {
        set.push({ [conductor.cable.name]: [conductor.cable.wireIndex] });
      } else {
        set.push(conductor.wirevizLink ?? '--');
      }
      set.push(ref(conductor.to, names, designators));
      connections.push(set);
    }
  }

  report.info(
    'field-not-representable',
    'layout',
    'Posições, furos na placa, taps visuais e rotas manuais permanecem apenas no ' +
      'projeto: o YAML WireViz não consegue representá-los.',
  );

  const document: Record<string, YamlValue> = { connectors };
  if (Object.keys(cables).length > 0) document['cables'] = cables;
  if (connections.length > 0) document['connections'] = connections;

  return { yaml: stringifyYamlSubset(document), document, report: report.build() };
}

type ConductorInspectionField = 'gauge' | 'length' | 'notes';

const CONDUCTOR_INSPECTION_FIELDS: readonly ConductorInspectionField[] = [
  'gauge',
  'length',
  'notes',
];

function collectConductorsByCable(
  electrical: CanonicalElectrical,
): Map<string, CanonicalConductor[]> {
  const result = new Map<string, CanonicalConductor[]>();
  for (const net of electrical.nets) {
    for (const conductor of net.conductors) {
      const name = conductor.cable?.name;
      if (!name) continue;
      const conductors = result.get(name) ?? [];
      conductors.push(conductor);
      result.set(name, conductors);
    }
  }
  return result;
}

/**
 * WireViz exposes gauge, length and notes once per cable, while the editor owns
 * them per conductor. Equal values can be emitted losslessly. Divergent values
 * are omitted and reported instead of flattening a multi-drop harness to one
 * arbitrarily selected conductor.
 */
function effectiveCableForExport(
  cable: CanonicalCable,
  conductors: readonly CanonicalConductor[],
  report: WireVizReportBuilder,
): CanonicalCable {
  const effective: CanonicalCable = {
    ...cable,
    colors: [...cable.colors],
    wireLabels: cable.wireLabels ? [...cable.wireLabels] : undefined,
  };

  reconcileConductorColors(effective, conductors, report);

  for (const field of CONDUCTOR_INSPECTION_FIELDS) {
    if (
      conductors.length === 0 ||
      conductors.every((conductor) => conductor[field] === undefined)
    ) {
      continue;
    }
    const first = conductors[0][field];
    if (conductors.every((conductor) => conductor[field] === first)) {
      effective[field] = first;
      continue;
    }

    clearInspectionField(effective, field);
    report.warn(
      'field-not-representable',
      `cables.${cable.name}.${field}`,
      `Os condutores do cabo "${cable.name}" têm valores diferentes para ${field}; ` +
        'o campo foi omitido do YAML e permanece por ligação no projeto.',
    );
  }

  return effective;
}

function clearInspectionField(cable: CanonicalCable, field: ConductorInspectionField): void {
  switch (field) {
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

function reconcileConductorColors(
  cable: CanonicalCable,
  conductors: readonly CanonicalConductor[],
  report: WireVizReportBuilder,
): void {
  const declarations = new Map<number, string[]>();
  for (const conductor of conductors) {
    if (!conductor.cable) continue;
    const hasLocalColor = conductor.color !== undefined || conductor.colorCode !== undefined;
    if (!hasLocalColor) continue;
    const raw = conductor.colorCode ?? conductor.color ?? '';
    let emitted = raw;
    if (conductor.colorCode === undefined && conductor.color !== undefined) {
      if (isWireVizRgbColor(conductor.color)) {
        emitted = conductor.color;
      } else {
        emitted = '';
        report.warn(
          'color-not-representable',
          `cables.${cable.name}.colors[${conductor.cable.wireIndex - 1}]`,
          `A cor personalizada "${conductor.color}" da ligação "${conductor.id}" não pode ` +
            'ser emitida no YAML WireViz; permanece no projeto.',
        );
      }
    }
    const values = declarations.get(conductor.cable.wireIndex) ?? [];
    values.push(emitted);
    declarations.set(conductor.cable.wireIndex, values);
  }

  for (const [wireIndex, values] of declarations) {
    const first = values[0];
    if (values.some((value) => value !== first)) {
      cable.colors[wireIndex - 1] = '';
      report.warn(
        'color-not-representable',
        `cables.${cable.name}.colors[${wireIndex - 1}]`,
        `Mais de uma ligação usa o condutor ${wireIndex} do cabo "${cable.name}" com cores ` +
          'diferentes; a cor foi omitida do YAML e permanece no projeto.',
      );
    } else {
      cable.colors[wireIndex - 1] = first;
    }
  }
}

function reportDirectLinkInspectionMetadata(
  netId: string,
  conductor: CanonicalConductor,
  report: WireVizReportBuilder,
): void {
  if (conductor.color !== undefined || conductor.colorCode !== undefined) {
    report.warn(
      'color-not-representable',
      `nets.${netId}.conductors.${conductor.id}.color`,
      'A ligação direta tem cor no editor, mas WireViz só aceita cores em condutores de cabos; ' +
        'o valor permanece no projeto.',
    );
  }
  for (const field of CONDUCTOR_INSPECTION_FIELDS) {
    if (conductor[field] === undefined) continue;
    report.warn(
      'field-not-representable',
      `nets.${netId}.conductors.${conductor.id}.${field}`,
      `O campo ${field} pertence à ligação direta no editor, mas WireViz só o aceita em cabos; ` +
        'o valor permanece no projeto.',
    );
  }
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/**
 * One WireViz connector name per element, stable and unique.
 *
 * A collision is rejected. Renaming would change the preserved WireViz
 * identity and make an export/import cycle electrically non-equivalent.
 */
function resolveNames(electrical: CanonicalElectrical): Map<string, string> {
  const names = new Map<string, string>();
  const taken = new Set<string>();
  for (const cable of electrical.cables) {
    assertSafeMappingName(cable.name, `cables.${cable.name}`);
    if (taken.has(cable.name)) {
      throw new WireVizExportError(`duplicate cable name "${cable.name}"`);
    }
    taken.add(cable.name);
  }

  const claim = (id: string, preferred: string, path: string): void => {
    assertSafeMappingName(preferred, path);
    if (taken.has(preferred)) {
      throw new WireVizExportError(
        `${path}: connector name "${preferred}" collides with another connector or cable`,
      );
    }
    taken.add(preferred);
    names.set(id, preferred);
  };

  for (const component of [...electrical.components].sort((a, b) => compare(a.id, b.id))) {
    claim(
      component.id,
      component.wirevizName ?? component.deviceId ?? component.id,
      `connectors.${component.id}`,
    );
  }
  for (const junction of [...electrical.junctions].sort((a, b) => compare(a.id, b.id))) {
    claim(
      junction.id,
      junction.wirevizName ?? junction.label ?? junction.id,
      `connectors.${junction.id}`,
    );
  }

  return names;
}

function byName(names: ReadonlyMap<string, string>) {
  return (a: { id: string }, b: { id: string }): number =>
    compare(names.get(a.id) ?? a.id, names.get(b.id) ?? b.id);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function requireName(names: ReadonlyMap<string, string>, id: string): string {
  const name = names.get(id);
  if (!name) throw new Error(`no WireViz name for element "${id}"`);
  return name;
}

function assertSafeMappingName(name: string, path: string): void {
  if (isDangerousObjectKey(name)) {
    throw new WireVizExportError(`${path}: dangerous mapping name is not allowed`);
  }
}

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

function emitComponent(
  component: CanonicalComponent,
  name: string,
  loops: readonly [string, string][],
  report: WireVizReportBuilder,
): { entry: YamlValue; byPinId: Map<string, string> } {
  if (component.pins.length === 0) {
    throw new WireVizExportError(`connectors.${name}.pins: expected at least one pin`);
  }
  const { pins, remapped } = chooseDesignators(component.pins);
  if (remapped) {
    report.warn(
      'pin-designators-remapped',
      `connectors.${name}.pins`,
      'Os designadores WireViz originais estavam incompletos; os ausentes foram ' +
        'preenchidos com IDs locais sem perder os rótulos em "pinlabels".',
    );
  }

  const entry: Record<string, YamlValue> = {};
  if (component.wirevizType) entry['type'] = component.wirevizType;
  if (component.wirevizSubtype) entry['subtype'] = component.wirevizSubtype;
  if (component.wirevizColor) entry['color'] = component.wirevizColor;
  if (component.wirevizManufacturer) entry['manufacturer'] = component.wirevizManufacturer;
  if (component.wirevizMpn) entry['mpn'] = component.wirevizMpn;
  if (component.wirevizStyle) entry['style'] = component.wirevizStyle;
  if (component.wirevizShowName !== undefined) entry['show_name'] = component.wirevizShowName;
  entry['pins'] = pins.map((pin) => pin.designator);
  const pinLabels = pins.map((pin) => pin.wirevizLabel ?? pin.label);
  if (
    pins.some((pin) => pin.wirevizLabel !== undefined) ||
    pinLabels.some((label, index) => label !== pins[index].designator)
  ) {
    entry['pinlabels'] = pinLabels;
  }
  if (component.notes) entry['notes'] = component.notes;

  const byPinId = new Map(pins.map((pin) => [pin.id, pin.designator]));
  if (loops.length > 0) {
    entry['loops'] = loops.map(([fromPinId, toPinId], index) => {
      const from = byPinId.get(fromPinId);
      const to = byPinId.get(toPinId);
      if (!from || !to) {
        throw new WireVizExportError(
          `connectors.${name}.loops[${index}]: no designator for an internal-loop pin`,
        );
      }
      return [from, to];
    });
    report.info(
      'loop-emitted',
      `connectors.${name}.loops`,
      `${loops.length} ligação(ões) interna(s) reemitida(s) como loops WireViz.`,
    );
  }

  applyExtras(
    entry,
    component.wirevizExtras,
    WIREVIZ_CONNECTOR_CANONICAL_KEYS,
    `connectors.${name}`,
    report,
  );

  return {
    entry,
    byPinId,
  };
}

/**
 * Original WireViz designators win when they remain complete and unique.
 * Otherwise labels are used when possible, then stable generated
 * designators. Positional `pinlabels` are emitted whenever they were explicit
 * in the source or their user-facing value differs from the selected
 * designator.
 */
function chooseDesignators(pins: readonly CanonicalPin[]): {
  pins: {
    id: string;
    label: string;
    wirevizLabel?: string;
    designator: string;
  }[];
  remapped: boolean;
} {
  const original = pins.map((pin) => pin.wirevizDesignator);
  const labels = pins.map((pin) => pin.label);
  const originalDesignators = original.every((designator): designator is string => !!designator)
    ? original
    : undefined;
  const useOriginal =
    originalDesignators !== undefined &&
    aliasesAreUnambiguous(
      originalDesignators,
      pins.map((pin) => pin.wirevizLabel ?? pin.label),
    );
  if (originalDesignators !== undefined && !useOriginal) {
    throw new WireVizExportError(
      'connector pin designators and pinlabels collide or identify more than one pin',
    );
  }
  const effectiveLabels = pins.map((pin) => pin.wirevizLabel ?? pin.label);
  const useLabels =
    labels.every((label) => label.length > 0) &&
    new Set(labels).size === labels.length &&
    aliasesAreUnambiguous(labels, effectiveLabels);
  const designators: string[] =
    originalDesignators !== undefined && useOriginal
      ? originalDesignators
      : useLabels
        ? labels
        : fallbackDesignators(pins);

  if (!aliasesAreUnambiguous(designators, effectiveLabels)) {
    throw new WireVizExportError(
      'generated connector pin designators and pinlabels identify more than one pin',
    );
  }

  return {
    remapped: original.some((designator) => designator !== undefined) && !useOriginal,
    pins: pins.map((pin, index) => ({
      id: pin.id,
      label: pin.label,
      wirevizLabel: pin.wirevizLabel,
      designator: designators[index],
    })),
  };
}

function aliasesAreUnambiguous(designators: readonly string[], labels: readonly string[]): boolean {
  if (new Set(designators).size !== designators.length) return false;
  const owners = new Map<string, Set<number>>();
  const claim = (value: string, index: number): void => {
    if (value === '') return;
    const current = owners.get(value) ?? new Set<number>();
    current.add(index);
    owners.set(value, current);
  };
  designators.forEach(claim);
  labels.forEach(claim);
  return [...owners.values()].every((indices) => indices.size === 1);
}

function fallbackDesignators(pins: readonly CanonicalPin[]): string[] {
  return pins.map((pin) => pin.wirevizDesignator ?? pin.id);
}

/**
 * A junction is written as a one-pin `style: simple` connector -- WireViz's
 * own ferrule/splice form. A rail's extra tap positions are not emitted
 * because they are visual positions rather than distinct named electrical
 * pins. Real multi-pin connector shorts use `loops`; a project rail remains
 * one point and therefore needs only this single pin.
 */
function emitJunction(
  junction: CanonicalJunction,
  name: string,
  report: WireVizReportBuilder,
): YamlValue {
  const entry: Record<string, YamlValue> = { style: 'simple' };
  if (junction.wirevizType) entry['type'] = junction.wirevizType;
  if (junction.wirevizSubtype) entry['subtype'] = junction.wirevizSubtype;
  if (junction.wirevizColor) entry['color'] = junction.wirevizColor;
  if (junction.wirevizManufacturer) entry['manufacturer'] = junction.wirevizManufacturer;
  if (junction.wirevizMpn) entry['mpn'] = junction.wirevizMpn;
  if (junction.wirevizShowName !== undefined) entry['show_name'] = junction.wirevizShowName;
  entry['pins'] = [JUNCTION_PIN];
  if (junction.notes) entry['notes'] = junction.notes;

  applyExtras(
    entry,
    junction.wirevizExtras,
    WIREVIZ_CONNECTOR_CANONICAL_KEYS,
    `connectors.${name}`,
    report,
  );

  report.info(
    'junction-emitted',
    `connectors.${name}`,
    junction.kind === 'rail'
      ? 'Trilho exportado como conector "style: simple" de um pino; as posições ' +
          'visuais de tap são geometria e permanecem no projeto.'
      : 'Junção exportada como conector "style: simple" de um pino.',
  );

  return entry;
}

/** The single pin designator a junction is written with. */
const JUNCTION_PIN = '1';

// ---------------------------------------------------------------------------
// Cables
// ---------------------------------------------------------------------------

function emitCable(cable: CanonicalCable, report: WireVizReportBuilder): YamlValue {
  const entry: Record<string, YamlValue> = { wirecount: cable.wireCount };

  const colors: string[] = [];
  for (let i = 0; i < cable.wireCount; i++) {
    colors.push(emitColor(cable, i, report));
  }
  if (colors.some((color) => color !== '')) entry['colors'] = colors;
  if (cable.wireLabels) entry['wirelabels'] = [...cable.wireLabels];

  if (cable.gauge) entry['gauge'] = cable.gauge;
  if (cable.length) entry['length'] = cable.length;
  if (cable.type) entry['type'] = cable.type;
  if (cable.manufacturer) entry['manufacturer'] = cable.manufacturer;
  if (cable.mpn) entry['mpn'] = cable.mpn;
  if (cable.colorCode) entry['color_code'] = cable.colorCode;
  if (cable.notes) entry['notes'] = cable.notes;

  applyExtras(
    entry,
    cable.wirevizExtras,
    WIREVIZ_CABLE_CANONICAL_KEYS,
    `cables.${cable.name}`,
    report,
  );

  return entry;
}

/**
 * WireViz accepts a quoted, exact six-digit RGB value, so that form is
 * re-emitted byte for byte. Other CSS hex shapes are left out of the YAML and
 * reported -- never swapped for the nearest standard code, because that would
 * quietly change what the document claims the physical wire looks like. The
 * value itself stays in the project.
 */
function emitColor(cable: CanonicalCable, index: number, report: WireVizReportBuilder): string {
  const raw = cable.colors[index];
  if (!raw) return '';

  if (isWireVizColorCode(raw)) return raw.toUpperCase();

  if (isWireVizRgbColor(raw)) return raw;

  if (isCssHexColor(raw) || raw.startsWith('#')) {
    report.warn(
      'color-not-representable',
      `cables.${cable.name}.colors[${index}]`,
      `A cor "${raw}" não tem equivalente WireViz; foi omitida do YAML, sem ` +
        'substituição automática, e permanece no projeto.',
    );
    return '';
  }

  // An abbreviation this codebase does not know is still a WireViz-shaped
  // token: writing it back is more faithful than dropping it.
  return raw;
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

function ref(
  endpoint: CanonicalNetEndpoint,
  names: ReadonlyMap<string, string>,
  designators: ReadonlyMap<string, ReadonlyMap<string, string>>,
): YamlValue {
  if (endpoint.kind === 'junction') {
    const name = names.get(endpoint.junctionId);
    if (!name) throw new Error(`no WireViz name for junction "${endpoint.junctionId}"`);
    return { [name]: [JUNCTION_PIN] };
  }

  const name = names.get(endpoint.componentId);
  const designator = designators.get(endpoint.componentId)?.get(endpoint.pinId);
  if (!name || !designator) {
    throw new Error(
      `no WireViz designator for pin "${endpoint.pinId}" of component "${endpoint.componentId}"`,
    );
  }
  return { [name]: [designator] };
}

// ---------------------------------------------------------------------------
// Preserved fields
// ---------------------------------------------------------------------------

function applyExtras(
  entry: Record<string, YamlValue>,
  extras: Readonly<Record<string, YamlValue>> | undefined,
  reserved: ReadonlySet<string>,
  path: string,
  report: WireVizReportBuilder,
): void {
  if (!extras) return;
  for (const [key, value] of Object.entries(extras)) {
    if (isDangerousObjectKey(key)) {
      throw new WireVizExportError(`${path}.wirevizExtras.${key}: dangerous key is not allowed`);
    }
    if (reserved.has(key) || Object.hasOwn(entry, key)) {
      throw new WireVizExportError(
        `${path}.wirevizExtras.${key}: extras cannot replace a canonical WireViz field`,
      );
    }
    assertSafeExtraValue(value, `${path}.wirevizExtras.${key}`);
    entry[key] = value;
    report.info(
      'unknown-field-reemitted',
      `${path}.${key}`,
      'Campo preservado da importação, reescrito no YAML sem interpretação.',
    );
  }
}

function assertSafeExtraValue(value: YamlValue, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertSafeExtraValue(item, `${path}[${index}]`);
    });
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, nested] of Object.entries(value)) {
    if (isDangerousObjectKey(key)) {
      throw new WireVizExportError(`${path}.${key}: dangerous key is not allowed`);
    }
    assertSafeExtraValue(nested, `${path}.${key}`);
  }
}

function collectLoops(electrical: CanonicalElectrical): Map<string, [string, string][]> {
  const loops = new Map<string, [string, string][]>();
  const seen = new Map<string, Set<string>>();
  for (const net of electrical.nets) {
    for (const conductor of net.conductors) {
      if (!conductor.wirevizLoop) continue;
      if (
        conductor.cable ||
        conductor.wirevizLink ||
        conductor.from.kind !== 'pin' ||
        conductor.to.kind !== 'pin' ||
        conductor.from.componentId !== conductor.to.componentId ||
        conductor.from.pinId === conductor.to.pinId
      ) {
        throw new WireVizExportError(
          `nets.${net.id}.conductors.${conductor.id}: invalid internal WireViz loop`,
        );
      }
      const pins = [conductor.from.pinId, conductor.to.pinId].sort() as [string, string];
      const componentSeen = seen.get(conductor.from.componentId) ?? new Set<string>();
      const key = pins.join('\u0000');
      if (componentSeen.has(key)) {
        throw new WireVizExportError(
          `nets.${net.id}.conductors.${conductor.id}: duplicate internal WireViz loop`,
        );
      }
      componentSeen.add(key);
      seen.set(conductor.from.componentId, componentSeen);
      const componentLoops = loops.get(conductor.from.componentId) ?? [];
      componentLoops.push(pins);
      loops.set(conductor.from.componentId, componentLoops);
    }
  }
  for (const componentLoops of loops.values()) {
    componentLoops.sort(([a1, a2], [b1, b2]) => compare(`${a1}\u0000${a2}`, `${b1}\u0000${b2}`));
  }
  return loops;
}

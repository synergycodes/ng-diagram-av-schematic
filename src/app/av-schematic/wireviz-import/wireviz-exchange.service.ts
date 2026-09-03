import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';
import {
  buildNets,
  CANONICAL_FORMAT_VERSION,
  type CanonicalConductor,
  type CanonicalConductorLayout,
  type CanonicalElectrical,
  type CanonicalJunction,
  type CanonicalJunctionLayout,
  type CanonicalProjectV4,
} from '../diagram/model/canonical-project';
import { OPERATIONAL_LIMITS } from '../diagram/model/operational-limits.mjs';
import { defaultVisualPlane } from '../diagram/model/visual-planes';
import { ProjectStorageService } from '../project-storage/project-storage.service';
import { exportWireViz, type WireVizExportResult } from './export-wireviz';
import {
  MULTIDROP_EXISTING_RAIL,
  MULTIDROP_RAIL_PLACEMENT,
  MULTIDROP_RAIL_WIREVIZ_YAML,
} from './fixtures/multidrop-rail.fixture';
import { importWireViz } from './import-wireviz';
import { type WireVizCompatibilityReport, type WireVizReportEntry } from './wireviz-report';
import { WireVizImportError, type WireVizImportOptions } from './wireviz-to-diagram';

export type WireVizExchangeStatus = 'idle' | 'loading' | 'success' | 'error';

export const WIREVIZ_YAML_DOWNLOAD = new InjectionToken<(yaml: string, filename: string) => void>(
  'WIREVIZ_YAML_DOWNLOAD',
  {
    factory: () => (yaml, filename) => {
      const url = URL.createObjectURL(new Blob([yaml], { type: 'text/yaml;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    },
  },
);

@Injectable()
export class WireVizExchangeService {
  private readonly storage = inject(ProjectStorageService);
  private readonly download = inject(WIREVIZ_YAML_DOWNLOAD);

  private readonly _status = signal<WireVizExchangeStatus>('idle');
  private readonly _message = signal<string | null>(null);
  private readonly _report = signal<WireVizCompatibilityReport>({ entries: [] });

  readonly status = this._status.asReadonly();
  readonly message = this._message.asReadonly();
  readonly report = this._report.asReadonly();
  readonly reportEntries = computed<readonly WireVizReportEntry[]>(() => this._report().entries);
  readonly isBusy = computed(() => this._status() === 'loading');

  async importYaml(yaml: string, options?: WireVizImportOptions): Promise<boolean> {
    this.begin('Importando YAML WireViz...');
    try {
      const current = this.storage.snapshotImportSkeleton();
      const effectiveOptions = options ?? inferImportOptions(current);
      const imported = importWireViz(yaml, effectiveOptions);
      const project = buildImportedProject(imported.electrical, current);
      await this.storage.replaceProject(project);
      this._report.set({
        entries: [
          ...imported.report.entries,
          ...physicalNetReconciliationEntries(imported.electrical, project.electrical),
        ].sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code)),
      });
      this.succeed(
        `YAML importado: ${imported.electrical.nets.length} net(s), ` +
          `${imported.electrical.cables.length} cabo(s).`,
      );
      return true;
    } catch (error) {
      this.fail('import', `Falha ao importar WireViz: ${describeError(error)}`);
      return false;
    }
  }

  async loadMultidropFixture(): Promise<boolean> {
    return this.importYaml(MULTIDROP_RAIL_WIREVIZ_YAML, {
      placement: MULTIDROP_RAIL_PLACEMENT,
      junctions: [MULTIDROP_EXISTING_RAIL],
    });
  }

  exportYaml(): WireVizExportResult | null {
    this.begin('Exportando YAML WireViz...');
    try {
      const project = this.storage.snapshotProject();
      const bindingCount = project.layout.conductors.filter(
        (layout) => layout.physicalBinding,
      ).length;
      const boardJumperCount = project.layout.conductors.filter(
        (layout) => layout.boardJumper,
      ).length;
      const exported = exportWireViz(wireVizElectrical(project));
      const result = withProjectLayoutReport(exported, bindingCount, boardJumperCount);
      this._report.set(result.report);
      this.succeed(`WireViz exportado com ${result.report.entries.length} item(ns) no relatório.`);
      return result;
    } catch (error) {
      this.fail('export', `Falha ao exportar WireViz: ${describeError(error)}`);
      return null;
    }
  }

  downloadYaml(filename = 'wiring.yml'): boolean {
    const result = this.exportYaml();
    if (!result) return false;
    this.download(result.yaml, filename);
    return true;
  }

  private begin(message: string): void {
    this._status.set('loading');
    this._message.set(message);
  }

  private succeed(message: string): void {
    this._status.set('success');
    this._message.set(message);
  }

  private fail(path: 'import' | 'export', message: string): void {
    this._status.set('error');
    this._message.set(message);
    this._report.set({
      entries: [{ severity: 'error', code: 'operation-failed', path, message }],
    });
  }
}

/**
 * Removes generated pin-to-copper bindings before producing WireViz YAML.
 *
 * Those conductors describe soldered placement, not authored wires. Exporting
 * them as ordinary WireViz connections would make the next replacement import
 * duplicate them before `withPhysicalBindings` restores the project-owned
 * associations. A copper junction is retained when a visible conductor still
 * targets it; otherwise it is restored from the import skeleton together with
 * the hidden bindings.
 */
export function wireVizElectrical(project: CanonicalProjectV4): CanonicalElectrical {
  const hiddenConductorIds = new Set(
    project.layout.conductors
      .filter((layout) => layout.physicalBinding)
      .map((layout) => layout.conductorId),
  );
  if (hiddenConductorIds.size === 0) return project.electrical;

  const conductors: CanonicalConductor[] = [];
  const nameHints = new Map<string, string>();
  for (const net of project.electrical.nets) {
    for (const conductor of net.conductors) {
      if (hiddenConductorIds.has(conductor.id)) continue;
      conductors.push(conductor);
      nameHints.set(conductor.id, net.name);
    }
  }

  const referencedJunctionIds = new Set<string>();
  for (const conductor of conductors) {
    if (conductor.from.kind === 'junction') {
      referencedJunctionIds.add(conductor.from.junctionId);
    }
    if (conductor.to.kind === 'junction') {
      referencedJunctionIds.add(conductor.to.junctionId);
    }
  }
  const copperJunctionIds = new Set(
    project.layout.junctions
      .filter((layout) => layout.boardPort !== undefined)
      .map((layout) => layout.junctionId),
  );

  return {
    ...project.electrical,
    junctions: project.electrical.junctions.filter(
      (junction) => !copperJunctionIds.has(junction.id) || referencedJunctionIds.has(junction.id),
    ),
    nets: buildNets(conductors, nameHints),
  };
}

function withProjectLayoutReport(
  result: WireVizExportResult,
  bindingCount: number,
  boardJumperCount: number,
): WireVizExportResult {
  const entries: WireVizReportEntry[] = [];
  if (bindingCount > 0) {
    entries.push({
      severity: 'info',
      code: 'field-not-representable',
      path: 'layout.conductors.physicalBinding',
      message:
        `${bindingCount} associação(ões) física(s) entre pino e cobre permanecem apenas ` +
        'no projeto e serão restauradas em uma reimportação de substituição.',
    });
  }
  if (boardJumperCount > 0) {
    entries.push({
      severity: 'info',
      code: 'field-not-representable',
      path: 'layout.conductors.boardJumper',
      message:
        `${boardJumperCount} jumper(s) são exportados como condutores elétricos normais; ` +
        'a placa proprietária e as dobras locais permanecem apenas no projeto.',
    });
  }
  if (entries.length === 0) return result;
  return {
    ...result,
    report: {
      entries: [...result.report.entries, ...entries].sort(
        (a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code),
      ),
    },
  };
}

/**
 * Reuses only the identity/placement skeleton of the live project. WireViz
 * metadata always comes from the new import, so a previous snapshot cannot
 * conceal a lossy export by filling fields back in. `wirevizLabel` is carried
 * only as provenance: the importer still clears it when the incoming YAML
 * omits the positional label, but can avoid promoting a generated redundant
 * label to explicit metadata.
 */
function inferImportOptions(project: CanonicalProjectV4): WireVizImportOptions {
  const placement: Record<string, string> = {};
  for (const component of project.electrical.components) {
    const name = component.wirevizName ?? component.deviceId;
    if (name && placement[name] === undefined) placement[name] = component.id;
  }
  for (const junction of project.electrical.junctions) {
    const name = junction.wirevizName ?? junction.label;
    if (name && placement[name] === undefined) placement[name] = junction.id;
  }

  return {
    placement,
    components: project.electrical.components.map((component) => ({
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
        wirevizDesignator: pin.wirevizDesignator,
        wirevizLabel: pin.wirevizLabel,
      })),
    })),
    junctions: project.electrical.junctions.map((junction) => ({
      id: junction.id,
      label: junction.label,
      kind: junction.kind,
    })),
  };
}

export function buildImportedProject(
  importedElectrical: CanonicalElectrical,
  previous: CanonicalProjectV4,
): CanonicalProjectV4 {
  const electrical = withPhysicalBindings(importedElectrical, previous);
  const previousComponents = new Map(
    previous.layout.components.map((layout) => [layout.componentId, layout]),
  );
  const previousJunctions = new Map(
    previous.layout.junctions.map((layout) => [layout.junctionId, layout]),
  );
  const previousConductors = new Map(
    previous.layout.conductors.map((layout) => [layout.conductorId, layout]),
  );
  const junctionDegree = junctionDegrees(electrical);

  const components = electrical.components.map((component, index) => {
    const existing = previousComponents.get(component.id);
    return (
      existing ?? {
        componentId: component.id,
        position: autoPosition(index, 0),
        visualPlane: defaultVisualPlane('component'),
      }
    );
  });

  const junctions: CanonicalJunctionLayout[] = electrical.junctions.map((junction, index) => {
    const existing = previousJunctions.get(junction.id);
    const taps = expectJunctionTapCount(
      junction.id,
      Math.max(existing?.taps ?? 1, junctionDegree.get(junction.id) ?? 1),
    );
    return existing
      ? { ...existing, taps }
      : {
          junctionId: junction.id,
          position: autoPosition(index, 1),
          visualPlane: defaultVisualPlane('junction'),
          taps,
        };
  });

  const tapCursor = new Map<string, number>();
  const conductors: CanonicalConductorLayout[] = electrical.nets.flatMap((net) =>
    net.conductors.map((conductor) => {
      const existing = previousConductors.get(conductor.id);
      if (existing) return existing;
      return {
        conductorId: conductor.id,
        visualPlane: defaultVisualPlane('conductor'),
        fromTap:
          conductor.from.kind === 'junction'
            ? nextTap(conductor.from.junctionId, tapCursor, junctionDegree)
            : undefined,
        toTap:
          conductor.to.kind === 'junction'
            ? nextTap(conductor.to.junctionId, tapCursor, junctionDegree)
            : undefined,
      };
    }),
  );

  return {
    formatVersion: CANONICAL_FORMAT_VERSION,
    electrical,
    layout: {
      boards: previous.layout.boards,
      components,
      junctions,
      conductors,
    },
  };
}

/**
 * Carries pin-to-copper bindings through a replacement WireViz import.
 *
 * WireViz can describe the imported conductors, but it has no vocabulary for
 * a pin being soldered into a board hole. The import skeleton therefore keeps
 * those generated binding conductors and their copper junctions, then rebuilds
 * the net graph in one pass. Imported names are authored hints and always win;
 * a trace label is only a fallback for a binding-only net.
 */
function withPhysicalBindings(
  imported: CanonicalElectrical,
  previous: CanonicalProjectV4,
): CanonicalElectrical {
  const importedComponents = new Map(
    imported.components.map((component) => [component.id, component]),
  );
  const importedConductorIds = new Set(
    imported.nets.flatMap((net) => net.conductors.map((conductor) => conductor.id)),
  );
  const previousConductorById = new Map<string, CanonicalConductor>();
  const previousNetByConductor = new Map(
    previous.electrical.nets.flatMap((net) =>
      net.conductors.map((conductor) => {
        previousConductorById.set(conductor.id, conductor);
        return [conductor.id, net] as const;
      }),
    ),
  );
  const previousJunctions = new Map(
    previous.electrical.junctions.map((junction) => [junction.id, junction]),
  );

  const bindings: CanonicalConductor[] = [];
  const physicalJunctions = new Map<string, CanonicalJunction>();
  const fallbackNames = new Map<string, string>();
  for (const layout of previous.layout.conductors) {
    if (!layout.physicalBinding) continue;
    const conductor = previousConductorById.get(layout.conductorId);
    if (!conductor) continue;
    const pin =
      conductor.from.kind === 'pin'
        ? conductor.from
        : conductor.to.kind === 'pin'
          ? conductor.to
          : undefined;
    const junction =
      conductor.from.kind === 'junction'
        ? conductor.from
        : conductor.to.kind === 'junction'
          ? conductor.to
          : undefined;
    const component = pin ? importedComponents.get(pin.componentId) : undefined;
    if (!pin || !junction || !component?.pins.some((candidate) => candidate.id === pin.pinId)) {
      continue;
    }
    if (importedConductorIds.has(conductor.id)) {
      throw new WireVizImportError(
        `conductor "${conductor.id}": id reservado para uma associação física pin-cobre`,
      );
    }
    const physicalJunction = previousJunctions.get(junction.junctionId);
    if (!physicalJunction) continue;

    bindings.push(conductor);
    physicalJunctions.set(physicalJunction.id, physicalJunction);
    const previousNet = previousNetByConductor.get(conductor.id);
    if (previousNet && previousNet.name !== previousNet.id) {
      fallbackNames.set(conductor.id, previousNet.name);
    }
  }

  const importedConductors = imported.nets.flatMap((net) => net.conductors);
  const authoredNames = new Map<string, string>();
  for (const net of imported.nets) {
    for (const conductor of net.conductors) authoredNames.set(conductor.id, net.name);
  }
  const conductors = [...importedConductors, ...bindings];
  const junctions = new Map(imported.junctions.map((junction) => [junction.id, junction]));
  for (const junction of physicalJunctions.values()) {
    if (!junctions.has(junction.id)) junctions.set(junction.id, junction);
  }

  return {
    ...imported,
    junctions: [...junctions.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    nets: buildNets(conductors, authoredNames, fallbackNames),
  };
}

/** Actionable import warnings for author names merged by retained copper. */
export function physicalNetReconciliationEntries(
  imported: CanonicalElectrical,
  reconciled: CanonicalElectrical,
): WireVizReportEntry[] {
  const importedNameByConductor = new Map<string, string>();
  for (const net of imported.nets) {
    for (const conductor of net.conductors) {
      importedNameByConductor.set(conductor.id, net.name);
    }
  }

  const entries: WireVizReportEntry[] = [];
  for (const net of reconciled.nets) {
    const importedNames = [
      ...new Set(
        net.conductors
          .map((conductor) => importedNameByConductor.get(conductor.id))
          .filter((name): name is string => name !== undefined),
      ),
    ].sort();
    if (importedNames.length < 2) continue;
    entries.push({
      severity: 'warning',
      code: 'physical-net-reconciled',
      path: `electrical.nets.${net.id}`,
      message:
        `As redes importadas ${importedNames.map((name) => `"${name}"`).join(', ')} ` +
        `compartilham o cobre físico e foram reconciliadas como "${net.name}" por ordem ` +
        'lexical. Revise o encaixe ou a autoria das redes.',
    });
  }
  return entries;
}

function junctionDegrees(electrical: CanonicalElectrical): Map<string, number> {
  const degree = new Map<string, number>();
  const increment = (junctionId: string): void => {
    const taps = expectJunctionTapCount(junctionId, (degree.get(junctionId) ?? 0) + 1);
    degree.set(junctionId, taps);
  };
  for (const net of electrical.nets) {
    for (const conductor of net.conductors) {
      if (conductor.from.kind === 'junction') {
        increment(conductor.from.junctionId);
      }
      if (conductor.to.kind === 'junction') {
        increment(conductor.to.junctionId);
      }
    }
  }
  return degree;
}

function expectJunctionTapCount(junctionId: string, taps: number): number {
  if (!Number.isSafeInteger(taps) || taps < 1 || taps > OPERATIONAL_LIMITS.maxJunctionTaps) {
    throw new WireVizImportError(
      `junction "${junctionId}": junction tap count ${taps} exceeds operational limit of ` +
        `${OPERATIONAL_LIMITS.maxJunctionTaps}`,
    );
  }
  return taps;
}

function nextTap(
  junctionId: string,
  cursor: Map<string, number>,
  degree: ReadonlyMap<string, number>,
): number {
  const current = cursor.get(junctionId) ?? 0;
  cursor.set(junctionId, current + 1);
  return current % Math.max(1, degree.get(junctionId) ?? 1);
}

function autoPosition(index: number, row: number): { x: number; y: number } {
  return { x: 80 + (index % 4) * 260, y: 80 + row * 220 + Math.floor(index / 4) * 160 };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'erro desconhecido';
}

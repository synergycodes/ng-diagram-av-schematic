import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CANONICAL_FORMAT_VERSION,
  type CanonicalComponent,
  type CanonicalConductor,
  type CanonicalElectrical,
  type CanonicalNetEndpoint,
  type CanonicalProjectV2,
} from '../diagram/model/canonical-project';
import {
  basePhysicalProject,
  boardJumperProject,
} from '../diagram/model/canonical-project-corpus.mjs';
import { parseCanonicalProject } from '../diagram/model/canonical-project-parse';
import { electricallyEquivalent } from '../diagram/model/electrical-equivalence';
import { OPERATIONAL_LIMITS } from '../diagram/model/operational-limits.mjs';
import { ProjectStorageService } from '../project-storage/project-storage.service';
import {
  buildImportedProject,
  physicalNetReconciliationEntries,
  WIREVIZ_YAML_DOWNLOAD,
  WireVizExchangeService,
} from './wireviz-exchange.service';

function emptyProject(): CanonicalProjectV2 {
  return {
    formatVersion: CANONICAL_FORMAT_VERSION,
    electrical: { components: [], junctions: [], cables: [], nets: [] },
    layout: { boards: [], components: [], junctions: [], conductors: [] },
  };
}

function junctionFanout(degree: number): CanonicalElectrical {
  const components: CanonicalComponent[] = Array.from({ length: degree }, (_, index) => ({
    id: `load-${index}`,
    deviceId: `LOAD-${index}`,
    manufacturer: '',
    model: '',
    pins: [{ id: 'in', label: 'IN', direction: 'input' }],
  }));
  const junction: CanonicalNetEndpoint = { kind: 'junction', junctionId: 'rail' };
  const conductors: CanonicalConductor[] = components.map((component, index) => ({
    id: `branch-${index}`,
    from: junction,
    to: { kind: 'pin', componentId: component.id, pinId: 'in' },
  }));

  return {
    components,
    junctions: [{ id: 'rail', label: 'Rail', kind: 'rail' }],
    cables: [],
    nets: [
      {
        id: 'net-rail',
        name: '',
        endpoints: [junction, ...conductors.map((conductor) => conductor.to)],
        conductors,
      },
    ],
  };
}

class ProjectStorageStub {
  project = emptyProject();

  readonly snapshotProject = vi.fn(() => structuredClone(this.project));
  readonly snapshotImportSkeleton = vi.fn(() => structuredClone(this.project));
  readonly replaceProject = vi.fn((project: CanonicalProjectV2): Promise<void> => {
    this.project = structuredClone(project);
    return Promise.resolve();
  });
}

describe('WireVizExchangeService', () => {
  let storage: ProjectStorageStub;
  let download: ReturnType<typeof vi.fn>;
  let service: WireVizExchangeService;

  beforeEach(() => {
    storage = new ProjectStorageStub();
    download = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        WireVizExchangeService,
        { provide: ProjectStorageService, useValue: storage },
        { provide: WIREVIZ_YAML_DOWNLOAD, useValue: download },
      ],
    });
    service = TestBed.inject(WireVizExchangeService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('loads the usable multi-drop fixture into the live project', async () => {
    expect(await service.loadMultidropFixture()).toBe(true);

    expect(storage.replaceProject).toHaveBeenCalledOnce();
    expect(storage.project.electrical.nets).toHaveLength(1);
    expect(storage.project.electrical.nets[0].endpoints).toHaveLength(4);
    expect(storage.project.electrical.junctions).toContainEqual(
      expect.objectContaining({ id: 'rail-5v', kind: 'rail' }),
    );
    expect(storage.project.electrical.cables.find((cable) => cable.name === 'SPARE')).toMatchObject(
      {
        wireCount: 2,
        colors: ['#a1b2c3', 'GY'],
        wireLabels: ['unused-a', 'unused-b'],
      },
    );
    expect(service.status()).toBe('success');
    expect(service.reportEntries().length).toBeGreaterThan(0);
  });

  it('exports, downloads and reimports using only the live identity/placement skeleton', async () => {
    await service.loadMultidropFixture();
    const before = structuredClone(storage.project.electrical);
    const exported = service.exportYaml();
    if (!exported) throw new Error('fixture export failed');

    expect(exported.yaml).toContain('wirelabels:');
    expect(exported.yaml).toContain('"#a1b2c3"');
    expect(service.downloadYaml('multidrop.yml')).toBe(true);
    expect(download).toHaveBeenCalledWith(expect.stringContaining('SPARE:'), 'multidrop.yml');

    expect(await service.importYaml(exported.yaml)).toBe(true);
    expect(electricallyEquivalent(before, storage.project.electrical)).toBe(true);
  });

  it('omits hidden pin-to-copper bindings from WireViz and restores them on reimport', async () => {
    storage.project = parseCanonicalProject(basePhysicalProject());
    const before = structuredClone(storage.project.electrical);

    const exported = service.exportYaml();
    if (!exported) throw new Error('physical export failed');
    const document = exported.document as Record<string, unknown>;

    expect(document['connections']).toBeUndefined();
    expect(exported.report.entries).toContainEqual(
      expect.objectContaining({
        code: 'field-not-representable',
        path: 'layout.conductors.physicalBinding',
      }),
    );
    expect(await service.importYaml(exported.yaml)).toBe(true);
    expect(storage.project.electrical.nets).toHaveLength(1);
    expect(storage.project.electrical.nets[0]).toMatchObject({ name: before.nets[0].name });
    expect(
      storage.project.electrical.nets.flatMap((net) =>
        net.conductors.map((conductor) => conductor.id),
      ),
    ).toEqual(['binding:link-1/a', 'binding:link-1/b']);
  });

  it('exports a jumper electrically and reports its board-local geometry separately', () => {
    storage.project = parseCanonicalProject(boardJumperProject());

    const exported = service.exportYaml();
    if (!exported) throw new Error('jumper export failed');

    expect(exported.yaml).toContain('copper:board-17/hole%3A0%3A0');
    expect(exported.yaml).toContain('copper:board-17/hole%3A1%3A2');
    expect(exported.report.entries).toContainEqual(
      expect.objectContaining({
        code: 'field-not-representable',
        path: 'layout.conductors.boardJumper',
      }),
    );
  });

  it('keeps the live project unchanged and exposes a global error report state on invalid YAML', async () => {
    const before = structuredClone(storage.project);

    expect(await service.importYaml('connectors: []\n')).toBe(false);
    expect(storage.replaceProject).not.toHaveBeenCalled();
    expect(storage.project).toEqual(before);
    expect(service.status()).toBe('error');
    expect(service.message()).toContain('Falha ao importar WireViz');
    expect(service.reportEntries()).toEqual([
      expect.objectContaining({ severity: 'error', code: 'operation-failed', path: 'import' }),
    ]);
  });

  it('replaces a project even when its full snapshot is not exportable', async () => {
    storage.snapshotProject.mockImplementation(() => {
      throw new Error('dangling edges are not exportable');
    });

    expect(await service.importYaml('connectors: {}\nconnections: []\n')).toBe(true);
    expect(storage.snapshotImportSkeleton).toHaveBeenCalledOnce();
    expect(storage.snapshotProject).not.toHaveBeenCalled();
    expect(storage.replaceProject).toHaveBeenCalledOnce();
  });
});

describe('buildImportedProject junction taps', () => {
  it.each([
    ['below', OPERATIONAL_LIMITS.maxJunctionTaps - 1, true],
    ['at', OPERATIONAL_LIMITS.maxJunctionTaps, true],
    ['above', OPERATIONAL_LIMITS.maxJunctionTaps + 1, false],
  ] as const)('enforces derived taps %s the boundary', (_label, degree, accepted) => {
    const build = () => buildImportedProject(junctionFanout(degree), emptyProject());
    if (accepted) expect(build().layout.junctions[0].taps).toBe(degree);
    else expect(build).toThrow(/junction tap count.*operational limit/);
  });

  it('keeps physical bindings while an imported net name wins over copper', () => {
    const previous = parseCanonicalProject(basePhysicalProject());
    const imported: CanonicalElectrical = {
      components: [
        ...previous.electrical.components,
        {
          id: 'external',
          deviceId: 'EXT',
          manufacturer: '',
          model: '',
          pins: [{ id: 'out', label: 'OUT', direction: 'output' }],
        },
      ],
      junctions: [],
      cables: [],
      nets: [
        {
          id: 'imported-net',
          name: 'IMPORTED_NAME',
          endpoints: [
            { kind: 'pin', componentId: 'external', pinId: 'out' },
            { kind: 'pin', componentId: 'link-1', pinId: 'a' },
          ],
          conductors: [
            {
              id: 'wire-imported',
              from: { kind: 'pin', componentId: 'external', pinId: 'out' },
              to: { kind: 'pin', componentId: 'link-1', pinId: 'a' },
            },
          ],
        },
      ],
    };

    const parsed = parseCanonicalProject(buildImportedProject(imported, previous));
    expect(parsed.electrical.nets).toHaveLength(1);
    expect(parsed.electrical.nets[0].name).toBe('IMPORTED_NAME');
    expect(parsed.electrical.nets[0].conductors.map((conductor) => conductor.id)).toEqual(
      expect.arrayContaining(['wire-imported', 'binding:link-1/a', 'binding:link-1/b']),
    );
    expect(parsed.layout.conductors.filter((layout) => layout.physicalBinding)).toHaveLength(2);
    expect(parsed.layout.junctions[0]).toMatchObject({ boardPort: 'trace:vcc' });
  });

  it('reports distinct imported names reconciled through existing copper', () => {
    const previous = parseCanonicalProject(basePhysicalProject());
    const external = (id: string): CanonicalComponent => ({
      id,
      deviceId: id.toUpperCase(),
      manufacturer: '',
      model: '',
      pins: [{ id: 'p', label: 'P', direction: 'output' }],
    });
    const conductor = (id: string, externalId: string, pinId: string): CanonicalConductor => ({
      id,
      from: { kind: 'pin', componentId: externalId, pinId: 'p' },
      to: { kind: 'pin', componentId: 'link-1', pinId },
    });
    const first = conductor('wire-zeta', 'external-zeta', 'a');
    const second = conductor('wire-alpha', 'external-alpha', 'b');
    const imported: CanonicalElectrical = {
      components: [
        ...previous.electrical.components,
        external('external-zeta'),
        external('external-alpha'),
      ],
      junctions: [],
      cables: [],
      nets: [
        { id: 'zeta', name: 'ZETA', endpoints: [first.from, first.to], conductors: [first] },
        {
          id: 'alpha',
          name: 'ALPHA',
          endpoints: [second.from, second.to],
          conductors: [second],
        },
      ],
    };

    const reconciled = buildImportedProject(imported, previous).electrical;
    expect(reconciled.nets).toHaveLength(1);
    expect(reconciled.nets[0].name).toBe('ALPHA');
    const entries = physicalNetReconciliationEntries(imported, reconciled);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      severity: 'warning',
      code: 'physical-net-reconciled',
    });
    expect(entries[0]?.message).toContain('ALPHA');
  });
});

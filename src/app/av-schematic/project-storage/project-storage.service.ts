import { Injectable, computed, inject, signal } from '@angular/core';
import { NgDiagramModelService, NgDiagramViewportService, type Edge, type Node } from 'ng-diagram';
import { AV_SCHEMATIC_CONFIG } from '../av-schematic.config';
import { applyEdgeStretchOnSelectionMoved } from '../diagram/edge-reshaping/middleware/edge-stretch-on-move';
import {
  CanonicalProjectError,
  fromCanonicalProject,
  toCanonicalProject,
  type CanonicalCable,
  type CanonicalProjectV4,
} from '../diagram/model/canonical-project';
import { parseCanonicalProject } from '../diagram/model/canonical-project-parse';
import {
  inspectPhysicalLayout,
  type PhysicalDiagnostic,
} from '../diagram/model/physical-diagnostics';
import { NodeVisibilityConfigService } from '../diagram/node-visibility/node-visibility-config.service';
import { beginModelHistoryGroup } from '../diagram/model/model-history-group';

/**
 * Same-origin project persistence client for the local wiring-editor service
 * (see server/wiring-editor-server.mjs, docs/local-service.md).
 *
 * Talks only to `/api/projects/:id` on the same origin the app was served
 * from - no base URL configuration, no cross-origin request, matching the
 * server's same-origin-only API contract.
 *
 * Scoped to the av-schematic page (see AvSchematicPageComponent providers),
 * sharing a DI scope with NgDiagramModelService like DiagramExportService.
 */

/** A project id must match the server's PROJECT_ID_PATTERN before it ever leaves the client. */
export const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

export type ProjectStorageOperation = 'save' | 'open';
export type ProjectStorageStatus = 'idle' | 'loading' | 'success' | 'error';

@Injectable()
export class ProjectStorageService {
  private readonly modelService = inject(NgDiagramModelService);
  private readonly viewportService = inject(NgDiagramViewportService, { optional: true });
  private readonly visibilityConfig = inject(NodeVisibilityConfigService, { optional: true });
  private readonly avConfig = inject(AV_SCHEMATIC_CONFIG);

  private readonly _status = signal<ProjectStorageStatus>('idle');
  private readonly _operation = signal<ProjectStorageOperation | null>(null);
  private readonly _message = signal<string | null>(null);
  private readonly _physicalDiagnostics = signal<readonly PhysicalDiagnostic[]>([]);
  /**
   * Project-level cable inventory. Edges carry connected cable data, but a
   * completely disconnected cable has no diagram element of its own.
   */
  private cableInventory: CanonicalCable[] = [];

  readonly status = this._status.asReadonly();
  readonly operation = this._operation.asReadonly();
  readonly message = this._message.asReadonly();
  readonly isBusy = computed(() => this._status() === 'loading');
  readonly physicalDiagnostics = this._physicalDiagnostics.asReadonly();
  readonly physicalDiagnosticCount = computed(() => this._physicalDiagnostics().length);

  /** Validates a project id against the same pattern the server enforces, without a round trip. */
  validateProjectId(projectId: string): string | null {
    if (!PROJECT_ID_PATTERN.test(projectId)) {
      return 'ID de projeto inválido: use letras, números, "-" ou "_", começando por letra ou número.';
    }
    return null;
  }

  async save(projectId: string): Promise<void> {
    const validationError = this.validateProjectId(projectId);
    if (validationError) {
      this.setError('save', validationError);
      return;
    }

    this.begin('save');
    try {
      // The committed model, not the nodes()/edges() signals - a save must
      // persist exactly what's actually in the model right now, not a
      // possibly-stale reactive snapshot (see diagram.component.ts's
      // onPaletteItemDropped for the same committed-vs-signal distinction).
      const project = this.snapshotProject();
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      if (!response.ok) {
        throw new Error(await this.describeErrorResponse(response));
      }
      this.setSuccess('save', `Projeto "${projectId}" salvo com sucesso.`);
    } catch (err) {
      this.setError('save', `Falha ao salvar o projeto: ${this.describeError(err)}`);
    }
  }

  async open(projectId: string): Promise<void> {
    const validationError = this.validateProjectId(projectId);
    if (validationError) {
      this.setError('open', validationError);
      return;
    }

    this.begin('open');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: 'GET',
      });
      if (response.status === 404) {
        throw new Error(`projeto "${projectId}" não encontrado`);
      }
      if (!response.ok) {
        throw new Error(await this.describeErrorResponse(response));
      }

      const raw: unknown = await response.json();
      const project = parseCanonicalProject(raw);
      await this.replaceProject(project);
      await this.fitContent();

      this.setSuccess('open', `Projeto "${projectId}" carregado com sucesso.`);
    } catch (err) {
      this.setError('open', `Falha ao abrir o projeto: ${this.describeError(err)}`);
    }
  }

  /** Captures the current project, including disconnected cables and visual planes. */
  snapshotProject(): CanonicalProjectV4 {
    const committedModel = this.modelService.getModel();
    this.refreshPhysicalDiagnostics();
    const project = parseCanonicalProject(
      toCanonicalProject(committedModel.getNodes(), committedModel.getEdges(), this.cableInventory),
    );
    this.cableInventory = project.electrical.cables.map(cloneCable);
    return project;
  }

  /**
   * Captures only reusable node identity and layout for replacement imports.
   * Existing edges and cable inventory are deliberately discarded, so a
   * dangling draft edge cannot prevent a valid replacement from loading.
   */
  snapshotImportSkeleton(): CanonicalProjectV4 {
    const committedModel = this.modelService.getModel();
    return toCanonicalProject(committedModel.getNodes(), [], []);
  }

  /** Keeps the non-visual cable inventory aligned with a live wire-id rename. */
  renameCableIdentity(previousName: string, nextName: string): void {
    if (!previousName || previousName === nextName) return;
    const source = this.cableInventory.find((cable) => cable.name === previousName);
    const target = nextName
      ? this.cableInventory.find((cable) => cable.name === nextName)
      : undefined;
    if (source && target && source !== target) {
      throw new CanonicalProjectError(
        `cannot rename cable "${previousName}" to existing cable "${nextName}"`,
      );
    }
    if (!source) return;

    this.cableInventory = nextName
      ? this.cableInventory.map((cable) =>
          cable === source ? cloneCable({ ...source, name: nextName }) : cable,
        )
      : this.cableInventory.filter((cable) => cable !== source);
  }

  /** Replaces the live canvas and its non-visual cable inventory atomically from one project. */
  async replaceProject(project: CanonicalProjectV4): Promise<void> {
    const parsed = parseCanonicalProject(project);
    const { nodes, edges } = fromCanonicalProject(parsed);
    await this.replaceModel(nodes, edges);
    this.cableInventory = parsed.electrical.cables.map(cloneCable);
    const model = this.modelService.getModel() as { resetHistory?: () => void };
    model.resetHistory?.();
    this.refreshPhysicalDiagnostics();
  }

  /** Refreshes the actionable report without blocking save on warnings. */
  refreshPhysicalDiagnostics(): void {
    const model = this.modelService.getModel();
    this._physicalDiagnostics.set(inspectPhysicalLayout(model.getNodes(), model.getEdges()));
  }

  /**
   * Replaces the entire diagram model using only NgDiagramModelService's
   * public bulk operations (deleteEdges/deleteNodes/addNodes/addEdges) - no
   * private state access, no full-model "reset" call (the service exposes
   * none). Edges are removed before nodes (edges reference node ids) and
   * added back after (new edges reference the freshly added node ids).
   */
  private async replaceModel(nodes: Node[], edges: Edge[]): Promise<void> {
    const endHistoryGroup = beginModelHistoryGroup(this.modelService);
    const committedModel = this.modelService.getModel();
    const currentEdgeIds = committedModel.getEdges().map((edge) => edge.id);
    const currentNodeIds = committedModel.getNodes().map((node) => node.id);

    try {
      if (currentEdgeIds.length > 0) await this.modelService.deleteEdges(currentEdgeIds);
      if (currentNodeIds.length > 0) await this.modelService.deleteNodes(currentNodeIds);

      // Manual edge routes depend on measured port coordinates. Wait for the
      // freshly rendered nodes before restoring those edges.
      if (nodes.length > 0) {
        await this.modelService.addNodes(nodes, { waitForMeasurements: true });
      }
      if (edges.length > 0) {
        await this.modelService.addEdges(edges);
        await applyEdgeStretchOnSelectionMoved(
          this.modelService,
          new Set(nodes.map((node) => node.id)),
          true,
        );
      }
    } finally {
      endHistoryGroup();
    }
  }

  private async fitContent(): Promise<void> {
    if (!this.viewportService) return;
    const insets = this.visibilityConfig?.getViewportInsets() ?? {};
    const pad = this.avConfig.viewport.zoomToFitPadding;
    await this.viewportService.zoomToFit({
      padding: [
        (insets.top ?? 0) + pad,
        (insets.right ?? 0) + pad,
        (insets.bottom ?? 0) + pad,
        (insets.left ?? 0) + pad,
      ],
    });
  }

  private begin(operation: ProjectStorageOperation): void {
    this._operation.set(operation);
    this._status.set('loading');
    this._message.set(operation === 'save' ? 'Salvando projeto...' : 'Abrindo projeto...');
  }

  private setSuccess(operation: ProjectStorageOperation, message: string): void {
    this._operation.set(operation);
    this._status.set('success');
    this._message.set(message);
  }

  private setError(operation: ProjectStorageOperation, message: string): void {
    this._operation.set(operation);
    this._status.set('error');
    this._message.set(message);
  }

  private async describeErrorResponse(response: Response): Promise<string> {
    try {
      const body: unknown = await response.json();
      if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>;
        if (typeof record['message'] === 'string') return record['message'];
        if (typeof record['error'] === 'string')
          return `${record['error']} (HTTP ${response.status})`;
      }
    } catch {
      // Response body was not JSON; fall back to the generic status message.
    }
    return `erro do servidor (HTTP ${response.status})`;
  }

  private describeError(err: unknown): string {
    if (err instanceof CanonicalProjectError) return `projeto inválido (${err.message})`;
    if (err instanceof Error) return err.message;
    return 'erro desconhecido';
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

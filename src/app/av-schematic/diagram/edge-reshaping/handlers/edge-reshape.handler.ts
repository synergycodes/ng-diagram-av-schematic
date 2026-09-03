import { Injectable, inject, signal } from '@angular/core';
import {
  NgDiagramModelService,
  NgDiagramService,
  NgDiagramViewportService,
  type Edge,
} from 'ng-diagram';
import {
  edgeGridReferenceNode,
  normalizeRoute,
  resolveEdgeGrid,
  type Orientation,
  type ReshapeSegment,
} from '../logic';
import { PointerDragController } from '../directives/pointer-drag-controller';
import { EdgeCommandDispatcher } from '../commands';
import { beginModelHistoryGroup } from '../../model/model-history-group';

export interface ReshapeStartDescriptor extends ReshapeSegment {
  readonly edgeId: string;
}

export interface ReshapeDragState {
  readonly edgeId: string;
  readonly segmentIndex: number;
  readonly axis: Orientation;
  readonly anchorPortAtSource: boolean;
  readonly anchorPortAtTarget: boolean;
  readonly initialPoints: { readonly x: number; readonly y: number }[];
  readonly initialClientX: number;
  readonly initialClientY: number;
  // Grid resolved from snap config at gesture start; null when snapping is off.
  readonly grid: { x: number; y: number } | null;
}

/**
 * Owns the in-flight reshape gesture: captures the pointer, translates each
 * move into world deltas, and dispatches reshape commands. Holds no geometry or
 * model-write logic itself -- that lives in `logic/` and `commands/`.
 */
@Injectable()
export class EdgeReshapeHandler {
  private readonly modelService = inject(NgDiagramModelService);
  private readonly viewportService = inject(NgDiagramViewportService);
  private readonly diagramService = inject(NgDiagramService);
  private readonly dispatcher = inject(EdgeCommandDispatcher);

  // Masks L-bend insertions so the overlay's `@for` track key doesn't remap the
  // grabbed element off the cursor mid-drag. Read by the overlay.
  readonly gestureActive = signal(false);
  private endHistoryGroup = (): void => undefined;
  private pendingMutation: Promise<void> = Promise.resolve();

  // Handle-bound, no frame coalescing: the reshape compute is light and the
  // grabbed handle stays mounted through the gesture.
  private readonly drag = new PointerDragController<ReshapeDragState>(
    {
      onMove: (event, state) => {
        this.pendingMutation = this.pendingMutation.then(() =>
          this.dispatcher.dispatch({
            kind: 'reshape-move',
            edgeId: state.edgeId,
            initialPoints: state.initialPoints,
            segmentIndex: state.segmentIndex,
            axis: state.axis,
            anchorPortAtSource: state.anchorPortAtSource,
            anchorPortAtTarget: state.anchorPortAtTarget,
            grid: state.grid,
            dxWorld: (event.clientX - state.initialClientX) / (this.viewportService.scale() || 1),
            dyWorld: (event.clientY - state.initialClientY) / (this.viewportService.scale() || 1),
          }),
        );
      },
      onEnd: async (event, state) => {
        await this.pendingMutation;
        await this.dispatcher.dispatch({ kind: 'reshape-finish', edgeId: state.edgeId });
        // Prevent the trailing click from deselecting the edge.
        event.stopPropagation();
      },
      onTeardown: () => {
        this.endHistoryGroup();
        this.endHistoryGroup = () => undefined;
        this.pendingMutation = Promise.resolve();
        this.gestureActive.set(false);
      },
    },
    { listenerTarget: 'handle', coalesce: false },
  );

  get current(): ReshapeDragState | null {
    return this.drag.current;
  }

  start(event: PointerEvent, handleEl: HTMLElement, descriptor: ReshapeStartDescriptor): void {
    if (event.button !== 0) return;
    const edge = this.modelService.getEdgeById(descriptor.edgeId);
    if (!edge?.points) return;

    const initialPoints = normalizeRoute(edge.points);
    if (initialPoints.length < 2) return;
    this.endHistoryGroup = beginModelHistoryGroup(this.modelService);
    this.pendingMutation = Promise.resolve();
    if (initialPoints.length !== edge.points.length) {
      this.pendingMutation = this.pendingMutation.then(() =>
        this.dispatcher.dispatch({
          kind: 'set-edge-route',
          edgeId: descriptor.edgeId,
          points: initialPoints,
        }),
      );
    }

    this.gestureActive.set(true);
    this.drag.begin(event, handleEl, {
      edgeId: descriptor.edgeId,
      segmentIndex: descriptor.segmentIndex,
      axis: descriptor.axis,
      anchorPortAtSource: descriptor.anchorPortAtSource,
      anchorPortAtTarget: descriptor.anchorPortAtTarget,
      initialPoints,
      initialClientX: event.clientX,
      initialClientY: event.clientY,
      grid: this.gridForEdge(edge),
    });
  }

  teardown(): void {
    this.drag.teardown();
  }

  // Mirror the node-drag snap config: reshape snaps only when the edge's
  // reference node would snap on drag. Null -> snapping disabled, reshape moves
  // freely. Keeps snapping config-driven and optional for a core port.
  private gridForEdge(edge: Edge): { x: number; y: number } | null {
    const refNode = edgeGridReferenceNode(this.modelService.nodes(), edge);
    return resolveEdgeGrid(this.diagramService, refNode) ?? null;
  }
}

import { Injectable, inject, signal } from '@angular/core';
import {
  NgDiagramModelService,
  NgDiagramService,
  NgDiagramViewportService,
  type Edge,
  type Point,
} from 'ng-diagram';
import { edgeGridReferenceNode, resolveEdgeGrid, snapPointToGrid } from '../logic';
import { PointerDragController } from '../directives/pointer-drag-controller';
import { EdgeCommandDispatcher } from '../commands';
import { isBoardJumperEdge } from '../../model/board-jumper';
import { beginModelHistoryGroup } from '../../model/model-history-group';

const DRAG_THRESHOLD_PX = 3;

export interface BendStartDescriptor {
  readonly edgeId: string;
  readonly bendIndex: number;
  readonly point: Point;
}

export interface BendDragState {
  readonly edgeId: string;
  readonly bendIndex: number;
  readonly initialPoints: readonly Point[];
  readonly initialClientX: number;
  readonly initialClientY: number;
  readonly grid: { x: number; y: number } | null;
  hasMoved: boolean;
}

/**
 * Owns the single-bend gestures: dragging one bend, deleting one, and creating
 * one on a segment. Separate from {@link EdgeReshapeHandler} (which slides whole
 * segments) but on the same command pipeline -- every write goes through
 * {@link EdgeCommandDispatcher}.
 *
 * The drag preview is published as a signal so the overlay can pin the grabbed
 * handle to the cursor. Re-anchoring can insert an L-bend at a port mid-drag,
 * which shifts the live bend indices; driving the handle from the gesture's own
 * state instead of the live route keeps it under the pointer regardless.
 */
@Injectable()
export class EdgeBendHandler {
  private readonly modelService = inject(NgDiagramModelService);
  private readonly viewportService = inject(NgDiagramViewportService);
  private readonly diagramService = inject(NgDiagramService);
  private readonly dispatcher = inject(EdgeCommandDispatcher);

  readonly gestureActive = signal(false);
  /** Where the dragged bend currently sits, in flow coords; null when idle. */
  readonly dragPreview = signal<BendStartDescriptor | null>(null);
  private endHistoryGroup = (): void => undefined;
  private pendingMutation: Promise<void> = Promise.resolve();

  // 'document' + frame coalescing: a bend edit can change the point count, so
  // the handle element may be recycled mid-drag -- document listeners survive it.
  private readonly drag = new PointerDragController<BendDragState>(
    {
      onMove: (event, state) => {
        const dxClient = event.clientX - state.initialClientX;
        const dyClient = event.clientY - state.initialClientY;
        if (!state.hasMoved && Math.hypot(dxClient, dyClient) < DRAG_THRESHOLD_PX) return;
        state.hasMoved = true;
        const scale = this.viewportService.scale() || 1;
        const dxWorld = dxClient / scale;
        const dyWorld = dyClient / scale;
        this.pendingMutation = this.pendingMutation.then(() =>
          this.dispatcher.dispatch({
            kind: 'move-bend',
            edgeId: state.edgeId,
            initialPoints: state.initialPoints,
            bendIndex: state.bendIndex,
            grid: state.grid,
            dxWorld,
            dyWorld,
          }),
        );
        this.dragPreview.set({
          edgeId: state.edgeId,
          bendIndex: state.bendIndex,
          point: this.previewPoint(state, dxWorld, dyWorld),
        });
      },
      onEnd: async (event, state) => {
        await this.pendingMutation;
        if (state.hasMoved) {
          await this.dispatcher.dispatch({ kind: 'reshape-finish', edgeId: state.edgeId });
        }
        // Prevent the trailing click from deselecting the edge.
        event.stopPropagation();
      },
      onTeardown: () => {
        this.endHistoryGroup();
        this.endHistoryGroup = () => undefined;
        this.pendingMutation = Promise.resolve();
        this.gestureActive.set(false);
        this.dragPreview.set(null);
      },
    },
    { listenerTarget: 'document', coalesce: true },
  );

  get current(): BendDragState | null {
    return this.drag.current;
  }

  startDrag(event: PointerEvent, handleEl: HTMLElement, descriptor: BendStartDescriptor): void {
    if (event.button !== 0) return;
    const edge = this.modelService.getEdgeById(descriptor.edgeId);
    if (!edge?.points || edge.points.length < 3) return;
    if (descriptor.bendIndex < 1 || descriptor.bendIndex > edge.points.length - 2) return;

    this.endHistoryGroup = beginModelHistoryGroup(this.modelService);
    this.pendingMutation = Promise.resolve();
    this.gestureActive.set(true);
    this.dragPreview.set(descriptor);
    this.drag.begin(event, handleEl, {
      edgeId: descriptor.edgeId,
      bendIndex: descriptor.bendIndex,
      initialPoints: edge.points.map((p) => ({ x: p.x, y: p.y })),
      initialClientX: event.clientX,
      initialClientY: event.clientY,
      grid: this.gridForEdge(edge),
      hasMoved: false,
    });
  }

  removeBend(edgeId: string, bendIndex: number): void {
    void this.dispatcher.dispatch({ kind: 'remove-bend', edgeId, bendIndex });
  }

  /** Create a bend on `segmentIndex` at a client-space point (a double-click). */
  insertBendAtClientPoint(
    edgeId: string,
    segmentIndex: number,
    clientX: number,
    clientY: number,
  ): void {
    this.insertBendAtFlowPoint(
      edgeId,
      segmentIndex,
      this.viewportService.clientToFlowPosition({ x: clientX, y: clientY }),
    );
  }

  /** Keyboard-accessible variant whose point is already in flow coordinates. */
  insertBendAtFlowPoint(edgeId: string, segmentIndex: number, at: Point): void {
    const edge = this.modelService.getEdgeById(edgeId);
    if (!edge) return;
    void this.dispatcher.dispatch({
      kind: 'insert-bend',
      edgeId,
      segmentIndex,
      at,
      grid: this.gridForEdge(edge),
    });
  }

  teardown(): void {
    this.drag.teardown();
  }

  private previewPoint(state: BendDragState, dxWorld: number, dyWorld: number): Point {
    const origin = state.initialPoints[state.bendIndex];
    const moved = { x: origin.x + dxWorld, y: origin.y + dyWorld };
    return state.grid ? snapPointToGrid(moved, state.grid) : moved;
  }

  // Same rule as reshaping: the edge snaps exactly when its reference node
  // would snap on drag; null means snapping is off and the bend moves freely.
  private gridForEdge(edge: Edge): { x: number; y: number } | null {
    if (isBoardJumperEdge(edge)) return null;
    const refNode = edgeGridReferenceNode(this.modelService.nodes(), edge);
    return resolveEdgeGrid(this.diagramService, refNode) ?? null;
  }
}

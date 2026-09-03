import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { NgDiagramSelectionService, NgDiagramViewportService } from 'ng-diagram';
import {
  findBendHandles,
  findReshapeableSegments,
  normalizeRoute,
  type ReshapeEndpointKind,
  type ReshapeSegment,
} from './logic';
import {
  EdgeReshapeHandler,
  type ReshapeDragState,
  type ReshapeStartDescriptor,
} from './handlers/edge-reshape.handler';
import { EdgeBendHandler, type BendStartDescriptor } from './handlers/edge-bend.handler';
import { isBoardJumperEdge } from '../model/board-jumper';

interface OverlaySegment extends ReshapeStartDescriptor {
  readonly insertOnly?: boolean;
}

// Renders a reshape handle on every orthogonal segment of a selected edge, plus
// a bend handle on every interior vertex, and forwards the pointer gestures to
// the handlers. UI only -- no geometry, no model writes (those live in handlers/
// and commands/).
@Component({
  selector: 'app-edge-reshape-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './edge-reshape-overlay.component.html',
  styleUrl: './edge-reshape-overlay.component.scss',
})
export class EdgeReshapeOverlayComponent {
  private readonly selectionService = inject(NgDiagramSelectionService);
  private readonly viewportService = inject(NgDiagramViewportService);
  private readonly handler = inject(EdgeReshapeHandler);
  private readonly bendHandler = inject(EdgeBendHandler);

  constructor() {
    // Release capture + clear the mask if destroyed mid-drag.
    inject(DestroyRef).onDestroy(() => {
      this.handler.teardown();
      this.bendHandler.teardown();
    });
  }

  protected readonly handles = computed<readonly OverlaySegment[]>(() => {
    const drag = this.handler.current;
    const gestureOn = this.handler.gestureActive();
    const selection = this.selectionService.selection();
    const handles: OverlaySegment[] = [];
    for (const edge of selection.edges) {
      if (isBoardJumperEdge(edge) && edge.points) {
        for (let index = 0; index < edge.points.length - 1; index++) {
          const from = edge.points[index];
          const to = edge.points[index + 1];
          handles.push({
            edgeId: edge.id,
            segmentIndex: index,
            midpoint: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
            axis: Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) ? 'horizontal' : 'vertical',
            anchorPortAtSource: false,
            anchorPortAtTarget: false,
            insertOnly: true,
          });
        }
        continue;
      }
      const sourceKind = this.classifyEndpoint(edge.source);
      const targetKind = this.classifyEndpoint(edge.target);
      const isDragged = !!drag && gestureOn && drag.edgeId === edge.id;
      if (isDragged && drag) {
        const segments = findReshapeableSegments(edge.points, sourceKind, targetKind);
        for (const segment of this.maskInjectedBends(segments, drag, edge.points?.length ?? 0)) {
          handles.push({ edgeId: edge.id, ...segment });
        }
      } else {
        const segments = findReshapeableSegments(
          normalizeRoute(edge.points),
          sourceKind,
          targetKind,
        );
        for (const segment of segments) {
          handles.push({ edgeId: edge.id, ...segment });
        }
      }
    }
    return handles;
  });

  /**
   * One handle per direction-changing interior vertex of every selected edge.
   *
   * While a bend is being dragged only that bend is shown, positioned from the
   * gesture state rather than the live route: re-anchoring can insert an L-bend
   * at a port, which would otherwise shift every index (and the grabbed
   * element) out from under the cursor. Segment reshaping hides them entirely --
   * a segment slide moves the vertices, so stale bend dots would just chase it.
   */
  protected readonly bendHandles = computed<readonly BendStartDescriptor[]>(() => {
    if (this.handler.gestureActive()) return [];

    const preview = this.bendHandler.dragPreview();
    if (this.bendHandler.gestureActive() && preview) return [preview];

    const selection = this.selectionService.selection();
    const handles: BendStartDescriptor[] = [];
    for (const edge of selection.edges) {
      if (isBoardJumperEdge(edge) && edge.points) {
        edge.points.slice(1, -1).forEach((point, index) => {
          handles.push({ edgeId: edge.id, bendIndex: index + 1, point: { ...point } });
        });
        continue;
      }
      // Bend indices must refer to the persisted point list. Segment editing
      // normalizes its route on gesture start, but a direct bend removal has no
      // such start phase; pre-normalizing here could make it delete a different
      // vertex when a loaded route still contains a collinear point.
      for (const bend of findBendHandles(edge.points)) {
        handles.push({ edgeId: edge.id, bendIndex: bend.bendIndex, point: bend.point });
      }
    }
    return handles;
  });

  protected readonly transform = computed(() => {
    const viewport = this.viewportService.viewport();
    return `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`;
  });

  protected onPointerDown(event: PointerEvent, handle: OverlaySegment): void {
    if (event.button !== 0) return;
    // Stop ng-diagram from treating this as selection / box-select.
    event.stopPropagation();
    if (handle.insertOnly) return;
    this.handler.start(event, event.currentTarget as HTMLElement, handle);
  }

  /** Double-clicking a segment handle creates a bend jog there. */
  protected onSegmentDoubleClick(event: MouseEvent, handle: ReshapeStartDescriptor): void {
    event.stopPropagation();
    event.preventDefault();
    this.bendHandler.insertBendAtClientPoint(
      handle.edgeId,
      handle.segmentIndex,
      event.clientX,
      event.clientY,
    );
  }

  protected onSegmentKeyboardInsert(event: Event, handle: ReshapeStartDescriptor): void {
    event.stopPropagation();
    event.preventDefault();
    this.bendHandler.insertBendAtFlowPoint(handle.edgeId, handle.segmentIndex, handle.midpoint);
  }

  protected onBendPointerDown(event: PointerEvent, handle: BendStartDescriptor): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    this.bendHandler.startDrag(event, event.currentTarget as HTMLElement, handle);
  }

  /** Double-clicking a bend removes it (and the smallest run that keeps the route square). */
  protected onBendDoubleClick(event: MouseEvent, handle: BendStartDescriptor): void {
    event.stopPropagation();
    event.preventDefault();
    this.bendHandler.removeBend(handle.edgeId, handle.bendIndex);
  }

  protected onBendContextMenu(event: MouseEvent, handle: BendStartDescriptor): void {
    this.onBendDoubleClick(event, handle);
  }

  protected onBendKeyboardRemove(event: Event, handle: BendStartDescriptor): void {
    event.stopPropagation();
    event.preventDefault();
    this.bendHandler.removeBend(handle.edgeId, handle.bendIndex);
  }

  // An edge end is anchored when connected to a port, dangling when loose.
  private classifyEndpoint(nodeId: string): ReshapeEndpointKind {
    return nodeId ? 'anchored' : 'dangling';
  }

  // Drop L-bends injected this gesture and shift the remaining indices so
  // the dragged handle keeps its original track key.
  private maskInjectedBends(
    segments: readonly ReshapeSegment[],
    drag: ReshapeDragState,
    liveLen: number,
  ): ReshapeSegment[] {
    const initialLen = drag.initialPoints.length;
    const lengthDiff = liveLen - initialLen;
    if (lengthDiff <= 0) return segments.slice();

    const sourceBendInserted =
      drag.anchorPortAtSource && drag.segmentIndex === 0 && lengthDiff >= 1;
    const targetBendInserted =
      drag.anchorPortAtTarget &&
      drag.segmentIndex === initialLen - 2 &&
      lengthDiff >= (sourceBendInserted ? 2 : 1);

    const targetBendLiveIndex = liveLen - 2;
    const result: ReshapeSegment[] = [];
    for (const segment of segments) {
      if (sourceBendInserted && segment.segmentIndex === 0) continue;
      if (targetBendInserted && segment.segmentIndex === targetBendLiveIndex) continue;
      const remapped = sourceBendInserted
        ? { ...segment, segmentIndex: segment.segmentIndex - 1 }
        : segment;
      result.push(remapped);
    }
    return result;
  }
}

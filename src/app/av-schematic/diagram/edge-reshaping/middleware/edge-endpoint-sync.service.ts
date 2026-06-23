import { Injectable, OnDestroy, effect, inject } from '@angular/core';
import {
  NgDiagramModelService,
  NgDiagramService,
  type Edge,
  type Node,
  type Point,
} from 'ng-diagram';
import { EdgeReshapeCommandDispatcher } from '../commands/dispatcher';
import {
  endpointNeighborAxis,
  getDefaultMinInteriorBends,
  getEdgePortOrientations,
  getNodePortOrientation,
  getPortFlowPosition,
  pathSourceOrientation,
  reflowEndpoint,
  simplifyPath,
} from '../logic';

interface PortSnapshot {
  source: Point;
  target: Point;
}

const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

const samePath = (a: readonly Point[], b: readonly Point[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].x !== b[i].x || a[i].y !== b[i].y) return false;
  }
  return true;
};

/**
 * Watches manual-routed edges and reflows their endpoints whenever a
 * connected node moves.
 *
 * Mid-drag the path is reflowed but NOT simplified — collinear merges and
 * endpoint nudges run only once when the drag ends, mirroring the bend-drag
 * behaviour. Drag boundaries come from `nodeDragStarted` / `nodeDragEnded`
 * on `NgDiagramService`.
 *
 * Porting target: when this lands inside ng-diagram, the state-observing
 * `effect()` becomes a middleware that listens for the `moveNode` /
 * node-drag-end commands. The middleware sees the affected nodes directly
 * (no per-edge port snapshot map needed) and dispatches `reshapeEdge`
 * through the command handler. The Angular service form is the equivalent
 * shape on the application side until then.
 */
@Injectable()
export class EdgeEndpointSyncService implements OnDestroy {
  private readonly modelService = inject(NgDiagramModelService);
  private readonly diagramService = inject(NgDiagramService);
  private readonly dispatcher = inject(EdgeReshapeCommandDispatcher);

  private readonly lastKnownPorts = new Map<string, PortSnapshot>();
  private readonly unsubscribers: (() => void)[] = [];
  private dragging = false;
  private listenersAttached = false;

  constructor() {
    effect(() => {
      this.attachDragListenersOnce();
    });
    effect(() => {
      this.syncEdgeEndpoints();
    });
  }

  private attachDragListenersOnce(): void {
    if (this.listenersAttached) return;
    if (!this.diagramService.isInitialized()) return;

    this.listenersAttached = true;
    this.unsubscribers.push(
      this.diagramService.addEventListener('nodeDragStarted', () => {
        this.dragging = true;
      }),
      this.diagramService.addEventListener('nodeDragEnded', (event) => {
        this.dragging = false;
        this.finalizeForNodes(event.nodes);
      }),
    );
  }

  private syncEdgeEndpoints(): void {
    if (!this.diagramService.isInitialized()) return;

    const nodes = this.modelService.nodes();
    const edges = this.modelService.edges();

    const liveEdgeIds = new Set<string>();
    for (const edge of edges) {
      liveEdgeIds.add(edge.id);
      if (edge.routingMode !== 'manual' || !edge.points || edge.points.length < 3) {
        this.lastKnownPorts.delete(edge.id);
        continue;
      }
      this.processEdge(edge, nodes, /* simplify */ !this.dragging);
    }

    for (const trackedId of this.lastKnownPorts.keys()) {
      if (!liveEdgeIds.has(trackedId)) this.lastKnownPorts.delete(trackedId);
    }
  }

  ngOnDestroy(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers.length = 0;
  }

  private processEdge(edge: Edge, nodes: readonly Node[], simplify: boolean): void {
    const currentPoints = edge.points;
    if (!currentPoints) return;

    const sourceConnected = !!edge.source;
    const targetConnected = !!edge.target;
    const sourceNode = sourceConnected ? nodes.find((node) => node.id === edge.source) : undefined;
    const targetNode = targetConnected ? nodes.find((node) => node.id === edge.target) : undefined;
    if ((sourceConnected && !sourceNode) || (targetConnected && !targetNode)) return;

    // A dangling end has no port — its endpoint is its stored position.
    const sourcePos = sourceNode
      ? getPortFlowPosition(sourceNode, edge.sourcePort)
      : (edge.sourcePosition ?? currentPoints[0]);
    const targetPos = targetNode
      ? getPortFlowPosition(targetNode, edge.targetPort)
      : (edge.targetPosition ?? currentPoints[currentPoints.length - 1]);
    if (!sourcePos || !targetPos) return;

    const last = this.lastKnownPorts.get(edge.id);
    if (last && samePoint(sourcePos, last.source) && samePoint(targetPos, last.target)) {
      return;
    }

    // Only a *connected* end tracks a moving node (or needs anchoring to its
    // port on first sight). A dangling end's position is owned by whatever
    // gesture is editing it, NOT a node move — reacting to it here would fight
    // that gesture. First sight (`!last`) anchors connected ends so a manual
    // edge authored with an approximate port point snaps onto its port.
    const sourceMoved = sourceConnected && (!last || !samePoint(sourcePos, last.source));
    const targetMoved = targetConnected && (!last || !samePoint(targetPos, last.target));
    this.lastKnownPorts.set(edge.id, { source: sourcePos, target: targetPos });
    if (!sourceMoved && !targetMoved) return;

    const portSourceOrientation = getNodePortOrientation(sourceNode, edge.sourcePort);
    const portTargetOrientation = getNodePortOrientation(targetNode, edge.targetPort);
    // Slide the endpoint along the stub's *actual* axis, not the port's — a
    // reshaped wire can enter a horizontal port vertically (and vice versa).
    // Using the port axis there forces a diagonal stub. Port axis is the
    // fallback for a degenerate (collocated) stub.
    const sourceAxis = endpointNeighborAxis(currentPoints, 'source') ?? portSourceOrientation;
    const targetAxis = endpointNeighborAxis(currentPoints, 'target') ?? portTargetOrientation;
    let next: readonly Point[] = currentPoints;

    if (sourceMoved) {
      const reflowed = reflowEndpoint(next, 'source', sourcePos, sourceAxis);
      if (reflowed) next = reflowed;
    }
    if (targetMoved) {
      const reflowed = reflowEndpoint(next, 'target', targetPos, targetAxis);
      if (reflowed) next = reflowed;
    }

    const finalPoints = simplify
      ? simplifyPath(next, pathSourceOrientation(next, portSourceOrientation), portTargetOrientation, {
          minInteriorBends: getDefaultMinInteriorBends(
            portSourceOrientation,
            portTargetOrientation,
            next[0],
            next[next.length - 1],
          ),
        })
      : next;

    if (samePath(finalPoints, currentPoints)) return;

    this.dispatcher.dispatch({
      type: 'reshapeEdge',
      edgeId: edge.id,
      points: [...finalPoints],
      finalize: false,
    });
  }

  private finalizeForNodes(draggedNodes: readonly Node[]): void {
    if (draggedNodes.length === 0) return;
    const draggedIds = new Set(draggedNodes.map((n) => n.id));
    const edges = this.modelService.edges();
    const nodes = this.modelService.nodes();

    for (const edge of edges) {
      if (edge.routingMode !== 'manual' || !edge.points || edge.points.length < 3) continue;
      if (!draggedIds.has(edge.source) && !draggedIds.has(edge.target)) continue;

      const orientations = getEdgePortOrientations(nodes, edge);
      const simplified = simplifyPath(
        edge.points,
        pathSourceOrientation(edge.points, orientations.source),
        orientations.target,
        {
          minInteriorBends: getDefaultMinInteriorBends(
            orientations.source,
            orientations.target,
            edge.points[0],
            edge.points[edge.points.length - 1],
          ),
        },
      );

      if (samePath(simplified, edge.points)) continue;
      this.dispatcher.dispatch({
        type: 'reshapeEdge',
        edgeId: edge.id,
        points: simplified,
        finalize: false,
      });
    }
  }
}

/**
 * Eagerly constructs the service so its `effect()`s start watching the model.
 * Call from a host component's injection context (constructor or field
 * initializer) after providing `EdgeEndpointSyncService`.
 */
export const bootstrapEdgeEndpointSync = (): void => {
  inject(EdgeEndpointSyncService);
};

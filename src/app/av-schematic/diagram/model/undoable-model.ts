import {
  stripEdgeRuntimeProperties,
  stripNodeRuntimeProperties,
  type Edge,
  type Metadata,
  type ModelAdapter,
  type ModelChanges,
  type Node,
  type Point,
} from 'ng-diagram';
import { isBoardNode } from './guards';

interface ModelSnapshot {
  nodes: Node[];
  edges: Edge[];
}

const MAX_HISTORY_ENTRIES = 100;

/**
 * Adds content history to ng-diagram's signal adapter and keeps movement of a
 * board plus its local jumpers in one model mutation. Runtime-only selection
 * and measurement changes do not consume undo entries.
 */
export class UndoableDiagramModelAdapter implements ModelAdapter {
  private readonly past: ModelSnapshot[] = [];
  private readonly future: ModelSnapshot[] = [];
  private historyGroupDepth = 0;
  private historyGroupStart: ModelSnapshot | null = null;
  private pendingBefore: ModelSnapshot | null = null;
  private pendingBoardDeltas = new Map<string, Point>();
  private pendingFlushScheduled = false;

  constructor(private readonly delegate: ModelAdapter) {}

  destroy(): void {
    this.resetHistory();
    this.delegate.destroy();
  }

  /** Starts a new project history without carrying undo state across projects. */
  resetHistory(): void {
    this.past.length = 0;
    this.future.length = 0;
    this.historyGroupDepth = 0;
    this.historyGroupStart = null;
    this.pendingBefore = null;
    this.pendingBoardDeltas.clear();
    this.pendingFlushScheduled = false;
  }

  beginHistoryGroup(): void {
    if (this.historyGroupDepth === 0)
      this.historyGroupStart = this.pendingBefore ?? this.snapshot();
    this.historyGroupDepth++;
  }

  endHistoryGroup(): void {
    if (this.historyGroupDepth === 0) return;
    this.historyGroupDepth--;
    if (this.historyGroupDepth !== 0) {
      this.flushPending();
      return;
    }
    const before = this.historyGroupStart;
    this.historyGroupStart = null;
    this.flushPending(false);
    if (before) this.recordIfChanged(before);
  }

  getNodes(): Node[] {
    return this.delegate.getNodes();
  }

  getEdges(): Edge[] {
    return this.delegate.getEdges();
  }

  updateNodes(nodes: Node[] | ((nodes: Node[]) => Node[])): void {
    this.capturePendingBefore();
    const before = this.snapshot();
    if (typeof nodes === 'function') this.delegate.updateNodes(nodes);
    else this.delegate.updateNodes(nodes);
    this.translateOwnedJumpers(before.nodes, this.delegate.getNodes());
    this.schedulePendingFlush();
  }

  updateEdges(edges: Edge[] | ((edges: Edge[]) => Edge[])): void {
    this.capturePendingBefore();
    if (typeof edges === 'function') {
      this.delegate.updateEdges((current) =>
        edges(current).map((edge) => this.applyPendingDelta(edge)),
      );
    } else this.delegate.updateEdges(edges.map((edge) => this.applyPendingDelta(edge)));
    this.schedulePendingFlush();
  }

  getMetadata(): Metadata {
    return this.delegate.getMetadata();
  }

  updateMetadata(metadata: Metadata | ((metadata: Metadata) => Metadata)): void {
    // Viewport movement is session state, not an editable project operation.
    if (typeof metadata === 'function') this.delegate.updateMetadata(metadata);
    else this.delegate.updateMetadata(metadata);
  }

  onChange(callback: (changes: ModelChanges) => void): void {
    this.delegate.onChange(callback);
  }

  unregisterOnChange(callback: (changes: ModelChanges) => void): void {
    this.delegate.unregisterOnChange(callback);
  }

  undo(): void {
    this.flushPending();
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.snapshot());
    this.restore(previous);
  }

  redo(): void {
    this.flushPending();
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.snapshot());
    this.restore(next);
  }

  toJSON(): string {
    return this.delegate.toJSON();
  }

  private translateOwnedJumpers(previousNodes: readonly Node[], nextNodes: readonly Node[]): void {
    const previousPositions = new Map(previousNodes.map((node) => [node.id, node.position]));
    const deltasByBoardId = new Map<string, Point>();
    for (const node of nextNodes) {
      if (!isBoardNode(node)) continue;
      const previous = previousPositions.get(node.id);
      if (!previous) continue;
      const delta = { x: node.position.x - previous.x, y: node.position.y - previous.y };
      if (delta.x !== 0 || delta.y !== 0) deltasByBoardId.set(node.data.boardId, delta);
    }
    if (deltasByBoardId.size === 0) return;
    for (const [boardId, delta] of deltasByBoardId) {
      const previous = this.pendingBoardDeltas.get(boardId);
      this.pendingBoardDeltas.set(
        boardId,
        previous ? { x: previous.x + delta.x, y: previous.y + delta.y } : delta,
      );
    }

    this.delegate.updateEdges((edges) =>
      edges.map((edge) => {
        const ownerId = boardJumperOwnerId(edge);
        const delta = ownerId ? deltasByBoardId.get(ownerId) : undefined;
        if (!delta || !edge.points) return edge;
        return {
          ...edge,
          points: edge.points.map((point) => ({
            x: point.x + delta.x,
            y: point.y + delta.y,
          })),
        };
      }),
    );
  }

  private applyPendingDelta(edge: Edge): Edge {
    const ownerId = boardJumperOwnerId(edge);
    const delta = ownerId ? this.pendingBoardDeltas.get(ownerId) : undefined;
    if (!delta || !edge.points) return edge;
    const baseline = this.pendingBefore?.edges.find((candidate) => candidate.id === edge.id);
    if (baseline?.points && pointsEqual(edge.points, translatedPoints(baseline.points, delta))) {
      return edge;
    }
    return {
      ...edge,
      points: edge.points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y })),
    };
  }

  private capturePendingBefore(): void {
    this.pendingBefore ??= this.snapshot();
  }

  private schedulePendingFlush(): void {
    if (this.pendingFlushScheduled) return;
    this.pendingFlushScheduled = true;
    queueMicrotask(() => {
      this.flushPending();
    });
  }

  private flushPending(record = true): void {
    this.pendingFlushScheduled = false;
    const before = this.pendingBefore;
    this.pendingBefore = null;
    this.pendingBoardDeltas.clear();
    if (record && before) this.recordIfChanged(before);
  }

  private recordIfChanged(before: ModelSnapshot): void {
    if (this.historyGroupDepth > 0) return;
    if (contentFingerprint(before) === contentFingerprint(this.current())) return;
    this.past.push(before);
    if (this.past.length > MAX_HISTORY_ENTRIES) this.past.shift();
    this.future.length = 0;
  }

  private current(): ModelSnapshot {
    return { nodes: this.delegate.getNodes(), edges: this.delegate.getEdges() };
  }

  private snapshot(): ModelSnapshot {
    const current = this.current();
    return {
      nodes: current.nodes.map((node) => structuredClone(stripNodeRuntimeProperties(node))),
      edges: current.edges.map((edge) => structuredClone(stripEdgeHistoryProperties(edge))),
    };
  }

  private restore(snapshot: ModelSnapshot): void {
    const restored = structuredClone(snapshot);
    this.delegate.updateNodes(restored.nodes);
    this.delegate.updateEdges(restored.edges);
  }
}

function translatedPoints(points: readonly Point[], delta: Point): Point[] {
  return points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y }));
}

function pointsEqual(left: readonly Point[], right: readonly Point[]): boolean {
  return (
    left.length === right.length &&
    left.every((point, index) => point.x === right[index]?.x && point.y === right[index]?.y)
  );
}

function boardJumperOwnerId(edge: Edge): string | undefined {
  if (typeof edge.data !== 'object' || edge.data === null) return undefined;
  const ownerId = (edge.data as { jumperBoardId?: unknown }).jumperBoardId;
  return typeof ownerId === 'string' ? ownerId : undefined;
}

function contentFingerprint(snapshot: ModelSnapshot): string {
  return JSON.stringify({
    nodes: snapshot.nodes.map(stripNodeRuntimeProperties),
    edges: snapshot.edges.map(stripEdgeHistoryProperties),
  });
}

function stripEdgeHistoryProperties(edge: Edge): Omit<Edge, 'selected'> {
  const { selected: _selected, ...content } = stripEdgeRuntimeProperties(edge);
  return content;
}

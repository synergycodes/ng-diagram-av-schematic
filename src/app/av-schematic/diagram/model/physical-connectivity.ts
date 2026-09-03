import { type Edge, type Node } from 'ng-diagram';
import { isBoardHoleAvailable } from './board-geometry';
import { parseHolePortId, parseTracePortId } from './board-ports';
import { traceForHole, traceHoles } from './board-trace';
import { devicePortHoles } from './footprint-geometry';
import { isBoardNode, isDeviceNode } from './guards';
import { type BoardHole } from './interfaces';

/**
 * Where a diagram endpoint physically lands, resolved through
 * pin -> hole -> trace.
 *
 * `netLabel` is deliberately *not* called `netId`: copper carries a **name**
 * the person wrote on the board ("GND_SYS"), never the identity of a net. In
 * format v2 a net's identity is derived from the conductor graph
 * (`net-grouping.ts`) and nowhere else, so this label is only ever used as a
 * naming hint for a brand-new net and as evidence in
 * `physical-diagnostics.ts`. Nothing here rewrites an imported net.
 */
export interface PhysicalEndpoint {
  boardId: string;
  hole: BoardHole;
  traceId?: string;
  traceLabel?: string;
  /** Net *name* written on the copper, when its trace declares one. */
  netLabel?: string;
}

export interface PhysicalEdgeNet {
  /** The single copper net name both ends agree on, when there is one. */
  netLabel?: string;
  /** Two or more distinct copper net names met by one conductor: a short. */
  conflict: string[];
}

export interface PhysicalConnectionAssessment extends PhysicalEdgeNet {
  sameCopper: boolean;
}

export interface PhysicalGraphConflict {
  conflict: string[];
  conductorIds: string[];
}

type PhysicalEdgeLike = Pick<Edge, 'source' | 'sourcePort' | 'target' | 'targetPort'> &
  Partial<Pick<Edge, 'id'>>;

/** Resolve a live diagram endpoint through pin -> hole -> trace -> copper label. */
export function physicalEndpoint(
  nodes: readonly Node[],
  nodeId: string | undefined,
  portId: string | undefined,
): PhysicalEndpoint | null {
  if (!nodeId || !portId) return null;
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;

  if (isBoardNode(node)) {
    const hole = parseHolePortId(portId);
    if (hole) {
      if (!isBoardHoleAvailable(node.data, hole)) return null;
      return endpointAtHole(node.data.boardId, hole, traceForHole(node.data, hole));
    }
    const traceId = parseTracePortId(portId);
    const trace = node.data.traces?.find((candidate) => candidate.id === traceId);
    const traceHole = trace ? traceHoles(trace)[0] : undefined;
    return trace && traceHole
      ? {
          boardId: node.data.boardId,
          hole: traceHole,
          traceId: trace.id,
          traceLabel: trace.label,
          netLabel: trace.net,
        }
      : null;
  }

  if (!isDeviceNode(node)) return null;
  const boardId = node.data.placement?.boardId ?? node.data.boardId;
  if (!boardId) return null;
  const board = nodes.filter(isBoardNode).find((candidate) => candidate.data.boardId === boardId);
  const hole = devicePortHoles(node.data).get(portId);
  if (!board || !hole) return null;
  return endpointAtHole(board.data.boardId, hole, traceForHole(board.data, hole));
}

export function physicalNetLabelForEndpoint(
  nodes: readonly Node[],
  nodeId: string | undefined,
  portId: string | undefined,
): string | undefined {
  return physicalEndpoint(nodes, nodeId, portId)?.netLabel;
}

/**
 * The copper net name a conductor would carry, or an explicit short when its
 * two ends sit on copper that already carries two different names.
 *
 * Refusing that connection is the only place physical copper is allowed to
 * *veto* an edit; it never rewrites a net that already exists.
 */
export function physicalEdgeNet(
  nodes: readonly Node[],
  edge: PhysicalEdgeLike,
  contextEdges: readonly PhysicalEdgeLike[] = [],
): PhysicalEdgeNet {
  const graph = createPhysicalGraph(nodes);
  for (const candidate of contextEdges) {
    if (edge.id !== undefined && candidate.id === edge.id) continue;
    graph.registerEdge(candidate);
  }
  const starts = graph.registerEdge(edge);
  const unique = labelsForComponent(graph, collectComponent(graph, starts));
  return unique.length > 1 ? { conflict: unique } : { netLabel: unique[0], conflict: [] };
}

/** Evaluates a prospective connection once, including net conflict and copper identity. */
export function assessPhysicalConnection(
  nodes: readonly Node[],
  edge: PhysicalEdgeLike,
  contextEdges: readonly PhysicalEdgeLike[] = [],
): PhysicalConnectionAssessment {
  const net = physicalEdgeNet(nodes, edge, contextEdges);
  const source = physicalEndpoint(nodes, edge.source, edge.sourcePort);
  const target = physicalEndpoint(nodes, edge.target, edge.targetPort);
  return {
    ...net,
    sameCopper: !!source && !!target && physicalCopperKey(source) === physicalCopperKey(target),
  };
}

/**
 * Whether both diagram endpoints are board ports that canonicalize to the same
 * copper junction. Device pins deliberately do not participate: even when a
 * seated pin touches that copper, its canonical endpoint remains the pin.
 */
export function boardPortsResolveToSameCopper(
  nodes: readonly Node[],
  edge: PhysicalEdgeLike,
): boolean {
  const sourceNode = nodes.find((candidate) => candidate.id === edge.source);
  const targetNode = nodes.find((candidate) => candidate.id === edge.target);
  if (!sourceNode || !targetNode || !isBoardNode(sourceNode) || !isBoardNode(targetNode)) {
    return false;
  }
  const source = physicalEndpoint(nodes, edge.source, edge.sourcePort);
  const target = physicalEndpoint(nodes, edge.target, edge.targetPort);
  return !!source && !!target && physicalCopperKey(source) === physicalCopperKey(target);
}

/** Finds every connected conductor group that spans incompatible named copper. */
export function physicalGraphConflicts(
  nodes: readonly Node[],
  edges: readonly PhysicalEdgeLike[],
): PhysicalGraphConflict[] {
  const graph = createPhysicalGraph(nodes);
  for (const edge of edges) graph.registerEdge(edge);

  const visited = new Set<string>();
  const conflicts: PhysicalGraphConflict[] = [];
  for (const start of [...graph.adjacency.keys()].sort()) {
    if (visited.has(start)) continue;
    const component = collectComponent(graph, [start]);
    for (const key of component) visited.add(key);
    const conflict = labelsForComponent(graph, component);
    if (conflict.length < 2) continue;
    const conductorIds = [
      ...new Set([...component].flatMap((key) => [...(graph.conductorIdsByKey.get(key) ?? [])])),
    ].sort();
    conflicts.push({ conflict, conductorIds });
  }
  return conflicts.sort((left, right) =>
    (left.conductorIds[0] ?? '').localeCompare(right.conductorIds[0] ?? ''),
  );
}

interface PhysicalGraph {
  adjacency: Map<string, Set<string>>;
  labels: Map<string, string>;
  conductorIdsByKey: Map<string, Set<string>>;
  registerEdge: (edge: PhysicalEdgeLike) => string[];
}

function createPhysicalGraph(nodes: readonly Node[]): PhysicalGraph {
  const adjacency = new Map<string, Set<string>>();
  const labels = new Map<string, string>();
  const conductorIdsByKey = new Map<string, Set<string>>();

  const connect = (left: string, right: string): void => {
    const leftNeighbors = adjacency.get(left) ?? new Set<string>();
    const rightNeighbors = adjacency.get(right) ?? new Set<string>();
    leftNeighbors.add(right);
    rightNeighbors.add(left);
    adjacency.set(left, leftNeighbors);
    adjacency.set(right, rightNeighbors);
  };

  const registerEndpoint = (
    nodeId: string | undefined,
    portId: string | undefined,
  ): string | undefined => {
    if (!nodeId || !portId) return undefined;
    const key = diagramEndpointKey(nodeId, portId);
    adjacency.set(key, adjacency.get(key) ?? new Set<string>());
    const endpoint = physicalEndpoint(nodes, nodeId, portId);
    if (!endpoint) return key;
    const copperKey = physicalCopperKey(endpoint);
    connect(key, copperKey);
    if (endpoint.netLabel) labels.set(copperKey, endpoint.netLabel);
    return key;
  };

  const registerEdge = (candidate: PhysicalEdgeLike): string[] => {
    const from = registerEndpoint(candidate.source, candidate.sourcePort);
    const to = registerEndpoint(candidate.target, candidate.targetPort);
    if (from && to) connect(from, to);
    const keys = [from, to].filter((key): key is string => key !== undefined);
    if (candidate.id !== undefined) {
      for (const key of keys) {
        const conductorIds = conductorIdsByKey.get(key) ?? new Set<string>();
        conductorIds.add(candidate.id);
        conductorIdsByKey.set(key, conductorIds);
      }
    }
    return keys;
  };

  return { adjacency, labels, conductorIdsByKey, registerEdge };
}

function collectComponent(graph: PhysicalGraph, starts: readonly string[]): Set<string> {
  const visited = new Set<string>();
  const pending = [...starts];
  while (pending.length > 0) {
    const key = pending.pop();
    if (!key || visited.has(key)) continue;
    visited.add(key);
    for (const neighbor of graph.adjacency.get(key) ?? []) pending.push(neighbor);
  }
  return visited;
}

function labelsForComponent(graph: PhysicalGraph, component: ReadonlySet<string>): string[] {
  return [...new Set([...component].map((key) => graph.labels.get(key)).filter(isString))].sort();
}

/**
 * The net name a *new* conductor should be born with.
 *
 * Only ever fills a blank: an edge that already carries a name (typically one
 * an import wrote) keeps it, and the divergence is reported by
 * `physical-diagnostics.ts` instead of being silently overwritten.
 */
export function initialNetNameFromCopper(
  storedNetName: string | undefined,
  physical: PhysicalEdgeNet,
): string | undefined {
  if (storedNetName) return storedNetName;
  return physical.conflict.length > 0 ? undefined : physical.netLabel;
}

function endpointAtHole(
  boardId: string,
  hole: BoardHole,
  trace: ReturnType<typeof traceForHole>,
): PhysicalEndpoint {
  return {
    boardId,
    hole,
    traceId: trace?.id,
    traceLabel: trace?.label,
    netLabel: trace?.net,
  };
}

function diagramEndpointKey(nodeId: string, portId: string): string {
  return `endpoint:${JSON.stringify([nodeId, portId])}`;
}

function physicalCopperKey(endpoint: PhysicalEndpoint): string {
  return endpoint.traceId
    ? `copper:${JSON.stringify([endpoint.boardId, 'trace', endpoint.traceId])}`
    : `copper:${JSON.stringify([endpoint.boardId, 'hole', endpoint.hole.row, endpoint.hole.col])}`;
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}

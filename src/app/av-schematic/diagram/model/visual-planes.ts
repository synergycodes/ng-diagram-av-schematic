import { type Edge, type Node } from 'ng-diagram';
import { isBoardNode, isDeviceNode, isJunctionNode, isWireEdge } from './guards';
import { OPERATIONAL_LIMITS } from './operational-limits.mjs';

export const DEFAULT_VISUAL_PLANES = Object.freeze({
  board: 0,
  component: 10,
  conductor: 20,
  junction: 30,
});

export const MIN_VISUAL_PLANE = -OPERATIONAL_LIMITS.maxVisualPlane;
export const MAX_VISUAL_PLANE = OPERATIONAL_LIMITS.maxVisualPlane;

export type VisualElementKind = 'board' | 'component' | 'conductor' | 'junction';

export function defaultVisualPlane(kind: VisualElementKind): number {
  return DEFAULT_VISUAL_PLANES[kind];
}

export function visualElementKind(element: Node | Edge): VisualElementKind | null {
  if (isBoardNode(element as Node)) return 'board';
  if (isDeviceNode(element as Node)) return 'component';
  if (isJunctionNode(element as Node)) return 'junction';
  if (isWireEdge(element as Edge)) return 'conductor';
  return null;
}

export function visualPlaneOf(element: Node | Edge): number {
  const kind = visualElementKind(element);
  if (!kind) return 0;
  const value = (element.data as { visualPlane?: unknown }).visualPlane;
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? value
    : defaultVisualPlane(kind);
}

export function isValidVisualPlane(value: number): boolean {
  return Number.isSafeInteger(value) && value >= MIN_VISUAL_PLANE && value <= MAX_VISUAL_PLANE;
}

/**
 * Normalizes persisted planes and maps them to ng-diagram's shared z-order.
 * Stable kind/id ordering removes insertion-order dependence inside a plane.
 */
export function applyVisualZOrder<TNode extends Node, TEdge extends Edge>(
  nodes: readonly TNode[],
  edges: readonly TEdge[],
): { nodes: TNode[]; edges: TEdge[] } {
  const jumperOwnerIds = new Set(
    edges.flatMap((edge) => {
      const ownerId = isWireEdge(edge) ? edge.data.jumperBoardId : undefined;
      return typeof ownerId === 'string' ? [ownerId] : [];
    }),
  );
  const normalizedNodes = nodes.map((node) => {
    if (
      !isBoardNode(node) ||
      !jumperOwnerIds.has(node.data.boardId) ||
      visualPlaneOf(node) < MAX_VISUAL_PLANE
    ) {
      return node;
    }
    return {
      ...node,
      data: { ...node.data, visualPlane: MAX_VISUAL_PLANE - 1 },
    };
  });
  const boardsById = new Map<string, Node>();
  for (const node of normalizedNodes) {
    if (isBoardNode(node)) boardsById.set(node.data.boardId, node);
  }
  const normalizedEdges = edges.map((edge) => {
    const ownerId = isWireEdge(edge) ? edge.data.jumperBoardId : undefined;
    const owner = ownerId ? boardsById.get(ownerId) : undefined;
    if (!owner || visualPlaneOf(edge) > visualPlaneOf(owner)) return edge;
    return {
      ...edge,
      data: { ...edge.data, visualPlane: visualPlaneOf(owner) + 1 },
    };
  });
  const entries = [
    ...normalizedNodes.map((element) => ({ element, collection: 'node' as const })),
    ...normalizedEdges.map((element) => ({ element, collection: 'edge' as const })),
  ]
    .filter(({ element }) => visualElementKind(element) !== null)
    .sort((a, b) => compareVisualElements(a.element, b.element));
  const zOrderByKey = new Map(
    entries.map(({ collection, element }, index) => [`${collection}:${element.id}`, index]),
  );

  return {
    nodes: normalizedNodes.map((node) =>
      normalizeElement(node, zOrderByKey.get(`node:${node.id}`)),
    ),
    edges: normalizedEdges.map((edge) =>
      normalizeElement(edge, zOrderByKey.get(`edge:${edge.id}`)),
    ),
  };
}

function compareVisualElements(a: Node | Edge, b: Node | Edge): number {
  const planeDifference = visualPlaneOf(a) - visualPlaneOf(b);
  if (planeDifference !== 0) return planeDifference;
  const kindA = visualElementKind(a) ?? '';
  const kindB = visualElementKind(b) ?? '';
  const kindDifference = compareText(kindA, kindB);
  return kindDifference || compareText(a.id, b.id);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeElement<T extends Node | Edge>(element: T, zOrder: number | undefined): T {
  const kind = visualElementKind(element);
  if (!kind || zOrder === undefined) return { ...element };
  return {
    ...element,
    zOrder,
    data: {
      ...element.data,
      visualPlane: visualPlaneOf(element),
    },
  };
}

import { type Edge, type Node } from 'ng-diagram';
import { boardJumperForConnection, isBoardJumperEdge } from './board-jumper';
import { isBoardNode, isDeviceNode, isJunctionNode } from './guards';

export interface PastedBoardOwnershipPlan {
  nodeUpdates: (Pick<Node, 'id'> & Partial<Node>)[];
  edgeUpdates: (Pick<Edge, 'id'> & Partial<Edge>)[];
  rejectedEdgeIds: string[];
}

/** Remaps copied board domain ids and rejects jumpers whose copied owner is absent. */
export function planPastedBoardOwnership(
  pastedNodes: readonly Node[],
  pastedEdges: readonly Edge[],
  allNodes: readonly Node[],
): PastedBoardOwnershipPlan {
  const pastedNodeIds = new Set(pastedNodes.map((node) => node.id));
  const usedDomainIds = new Set(
    allNodes.flatMap((node) => {
      if (pastedNodeIds.has(node.id)) return [];
      return isBoardNode(node) ? [node.id, node.data.boardId] : [node.id];
    }),
  );
  const boardIdByNodeId = new Map<string, string>();
  const boardIdRemap = new Map<string, string>();

  for (const board of pastedNodes.filter(isBoardNode)) {
    const nextBoardId = uniqueBoardId(board.id, usedDomainIds);
    usedDomainIds.add(nextBoardId);
    boardIdByNodeId.set(board.id, nextBoardId);
    boardIdRemap.set(board.data.boardId, nextBoardId);
  }

  const nodeUpdates: PastedBoardOwnershipPlan['nodeUpdates'] = [];
  for (const node of pastedNodes) {
    if (isBoardNode(node)) {
      const boardId = boardIdByNodeId.get(node.id);
      if (boardId && boardId !== node.data.boardId) {
        nodeUpdates.push({ id: node.id, data: { ...node.data, boardId } });
      }
      continue;
    }
    if (isDeviceNode(node)) {
      const boardId = node.data.boardId ? boardIdRemap.get(node.data.boardId) : undefined;
      const placementBoardId = node.data.placement
        ? boardIdRemap.get(node.data.placement.boardId)
        : undefined;
      if (boardId || placementBoardId) {
        nodeUpdates.push({
          id: node.id,
          data: {
            ...node.data,
            boardId: boardId ?? node.data.boardId,
            placement: node.data.placement
              ? {
                  ...node.data.placement,
                  boardId: placementBoardId ?? node.data.placement.boardId,
                }
              : undefined,
          },
        });
      }
      continue;
    }
    if (isJunctionNode(node) && node.data.boardId) {
      const boardId = boardIdRemap.get(node.data.boardId);
      if (boardId) nodeUpdates.push({ id: node.id, data: { ...node.data, boardId } });
    }
  }

  const projectedNodes = allNodes.map((node) => {
    const update = nodeUpdates.find((candidate) => candidate.id === node.id);
    return update?.data ? { ...node, data: update.data } : node;
  });
  const edgeUpdates: PastedBoardOwnershipPlan['edgeUpdates'] = [];
  const rejectedEdgeIds: string[] = [];
  for (const edge of pastedEdges) {
    if (!isBoardJumperEdge(edge)) continue;
    const ownerId = edge.source === edge.target ? boardIdByNodeId.get(edge.source) : undefined;
    if (!ownerId) {
      rejectedEdgeIds.push(edge.id);
      continue;
    }
    const candidate = { ...edge, data: { ...edge.data, jumperBoardId: ownerId } };
    const jumper = boardJumperForConnection(projectedNodes, candidate);
    if (jumper?.board.data.boardId !== ownerId) {
      rejectedEdgeIds.push(edge.id);
      continue;
    }
    if (ownerId !== edge.data.jumperBoardId) {
      edgeUpdates.push({ id: edge.id, data: candidate.data });
    }
  }

  return { nodeUpdates, edgeUpdates, rejectedEdgeIds };
}

function uniqueBoardId(preferred: string, used: ReadonlySet<string>): string {
  if (!used.has(preferred)) return preferred;
  let suffix = 2;
  while (used.has(`${preferred}-${suffix}`)) suffix++;
  return `${preferred}-${suffix}`;
}

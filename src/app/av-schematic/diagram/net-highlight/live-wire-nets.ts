import { type Edge, type Node } from 'ng-diagram';
import { endpointKeysOf, groupConductorsIntoNets } from '../model/net-grouping';
import { stableIdFragment } from '../model/canonical-project';
import { isDeviceNode, isJunctionNode, isWireEdge } from '../model/guards';

export interface LiveWireNet {
  readonly id: string;
  readonly name: string;
  readonly edgeIds: readonly string[];
}

interface KeyedWire {
  readonly edge: Edge;
  readonly fromKey: string;
  readonly toKey: string;
}

type LiveNodeKind = 'device' | 'junction';

const liveEndpointKey = (
  nodeKinds: ReadonlyMap<string, LiveNodeKind>,
  nodeId: string | undefined,
  portId: string | undefined,
): string | null => {
  if (!nodeId || !portId) return null;
  const kind = nodeKinds.get(nodeId);
  if (kind === 'junction') return `junction:${encodeURIComponent(nodeId)}`;
  if (kind === 'device') {
    return `pin:${encodeURIComponent(nodeId)}/${encodeURIComponent(portId)}`;
  }
  return null;
};

/**
 * Derives the net for every complete wire from the current diagram graph.
 *
 * `WireEdgeData.netId` is only a serialization snapshot. Using the live
 * endpoints here makes freshly drawn and relinked wires immediately
 * inspectable without mutating model data or waiting for a save/open cycle.
 */
export function deriveLiveWireNets(
  nodes: readonly Node[],
  edges: readonly Edge[],
): ReadonlyMap<string, LiveWireNet> {
  const nodeKinds = new Map<string, LiveNodeKind>();
  for (const node of nodes) {
    if (isDeviceNode(node)) nodeKinds.set(node.id, 'device');
    else if (isJunctionNode(node)) nodeKinds.set(node.id, 'junction');
  }

  const keyedWires: KeyedWire[] = [];
  for (const edge of edges) {
    if (!isWireEdge(edge)) continue;
    const fromKey = liveEndpointKey(nodeKinds, edge.source, edge.sourcePort);
    const toKey = liveEndpointKey(nodeKinds, edge.target, edge.targetPort);
    if (!fromKey || !toKey) continue;
    keyedWires.push({ edge, fromKey, toKey });
  }

  const netsByEdgeId = new Map<string, LiveWireNet>();
  for (const group of groupConductorsIntoNets(keyedWires)) {
    const keys = endpointKeysOf(group);
    const id = `net-${stableIdFragment(keys[0])}`;
    const nameHints = group
      .map(({ edge }) => (isWireEdge(edge) ? edge.data.netName : undefined))
      .filter((name): name is string => !!name)
      .sort();
    const net: LiveWireNet = {
      id,
      name: nameHints[0] ?? id,
      edgeIds: group.map(({ edge }) => edge.id),
    };
    for (const edgeId of net.edgeIds) netsByEdgeId.set(edgeId, net);
  }
  return netsByEdgeId;
}

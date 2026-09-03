import { type Edge, type Node } from 'ng-diagram';
import { parseHolePortId, parseTracePortId } from './board-ports';
import { isBoardNode, isDeviceNode, isJunctionNode } from './guards';
import { junctionTapIndex } from './canonical-project';
import { physicalEndpoint } from './physical-connectivity';

/** A wire end, described the way both the sidebar and the canvas chip show it. */
export interface WireEndpointInfo {
  deviceId: string;
  portLabel: string;
}

export interface WireEndpoints {
  source: WireEndpointInfo | null;
  target: WireEndpointInfo | null;
}

/**
 * Resolve one wire end to the node + port labels a human reads.
 *
 * Null for a dangling end (no node), for an endpoint kind not represented by
 * this slice, or for a node that is not in `nodes`. `deviceId` remains the
 * stable display-label field consumed by the wire form and canvas chip, even
 * when the endpoint is a board.
 */
export const describeWireEndpoint = (
  nodes: readonly Node[],
  nodeId: string | undefined,
  portId: string | undefined,
): WireEndpointInfo | null => {
  if (!nodeId) return null;
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;
  if (isJunctionNode(node)) {
    const tap = junctionTapIndex(portId);
    return {
      deviceId: node.data.label,
      portLabel: tap === undefined ? (portId ?? '') : `tap ${tap + 1}`,
    };
  }

  const physical = physicalEndpoint(nodes, nodeId, portId);
  if (isDeviceNode(node)) {
    const port = portId ? node.data.ports.find((candidate) => candidate.id === portId) : undefined;
    const physicalSuffix = physical
      ? ` · L${physical.hole.row + 1}-C${physical.hole.col + 1}${formatNet(physical.netLabel)}`
      : '';
    return {
      deviceId: node.data.deviceId,
      portLabel: `${port?.label ?? portId ?? ''}${physicalSuffix}`,
    };
  }

  if (isBoardNode(node) && portId && physical) {
    const hole = parseHolePortId(portId);
    const traceId = parseTracePortId(portId);
    const trace = traceId
      ? node.data.traces?.find((candidate) => candidate.id === traceId)
      : undefined;
    const label = hole
      ? `L${hole.row + 1}-C${hole.col + 1}${physical.traceLabel ? ` · ${physical.traceLabel}` : ''}`
      : (trace?.label ?? portId);
    return {
      deviceId: node.data.label,
      portLabel: `${label}${formatNet(physical.netLabel)}`,
    };
  }

  return null;
};

const formatNet = (netName: string | undefined): string => (netName ? ` (${netName})` : '');

/**
 * Both ends of a wire. Single source of truth for "where does this wire go",
 * shared by the properties sidebar and the on-canvas inspection chip so the two
 * can never disagree.
 */
export const describeWireEndpoints = (
  nodes: readonly Node[],
  edge: Pick<Edge, 'source' | 'sourcePort' | 'target' | 'targetPort'>,
): WireEndpoints => ({
  source: describeWireEndpoint(nodes, edge.source, edge.sourcePort),
  target: describeWireEndpoint(nodes, edge.target, edge.targetPort),
});

/** "NANO-1 x D9", or an em dash when the end is dangling. */
export const formatWireEndpoint = (endpoint: WireEndpointInfo | null): string => {
  if (!endpoint) return '—';
  return endpoint.portLabel ? `${endpoint.deviceId} · ${endpoint.portLabel}` : endpoint.deviceId;
};

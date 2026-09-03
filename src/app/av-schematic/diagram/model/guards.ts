import { type Edge, type Node } from 'ng-diagram';
import {
  type BoardNodeData,
  type DeviceNodeData,
  type JunctionNodeData,
  type WireEdgeData,
} from './interfaces';

export function isDeviceNodeData(data: unknown): data is DeviceNodeData {
  return typeof data === 'object' && data !== null && 'type' in data && data.type === 'device';
}

export function isDeviceNode(node: Node | null | undefined): node is Node<DeviceNodeData> {
  return !!node && isDeviceNodeData(node.data);
}

export function isBoardNodeData(data: unknown): data is BoardNodeData {
  return typeof data === 'object' && data !== null && 'type' in data && data.type === 'board';
}

export function isBoardNode(node: Node | null | undefined): node is Node<BoardNodeData> {
  return !!node && isBoardNodeData(node.data);
}

export function isJunctionNodeData(data: unknown): data is JunctionNodeData {
  return typeof data === 'object' && data !== null && 'type' in data && data.type === 'junction';
}

export function isJunctionNode(node: Node | null | undefined): node is Node<JunctionNodeData> {
  return !!node && isJunctionNodeData(node.data);
}

export function isWireEdgeData(data: unknown): data is WireEdgeData {
  return typeof data === 'object' && data !== null && 'type' in data && data.type === 'wire';
}

export function isWireEdge(edge: Edge | null | undefined): edge is Edge<WireEdgeData> {
  return !!edge && isWireEdgeData(edge.data);
}

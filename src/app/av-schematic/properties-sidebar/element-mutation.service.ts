import { inject, Injectable } from '@angular/core';
import {
  NgDiagramModelService,
  NgDiagramService,
  type Edge,
  type Node,
  type Point,
} from 'ng-diagram';
import {
  type DevicePort,
  type DeviceNodeData,
  type WireEdgeData,
} from '../diagram/model/interfaces';
import { formDataToDeviceData, type DeviceFieldChange } from '../device-form/device-form.mappers';
import { formDataToWireData, type WireFieldChange } from './components/wire-form/wire-form.mappers';
import { applyEdgeStretchOnSelectionMoved } from '../diagram/edge-reshaping/middleware/edge-stretch-on-move';

/** Mutates diagram nodes and edges in response to sidebar form changes and removal requests. */
@Injectable()
export class ElementMutationService {
  private readonly modelService = inject(NgDiagramModelService);
  private readonly diagramService = inject(NgDiagramService);

  async removeNode(nodeId: string): Promise<void> {
    await this.modelService.deleteNodes([nodeId]);
  }

  async removeEdge(edgeId: string): Promise<void> {
    await this.modelService.deleteEdges([edgeId]);
  }

  /** Removes a mixed selection; wires go first so none is deleted twice via its device. */
  async removeElements(nodeIds: readonly string[], edgeIds: readonly string[]): Promise<void> {
    if (edgeIds.length > 0) await this.modelService.deleteEdges([...edgeIds]);
    if (nodeIds.length > 0) await this.modelService.deleteNodes([...nodeIds]);
  }

  handleDeviceFieldChange(change: DeviceFieldChange): void {
    const node = this.modelService.getNodeById<DeviceNodeData>(change.entityId);
    if (!node) return;
    const updatedData = formDataToDeviceData(change.formData, node.data);
    const portsChanged = change.fields.includes('ports');

    if (!portsChanged) {
      void this.modelService.updateNodeData(change.entityId, updatedData);
      return;
    }

    const orphanedEdgeIds = this.findOrphanedEdgeIds(
      change.entityId,
      node.data.ports,
      updatedData.ports,
    );
    const flippedPortIds = findDirectionFlippedPortIds(node.data.ports, updatedData.ports);
    const orphanedSet = new Set(orphanedEdgeIds);
    const affectedEdgeIds = flippedPortIds.size
      ? this.modelService
          .getConnectedEdges(change.entityId)
          .filter(
            (edge) =>
              !orphanedSet.has(edge.id) &&
              ((edge.source === change.entityId && flippedPortIds.has(edge.sourcePort ?? '')) ||
                (edge.target === change.entityId && flippedPortIds.has(edge.targetPort ?? ''))),
          )
          .map((edge) => edge.id)
      : [];

    void this.diagramService
      .transaction(
        () => {
          void this.modelService.updateNodeData(change.entityId, updatedData);
          if (orphanedEdgeIds.length > 0) {
            void this.modelService.deleteEdges(orphanedEdgeIds);
          }
        },
        { waitForMeasurements: true },
      )
      .then(async () => {
        await this.diagramService.invalidateMeasurements({ nodes: [{ nodeId: change.entityId }] });
        if (affectedEdgeIds.length > 0) {
          await this.reflowFlippedPortEdges(change.entityId, flippedPortIds, affectedEdgeIds);
        }
        // Any ports change (flip, reorder, removal) shifts sibling port rows, so
        // manual edges on unchanged ports need re-anchoring too.
        applyEdgeStretchOnSelectionMoved(this.modelService, new Set([change.entityId]), true);
      });
  }

  private async reflowFlippedPortEdges(
    nodeId: string,
    flippedPortIds: ReadonlySet<string>,
    edgeIds: readonly string[],
  ): Promise<void> {
    const updates: {
      id: string;
      points: Point[] | undefined;
      routingMode: 'manual' | 'auto';
    }[] = [];
    for (const edgeId of edgeIds) {
      const edge = this.modelService.getEdgeById(edgeId);
      if (!edge) continue;
      const next = this.computeFlippedPath(edge, nodeId, flippedPortIds);
      if (!next) continue;
      if (next === 'reset') {
        updates.push({ id: edgeId, points: undefined, routingMode: 'auto' });
      } else {
        updates.push({ id: edgeId, points: next, routingMode: 'manual' });
      }
    }
    if (updates.length === 0) return;
    await this.modelService.updateEdges(updates);
  }

  private computeFlippedPath(
    edge: Edge,
    nodeId: string,
    flippedPortIds: ReadonlySet<string>,
  ): Point[] | 'reset' | null {
    const node = this.modelService.getNodeById(nodeId);
    if (!node) return null;

    const sourceFlipped = edge.source === nodeId && flippedPortIds.has(edge.sourcePort ?? '');
    const targetFlipped = edge.target === nodeId && flippedPortIds.has(edge.targetPort ?? '');
    if (!sourceFlipped && !targetFlipped) return null;

    // Auto-routed edges need no app reflow: the router routes to the
    // re-measured port side on its own. Only mirror user-shaped paths.
    const manualPoints =
      edge.routingMode === 'manual' && edge.points && edge.points.length >= 3 ? edge.points : null;
    if (!manualPoints) return null;

    const sourceNode = edge.source === nodeId ? node : this.modelService.getNodeById(edge.source);
    const targetNode = edge.target === nodeId ? node : this.modelService.getNodeById(edge.target);
    if (!sourceNode || !targetNode) return 'reset';

    const srcSide = getHorizontalPortSide(sourceNode, edge.sourcePort);
    const tgtSide = getHorizontalPortSide(targetNode, edge.targetPort);
    if (!srcSide || !tgtSide) return 'reset';

    const srcPos = computePortAnchor(sourceNode, edge.sourcePort, srcSide);
    const tgtPos = computePortAnchor(targetNode, edge.targetPort, tgtSide);
    if (!srcPos || !tgtPos) return 'reset';

    const nodeCenterX = node.position.x + (node.size?.width ?? 0) / 2;
    let next: Point[] = manualPoints.slice();
    if (sourceFlipped) next = flipEndpointAcrossNode(next, 'source', srcPos, nodeCenterX);
    if (targetFlipped) next = flipEndpointAcrossNode(next, 'target', tgtPos, nodeCenterX);
    return next;
  }

  private findOrphanedEdgeIds(
    nodeId: string,
    oldPorts: readonly DevicePort[],
    newPorts: readonly DevicePort[],
  ): string[] {
    const newIds = new Set(newPorts.map((p) => p.id));
    const removedIds = new Set(oldPorts.filter((p) => !newIds.has(p.id)).map((p) => p.id));
    if (removedIds.size === 0) return [];

    return this.modelService
      .getConnectedEdges(nodeId)
      .filter(
        (edge) =>
          (edge.source === nodeId && removedIds.has(edge.sourcePort ?? '')) ||
          (edge.target === nodeId && removedIds.has(edge.targetPort ?? '')),
      )
      .map((edge) => edge.id);
  }

  handleWireFieldChange(change: WireFieldChange): void {
    const edge = this.modelService.getEdgeById<WireEdgeData>(change.edgeId);
    if (!edge) return;
    const updatedData = formDataToWireData(change.formData, edge.data);
    void this.modelService.updateEdgeData(change.edgeId, updatedData);
  }

  resetEdgeRouting(edgeId: string): void {
    void this.modelService.updateEdge(edgeId, {
      points: undefined,
      routingMode: 'auto',
    });
  }
}

const findDirectionFlippedPortIds = (
  oldPorts: readonly DevicePort[],
  newPorts: readonly DevicePort[],
): Set<string> => {
  const oldById = new Map(oldPorts.map((p) => [p.id, p]));
  const flipped = new Set<string>();
  for (const next of newPorts) {
    const prev = oldById.get(next.id);
    if (prev && prev.direction !== next.direction) flipped.add(next.id);
  }
  return flipped;
};

const getHorizontalPortSide = (
  node: Node | null | undefined,
  portId: string | undefined,
): 'left' | 'right' | null => {
  if (!node || !portId) return null;
  const port = node.measuredPorts?.find((p) => p.id === portId);
  if (!port) return null;
  return port.side === 'left' || port.side === 'right' ? port.side : null;
};

const computePortAnchor = (
  node: Node,
  portId: string | undefined,
  side: 'left' | 'right',
): Point | null => {
  if (!portId) return null;
  const port = node.measuredPorts?.find((p) => p.id === portId);
  if (!port?.position || !port.size) return null;
  const x =
    side === 'left'
      ? port.position.x + node.position.x
      : port.position.x + node.position.x + port.size.width;
  const y = port.position.y + node.position.y + port.size.height / 2;
  return { x, y };
};

const flipEndpointAcrossNode = (
  points: readonly Point[],
  side: 'source' | 'target',
  newPortPosition: Point,
  nodeCenterX: number,
): Point[] => {
  const next = points.slice();
  const endpointIndex = side === 'source' ? 0 : next.length - 1;
  const neighbourIndex = side === 'source' ? 1 : next.length - 2;
  const beyondIndex = side === 'source' ? 2 : next.length - 3;
  const oldNeighbour = points[neighbourIndex];
  const newNeighbourX = 2 * nodeCenterX - oldNeighbour.x;

  next[endpointIndex] = { x: newPortPosition.x, y: newPortPosition.y };
  next[neighbourIndex] = { x: newNeighbourX, y: newPortPosition.y };

  // Carry the mirror through to the next bend if it shared X with the
  // neighbour, otherwise that segment turns diagonal.
  if (beyondIndex >= 0 && beyondIndex < next.length) {
    const beyond = points[beyondIndex];
    if (beyond.x === oldNeighbour.x) {
      next[beyondIndex] = { x: newNeighbourX, y: beyond.y };
    }
  }
  return next;
};

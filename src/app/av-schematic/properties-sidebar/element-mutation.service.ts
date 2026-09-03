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
  type JunctionNodeData,
  type WireEdgeData,
} from '../diagram/model/interfaces';
import { isBoardNode, isWireEdge } from '../diagram/model/guards';
import { junctionTapIndex, junctionTapPortId } from '../diagram/model/canonical-project';
import { canonicalColorValue } from '../diagram/model/wire-colors';
import { ProjectStorageService } from '../project-storage/project-storage.service';
import { formDataToDeviceData, type DeviceFieldChange } from '../device-form/device-form.mappers';
import { formDataToWireData, type WireFieldChange } from './components/wire-form/wire-form.mappers';
import { applyEdgeStretchOnSelectionMoved } from '../diagram/edge-reshaping/middleware/edge-stretch-on-move';
import {
  formDataToJunctionData,
  type JunctionFieldChange,
} from './components/junction-form/junction-form.mappers';
import {
  applyVisualZOrder,
  isValidVisualPlane,
  type VisualElementKind,
} from '../diagram/model/visual-planes';
import {
  boardJumperForConnection,
  boardWorldPoints,
  defaultBoardJumperLocalRoute,
} from '../diagram/model/board-jumper';
import { beginModelHistoryGroup } from '../diagram/model/model-history-group';

/** Mutates diagram nodes and edges in response to sidebar form changes and removal requests, including port-direction-flip reflow and orphaned-edge cleanup. */
@Injectable()
export class ElementMutationService {
  private readonly modelService = inject(NgDiagramModelService);
  private readonly diagramService = inject(NgDiagramService);
  private readonly storage = inject(ProjectStorageService);

  async removeNode(nodeId: string): Promise<void> {
    const node = this.modelService
      .getModel()
      .getNodes()
      .find((candidate) => candidate.id === nodeId);
    const jumperBoardId = isBoardNode(node) ? node.data.boardId : undefined;
    const jumperIds = this.modelService
      .getModel()
      .getEdges()
      .filter(
        (edge) =>
          isWireEdge(edge) &&
          jumperBoardId !== undefined &&
          edge.data.jumperBoardId === jumperBoardId,
      )
      .map((edge) => edge.id);
    const endHistoryGroup = beginModelHistoryGroup(this.modelService);
    try {
      if (jumperIds.length === 0) {
        await this.modelService.deleteNodes([nodeId]);
        return;
      }
      await this.diagramService.transaction(() => {
        void this.modelService.deleteEdges(jumperIds);
        void this.modelService.deleteNodes([nodeId]);
      });
    } finally {
      endHistoryGroup();
    }
  }

  async removeEdge(edgeId: string): Promise<void> {
    await this.modelService.deleteEdges([edgeId]);
  }

  async setVisualPlane(
    modelKind: 'node' | 'edge',
    elementKind: VisualElementKind,
    id: string,
    visualPlane: number,
  ): Promise<void> {
    if (!isValidVisualPlane(visualPlane)) return;
    const model = this.modelService.getModel();
    const nodes = model
      .getNodes()
      .map((node) =>
        modelKind === 'node' && node.id === id
          ? { ...node, data: { ...node.data, visualPlane } }
          : node,
      );
    const edges = model
      .getEdges()
      .map((edge) =>
        modelKind === 'edge' && edge.id === id
          ? { ...edge, data: { ...edge.data, visualPlane } }
          : edge,
      );
    const target =
      modelKind === 'node'
        ? nodes.find((node) => node.id === id)
        : edges.find((edge) => edge.id === id);
    const targetType = (target?.data as { type?: unknown } | undefined)?.type;
    if (!target || targetType !== elementKindToDataType(elementKind)) return;
    await this.applyVisualOrder(nodes, edges);
  }

  async normalizeVisualOrder(): Promise<void> {
    const model = this.modelService.getModel();
    await this.applyVisualOrder(model.getNodes(), model.getEdges());
  }

  private async applyVisualOrder(nodes: readonly Node[], edges: readonly Edge[]): Promise<void> {
    const ordered = applyVisualZOrder(nodes, edges);
    await this.diagramService.transaction(() => {
      void this.modelService.updateNodes(
        ordered.nodes.map((node) => ({ id: node.id, data: node.data, zOrder: node.zOrder })),
      );
      void this.modelService.updateEdges(
        ordered.edges.map((edge) => ({ id: edge.id, data: edge.data, zOrder: edge.zOrder })),
      );
    });
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
        await applyEdgeStretchOnSelectionMoved(this.modelService, new Set([change.entityId]), true);
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

  async handleWireFieldChange(change: WireFieldChange): Promise<void> {
    const edge = this.modelService.getEdgeById<WireEdgeData>(change.edgeId);
    if (!edge) return;
    const updatedData = formDataToWireData(change.formData, edge.data);
    const previousName = edge.data.wireId;
    const nextName = updatedData.wireId;
    const colorChanged = change.fields.some(
      (field) => field === 'colorChoice' || field === 'customColor',
    );
    const identityChanged =
      change.fields.includes('wireId') && previousName !== nextName && !!previousName;
    const wireEdges = this.modelService.getModel().getEdges().filter(isWireEdge);

    if (!identityChanged && (!colorChanged || !nextName)) {
      await this.modelService.updateEdgeData(change.edgeId, updatedData);
      return;
    }

    if (
      identityChanged &&
      nextName &&
      wireEdges.some(
        (candidate) => candidate.data.wireId === nextName && candidate.data.wireId !== previousName,
      )
    ) {
      throw new Error(`cannot rename cable "${previousName}" to existing cable "${nextName}"`);
    }

    await this.diagramService.transaction(() => {
      if (identityChanged) this.storage.renameCableIdentity(previousName, nextName);
      const selectedIndex = updatedData.wireIndex ?? 1;
      const serializedColor = canonicalColorValue({
        color: updatedData.color,
        colorCode: updatedData.colorCode,
      });
      for (const candidate of wireEdges) {
        const belongsToCable =
          candidate.data.wireId === (identityChanged ? previousName : nextName);
        if (
          candidate.id !== change.edgeId &&
          (!belongsToCable || (!identityChanged && !colorChanged))
        ) {
          continue;
        }

        let data =
          candidate.id === change.edgeId
            ? updatedData
            : identityChanged
              ? { ...candidate.data, wireId: nextName }
              : candidate.data;

        if (colorChanged && belongsToCable) {
          const cableColors = [...(data.cableColors ?? [])];
          while (cableColors.length < selectedIndex) cableColors.push('');
          cableColors[selectedIndex - 1] = serializedColor ?? '';
          data = {
            ...data,
            cableColors,
            ...((data.wireIndex ?? 1) === selectedIndex
              ? { color: updatedData.color, colorCode: updatedData.colorCode }
              : {}),
          };
        }
        void this.modelService.updateEdgeData(candidate.id, data);
      }
    });
  }

  handleJunctionFieldChange(change: JunctionFieldChange): void {
    const node = this.modelService.getNodeById<JunctionNodeData>(change.nodeId);
    if (!node) return;
    const updatedData = formDataToJunctionData(change.formData, node.data);
    const tapsChanged = updatedData.taps !== node.data.taps;
    if (!tapsChanged) {
      void this.modelService.updateNodeData(change.nodeId, updatedData);
      return;
    }

    const edgeUpdates = this.modelService.getConnectedEdges(change.nodeId).map((edge) => {
      const update: { id: string; sourcePort?: string; targetPort?: string } = { id: edge.id };
      if (edge.source === change.nodeId) {
        const index = junctionTapIndex(edge.sourcePort) ?? 0;
        update.sourcePort = junctionTapPortId(index % updatedData.taps);
      }
      if (edge.target === change.nodeId) {
        const index = junctionTapIndex(edge.targetPort) ?? 0;
        update.targetPort = junctionTapPortId(index % updatedData.taps);
      }
      return update;
    });

    void this.diagramService
      .transaction(
        () => {
          void this.modelService.updateNodeData(change.nodeId, updatedData);
          if (edgeUpdates.length > 0) void this.modelService.updateEdges(edgeUpdates);
        },
        { waitForMeasurements: true },
      )
      .then(() =>
        applyEdgeStretchOnSelectionMoved(this.modelService, new Set([change.nodeId]), true),
      );
  }

  resetEdgeRouting(edgeId: string): void {
    const edge = this.modelService.getEdgeById<WireEdgeData>(edgeId);
    const model = this.modelService.getModel();
    const jumper = edge ? boardJumperForConnection(model.getNodes(), edge) : null;
    if (edge?.data.jumperBoardId && jumper?.board.data.boardId === edge.data.jumperBoardId) {
      void this.modelService.updateEdge(edgeId, {
        routing: 'polyline',
        routingMode: 'manual',
        points: boardWorldPoints(
          jumper.board,
          defaultBoardJumperLocalRoute(jumper.board.data, jumper.sourceHole, jumper.targetHole),
        ),
      });
      return;
    }
    void this.modelService.updateEdge(edgeId, {
      points: undefined,
      routingMode: 'auto',
    });
  }
}

function elementKindToDataType(kind: VisualElementKind): string {
  if (kind === 'component') return 'device';
  if (kind === 'conductor') return 'wire';
  return kind;
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

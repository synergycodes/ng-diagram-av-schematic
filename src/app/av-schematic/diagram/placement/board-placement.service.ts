import { Injectable, computed, inject, signal } from '@angular/core';
import { NgDiagramModelService, type Node } from 'ng-diagram';
import { applyEdgeStretchOnSelectionMoved } from '../edge-reshaping/middleware/edge-stretch-on-move';
import { holeKey, type BoardHoleClaim } from '../model/board-geometry';
import { selectPlacementBoard } from '../model/board-selection';
import { resolveFootprint, type Footprint } from '../model/footprint';
import {
  DETACHED_FOOTPRINT_FALLBACK_PITCH,
  anchorAfterRotation,
  anchorForNodePosition,
  deviceHoleClaims,
  placementNodePosition,
  stepRotation,
  syncPortHolesToPlacement,
  validatePlacement,
  type PlacementConflict,
} from '../model/footprint-geometry';
import { isBoardNode, isDeviceNode, isWireEdge } from '../model/guards';
import { physicalGraphConflicts } from '../model/physical-connectivity';
import {
  NodeTemplateType,
  type BoardNodeData,
  type BoardRotation,
  type DeviceNodeData,
  type DevicePlacement,
} from '../model/interfaces';

/**
 * Owns "where is this component seated, and is that seat legal".
 *
 * Three jobs, all driven by ordinary ng-diagram node moves - no second canvas,
 * no parallel geometry model:
 *
 * 1. **Snap.** A footprinted component dropped anywhere over a board is seated
 *    on the nearest hole, and its node position is rewritten from the resulting
 *    anchor - so the pixels always agree with the hole address, never approximate it.
 * 2. **Occupancy.** A seat that would put two pins in one hole, or hang the
 *    footprint off the edge, is refused: the move is reverted to the last legal
 *    placement and the conflict is published for the UI to show. Nothing ever
 *    silently overlaps.
 * 3. **Follow.** Moving a board carries everything seated on it, because a part
 *    soldered to a board does not stay behind when the board moves.
 */
@Injectable()
export class BoardPlacementService {
  private readonly modelService = inject(NgDiagramModelService);

  private readonly _conflict = signal<PlacementConflict | null>(null);
  readonly conflict = this._conflict.asReadonly();

  readonly conflictMessage = computed(() => {
    const conflict = this._conflict();
    if (!conflict) return null;
    const where = conflict.holes.map((hole) => `L${hole.row + 1}-C${hole.col + 1}`).join(', ');
    switch (conflict.kind) {
      case 'out-of-bounds':
        return `"${conflict.nodeId}" não cabe em "${conflict.boardId}": ${where || 'fora da placa'}.`;
      case 'occupied':
        return `"${conflict.nodeId}" não pode ocupar ${where} em "${conflict.boardId}": já usado por ${conflict.blockedBy.join(', ')}.`;
      case 'net-conflict':
        return `"${conflict.nodeId}" não pode unir redes físicas incompatíveis: ${conflict.blockedBy.join(', ')}.`;
      case 'unknown-board':
        return `"${conflict.nodeId}" foi solto fora de qualquer placa.`;
      case 'unknown-footprint':
        return `"${conflict.nodeId}" não tem footprint conhecido.`;
    }
  });

  /** Hole keys to highlight on a board because the last rejected move wanted them. */
  conflictHoleKeys(boardId: string): ReadonlySet<string> {
    const conflict = this._conflict();
    if (conflict?.boardId !== boardId) return new Set<string>();
    return new Set(conflict.holes.map(holeKey));
  }

  dismissConflict(): void {
    this._conflict.set(null);
  }

  /**
   * Reconciles the model after nodes moved.
   *
   * Returns every node id whose position ended up changing (the moved nodes
   * plus any parts carried along by a board), so the caller can re-anchor the
   * manual edge routes touching them in one pass.
   */
  async settleDrag(movedNodeIds: ReadonlySet<string>): Promise<Set<string>> {
    const affected = new Set(movedNodeIds);
    for (const nodeId of await this.followBoards(movedNodeIds)) affected.add(nodeId);

    for (const node of this.modelService.getModel().getNodes()) {
      if (!movedNodeIds.has(node.id) || !isDeviceNode(node)) continue;
      if (!node.data.footprintId) continue;
      await this.seatDroppedNode(node);
    }
    return affected;
  }

  /**
   * Repositions every part seated on a moved board. Positions are recomputed
   * from each part's own anchor rather than by applying a delta, so a part can
   * never accumulate drift no matter how many times its board is dragged.
   */
  async followBoards(movedNodeIds: ReadonlySet<string>): Promise<Set<string>> {
    const moved = new Set<string>();
    const nodes = this.modelService.getModel().getNodes();
    const movedBoards = nodes.filter(isBoardNode).filter((node) => movedNodeIds.has(node.id));
    if (movedBoards.length === 0) return moved;

    const movedBoardIds = new Set(movedBoards.map((board) => board.data.boardId));
    const boardsById = new Map(movedBoards.map((board) => [board.data.boardId, board]));

    for (const node of nodes) {
      if (!isDeviceNode(node)) continue;
      const placement = node.data.placement;
      if (!placement || !movedBoardIds.has(placement.boardId)) continue;
      const board = boardsById.get(placement.boardId);
      if (!board) continue;

      const position = placementNodePosition(
        { board: board.data, position: board.position },
        placement,
      );
      if (position.x === node.position.x && position.y === node.position.y) continue;
      await this.modelService.updateNode(node.id, { position });
      moved.add(node.id);
    }
    return moved;
  }

  /** Rotates a component 90 degrees, validating the seat when it is on a board. */
  async rotate(nodeId: string, step: 1 | -1): Promise<boolean> {
    const node = this.modelService.getNodeById<DeviceNodeData>(nodeId);
    if (!node || !isDeviceNode(node)) return false;
    const placement = node.data.placement;
    const footprint = resolveFootprint(node.data);
    if (!footprint) return false;

    if (!placement) {
      this._conflict.set(null);
      await this.modelService.updateNode(
        nodeId,
        {
          data: {
            ...node.data,
            footprintRotation: stepRotation(node.data.footprintRotation ?? 0, step),
          },
        },
        { waitForMeasurements: true },
      );
      await applyEdgeStretchOnSelectionMoved(this.modelService, new Set([nodeId]), true);
      return true;
    }

    const board = this.findBoardById(placement.boardId);
    if (!board) {
      this._conflict.set({
        kind: 'unknown-board',
        nodeId,
        boardId: placement.boardId,
        holes: [],
        blockedBy: [],
      });
      return false;
    }

    const rotation: BoardRotation = stepRotation(placement.rotation, step);
    // Keep pin 1 fixed. The integer transform is exactly reversible after four
    // turns, unlike center deltas rounded at each step.
    const anchor = anchorAfterRotation(footprint, placement, rotation);

    const rotated = await this.commitPlacement(node, board, footprint, {
      boardId: placement.boardId,
      anchor,
      rotation,
    });
    if (rotated) {
      await applyEdgeStretchOnSelectionMoved(this.modelService, new Set([nodeId]), true);
    }
    return rotated;
  }

  /** Every hole currently claimed on any board, by any device. */
  currentClaims(): BoardHoleClaim[] {
    return this.modelService
      .getModel()
      .getNodes()
      .filter(isDeviceNode)
      .flatMap((node) => deviceHoleClaims(node.id, node.data));
  }

  private async seatDroppedNode(node: Node<DeviceNodeData>): Promise<void> {
    const footprint = resolveFootprint(node.data);
    if (!footprint) {
      this._conflict.set({
        kind: 'unknown-footprint',
        nodeId: node.id,
        boardId: node.data.placement?.boardId ?? '',
        holes: [],
        blockedBy: [],
      });
      return;
    }

    const board = this.findBoardUnder(node);
    if (!board) {
      if (node.data.placement) {
        await this.unseat(node);
        return;
      }
      if (
        node.type === NodeTemplateType.FootprintNode ||
        node.data.footprintRotation !== undefined ||
        node.data.footprintPitch !== undefined
      ) {
        this._conflict.set(null);
        return;
      }
      this._conflict.set({
        kind: 'unknown-board',
        nodeId: node.id,
        boardId: '',
        holes: [],
        blockedBy: [],
      });
      return;
    }

    const rotation = node.data.placement?.rotation ?? node.data.footprintRotation ?? 0;
    const currentBoard = this.findBoardById(node.data.placement?.boardId);
    const visualPitch =
      currentBoard?.data.pitch ??
      node.data.footprintPitch ??
      (node.type === NodeTemplateType.FootprintNode
        ? DETACHED_FOOTPRINT_FALLBACK_PITCH
        : board.data.pitch);
    const anchor = anchorForNodePosition(
      { board: board.data, position: board.position },
      node.position,
      visualPitch,
    );
    if (!anchor) {
      this._conflict.set({
        kind: 'out-of-bounds',
        nodeId: node.id,
        boardId: board.data.boardId,
        holes: [],
        blockedBy: [],
      });
      await this.revert(node, 'out-of-bounds');
      return;
    }
    const placement: DevicePlacement = { boardId: board.data.boardId, anchor, rotation };
    await this.commitPlacement(node, board, footprint, placement);
  }

  private async commitPlacement(
    node: Node<DeviceNodeData>,
    board: Node<BoardNodeData>,
    footprint: Footprint,
    placement: DevicePlacement,
  ): Promise<boolean> {
    const conflict = validatePlacement(
      node.id,
      board.data,
      footprint,
      placement,
      this.currentClaims(),
    );
    if (conflict) {
      this._conflict.set(conflict);
      await this.revert(node, conflict.kind);
      return false;
    }

    this._conflict.set(null);
    const data = syncPortHolesToPlacement({
      ...node.data,
      placement,
      boardId: placement.boardId,
      footprintRotation: placement.rotation,
      footprintPitch: board.data.pitch,
    });
    const previousNodes = this.modelService.getModel().getNodes();
    const connectedEdges = this.modelService.getConnectedEdges(node.id).filter(isWireEdge);
    const modelEdges = this.modelService.getModel().getEdges().filter(isWireEdge);
    const candidateNodes = previousNodes.map((candidate) =>
      candidate.id === node.id ? { ...candidate, data } : candidate,
    );
    const connectedEdgeIds = new Set(connectedEdges.map((edge) => edge.id));
    const conflictingNets = [
      ...new Set(
        physicalGraphConflicts(candidateNodes, modelEdges)
          .filter((entry) => entry.conductorIds.some((id) => connectedEdgeIds.has(id)))
          .flatMap((entry) => entry.conflict),
      ),
    ].sort();
    if (conflictingNets.length > 0) {
      this._conflict.set({
        kind: 'net-conflict',
        nodeId: node.id,
        boardId: placement.boardId,
        holes: [],
        blockedBy: conflictingNets,
      });
      await this.revert(node, 'net-conflict');
      return false;
    }

    await this.modelService.updateNode(
      node.id,
      {
        type: NodeTemplateType.FootprintNode,
        position: placementNodePosition({ board: board.data, position: board.position }, placement),
        data,
      },
      { waitForMeasurements: true },
    );
    return true;
  }

  /** Detaches a footprint from its board without changing its electrical wires. */
  private async unseat(node: Node<DeviceNodeData>): Promise<void> {
    this._conflict.set(null);
    const board = this.findBoardById(node.data.placement?.boardId);
    await this.modelService.updateNode(
      node.id,
      {
        type: NodeTemplateType.FootprintNode,
        data: {
          ...node.data,
          boardId: undefined,
          placement: undefined,
          footprintRotation: node.data.placement?.rotation ?? node.data.footprintRotation ?? 0,
          footprintPitch: board?.data.pitch ?? node.data.footprintPitch,
          ports: node.data.ports.map((port) => ({ ...port, hole: undefined })),
        },
      },
      { waitForMeasurements: true },
    );
  }

  /**
   * Puts a rejected node back on its last known good seat. A node that never
   * had one (dragged in from the palette straight onto an illegal spot) is left
   * where it is with the conflict published - throwing it back to nowhere would
   * be worse than showing why it can't sit there.
   */
  private async revert(node: Node<DeviceNodeData>, kind: PlacementConflict['kind']): Promise<void> {
    const placement = node.data.placement;
    const board = this.findBoardById(placement?.boardId);
    if (!placement || !board) {
      const current = this._conflict();
      if (current?.nodeId !== node.id || current?.kind !== kind) {
        this._conflict.set({
          kind,
          nodeId: node.id,
          boardId: placement?.boardId ?? '',
          holes: [],
          blockedBy: [],
        });
      }
      return;
    }
    await this.modelService.updateNode(node.id, {
      position: placementNodePosition({ board: board.data, position: board.position }, placement),
    });
  }

  private findBoardById(boardId: string | undefined): Node<BoardNodeData> | null {
    if (boardId === undefined) return null;
    return (
      this.modelService
        .getModel()
        .getNodes()
        .filter(isBoardNode)
        .find((node) => node.data.boardId === boardId) ?? null
    );
  }

  /** The board whose rendered body contains the dropped node's top-left corner. */
  private findBoardUnder(node: Node<DeviceNodeData>): Node<BoardNodeData> | null {
    return selectPlacementBoard(
      this.modelService.getModel().getNodes(),
      node.position,
      node.data.placement?.boardId,
    );
  }
}

import { inject, Injectable, signal } from '@angular/core';
import { NgDiagramModelService, NgDiagramService, type Edge, type Node } from 'ng-diagram';
import { randomShortId } from '../shared/utils/random-short-id';
import {
  boardJumperForConnection,
  boardWorldPoints,
  defaultBoardJumperLocalRoute,
  resolveBoardJumperStructure,
} from './model/board-jumper';
import { holePortId } from './model/board-ports';
import { assessPhysicalConnection } from './model/physical-connectivity';
import {
  EdgeTemplateType,
  type BoardHole,
  type BoardNodeData,
  type WireEdgeData,
} from './model/interfaces';
import { beginModelHistoryGroup } from './model/model-history-group';
import { applyVisualZOrder, defaultVisualPlane } from './model/visual-planes';

interface JumperStart {
  boardId: string;
  nodeId: string;
  portId: string;
}

type JumperValidation =
  | {
      ok: true;
      jumper: NonNullable<ReturnType<typeof boardJumperForConnection>>;
      netLabel?: string;
    }
  | { ok: false; message: string };

/** Two-click board jumper creation mode shared by the sidebar and board holes. */
@Injectable()
export class BoardJumperCreationService {
  private readonly modelService = inject(NgDiagramModelService);
  private readonly diagramService = inject(NgDiagramService);
  private readonly activeBoardIdState = signal<string | null>(null);
  private readonly startState = signal<JumperStart | null>(null);
  private readonly statusState = signal<string | null>(null);

  readonly activeBoardId = this.activeBoardIdState.asReadonly();
  readonly status = this.statusState.asReadonly();

  toggle(board: Node<BoardNodeData>): void {
    if (board.data.surface !== 'breadboard') return;
    if (this.activeBoardIdState() === board.data.boardId) {
      this.cancel();
      return;
    }
    this.activeBoardIdState.set(board.data.boardId);
    this.startState.set(null);
    this.statusState.set(null);
  }

  cancel(): void {
    this.activeBoardIdState.set(null);
    this.startState.set(null);
    this.statusState.set(null);
  }

  handles(board: Node<BoardNodeData>): boolean {
    return this.activeBoardIdState() === board.data.boardId;
  }

  isStart(boardId: string, hole: BoardHole): boolean {
    const start = this.startState();
    return start?.boardId === boardId && start.portId === holePortId(hole);
  }

  selectHole(board: Node<BoardNodeData>, hole: BoardHole): boolean {
    if (this.activeBoardIdState() === null) return false;
    const portId = holePortId(hole);
    const start = this.startState();
    if (this.activeBoardIdState() !== board.data.boardId) {
      this.statusState.set('Owner inválido: selecione os dois furos na mesma protoboard.');
      return true;
    }
    if (!start) {
      this.statusState.set(null);
      this.startState.set({ boardId: board.data.boardId, nodeId: board.id, portId });
      return true;
    }
    if (start.boardId !== board.data.boardId || start.nodeId !== board.id) {
      this.startState.set(null);
      this.statusState.set('Owner inválido: selecione os dois furos na mesma protoboard.');
      return true;
    }

    const model = this.modelService.getModel();
    const connection = {
      source: start.nodeId,
      sourcePort: start.portId,
      target: board.id,
      targetPort: portId,
    };
    const validation = this.validateConnection(model.getNodes(), model.getEdges(), connection);
    if (!validation.ok) {
      this.startState.set(null);
      this.statusState.set(validation.message);
      return true;
    }
    const { jumper } = validation;

    const points = boardWorldPoints(
      jumper.board,
      defaultBoardJumperLocalRoute(jumper.board.data, jumper.sourceHole, jumper.targetHole),
    );
    const edge: Edge<WireEdgeData> = {
      id: this.uniqueId('jumper', new Set(model.getEdges().map((candidate) => candidate.id))),
      type: EdgeTemplateType.WireEdge,
      source: jumper.board.id,
      sourcePort: start.portId,
      target: jumper.board.id,
      targetPort: portId,
      routing: 'polyline',
      routingMode: 'manual',
      points,
      data: {
        type: 'wire',
        visualPlane: defaultVisualPlane('conductor'),
        wireId: this.uniqueId(
          'W',
          new Set(
            model
              .getEdges()
              .map((candidate) => (candidate.data as { wireId?: unknown }).wireId)
              .filter((wireId): wireId is string => typeof wireId === 'string'),
          ),
        ),
        wireType: 'jumper',
        jumperBoardId: jumper.board.data.boardId,
        netName: validation.netLabel,
      },
    };

    this.commitProjectedState(model.getNodes(), model.getEdges(), edge);
    this.cancel();
    return true;
  }

  private validateConnection(
    nodes: readonly Node[],
    edges: readonly Edge[],
    connection: { source: string; sourcePort: string; target: string; targetPort: string },
  ): JumperValidation {
    if (connection.sourcePort === connection.targetPort) {
      return { ok: false, message: 'Os furos de origem e destino devem ser diferentes.' };
    }
    const physical = assessPhysicalConnection(nodes, connection, edges);
    if (physical.conflict.length > 0) {
      return {
        ok: false,
        message: 'Conflito entre nets: os furos pertencem a redes de cobre incompatíveis.',
      };
    }
    if (physical.sameCopper) {
      return { ok: false, message: 'Os furos pertencem ao mesmo grupo de cobre.' };
    }
    const jumper = resolveBoardJumperStructure(nodes, connection);
    return jumper
      ? { ok: true, jumper, netLabel: physical.netLabel }
      : { ok: false, message: 'Owner inválido: selecione dois furos da mesma protoboard.' };
  }

  private commitProjectedState(
    nodes: readonly Node[],
    edges: readonly Edge[],
    created: Edge<WireEdgeData>,
  ): void {
    const ordered = applyVisualZOrder(nodes, [...edges, created]);
    const jumper = ordered.edges.find((edge) => edge.id === created.id);
    if (!jumper) return;
    const existingEdges = ordered.edges.filter((edge) => edge.id !== created.id);
    const endHistoryGroup = beginModelHistoryGroup(this.modelService);

    void this.diagramService
      .transaction(() => {
        void this.modelService.updateNodes(
          ordered.nodes.map((node) => ({ id: node.id, data: node.data, zOrder: node.zOrder })),
        );
        if (existingEdges.length > 0) {
          void this.modelService.updateEdges(
            existingEdges.map((edge) => ({ id: edge.id, data: edge.data, zOrder: edge.zOrder })),
          );
        }
        void this.modelService.addEdges([jumper]);
      })
      .finally(endHistoryGroup);
  }

  private uniqueId(prefix: string, used: ReadonlySet<string>): string {
    let candidate = randomShortId(prefix);
    while (used.has(candidate)) candidate = randomShortId(prefix);
    return candidate;
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  DiagramInitEvent,
  initializeModel,
  NgDiagramBackgroundComponent,
  NgDiagramComponent,
  NgDiagramEdgeTemplateMap,
  NgDiagramModelService,
  NgDiagramNodeTemplateMap,
  NgDiagramViewportService,
  type Edge,
  type EdgeDrawEndedEvent,
  type ClipboardPastedEvent,
  type NgDiagramConfig,
  type Node,
  type NodeDragEndedEvent,
  type NodeDragStartedEvent,
  type PaletteItemDroppedEvent,
  type Port,
  type SelectionGestureEndedEvent,
  type SelectionMovedEvent,
} from 'ng-diagram';
import { AV_SCHEMATIC_CONFIG } from '../av-schematic.config';
import { snapPointToGrid } from './edge-reshaping/logic';
import { DanglingEdgeService } from './dangling-edge-creation/dangling-edge.service';
import { DiagramExportService } from '../export/diagram-export.service';
import { PropertiesSidebarService } from '../properties-sidebar/properties-sidebar.service';
import { ElementMutationService } from '../properties-sidebar/element-mutation.service';
import { randomShortId } from '../shared/utils/random-short-id';
import { generateDeviceId } from './model/auto-device-id';
import { isBoardNode, isDeviceNode, isJunctionNode, isWireEdge } from './model/guards';
import {
  boardPortsResolveToSameCopper,
  initialNetNameFromCopper,
  physicalEdgeNet,
} from './model/physical-connectivity';
import { snapForNode } from './model/physical-snap';
import {
  EdgeTemplateType,
  NodeTemplateType,
  type DeviceNodeData,
  type WireEdgeData,
} from './model/interfaces';
import { NodeVisibilityConfigService } from './node-visibility/node-visibility-config.service';
import { BoardNodeComponent } from './node/board-node.component';
import { DeviceNodeComponent } from './node/device-node.component';
import { FootprintNodeComponent } from './node/footprint-node.component';
import { JunctionNodeComponent } from './node/junction-node.component';
import { BoardPlacementService } from './placement/board-placement.service';
import { applyEdgeStretchOnSelectionMoved } from './edge-reshaping/middleware/edge-stretch-on-move';
import { EdgeReshapeOverlayComponent } from './edge-reshaping/edge-reshape-overlay.component';
import { WireEdgeComponent } from './wire-edge.component';
import { diagramModel } from './data';
import { defaultVisualPlane, MAX_VISUAL_PLANE, visualPlaneOf } from './model/visual-planes';
import {
  boardJumperForConnection,
  boardWorldPoints,
  defaultBoardJumperLocalRoute,
} from './model/board-jumper';
import { UndoableDiagramModelAdapter } from './model/undoable-model';
import { BoardJumperCreationService } from './board-jumper-creation.service';
import { planPastedBoardOwnership } from './model/pasted-board-jumpers';
import { beginModelHistoryGroup } from './model/model-history-group';

const generateWireId = (): string => randomShortId('W');

@Component({
  selector: 'app-diagram',
  imports: [NgDiagramComponent, NgDiagramBackgroundComponent, EdgeReshapeOverlayComponent],
  templateUrl: './diagram.component.html',
  styleUrl: './diagram.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiagramComponent {
  private readonly avConfig = inject(AV_SCHEMATIC_CONFIG);
  private readonly viewportService = inject(NgDiagramViewportService);
  private readonly sidebarService = inject(PropertiesSidebarService);
  private readonly elementMutationService = inject(ElementMutationService);
  private readonly nodeVisibilityConfigService = inject(NodeVisibilityConfigService);
  private readonly modelService = inject(NgDiagramModelService);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly exportService = inject(DiagramExportService);
  private readonly danglingEdge = inject(DanglingEdgeService);
  private readonly boardPlacement = inject(BoardPlacementService);
  private readonly jumperCreation = inject(BoardJumperCreationService);
  private readonly manualWirePick = signal(false);
  private readonly altWirePick = signal(false);

  protected readonly wirePickActive = computed(() => this.manualWirePick() || this.altWirePick());

  constructor() {
    this.exportService.setDiagramElement(this.elementRef);
    inject(DestroyRef).onDestroy(() => {
      this.exportService.clearDiagramElement();
    });
  }

  config = {
    background: {
      dotSpacing: this.avConfig.snapping.gridSize,
    },
    edgeRouting: {
      defaultRouting: 'orthogonal',
      orthogonal: {
        firstLastSegmentLength: 80,
        maxCornerRadius: 4,
      },
    },
    linking: {
      validateConnection: (
        source: Node | null,
        sourcePort: Port | null,
        target: Node | null,
        targetPort: Port | null,
      ): boolean =>
        !this.isSamePort(source, sourcePort, target, targetPort) &&
        this.physicalConnectionIsCompatible(source, sourcePort, target, targetPort),
      temporaryEdgeDataBuilder: (edge: Edge): Edge<WireEdgeData> => ({
        ...edge,
        ...this.snapTemporaryTarget(edge),
        type: EdgeTemplateType.WireEdge,
        routing: 'orthogonal',
        sourceArrowhead: undefined,
        targetArrowhead: undefined,
        data: {
          type: 'wire',
          visualPlane: defaultVisualPlane('conductor'),
          wireId: '',
          netName: initialNetNameFromCopper(
            undefined,
            physicalEdgeNet(
              this.modelService.getModel().getNodes(),
              edge,
              this.modelService.getModel().getEdges(),
            ),
          ),
        },
      }),
      finalEdgeDataBuilder: (edge: Edge): Edge<WireEdgeData> => this.buildFinalWire(edge),
    },
    snapping: {
      defaultDragSnap: {
        width: this.avConfig.snapping.gridSize,
        height: this.avConfig.snapping.gridSize,
      },
      computeSnapForNodeDrag: (node: Node) =>
        snapForNode(node, this.modelService.getModel().getNodes(), {
          width: this.avConfig.snapping.gridSize,
          height: this.avConfig.snapping.gridSize,
        }),
      shouldSnapDragForNode: () => this.avConfig.snapping.enabled,
    },
    watermarkPosition: 'bottom-left',
    zIndex: {
      elevateOnSelection: false,
    },
  } satisfies NgDiagramConfig;

  private buildFinalWire(edge: Edge): Edge<WireEdgeData> {
    const model = this.modelService.getModel();
    const jumper = boardJumperForConnection(model.getNodes(), edge);
    const visualPlane = jumper
      ? Math.min(
          MAX_VISUAL_PLANE,
          Math.max(defaultVisualPlane('conductor'), visualPlaneOf(jumper.board) + 1),
        )
      : defaultVisualPlane('conductor');
    const points = jumper
      ? boardWorldPoints(
          jumper.board,
          defaultBoardJumperLocalRoute(jumper.board.data, jumper.sourceHole, jumper.targetHole),
        )
      : undefined;
    return {
      ...edge,
      type: EdgeTemplateType.WireEdge,
      routing: jumper ? 'polyline' : undefined,
      routingMode: jumper ? 'manual' : edge.routingMode,
      points: points ?? edge.points,
      sourceArrowhead: undefined,
      targetArrowhead: undefined,
      data: {
        type: 'wire',
        visualPlane,
        wireId: generateWireId(),
        wireType: jumper ? 'jumper' : undefined,
        jumperBoardId: jumper?.board.data.boardId,
        netName: initialNetNameFromCopper(
          undefined,
          physicalEdgeNet(model.getNodes(), edge, model.getEdges()),
        ),
      },
    };
  }

  nodeTemplateMap = new NgDiagramNodeTemplateMap([
    [NodeTemplateType.DeviceNode, DeviceNodeComponent],
    [NodeTemplateType.BoardNode, BoardNodeComponent],
    [NodeTemplateType.JunctionNode, JunctionNodeComponent],
    [NodeTemplateType.FootprintNode, FootprintNodeComponent],
  ]);

  edgeTemplateMap = new NgDiagramEdgeTemplateMap([[EdgeTemplateType.WireEdge, WireEdgeComponent]]);

  model = new UndoableDiagramModelAdapter(initializeModel(diagramModel));

  onDiagramInit(_: DiagramInitEvent): void {
    this.zoomToFit();
  }

  async onEdgeDrawEnded(event: EdgeDrawEndedEvent): Promise<void> {
    await this.danglingEdge.handleEdgeDrawEnded(event);
    await this.elementMutationService.normalizeVisualOrder();
  }

  async onClipboardPasted(event: ClipboardPastedEvent): Promise<void> {
    const endHistoryGroup = beginModelHistoryGroup(this.modelService);
    try {
      const pastedNodes = event.nodes ?? [];
      const pastedEdges = event.edges ?? [];
      const plan = planPastedBoardOwnership(
        pastedNodes,
        pastedEdges,
        this.modelService.getModel().getNodes(),
      );
      if (plan.nodeUpdates.length > 0) await this.modelService.updateNodes(plan.nodeUpdates);
      if (plan.edgeUpdates.length > 0) await this.modelService.updateEdges(plan.edgeUpdates);
      if (plan.rejectedEdgeIds.length > 0) {
        await this.modelService.deleteEdges(plan.rejectedEdgeIds);
      }
      await this.elementMutationService.normalizeVisualOrder();
    } finally {
      endHistoryGroup();
    }
  }

  // Manual edges don't auto-reroute, so re-anchor their endpoints to the live
  // ports of any moved node (auto edges are handled by ng-diagram's router).
  // Mid-drag: re-anchor only, no merge - the route mustn't simplify before drop.
  onSelectionMoved(event: SelectionMovedEvent): void {
    void applyEdgeStretchOnSelectionMoved(this.modelService, this.nodeIds(event.nodes), false);
  }

  onNodeDragStarted(_: NodeDragStartedEvent): void {
    this.model.beginHistoryGroup();
  }

  // On drop, snap footprinted devices to their board holes, carry components
  // seated on a moved board, then re-anchor every affected manual route.
  async onNodeDragEnded(event: NodeDragEndedEvent): Promise<void> {
    try {
      const affectedNodeIds = await this.boardPlacement.settleDrag(this.nodeIds(event.nodes));
      await applyEdgeStretchOnSelectionMoved(this.modelService, affectedNodeIds, true);
    } finally {
      this.model.endHistoryGroup();
    }
  }

  private nodeIds(nodes: readonly { id: string }[]): Set<string> {
    return new Set(nodes.map((node) => node.id));
  }

  private isSamePort(
    source: Node | null,
    sourcePort: Port | null,
    target: Node | null,
    targetPort: Port | null,
  ): boolean {
    return !!source && source.id === target?.id && !!sourcePort && sourcePort.id === targetPort?.id;
  }

  private physicalConnectionIsCompatible(
    source: Node | null,
    sourcePort: Port | null,
    target: Node | null,
    targetPort: Port | null,
  ): boolean {
    const model = this.modelService.getModel();
    const candidate = {
      source: source?.id ?? '',
      sourcePort: sourcePort?.id,
      target: target?.id ?? '',
      targetPort: targetPort?.id,
    };
    if (boardPortsResolveToSameCopper(model.getNodes(), candidate)) return false;
    const result = physicalEdgeNet(model.getNodes(), candidate, model.getEdges());
    return result.conflict.length === 0;
  }

  private snapTemporaryTarget(edge: Edge): Pick<Edge, 'targetPosition'> | undefined {
    if (!this.avConfig.snapping.enabled || edge.target || !edge.targetPosition) return undefined;
    const nodes = this.modelService.getModel().getNodes();
    const reference = nodes.find((node) => node.id === edge.source);
    const fallback = {
      width: this.avConfig.snapping.gridSize,
      height: this.avConfig.snapping.gridSize,
    };
    const snap = reference ? snapForNode(reference, nodes, fallback) : fallback;
    return {
      targetPosition: snapPointToGrid(edge.targetPosition, {
        x: snap.width,
        y: snap.height,
      }),
    };
  }

  onSelectionGestureEnded(event: SelectionGestureEndedEvent): void {
    this.manualWirePick.set(false);
    const hasDeviceNodes = event.nodes.some(isDeviceNode);
    const hasBoardNodes = event.nodes.some(isBoardNode);
    const hasJunctionNodes = event.nodes.some(isJunctionNode);
    const hasWireEdges = event.edges.some(isWireEdge);
    if (hasDeviceNodes || hasBoardNodes || hasJunctionNodes || hasWireEdges) {
      this.sidebarService.expandSidebar();
    }
  }

  protected toggleWirePickMode(): void {
    this.manualWirePick.update((active) => !active);
  }

  protected onCanvasPointerEnd(event: PointerEvent): void {
    const target = event.target;
    if (target instanceof Element && target.closest('.wire-pick-control')) return;
    this.manualWirePick.set(false);
  }

  @HostListener('document:keydown', ['$event'])
  protected cancelManualWirePick(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !this.manualWirePick()) return;
    event.preventDefault();
    this.manualWirePick.set(false);
  }

  @HostListener('document:keydown', ['$event'])
  protected cancelJumperCreation(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || this.jumperCreation.activeBoardId() === null) return;
    event.preventDefault();
    this.jumperCreation.cancel();
  }

  @HostListener('document:keydown', ['$event'])
  protected activateAltWirePick(event: KeyboardEvent): void {
    if (event.key === 'Alt') this.altWirePick.set(true);
  }

  @HostListener('document:keyup', ['$event'])
  protected deactivateAltWirePick(event: KeyboardEvent): void {
    if (event.key === 'Alt') this.altWirePick.set(false);
  }

  @HostListener('window:blur')
  protected clearAltWirePick(): void {
    this.altWirePick.set(false);
  }

  async onPaletteItemDropped(event: PaletteItemDroppedEvent): Promise<void> {
    const node = event.node;
    if (!isDeviceNode(node)) return;

    // Committed model, not the nodes() signal - on rapid consecutive drops the
    // signal may not include the previous drop yet, minting a duplicate id.
    if (!node.data.deviceId) {
      const deviceId = generateDeviceId(
        node.data.category,
        this.modelService.getModel().getNodes(),
      );
      await this.modelService.updateNodeData<DeviceNodeData>(node.id, {
        ...node.data,
        visualPlane: node.data.visualPlane ?? defaultVisualPlane('component'),
        deviceId,
      });
    }
    await this.elementMutationService.normalizeVisualOrder();
  }

  private zoomToFit(): void {
    const insets = this.nodeVisibilityConfigService.getViewportInsets();
    const pad = this.avConfig.viewport.zoomToFitPadding;
    void this.viewportService.zoomToFit({
      padding: [
        (insets.top ?? 0) + pad,
        (insets.right ?? 0) + pad,
        (insets.bottom ?? 0) + pad,
        (insets.left ?? 0) + pad,
      ],
    });
  }
}

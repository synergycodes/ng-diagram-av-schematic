import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject } from '@angular/core';
import {
  configureShortcuts,
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
  type NgDiagramConfig,
  type Node,
  type NodeDragEndedEvent,
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
import { randomShortId } from '../shared/utils/random-short-id';
import { generateDeviceId } from './model/auto-device-id';
import { isDeviceNode, isWireEdge } from './model/guards';
import {
  EdgeTemplateType,
  NodeTemplateType,
  type DeviceNodeData,
  type WireEdgeData,
} from './model/interfaces';
import { NodeVisibilityConfigService } from './node-visibility/node-visibility-config.service';
import { DeviceNodeComponent } from './node/device-node.component';
import { applyEdgeStretchOnSelectionMoved } from './edge-reshaping/middleware/edge-stretch-on-move';
import { EdgeReshapeOverlayComponent } from './edge-reshaping/edge-reshape-overlay.component';
import { WireEdgeComponent } from './wire-edge.component';
import { diagramModel } from './data';
import { SelectionRemovalService } from './selection-removal.service';

const generateWireId = (): string => randomShortId('W');

@Component({
  selector: 'app-diagram',
  imports: [NgDiagramComponent, NgDiagramBackgroundComponent, EdgeReshapeOverlayComponent],
  templateUrl: './diagram.component.html',
  styleUrl: './diagram.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKeydown($event)' },
})
export class DiagramComponent {
  private readonly avConfig = inject(AV_SCHEMATIC_CONFIG);
  private readonly viewportService = inject(NgDiagramViewportService);
  private readonly sidebarService = inject(PropertiesSidebarService);
  private readonly nodeVisibilityConfigService = inject(NodeVisibilityConfigService);
  private readonly modelService = inject(NgDiagramModelService);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly exportService = inject(DiagramExportService);
  private readonly danglingEdge = inject(DanglingEdgeService);
  private readonly selectionRemoval = inject(SelectionRemovalService);

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
      ): boolean => !this.isSamePort(source, sourcePort, target, targetPort),
      temporaryEdgeDataBuilder: (edge: Edge): Edge<WireEdgeData> => ({
        ...edge,
        ...this.snapTemporaryTarget(edge),
        type: EdgeTemplateType.WireEdge,
        routing: 'orthogonal',
        sourceArrowhead: undefined,
        targetArrowhead: undefined,
        data: { type: 'wire', wireId: '' },
      }),
      finalEdgeDataBuilder: (edge: Edge): Edge<WireEdgeData> => ({
        ...edge,
        type: EdgeTemplateType.WireEdge,
        routing: undefined,
        sourceArrowhead: undefined,
        targetArrowhead: undefined,
        data: { type: 'wire', wireId: generateWireId() },
      }),
    },
    snapping: {
      defaultDragSnap: {
        width: this.avConfig.snapping.gridSize,
        height: this.avConfig.snapping.gridSize,
      },
      shouldSnapDragForNode: () => this.avConfig.snapping.enabled,
    },
    watermarkPosition: 'bottom-left',
    zIndex: {
      elevateOnSelection: false,
    },
    // Delete, Backspace and Cut would drop devices and wires with no confirmation;
    // `SelectionRemovalService` handles the keys instead (see `onKeydown`).
    shortcuts: configureShortcuts([
      { actionName: 'deleteSelection', bindings: [] },
      { actionName: 'cut', bindings: [] },
    ]),
  } satisfies NgDiagramConfig;

  nodeTemplateMap = new NgDiagramNodeTemplateMap([
    [NodeTemplateType.DeviceNode, DeviceNodeComponent],
  ]);

  edgeTemplateMap = new NgDiagramEdgeTemplateMap([[EdgeTemplateType.WireEdge, WireEdgeComponent]]);

  model = initializeModel(diagramModel);

  protected onKeydown(event: KeyboardEvent): void {
    this.selectionRemoval.handleKeydown(event, this.elementRef.nativeElement);
  }

  onDiagramInit(_: DiagramInitEvent): void {
    this.zoomToFit();
  }

  onEdgeDrawEnded(event: EdgeDrawEndedEvent): void {
    this.danglingEdge.handleEdgeDrawEnded(event);
  }

  // Manual edges don't auto-reroute, so re-anchor their endpoints to the live
  // ports of any moved node (auto edges are handled by ng-diagram's router).
  // Mid-drag: re-anchor only, no merge — the route mustn't simplify before drop.
  onSelectionMoved(event: SelectionMovedEvent): void {
    applyEdgeStretchOnSelectionMoved(this.modelService, this.nodeIds(event.nodes), false);
  }

  // On drop: fold the bends the drag left collinear, once (point #4).
  onNodeDragEnded(event: NodeDragEndedEvent): void {
    applyEdgeStretchOnSelectionMoved(this.modelService, this.nodeIds(event.nodes), true);
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

  private snapTemporaryTarget(edge: Edge): Pick<Edge, 'targetPosition'> | undefined {
    if (!this.avConfig.snapping.enabled || edge.target || !edge.targetPosition) return undefined;
    const step = this.avConfig.snapping.gridSize;
    return { targetPosition: snapPointToGrid(edge.targetPosition, { x: step, y: step }) };
  }

  onSelectionGestureEnded(event: SelectionGestureEndedEvent): void {
    const hasDeviceNodes = event.nodes.some(isDeviceNode);
    const hasWireEdges = event.edges.some(isWireEdge);
    if (hasDeviceNodes || hasWireEdges) {
      this.sidebarService.expandSidebar();
    }
  }

  onPaletteItemDropped(event: PaletteItemDroppedEvent): void {
    const node = event.node;
    if (!isDeviceNode(node) || node.data.deviceId) return;

    // Committed model, not the nodes() signal — on rapid consecutive drops the
    // signal may not include the previous drop yet, minting a duplicate id.
    const deviceId = generateDeviceId(node.data.category, this.modelService.getModel().getNodes());
    void this.modelService.updateNodeData<DeviceNodeData>(node.id, {
      ...node.data,
      deviceId,
    });
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

import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject } from '@angular/core';
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
  type NgDiagramConfig,
  type PaletteItemDroppedEvent,
  type SelectionGestureEndedEvent,
} from 'ng-diagram';
import { AV_SCHEMATIC_CONFIG } from '../av-schematic.config';
import { LinkDanglingService } from './edge-linking/link-dangling.service';
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
import { WireEdgeComponent } from './wire-edge.component';
import { diagramModel } from './data';

const generateWireId = (): string => randomShortId('W');

@Component({
  selector: 'app-diagram',
  imports: [NgDiagramComponent, NgDiagramBackgroundComponent],
  templateUrl: './diagram.component.html',
  styleUrl: './diagram.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiagramComponent {
  private readonly avConfig = inject(AV_SCHEMATIC_CONFIG);
  private readonly viewportService = inject(NgDiagramViewportService);
  private readonly sidebarService = inject(PropertiesSidebarService);
  private readonly nodeVisibilityConfigService = inject(NodeVisibilityConfigService);
  private readonly modelService = inject(NgDiagramModelService);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly exportService = inject(DiagramExportService);
  private readonly linkDangling = inject(LinkDanglingService);

  constructor() {
    this.exportService.setDiagramElement(this.elementRef);
    inject(DestroyRef).onDestroy(() => {
      this.exportService.clearDiagramElement();
    });
  }

  config = {
    edgeRouting: {
      defaultRouting: 'orthogonal',
      orthogonal: {
        firstLastSegmentLength: 80,
        maxCornerRadius: 4,
      },
    },
    linking: {
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
  } satisfies NgDiagramConfig;

  nodeTemplateMap = new NgDiagramNodeTemplateMap([
    [NodeTemplateType.DeviceNode, DeviceNodeComponent],
  ]);

  edgeTemplateMap = new NgDiagramEdgeTemplateMap([[EdgeTemplateType.WireEdge, WireEdgeComponent]]);

  model = initializeModel(diagramModel);

  onDiagramInit(_: DiagramInitEvent): void {
    this.zoomToFit();
  }

  onEdgeDrawEnded(event: EdgeDrawEndedEvent): void {
    this.linkDangling.handleEdgeDrawEnded(event);
  }

  private snapTemporaryTarget(edge: Edge): Pick<Edge, 'targetPosition'> | undefined {
    if (!this.avConfig.snapping.enabled || edge.target || !edge.targetPosition) return undefined;
    const grid = this.avConfig.snapping.gridSize;
    return {
      targetPosition: {
        x: Math.round(edge.targetPosition.x / grid) * grid,
        y: Math.round(edge.targetPosition.y / grid) * grid,
      },
    };
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

    const deviceId = generateDeviceId(node.data.category, this.modelService.nodes());
    this.modelService.updateNodeData<DeviceNodeData>(node.id, {
      ...node.data,
      deviceId,
    });
  }

  private zoomToFit(): void {
    const insets = this.nodeVisibilityConfigService.getViewportInsets();
    const pad = this.avConfig.viewport.zoomToFitPadding;
    this.viewportService.zoomToFit({
      padding: [
        (insets.top ?? 0) + pad,
        (insets.right ?? 0) + pad,
        (insets.bottom ?? 0) + pad,
        (insets.left ?? 0) + pad,
      ],
    });
  }
}

import { computed, inject, Injectable, signal } from '@angular/core';
import { NgDiagramModelService, NgDiagramSelectionService, type Edge, type Node } from 'ng-diagram';
import { isBoardNode, isDeviceNode, isJunctionNode, isWireEdge } from '../diagram/model/guards';
import {
  type BoardNodeData,
  type DeviceNodeData,
  type JunctionNodeData,
  type WireEdgeData,
} from '../diagram/model/interfaces';
import { visualPlaneOf, type VisualElementKind } from '../diagram/model/visual-planes';
import { describeWireEndpoints, type WireEndpointInfo } from '../diagram/model/wire-endpoints';
import { NetHighlightService } from '../diagram/net-highlight/net-highlight.service';
import { boardJumperLengthLabel } from '../diagram/model/board-jumper';

export type SidebarState =
  | 'empty'
  | 'single-node'
  | 'single-board'
  | 'single-junction'
  | 'single-edge'
  | 'multi';

export interface SelectedVisualElement {
  id: string;
  modelKind: 'node' | 'edge';
  elementKind: VisualElementKind;
  visualPlane: number;
}

// Re-exported so existing consumers keep their import path.
export type { WireEndpointInfo } from '../diagram/model/wire-endpoints';

export interface SelectedWireDetails {
  edge: Edge<WireEdgeData>;
  source: WireEndpointInfo | null;
  target: WireEndpointInfo | null;
  /** Number of physical conductors selected by a net highlight. */
  netSize: number;
  netId: string;
  netName: string;
  /** Derived board-local polyline length; null for ordinary conductors. */
  jumperLength: string | null;
}

/** Manages sidebar visibility and exposes selection-derived data. */
@Injectable()
export class PropertiesSidebarService {
  private readonly selectionService = inject(NgDiagramSelectionService);
  private readonly modelService = inject(NgDiagramModelService);
  private readonly netHighlight = inject(NetHighlightService);

  readonly isExpanded = signal(false);

  readonly selectedDeviceNodes = computed<Node<DeviceNodeData>[]>(() =>
    this.selectionService.selection().nodes.filter(isDeviceNode),
  );

  readonly selectedBoardNodes = computed<Node<BoardNodeData>[]>(() =>
    this.selectionService.selection().nodes.filter(isBoardNode),
  );

  readonly selectedWireEdges = computed<Edge<WireEdgeData>[]>(() =>
    this.selectionService.selection().edges.filter(isWireEdge),
  );

  readonly selectedJunctionNodes = computed<Node<JunctionNodeData>[]>(() =>
    this.selectionService.selection().nodes.filter(isJunctionNode),
  );

  readonly selectedNode = computed<Node<DeviceNodeData> | undefined>(() =>
    this.selectedDeviceNodes().at(0),
  );

  readonly selectedBoard = computed<Node<BoardNodeData> | undefined>(() =>
    this.selectedBoardNodes().at(0),
  );

  readonly selectedEdge = computed<Edge<WireEdgeData> | undefined>(() =>
    this.selectedWireEdges().at(0),
  );

  readonly selectedJunction = computed<Node<JunctionNodeData> | undefined>(() =>
    this.selectedJunctionNodes().at(0),
  );

  readonly sidebarState = computed<SidebarState>(() => {
    const nodeCount = this.selectedDeviceNodes().length;
    const boardCount = this.selectedBoardNodes().length;
    const junctionCount = this.selectedJunctionNodes().length;
    const edgeCount = this.selectedWireEdges().length;
    const total = nodeCount + boardCount + junctionCount + edgeCount;
    if (total === 0) return 'empty';
    if (total > 1) return 'multi';
    if (nodeCount === 1) return 'single-node';
    if (boardCount === 1) return 'single-board';
    if (junctionCount === 1) return 'single-junction';
    return 'single-edge';
  });

  readonly selectedVisualElement = computed<SelectedVisualElement | null>(() => {
    const state = this.sidebarState();
    const element =
      state === 'single-node'
        ? this.selectedNode()
        : state === 'single-board'
          ? this.selectedBoard()
          : state === 'single-junction'
            ? this.selectedJunction()
            : state === 'single-edge'
              ? this.selectedEdge()
              : undefined;
    if (!element) return null;
    return {
      id: element.id,
      modelKind: state === 'single-edge' ? 'edge' : 'node',
      elementKind:
        state === 'single-board'
          ? 'board'
          : state === 'single-junction'
            ? 'junction'
            : state === 'single-edge'
              ? 'conductor'
              : 'component',
      visualPlane: visualPlaneOf(element),
    };
  });

  readonly selectedWireDetails = computed<SelectedWireDetails | null>(() => {
    const edge = this.selectedEdge();
    if (!edge) return null;
    const { source, target } = describeWireEndpoints(this.modelService.nodes(), edge);
    const net = this.netHighlight.netForEdge(edge.id);
    return {
      edge,
      source,
      target,
      netSize: net?.edgeIds.length ?? 0,
      netId: net?.id ?? '',
      netName: net?.name ?? '',
      jumperLength: boardJumperLengthLabel(this.modelService.nodes(), edge),
    };
  });

  expandSidebar(): void {
    this.isExpanded.set(true);
  }

  toggleSidebarVisibility(): void {
    this.isExpanded.update((v) => !v);
  }
}

import type { Edge, Node } from 'ng-diagram';
import { CoordinateMapper } from './dxf-coordinate-mapper';
import { DxfDocument } from './dxf-document';
import { formatCoord } from './dxf-format';
import type { DxfExportConfig, DxfHeaderPair, DxfRenderContext } from './dxf-types';

export interface DiagramBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Orchestrates a DXF export run. Domain-free: knows nothing about device
 * nodes, wires, or any other av-schematic concept - it just dispatches each
 * node/edge to the renderer registered for its `type` in DxfExportConfig.
 *
 * To support a new node or edge type, register a renderer in the export
 * config; no changes are needed here.
 */
export class DxfExporter {
  constructor(private readonly config: DxfExportConfig) {}

  export(nodes: readonly Node[], edges: readonly Edge[], bounds: DiagramBounds): DxfDocument {
    const doc = new DxfDocument();
    const extent = this.computeExtent(bounds);
    this.applyHeaderVars(doc, extent);
    this.applyLayers(doc);
    this.applyTextStyles(doc);

    const mapper = CoordinateMapper.fromScale(
      bounds,
      this.config.scaleMmPerPx,
      this.config.paddingPx,
    );
    const ctx: DxfRenderContext = { doc, mapper, nodes };
    const warnedNodeTypes = new Set<string>();
    const warnedEdgeTypes = new Set<string>();

    for (const node of nodes) {
      const renderer = this.resolveNodeRenderer(node);
      if (!renderer) {
        const key = node.type ?? '(untyped)';
        if (!warnedNodeTypes.has(key)) {
          warnedNodeTypes.add(key);
          console.warn(`[DxfExporter] No renderer registered for node type: ${key}`);
        }
        continue;
      }
      renderer(ctx, node);
    }

    for (const edge of edges) {
      const renderer = this.resolveEdgeRenderer(edge);
      if (!renderer) {
        const key = edge.type ?? '(untyped)';
        if (!warnedEdgeTypes.has(key)) {
          warnedEdgeTypes.add(key);
          console.warn(`[DxfExporter] No renderer registered for edge type: ${key}`);
        }
        continue;
      }
      renderer(ctx, edge);
    }

    return doc;
  }

  private resolveNodeRenderer(node: Node) {
    const byType = node.type ? this.config.nodeRenderers[node.type] : undefined;
    return byType ?? this.config.defaultNodeRenderer;
  }

  private resolveEdgeRenderer(edge: Edge) {
    const byType = edge.type ? this.config.edgeRenderers[edge.type] : undefined;
    return byType ?? this.config.defaultEdgeRenderer;
  }

  private computeExtent(bounds: DiagramBounds): { widthMm: number; heightMm: number } {
    const paddingMm = this.config.paddingPx * this.config.scaleMmPerPx;
    return {
      widthMm: bounds.width * this.config.scaleMmPerPx + 2 * paddingMm,
      heightMm: bounds.height * this.config.scaleMmPerPx + 2 * paddingMm,
    };
  }

  private applyHeaderVars(doc: DxfDocument, extent: { widthMm: number; heightMm: number }): void {
    const { widthMm, heightMm } = extent;
    const defaults: Record<string, readonly DxfHeaderPair[]> = {
      $ACADVER: [{ code: 1, value: 'AC1027' }],
      $INSUNITS: [{ code: 70, value: 4 }],
      $MEASUREMENT: [{ code: 70, value: 1 }],
      $LWDISPLAY: [{ code: 290, value: 1 }],
      $LIMMIN: [
        { code: 10, value: formatCoord(0) },
        { code: 20, value: formatCoord(0) },
      ],
      $LIMMAX: [
        { code: 10, value: formatCoord(widthMm) },
        { code: 20, value: formatCoord(heightMm) },
      ],
      // $EXTMIN/$EXTMAX are 3D points (10/20/30), unlike the 2D $LIMMIN/$LIMMAX.
      $EXTMIN: [
        { code: 10, value: formatCoord(0) },
        { code: 20, value: formatCoord(0) },
        { code: 30, value: formatCoord(0) },
      ],
      $EXTMAX: [
        { code: 10, value: formatCoord(widthMm) },
        { code: 20, value: formatCoord(heightMm) },
        { code: 30, value: formatCoord(0) },
      ],
    };

    const merged = { ...defaults, ...(this.config.headerVars ?? {}) };
    for (const [name, pairs] of Object.entries(merged)) {
      doc.setHeaderVar(name, pairs);
    }
  }

  private applyLayers(doc: DxfDocument): void {
    for (const layer of this.config.layers) {
      doc.addLayer(layer);
    }
  }

  private applyTextStyles(doc: DxfDocument): void {
    for (const style of this.config.textStyles) {
      doc.addTextStyle(style);
    }
  }
}

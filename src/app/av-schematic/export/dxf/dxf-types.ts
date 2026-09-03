import type { Edge, Node } from 'ng-diagram';
import type { CoordinateMapper } from './dxf-coordinate-mapper';
import type { DxfDocument } from './dxf-document';
import type { DxfLayer } from './dxf-layer';
import type { DxfTextStyle } from './dxf-text-style';

/**
 * Context passed to every renderer call. Renderers append entities to `doc`
 * and use `mapper` to convert diagram px coordinates to DXF mm coordinates.
 */
export interface DxfRenderContext {
  readonly doc: DxfDocument;
  readonly mapper: CoordinateMapper;
  readonly nodes: readonly Node[];
}

export type DxfNodeRenderer = (ctx: DxfRenderContext, node: Node) => void;

export type DxfEdgeRenderer = (ctx: DxfRenderContext, edge: Edge) => void;

export interface DxfHeaderPair {
  readonly code: number;
  readonly value: string | number;
}

/**
 * Configuration for a DXF export. Project-specific code builds one of these
 * (see av-dxf-config.ts) and passes it into DxfExporter - that's the entire
 * extension surface for plugging in new node/edge types.
 */
export interface DxfExportConfig {
  readonly scaleMmPerPx: number;
  readonly paddingPx: number;
  readonly layers: readonly DxfLayer[];
  readonly textStyles: readonly DxfTextStyle[];
  readonly headerVars?: Record<string, readonly DxfHeaderPair[]>;
  readonly nodeRenderers: Record<string, DxfNodeRenderer>;
  readonly edgeRenderers: Record<string, DxfEdgeRenderer>;
  readonly defaultNodeRenderer?: DxfNodeRenderer;
  readonly defaultEdgeRenderer?: DxfEdgeRenderer;
}

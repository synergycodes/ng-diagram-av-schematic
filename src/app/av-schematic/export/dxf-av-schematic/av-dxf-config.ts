import { EdgeTemplateType, NodeTemplateType } from '../../diagram/model/interfaces';
import { DxfLayer } from '../dxf/dxf-layer';
import { DxfTextStyle } from '../dxf/dxf-text-style';
import type { DxfExportConfig } from '../dxf/dxf-types';
import { ACI, DIAGRAM_PADDING, DXF_SCALE_MM_PER_PX, LAYERS, TEXT_STYLE } from './av-dxf-constants';
import { renderDeviceNode } from './device-node-renderer';
import { renderBoardNode } from './board-node-renderer';
import { renderFootprintNode } from './footprint-node-renderer';
import { renderWireEdge } from './wire-edge-renderer';

/**
 * Wires av-schematic's renderers into the generic DxfExporter.
 *
 * To support a new node or edge type:
 *   1. Write a renderer function (see device-node-renderer.ts as a model).
 *   2. Register it here under the matching `node.type` / `edge.type` key.
 * Nothing in the generic `dxf/` library needs to change.
 */
export const buildAvDxfConfig = (): DxfExportConfig => ({
  scaleMmPerPx: DXF_SCALE_MM_PER_PX,
  paddingPx: DIAGRAM_PADDING,
  layers: [
    new DxfLayer(LAYERS.BOARDS, ACI.WHITE),
    new DxfLayer(LAYERS.DEVICES, ACI.WHITE),
    new DxfLayer(LAYERS.FOOTPRINTS, ACI.WHITE),
    new DxfLayer(LAYERS.WIRES, ACI.WHITE),
    new DxfLayer(LAYERS.JUMPERS, ACI.WHITE),
  ],
  textStyles: [new DxfTextStyle(TEXT_STYLE.STANDARD), new DxfTextStyle(TEXT_STYLE.BOLD, true)],
  nodeRenderers: {
    [NodeTemplateType.BoardNode]: renderBoardNode,
    [NodeTemplateType.DeviceNode]: renderDeviceNode,
    [NodeTemplateType.FootprintNode]: renderFootprintNode,
  },
  edgeRenderers: {
    [EdgeTemplateType.WireEdge]: renderWireEdge,
  },
});

export const LAYERS = {
  BOARDS: 'BOARDS',
  DEVICES: 'DEVICES',
  FOOTPRINTS: 'FOOTPRINTS',
  WIRES: 'WIRES',
  JUMPERS: 'JUMPERS',
} as const;

export const ACI = {
  WHITE: 7,
} as const;

export const TEXT_STYLE = {
  STANDARD: 'STANDARD',
  BOLD: 'BOLD',
} as const;

/**
 * Lineweights in 1/100 mm (DXF group code 370). Must use values from the
 * DXF standard lineweight enum: 0, 5, 9, 13, 15, 18, 20, 25, 30, 35, ...
 */
export const LINE_WEIGHT = {
  WIRE: 35,
  FRAME: 25,
  DETAIL: 25,
  SUBTLE: 13,
} as const;

/** Conversion factor: DXF millimetres per one diagram unit. Fixed (no paper fitting). */
export const DXF_SCALE_MM_PER_PX = 0.3;

/** Padding around the diagram in diagram units. */
export const DIAGRAM_PADDING = 50;

/**
 * Approximates the browser's default line-height for the project font (Poppins).
 * Used to lay out header text with breathing room close to the rendered DOM.
 */
export const TEXT_LINE_HEIGHT_RATIO = 1.4;

/**
 * Mirrors --av-node-width / --av-port-width / --av-port-height in tokens.css.
 * Used as fallbacks when measurement data is unavailable.
 */
export const DEFAULT_NODE_WIDTH = 240;
export const PORT_WIDTH = 8;
export const PORT_HEIGHT = 13;

/** Mirrors `.port-row { min-height: 36px }` - fallback when measuredPorts is missing. */
export const FALLBACK_PORT_ROW_HEIGHT = 36;

/**
 * How far to extend wire endpoints toward the next routing point so they
 * meet the outer edge of the snapped port rectangle. ng-diagram routes to
 * the port's measured center.
 */
export const WIRE_ENDPOINT_EXTENSION = 1;

export const HEADER_PADDING_TOP = 4;
export const HEADER_PADDING_BOTTOM = 8;
export const ROW_PADDING_X = 12;

export const FONT_DEVICE_ID = 14;
export const FONT_INFO = 10;
export const FONT_LABEL = 12;
export const FONT_CONNECTOR = 10;
export const FONT_WIRE_LABEL = 10;
export const FONT_PHYSICAL_LABEL = 9;

/** Mirrors the [positionOnEdge]="'30px'" / "'-30px'" markers in wire-edge.component.html. */
export const WIRE_LABEL_DISTANCE_FROM_END = 30;

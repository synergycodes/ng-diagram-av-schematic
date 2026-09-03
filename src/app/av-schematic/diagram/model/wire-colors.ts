/**
 * Wire color vocabulary shared by the diagram model and the WireViz
 * importer/exporter.
 *
 * A conductor stores its render color plus an optional lossless WireViz token.
 * The token can be a WireViz/DIN 47100 abbreviation (`"YE"`) or an exact RGB
 * value (`"#ff00aa"`) chosen locally. Both are first-class:
 *
 *   - an abbreviation resolves to a CSS value for rendering *and* survives a
 *     WireViz export unchanged;
 *   - an exact six-digit RGB value is also valid WireViz and survives byte for
 *     byte;
 *   - another CSS hex shape stays in the project and the exporter reports it
 *     instead of substituting the nearest standard code. Guessing a
 *     replacement would quietly change what the diagram says the physical
 *     wire looks like.
 *
 * The table is a deliberately small, explicitly maintained subset -- not the
 * full WireViz color table. An unrecognized abbreviation keeps its code and
 * resolves to no CSS value, so the wire falls back to the default stroke
 * token rather than rendering a wrong color.
 */
export const WIREVIZ_COLOR_CODES: Readonly<Record<string, string>> = {
  BK: '#1a1a1a',
  WH: '#f5f5f5',
  GY: '#8c8c8c',
  PK: '#f4a6c6',
  RD: '#e2231a',
  OG: '#f2820d',
  YE: '#f7d417',
  OL: '#7d7f00',
  GN: '#2fa93c',
  TQ: '#2fb5a0',
  LB: '#8fc7ff',
  BU: '#1e6fd9',
  VT: '#8e3fc9',
  BN: '#7a4a1e',
  BG: '#d9c7a3',
  IV: '#fffff0',
  SL: '#708090',
  CU: '#b87333',
  SN: '#c0c0c0',
  SR: '#c9c9c9',
  GD: '#d4af37',
};

export interface ResolvedWireColor {
  /** CSS color for the stroke, when one is known. */
  color?: string;
  /** WireViz abbreviation, when the stored value was one. */
  colorCode?: string;
}

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;
const WIREVIZ_RGB_COLOR = /^#[0-9a-fA-F]{6}$/;

export function isCssHexColor(value: string): boolean {
  return HEX_COLOR.test(value);
}

/** WireViz's lossless custom-color form: one quoted six-digit RGB value. */
export function isWireVizRgbColor(value: string): boolean {
  return WIREVIZ_RGB_COLOR.test(value);
}

/** True only for abbreviations this codebase can write into a WireViz `colors` list. */
export function isWireVizColorCode(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(WIREVIZ_COLOR_CODES, value.toUpperCase());
}

/** Splits a stored color value into "what to render" and "what WireViz calls it". */
export function resolveWireColor(value: string | undefined): ResolvedWireColor {
  if (!value) return {};
  if (isCssHexColor(value)) return { color: value };
  // Compound WireViz colors may contain one or more #RRGGBB segments. They
  // are not a single CSS stroke color, but their spelling is still the
  // lossless value to keep in the edge's WireViz field.
  const code = value.includes('#') ? value : value.toUpperCase();
  return { color: WIREVIZ_COLOR_CODES[code], colorCode: code };
}

/**
 * Inverse of `resolveWireColor`: the single value used in a WireViz cable color
 * slot. The token wins when present because it is the lossless form; a known
 * render color can be re-derived from it.
 */
export function canonicalColorValue(resolved: ResolvedWireColor): string | undefined {
  return resolved.colorCode ?? resolved.color;
}

/** Missing render color is recoverable from a known token; conflicts are not. */
export function isWireColorPairCoherent(
  color: string | undefined,
  colorCode: string | undefined,
): boolean {
  if (!colorCode) return true;
  const resolved = resolveWireColor(colorCode);
  if (!resolved.color || color === undefined) return true;
  return normalizeCssColor(color) === normalizeCssColor(resolved.color);
}

function normalizeCssColor(color: string): string {
  const trimmed = color.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  return trimmed;
}

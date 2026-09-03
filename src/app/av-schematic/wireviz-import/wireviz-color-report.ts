// What a wire's color means for the WireViz round-trip: which colors survive a
// YAML emission as a `cables.<name>.colors` entry, and which are custom colors
// that have no WireViz code and would be lost.
//
// Pure: takes wire data and returns the verdict rendered by the sidebar. The
// project-wide export report is produced by `export-wireviz.ts`, at the real
// YAML boundary, so it cannot drift from what was actually emitted.
import { type WireEdgeData } from '../diagram/model/interfaces';
import { isKnownWireVizCode, normalizeWireVizHexColor, paletteWireColor } from './wireviz-colors';

export type WireColorEmission =
  /** No color set -- WireViz emits the cable without a color for this wire. */
  | { kind: 'none' }
  /** A palette color: emits as this 2-letter WireViz code. */
  | { kind: 'palette'; code: string; color: string | undefined }
  /** A custom hex color: emits as a WireViz `#RRGGBB` token. */
  | { kind: 'custom-emittable'; color: string; token: string }
  /** A stored WireViz token outside the palette this editor can render. */
  | { kind: 'wireviz-opaque'; token: string; color: string | undefined }
  /** A CSS color WireViz cannot express in this single-color slice. */
  | { kind: 'custom-unemittable'; color: string };

/** Minimal shape of a wire for color reporting (see `WireEdgeData`). */
export type ColorBearingWire = Pick<WireEdgeData, 'color' | 'colorCode'>;

/**
 * How this wire's color would be emitted into a WireViz document.
 *
 * A stored `colorCode` wins when it is a palette code, a hex token, or an
 * opaque imported WireViz token. A color without a token remains explicitly
 * custom even when its RGB channels equal a palette entry; this is what keeps
 * palette -> custom stable through save/reload. WireViz accepts `#RRGGBB`;
 * other CSS colors remain canvas-only and must be reported.
 */
export function describeWireColorEmission(wire: ColorBearingWire): WireColorEmission {
  if (isKnownWireVizCode(wire.colorCode)) {
    const code = (wire.colorCode ?? '').trim().toUpperCase();
    return { kind: 'palette', code, color: wire.color ?? paletteWireColor(code).color };
  }
  const storedHex = normalizeWireVizHexColor(wire.colorCode);
  if (storedHex) {
    return { kind: 'custom-emittable', color: wire.color ?? storedHex, token: storedHex };
  }
  const storedToken = wire.colorCode?.trim();
  if (storedToken) {
    return { kind: 'wireviz-opaque', token: storedToken, color: wire.color };
  }
  if (!wire.color) return { kind: 'none' };
  const customHex = normalizeWireVizHexColor(wire.color);
  if (customHex) {
    return { kind: 'custom-emittable', color: wire.color, token: customHex };
  }
  return { kind: 'custom-unemittable', color: wire.color };
}

/**
 * WireViz color helpers and the user-facing palette.
 *
 * Storage and rendering rules live in `diagram/model/wire-colors.ts`; this
 * importer/UI facade adds labels and picker conversions without reversing the
 * model dependency.
 */
import {
  WIREVIZ_COLOR_CODES,
  isWireVizColorCode,
  resolveWireColor as resolveModelWireColor,
  type ResolvedWireColor,
} from '../diagram/model/wire-colors';

export {
  WIREVIZ_COLOR_CODES,
  canonicalColorValue,
  isCssHexColor,
  isWireColorPairCoherent,
  isWireVizRgbColor,
  isWireVizColorCode,
  resolveWireColor,
  type ResolvedWireColor,
} from '../diagram/model/wire-colors';

const WIREVIZ_COLOR_NAMES: Readonly<Record<string, string>> = {
  BK: 'Preto',
  WH: 'Branco',
  GY: 'Cinza',
  PK: 'Rosa',
  RD: 'Vermelho',
  OG: 'Laranja',
  YE: 'Amarelo',
  OL: 'Verde-oliva',
  GN: 'Verde',
  TQ: 'Turquesa',
  LB: 'Azul-claro',
  BU: 'Azul',
  VT: 'Violeta',
  BN: 'Marrom',
  BG: 'Bege',
  IV: 'Marfim',
  SL: 'Ardósia',
  CU: 'Cobre',
  SN: 'Estanho',
  SR: 'Prata',
  GD: 'Dourado',
};

export interface WireVizColorOption {
  code: string;
  color: string;
  label: string;
}

export const WIREVIZ_COLOR_OPTIONS: readonly WireVizColorOption[] = Object.entries(
  WIREVIZ_COLOR_CODES,
).map(([code, color]) => ({ code, color, label: WIREVIZ_COLOR_NAMES[code] ?? code }));

export function isKnownWireVizCode(code: string | undefined): boolean {
  return !!code && isWireVizColorCode(code.trim());
}

/** WireViz RGB token, expanding CSS shorthand while preserving no other CSS form. */
export function normalizeWireVizHexColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const trimmed = color.trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9A-F]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  return undefined;
}

/** Palette abbreviation or exact WireViz RGB token for one CSS color. */
export function wireVizCodeForColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const normalized = normalizeCssColor(color);
  for (const [code, paletteColor] of Object.entries(WIREVIZ_COLOR_CODES)) {
    if (normalizeCssColor(paletteColor) === normalized) return code;
  }
  return normalizeWireVizHexColor(normalized);
}

export function paletteWireColor(code: string | undefined): ResolvedWireColor {
  if (!isKnownWireVizCode(code)) return {};
  return resolveModelWireColor(code?.trim().toUpperCase());
}

function normalizeCssColor(color: string): string {
  const trimmed = color.trim().toLowerCase();
  const expanded = normalizeWireVizHexColor(trimmed);
  return expanded?.toLowerCase() ?? trimmed;
}

// Pure net-emphasis rules shared by the wire edge template and the sidebar.
// No signals, no model access -- so the highlight/dim decision is unit-testable
// on its own.

export type NetEmphasis = 'normal' | 'highlighted' | 'dimmed';

/** Minimal shape needed to group wires by net (see `WireEdgeData`). */
export interface NetBearing {
  readonly netId?: string;
}

/**
 * How one wire should render while `highlightedNetId` is selected.
 *
 * Wires with no `netId` never match a highlight, so they attenuate with the
 * rest when dimming is on -- a wire outside the inspected net is background
 * whether or not it belongs to some other net.
 */
export const resolveNetEmphasis = (
  edgeNetId: string | undefined,
  highlightedNetId: string | null,
  dimOthers: boolean,
): NetEmphasis => {
  if (!highlightedNetId) return 'normal';
  if (edgeNetId !== undefined && edgeNetId === highlightedNetId) return 'highlighted';
  return dimOthers ? 'dimmed' : 'normal';
};

/** Every distinct net id present in the model, sorted for a stable listing. */
export const collectNetIds = (edges: readonly NetBearing[]): string[] => {
  const netIds = new Set<string>();
  for (const edge of edges) {
    if (edge.netId !== undefined && edge.netId !== '') netIds.add(edge.netId);
  }
  return [...netIds].sort((a, b) => a.localeCompare(b));
};

/** Ids of the wires belonging to `netId` -- the connections a highlight lights up. */
export const edgeIdsInNet = (
  edges: readonly (NetBearing & { readonly id: string })[],
  netId: string | null,
): string[] => {
  if (netId === null || netId === '') return [];
  return edges.filter((edge) => edge.netId === netId).map((edge) => edge.id);
};

/** Stroke used for an attenuated wire whose own color is a CSS variable. */
export const DIMMED_WIRE_COLOR = 'var(--av-color-wire-dimmed)';

/**
 * The stroke to draw `color` with while it is attenuated.
 *
 * A literal hex keeps its hue and just loses opacity (8-digit hex, so it goes
 * straight into the same `stroke` input a normal color does -- no extra
 * rendering API, no `color-mix`). Anything else (a `var(--...)` token, a named
 * color) falls back to the neutral dimmed token, since its channels are not
 * knowable here.
 */
export const dimWireColor = (color: string): string => {
  const trimmed = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return `${trimmed}59`;
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}59`;
  }
  return DIMMED_WIRE_COLOR;
};

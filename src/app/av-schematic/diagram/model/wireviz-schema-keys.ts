/** Keys whose assignment can mutate object prototypes instead of plain data. */
export const DANGEROUS_OBJECT_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/**
 * Connector keys owned by the typed canonical model.
 *
 * They may never appear in `wirevizExtras`: the exporter writes these fields
 * from canonical data and an extras bag must not replace that authoritative
 * value (including when the canonical value happens to be absent).
 */
export const WIREVIZ_CONNECTOR_CANONICAL_KEYS: ReadonlySet<string> = new Set([
  'type',
  'subtype',
  'pins',
  'pinlabels',
  'pincount',
  'loops',
  'notes',
  'color',
  'manufacturer',
  'mpn',
  'style',
  'show_name',
]);

/** Cable keys owned by the typed canonical model. */
export const WIREVIZ_CABLE_CANONICAL_KEYS: ReadonlySet<string> = new Set([
  'wirecount',
  'colors',
  'wirelabels',
  'gauge',
  'length',
  'notes',
  'color_code',
  'type',
  'manufacturer',
  'mpn',
]);

export function isDangerousObjectKey(key: string): boolean {
  return DANGEROUS_OBJECT_KEYS.has(key);
}

/**
 * Compatibility report shared by the WireViz importer and exporter.
 *
 * Every construct this codebase recognizes but cannot fully represent — in
 * the diagram model on the way in, or in the emitted YAML on the way out —
 * produces an entry here instead of being dropped silently. That is the
 * whole point of the report: a field never disappears without a trace, even
 * when it is preserved verbatim rather than interpreted.
 *
 * Clean-room implementation for this repository (see
 * docs/license-matrix.md): no code or structure taken from
 * Garth-42/WireForm (GPL-3.0) or from the Python `wireviz` project.
 */

export type WireVizReportSeverity = 'info' | 'warning' | 'error';

/**
 * Stable machine-readable codes. Kept as a closed union so a new code has to
 * be declared here (and documented in docs/wireviz-round-trip.md) rather
 * than invented ad hoc at a call site.
 */
export type WireVizReportCode =
  /** The UI import/export operation failed before a compatibility result could be produced. */
  | 'operation-failed'
  // --- import ---------------------------------------------------------
  /** A key we do not interpret. Preserved verbatim and re-emitted on export. */
  | 'unknown-field'
  /** `pincount` declared without an explicit `pins` list; designators were generated as 1..n. */
  | 'inferred-pins'
  /** A repeated/trimmed WireViz color list was expanded to its effective wire count. */
  | 'colors-normalized'
  /** A recognized field that is preserved but whose *semantics* this slice does not model. */
  | 'unsupported-semantics'
  /** The same conductor was declared more than once; kept once. */
  | 'duplicate-conductor'
  /** A connection set only mentions an unconnected element. */
  | 'unconnected-reference'
  /** A connector marked `style: simple` was imported as a junction node. */
  | 'junction-detected'
  /** A WireViz connector `loops` pair became explicit internal connectivity. */
  | 'loop-detected'
  /** A net ended up with three or more endpoints (multi-drop / fan-out). Informational, never an error. */
  | 'multidrop-net'
  /** Distinct imported net names became one net through existing physical copper. */
  | 'physical-net-reconciled'
  // --- export ---------------------------------------------------------
  /** A color shape WireViz cannot represent. Kept in the project, omitted from YAML, never substituted. */
  | 'color-not-representable'
  /** Data that exists only in the project (geometry, app-level metadata) and has no YAML slot. */
  | 'field-not-representable'
  /** Incomplete imported designators required safe generated designators; labels remain in `pinlabels`. */
  | 'pin-designators-remapped'
  /** A junction was emitted as a `style: simple` connector. */
  | 'junction-emitted'
  /** Internal connector connectivity was emitted through WireViz `loops`. */
  | 'loop-emitted'
  /** A previously unknown field was written back into the YAML unchanged. */
  | 'unknown-field-reemitted';

export interface WireVizReportEntry {
  severity: WireVizReportSeverity;
  code: WireVizReportCode;
  /** Dotted path into the document/project the entry is about, e.g. `connectors.NANO.subtype`. */
  path: string;
  /** Human-readable, pt-BR — this string is what a UI would show. */
  message: string;
}

export interface WireVizCompatibilityReport {
  entries: readonly WireVizReportEntry[];
}

/** Mutable accumulator; call `build()` once at the end to freeze it. */
export class WireVizReportBuilder {
  private readonly entries: WireVizReportEntry[] = [];

  add(
    severity: WireVizReportSeverity,
    code: WireVizReportCode,
    path: string,
    message: string,
  ): void {
    this.entries.push({ severity, code, path, message });
  }

  info(code: WireVizReportCode, path: string, message: string): void {
    this.add('info', code, path, message);
  }

  warn(code: WireVizReportCode, path: string, message: string): void {
    this.add('warning', code, path, message);
  }

  error(code: WireVizReportCode, path: string, message: string): void {
    this.add('error', code, path, message);
  }

  build(): WireVizCompatibilityReport {
    // Sorted by path so two runs over equivalent input produce an equal
    // report regardless of the order the document happened to be walked in
    // — the same order-independence the round-trip tests rely on.
    const entries = [...this.entries].sort(
      (a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code),
    );
    return { entries };
  }
}

export function hasSeverity(
  report: WireVizCompatibilityReport,
  severity: WireVizReportSeverity,
): boolean {
  return report.entries.some((entry) => entry.severity === severity);
}

export function entriesWithCode(
  report: WireVizCompatibilityReport,
  code: WireVizReportCode,
): readonly WireVizReportEntry[] {
  return report.entries.filter((entry) => entry.code === code);
}

/** Flat, human-readable rendering, one entry per line. Used by tests and non-visual callers. */
export function formatReport(report: WireVizCompatibilityReport): string[] {
  return report.entries.map((e) => `[${e.severity}] ${e.code} ${e.path}: ${e.message}`);
}

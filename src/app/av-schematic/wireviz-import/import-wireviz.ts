import { type CanonicalElectrical } from '../diagram/model/canonical-project';
import { parseWireVizDocument, type WireVizDocument } from './wireviz-model';
import { type WireVizCompatibilityReport } from './wireviz-report';
import { wirevizToElectrical, type WireVizImportOptions } from './wireviz-to-diagram';
import { parseYamlSubset } from './wireviz-yaml';

/**
 * Front door of the WireViz import pipeline:
 *
 *   YAML text
 *     -> wireviz-yaml.ts       parseYamlSubset()        generic subset value
 *     -> wireviz-model.ts      parseWireVizDocument()   validated document
 *     -> wireviz-to-diagram.ts wirevizToElectrical()    canonical electrical
 *
 * The compatibility report travels the whole way: entries raised while
 * reading the document are replayed alongside the ones raised while turning
 * it into project elements, so a caller gets one list covering both stages.
 */
export interface WireVizImportOutcome {
  /** The validated document, for callers that need the raw WireViz view. */
  document: WireVizDocument;
  /** Components, junctions, cables and nets. Geometry is the caller's to add. */
  electrical: CanonicalElectrical;
  report: WireVizCompatibilityReport;
}

/** Parses raw WireViz YAML text (this project's subset) into a validated document. */
export function parseWireViz(yamlText: string): WireVizDocument {
  return parseWireVizDocument(parseYamlSubset(yamlText));
}

export function importWireViz(
  yamlText: string,
  options: WireVizImportOptions = {},
): WireVizImportOutcome {
  const document = parseWireViz(yamlText);
  const { electrical, report } = wirevizToElectrical(document, options);
  return { document, electrical, report };
}

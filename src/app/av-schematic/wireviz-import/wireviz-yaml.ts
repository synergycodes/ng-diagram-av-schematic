import { type JsonValue } from '../shared/utils/json-value';

/**
 * Minimal, hand-rolled YAML-subset parser.
 *
 * Clean-room implementation written for this slice — no code was copied or
 * adapted from Garth-42/WireForm (GPL-3.0) or any other WireViz tooling. It
 * covers only the constructs a WireViz `connectors` / `cables` / `connections`
 * document needs. See docs/wireviz-import-limits.md for the exact supported
 * subset and known gaps.
 *
 * Supported:
 *   - Nested mappings (`key: value`, `key:` + indented block)
 *   - Nested sequences (`- item`), including compacted multi-dash lines
 *     (`- - NANO: [D9]`), which is how WireViz writes a list of connection
 *     sets
 *   - Inline flow sequences (`[a, b, c]`)
 *   - Single- and double-quoted scalars, bare word/number scalars
 *   - `#` comments (outside quotes) and blank lines
 *
 * Not supported (throws or silently cannot represent): tabs for indentation,
 * anchors/aliases, multi-document streams, block scalars (`|`, `>`), flow
 * mappings other than the empty `{}`, multi-key inline sequence items beyond one extra
 * indented continuation.
 *
 * Rejected as invalid input rather than silently accepted (same documented
 * subset, stricter validation): a duplicate key within one mapping, a
 * dangerous key (`__proto__`, `constructor`, `prototype` — these would
 * otherwise let a crafted document reach into the parser's own object
 * prototypes instead of producing a plain data key), and any input left
 * over after the top-level value has been fully parsed.
 */

/**
 * An alias of the shared `JsonValue`: a parsed document is plain JSON-safe
 * data. Sharing the declaration keeps it assignable to the diagram model's
 * `PreservedValue` without a cast at every hand-off.
 */
export type YamlValue = JsonValue;

interface RawLine {
  indent: number;
  content: string;
  lineNumber: number;
}

export class WireVizYamlError extends Error {
  constructor(
    message: string,
    readonly lineNumber?: number,
  ) {
    super(lineNumber ? `${message} (line ${lineNumber})` : message);
    this.name = 'WireVizYamlError';
  }
}

export function parseYamlSubset(text: string): YamlValue {
  const lines = preprocessLines(text);
  if (lines.length === 0) return null;
  const { value, nextIndex } = parseBlock(lines, 0, lines[0].indent);
  if (nextIndex < lines.length) {
    throw new WireVizYamlError(
      'unexpected trailing content after the top-level value',
      lines[nextIndex].lineNumber,
    );
  }
  return value;
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Sets a mapping key after checking it isn't a prototype-pollution vector
 * and isn't already present at this mapping level. Every place that builds a
 * `Record<string, YamlValue>` from parsed input must go through this instead
 * of a bare `map[key] = value`.
 */
function setMapKey(
  map: Record<string, YamlValue>,
  key: string,
  value: YamlValue,
  lineNumber: number,
): void {
  if (DANGEROUS_KEYS.has(key)) {
    throw new WireVizYamlError(`key "${key}" is not allowed`, lineNumber);
  }
  if (Object.prototype.hasOwnProperty.call(map, key)) {
    throw new WireVizYamlError(`duplicate key "${key}"`, lineNumber);
  }
  map[key] = value;
}

// ---------------------------------------------------------------------------
// Preprocessing: strip comments/blanks, reject tabs, expand compacted
// "- - - key: value" lines into one synthetic line per nesting level so the
// block parser never has to deal with inline sequence nesting.
// ---------------------------------------------------------------------------

function preprocessLines(text: string): RawLine[] {
  const result: RawLine[] = [];
  const rawLines = text.split(/\r?\n/);

  rawLines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    if (rawLine.includes('\t')) {
      throw new WireVizYamlError('tabs are not supported for indentation', lineNumber);
    }

    const stripped = stripComment(rawLine);
    if (stripped.trim() === '') return;

    const indent = stripped.length - stripped.trimStart().length;
    let content = stripped.trim();
    let runningIndent = indent;

    // Peel off "- " (or bare "-") prefixes, emitting one synthetic bare "-"
    // line per level except the last, which keeps its trailing content.
    for (;;) {
      if (content === '-') {
        result.push({ indent: runningIndent, content: '-', lineNumber });
        return;
      }
      if (content.startsWith('- ')) {
        const rest = content.slice(2);
        if (rest.trimStart().startsWith('- ') || rest.trim() === '-') {
          result.push({ indent: runningIndent, content: '-', lineNumber });
          runningIndent += 2;
          content = rest.trim();
          continue;
        }
        result.push({ indent: runningIndent, content: `- ${rest.trim()}`, lineNumber });
        return;
      }
      result.push({ indent: runningIndent, content, lineNumber });
      return;
    }
  });

  return result;
}

function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) {
      // A '#' only starts a comment when preceded by start-of-line or whitespace.
      if (i === 0 || /\s/.test(line[i - 1])) return line.slice(0, i);
    }
  }
  return line;
}

// ---------------------------------------------------------------------------
// Block parser: mappings and sequences, indent-driven.
// ---------------------------------------------------------------------------

function parseBlock(
  lines: RawLine[],
  index: number,
  indent: number,
): { value: YamlValue; nextIndex: number } {
  if (index >= lines.length || lines[index].indent < indent) {
    return { value: null, nextIndex: index };
  }
  if (lines[index].indent > indent) {
    throw new WireVizYamlError('unexpected indentation', lines[index].lineNumber);
  }

  if (lines[index].content === '-' || lines[index].content.startsWith('- ')) {
    return parseSequence(lines, index, indent);
  }
  return parseMapping(lines, index, indent);
}

function parseSequence(
  lines: RawLine[],
  index: number,
  indent: number,
): { value: YamlValue[]; nextIndex: number } {
  const items: YamlValue[] = [];
  let i = index;

  while (i < lines.length && lines[i].indent === indent && isSequenceLine(lines[i].content)) {
    const rest = lines[i].content === '-' ? '' : lines[i].content.slice(2);
    i++;

    if (rest === '') {
      const nextIndent = i < lines.length ? lines[i].indent : -1;
      if (nextIndent > indent) {
        const { value, nextIndex } = parseBlock(lines, i, nextIndent);
        items.push(value);
        i = nextIndex;
      } else {
        items.push(null);
      }
      continue;
    }

    if (isMapKeyLine(rest)) {
      const { value, nextIndex } = parseMappingFromInline(
        lines,
        i,
        indent + 2,
        rest,
        lines[i - 1].lineNumber,
      );
      items.push(value);
      i = nextIndex;
    } else {
      items.push(parseScalar(rest));
    }
  }

  return { value: items, nextIndex: i };
}

function isSequenceLine(content: string): boolean {
  return content === '-' || content.startsWith('- ');
}

const MAP_KEY_PATTERN = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:#]+?):(\s+(.*)|)$/;

function isMapKeyLine(content: string): boolean {
  return MAP_KEY_PATTERN.test(content);
}

/**
 * Parses a mapping that starts inline (right after a sequence dash, e.g.
 * `- NANO: [D9]`) and may continue on subsequent lines indented to align
 * with the first key (WireViz doesn't use this for `connections`, but
 * generic WireViz-style connector definitions can).
 */
function parseMappingFromInline(
  lines: RawLine[],
  index: number,
  continuationIndent: number,
  firstLine: string,
  firstLineNumber: number,
): { value: Record<string, YamlValue>; nextIndex: number } {
  const map: Record<string, YamlValue> = {};
  let i = index;

  const { key, value, hasNestedBlock } = parseMapLine(firstLine, firstLineNumber);
  if (hasNestedBlock) {
    const nextIndent = i < lines.length ? lines[i].indent : -1;
    if (nextIndent > continuationIndent) {
      const nested = parseBlock(lines, i, nextIndent);
      setMapKey(map, key, nested.value, firstLineNumber);
      i = nested.nextIndex;
    } else {
      setMapKey(map, key, null, firstLineNumber);
    }
  } else {
    setMapKey(map, key, value, firstLineNumber);
  }

  while (
    i < lines.length &&
    lines[i].indent === continuationIndent &&
    !isSequenceLine(lines[i].content)
  ) {
    const continuationLineNumber = lines[i].lineNumber;
    const { value: nested, nextIndex } = parseMapping(lines, i, continuationIndent);
    for (const [nestedKey, nestedValue] of Object.entries(nested)) {
      setMapKey(map, nestedKey, nestedValue, continuationLineNumber);
    }
    i = nextIndex;
  }

  return { value: map, nextIndex: i };
}

function parseMapping(
  lines: RawLine[],
  index: number,
  indent: number,
): { value: Record<string, YamlValue>; nextIndex: number } {
  const map: Record<string, YamlValue> = {};
  let i = index;

  while (i < lines.length && lines[i].indent === indent && !isSequenceLine(lines[i].content)) {
    const line = lines[i];
    const { key, value, hasNestedBlock } = parseMapLine(line.content, line.lineNumber);
    i++;

    if (hasNestedBlock) {
      const nextIndent = i < lines.length ? lines[i].indent : -1;
      if (nextIndent > indent) {
        const nested = parseBlock(lines, i, nextIndent);
        setMapKey(map, key, nested.value, line.lineNumber);
        i = nested.nextIndex;
      } else {
        setMapKey(map, key, null, line.lineNumber);
      }
    } else {
      setMapKey(map, key, value, line.lineNumber);
    }
  }

  return { value: map, nextIndex: i };
}

function parseMapLine(
  content: string,
  lineNumber: number,
): { key: string; value: YamlValue; hasNestedBlock: boolean } {
  const match = MAP_KEY_PATTERN.exec(content);
  if (!match) {
    throw new WireVizYamlError(`expected "key: value", got "${content}"`, lineNumber);
  }
  const key = unquoteIfNeeded(match[1]);
  const rawValue = match[3];
  if (rawValue === undefined || rawValue === '') {
    return { key, value: null, hasNestedBlock: true };
  }
  return { key, value: parseScalar(rawValue), hasNestedBlock: false };
}

// ---------------------------------------------------------------------------
// Scalars and inline flow sequences.
// ---------------------------------------------------------------------------

function parseScalar(raw: string): YamlValue {
  const trimmed = raw.trim();
  if (trimmed === '{}') return {};
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return parseFlowSequence(trimmed.slice(1, -1));
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return unquoteIfNeeded(trimmed);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === '~') return null;
  if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return Number.parseFloat(trimmed);
  return trimmed;
}

function parseFlowSequence(inner: string): YamlValue[] {
  if (inner.trim() === '') return [];
  const items: string[] = [];
  let depth = 0;
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (const ch of inner) {
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    if (!inSingle && !inDouble) {
      if (ch === '[') depth++;
      if (ch === ']') depth--;
      if (ch === ',' && depth === 0) {
        items.push(current);
        current = '';
        continue;
      }
    }
    current += ch;
  }
  items.push(current);

  return items.map((item) => parseScalar(item.trim()));
}

function unquoteIfNeeded(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\"/g, '"');
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  return raw;
}

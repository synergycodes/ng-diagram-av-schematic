import { type YamlValue } from './wireviz-yaml';

/**
 * Minimal, hand-rolled YAML-subset emitter — the inverse of
 * `wireviz-yaml.ts`'s parser, and deliberately restricted to exactly the
 * shapes that parser accepts, so anything this writes can be read back.
 *
 * Clean-room implementation written for this repository: no code was copied
 * or adapted from Garth-42/WireForm (GPL-3.0) or from the Python `wireviz`
 * project. See docs/license-matrix.md.
 *
 * Shapes produced:
 *   - block mappings (`key:` + indented block) for nested maps/sequences;
 *   - inline flow sequences (`[a, b, c]`) for lists of scalars;
 *   - block sequences (`- item`), with a nested sequence compacted onto the
 *     parent's dash (`- - NANO: [D9]`) — the form WireViz itself uses for a
 *     list of connection sets, and the form the parser expects.
 *
 * Scalar types are preserved. In particular, strings that look numeric are
 * quoted so an unknown field containing `"1"` does not come back as number
 * `1`; designators remain strings too, even though the importer also accepts
 * numeric designators from human-authored documents.
 */
export function stringifyYamlSubset(value: YamlValue): string {
  const lines: string[] = [];
  emitNode(value, 0, lines);
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function emitNode(value: YamlValue, indent: number, lines: string[]): void {
  if (isMapping(value)) {
    emitMapping(value, indent, lines);
    return;
  }
  if (Array.isArray(value)) {
    emitSequence(value, indent, lines);
    return;
  }
  lines.push(pad(indent) + formatScalar(value));
}

function emitMapping(map: Record<string, YamlValue>, indent: number, lines: string[]): void {
  for (const [key, value] of Object.entries(map)) {
    if (value === undefined) continue;
    const head = `${pad(indent)}${formatKey(key)}:`;
    if (isInline(value)) {
      lines.push(`${head} ${formatInline(value)}`);
      continue;
    }
    lines.push(head);
    emitNode(value, indent + 2, lines);
  }
}

function emitSequence(items: readonly YamlValue[], indent: number, lines: string[]): void {
  for (const item of items) {
    if (isInline(item)) {
      lines.push(`${pad(indent)}- ${formatInline(item)}`);
      continue;
    }

    // A nested block (sequence or mapping) is emitted at indent + 2 and its
    // first line is folded onto this item's dash, which is how the parser
    // reads compacted "- - key: value" lines back.
    const nested: string[] = [];
    emitNode(item, indent + 2, nested);
    if (nested.length === 0) {
      lines.push(`${pad(indent)}-`);
      continue;
    }
    lines.push(`${pad(indent)}- ${nested[0].trimStart()}`);
    lines.push(...nested.slice(1));
  }
}

/** True for values that fit on one line: scalars, and lists of scalars. */
function isInline(value: YamlValue): boolean {
  if (Array.isArray(value)) return value.every((item) => !isMapping(item) && !Array.isArray(item));
  if (isMapping(value)) return Object.keys(value).length === 0;
  return !isMapping(value);
}

function formatInline(value: YamlValue): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => formatScalar(item)).join(', ')}]`;
  }
  if (isMapping(value) && Object.keys(value).length === 0) return '{}';
  return formatScalar(value);
}

function isMapping(value: YamlValue): value is Record<string, YamlValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pad(indent: number): string {
  return ' '.repeat(indent);
}

function formatKey(key: string): string {
  return needsQuoting(key) ? quote(key) : key;
}

function formatScalar(value: YamlValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`cannot write a non-finite number to YAML: ${value}`);
    }
    return String(value);
  }
  if (typeof value === 'string') {
    return needsQuoting(value) ? quote(value) : value;
  }
  // Reached only if a mapping/sequence slipped into a scalar position.
  throw new Error(`cannot write ${typeof value} as a YAML scalar`);
}

/**
 * Quoting is deliberately eager: anything that could change meaning when
 * read back — a structural character, a leading/trailing space, a word the
 * parser turns into a boolean or null — is quoted, because a wrong guess
 * here silently alters the electrical document.
 */
function needsQuoting(value: string): boolean {
  if (value === '') return true;
  if (value.trim() !== value) return true;
  if (/[[\]{},"'#\n\r]/.test(value)) return true;
  if (/:(\s|$)/.test(value)) return true;
  if (/^[-?*&!|>%@`]/.test(value)) return true;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return true;
  return ['true', 'false', 'null', '~'].includes(value.toLowerCase());
}

/**
 * Double quotes normally; single quotes as soon as the value contains a
 * double quote or a backslash. The parser only unescapes `\"` inside double
 * quotes and `''` inside single quotes, so a backslash has no escape form in
 * the double-quoted style it could survive — the single-quoted style, which
 * treats backslashes literally, is the one that round-trips.
 */
function quote(value: string): string {
  if (value.includes('"') || value.includes('\\')) {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `"${value}"`;
}

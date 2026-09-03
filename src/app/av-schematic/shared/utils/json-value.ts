/**
 * The set of values that survive `JSON.stringify` / `JSON.parse` unchanged.
 *
 * Declared once, in a module that depends on nothing, because two unrelated
 * layers need exactly this type and must stay assignable to each other: the
 * YAML subset parser's `YamlValue` and the diagram model's `PreservedValue`
 * (fields carried verbatim from an imported document). Writing the same
 * recursive shape twice would leave TypeScript comparing two structurally
 * identical but separately declared types at every hand-off.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

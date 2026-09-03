/**
 * Connectivity grouping shared by every place that has to answer "which
 * conductors form one electrical net?".
 *
 * The rule the whole project rests on: a net is a *connected component* of
 * the conductor graph. Two conductors that touch the same endpoint belong to
 * the same net, no matter how many conductors already touch it and no matter
 * which order they were declared in. That is what turns a pin referenced
 * from several WireViz connection sets into one multi-drop net with three or
 * more endpoints, instead of an "invalid port reuse" error.
 *
 * Deriving nets rather than storing them as first-class user-owned entities
 * also means the canvas cannot drift out of sync: drawing one wire between
 * two existing nets merges them on the next serialization, and deleting the
 * wire that joined them splits them again, with no bookkeeping step in
 * between.
 */

/** Minimal shape this module needs from a conductor: the two endpoints it joins. */
export interface ConductorEndpoints {
  readonly fromKey: string;
  readonly toKey: string;
}

/**
 * Groups conductors into connected components.
 *
 * Determinism matters more than it looks: two projects that are electrically
 * equal but were built in a different order must produce the same groups in
 * the same order, otherwise the round-trip comparison would depend on
 * declaration order. Groups are therefore returned sorted by their smallest
 * endpoint key, and each group's members keep their input order.
 */
export function groupConductorsIntoNets<T extends ConductorEndpoints>(
  conductors: readonly T[],
): T[][] {
  const parent = new Map<string, string>();

  const find = (key: string): string => {
    let root = key;
    for (;;) {
      const next = parent.get(root);
      if (next === undefined) {
        parent.set(root, root);
        return root;
      }
      if (next === root) return root;
      root = next;
    }
  };

  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;
    // Union by lexicographic order, so the representative of a group is
    // always its smallest key regardless of insertion order.
    if (rootA < rootB) parent.set(rootB, rootA);
    else parent.set(rootA, rootB);
  };

  for (const conductor of conductors) {
    find(conductor.fromKey);
    find(conductor.toKey);
    union(conductor.fromKey, conductor.toKey);
  }

  const groups = new Map<string, T[]>();
  for (const conductor of conductors) {
    const root = find(conductor.fromKey);
    const group = groups.get(root);
    if (group) group.push(conductor);
    else groups.set(root, [conductor]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, group]) => group);
}

/**
 * Every distinct endpoint key touched by a group of conductors, sorted.
 * A group with three or more of these is a multi-drop net.
 */
export function endpointKeysOf(conductors: readonly ConductorEndpoints[]): string[] {
  const keys = new Set<string>();
  for (const conductor of conductors) {
    keys.add(conductor.fromKey);
    keys.add(conductor.toKey);
  }
  return [...keys].sort();
}

/**
 * How many conductors land on each endpoint. An endpoint with two or more is
 * a fan-out point: the same physical pin or junction feeding several
 * branches of one net. This is the legitimate reuse the importer must accept
 * instead of flagging a port collision.
 */
export function conductorDegreeByEndpoint(
  conductors: readonly ConductorEndpoints[],
): Map<string, number> {
  const degree = new Map<string, number>();
  const bump = (key: string): void => {
    degree.set(key, (degree.get(key) ?? 0) + 1);
  };
  for (const conductor of conductors) {
    bump(conductor.fromKey);
    bump(conductor.toKey);
  }
  return degree;
}

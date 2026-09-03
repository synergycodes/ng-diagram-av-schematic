import { describe, expect, it } from 'vitest';
import { OPERATIONAL_LIMITS } from '../model/operational-limits.mjs';
import { materializeJunctionTaps } from './junction-node.component';

describe('materializeJunctionTaps', () => {
  it.each([
    ['below', OPERATIONAL_LIMITS.maxJunctionTaps - 1, OPERATIONAL_LIMITS.maxJunctionTaps - 1],
    ['at', OPERATIONAL_LIMITS.maxJunctionTaps, OPERATIONAL_LIMITS.maxJunctionTaps],
    ['above', OPERATIONAL_LIMITS.maxJunctionTaps + 1, OPERATIONAL_LIMITS.maxJunctionTaps],
  ] as const)('bounds materialization %s the boundary', (_label, taps, expected) => {
    const materialized = materializeJunctionTaps(taps);

    expect(materialized).toHaveLength(expected);
    expect(materialized.at(-1)).toEqual({ id: `tap-${expected - 1}`, index: expected - 1 });
  });
});

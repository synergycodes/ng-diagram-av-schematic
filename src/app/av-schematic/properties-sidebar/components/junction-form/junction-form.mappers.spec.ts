import { describe, expect, it } from 'vitest';
import { type JunctionNodeData } from '../../../diagram/model/interfaces';
import { OPERATIONAL_LIMITS } from '../../../diagram/model/operational-limits.mjs';
import { formDataToJunctionData, junctionDataToFormData } from './junction-form.mappers';

const RAIL: JunctionNodeData = {
  type: 'junction',
  junctionId: 'rail-5v',
  label: 'Rail 5 V',
  kind: 'rail',
  taps: 3,
  notes: 'Distribuição principal',
  netId: 'net-5v',
  wirevizName: 'RAIL_5V',
};

describe('junction form mappers', () => {
  it('exposes the editable rail fields without hiding inspection metadata', () => {
    expect(junctionDataToFormData(RAIL)).toEqual({
      label: 'Rail 5 V',
      kind: 'rail',
      taps: 3,
      notes: 'Distribuição principal',
    });
  });

  it('applies real junction edits while preserving net and WireViz identity', () => {
    expect(
      formDataToJunctionData(
        { label: 'Barramento 5 V', kind: 'junction', taps: 5, notes: '' },
        RAIL,
      ),
    ).toEqual({
      ...RAIL,
      label: 'Barramento 5 V',
      kind: 'junction',
      taps: 5,
      notes: undefined,
    });
  });

  it('clamps invalid tap counts to one visible electrical tap', () => {
    expect(
      formDataToJunctionData(
        { label: RAIL.label, kind: RAIL.kind, taps: 0, notes: RAIL.notes ?? '' },
        RAIL,
      ).taps,
    ).toBe(1);

    expect(
      formDataToJunctionData(
        { label: RAIL.label, kind: RAIL.kind, taps: Number.POSITIVE_INFINITY, notes: '' },
        RAIL,
      ).taps,
    ).toBe(1);
  });

  it.each([
    ['below', OPERATIONAL_LIMITS.maxJunctionTaps - 1, OPERATIONAL_LIMITS.maxJunctionTaps - 1],
    ['at', OPERATIONAL_LIMITS.maxJunctionTaps, OPERATIONAL_LIMITS.maxJunctionTaps],
    ['above', OPERATIONAL_LIMITS.maxJunctionTaps + 1, OPERATIONAL_LIMITS.maxJunctionTaps],
  ] as const)('keeps edited taps within the limit %s the boundary', (_label, taps, expected) => {
    expect(
      formDataToJunctionData(
        { label: RAIL.label, kind: RAIL.kind, taps, notes: RAIL.notes ?? '' },
        RAIL,
      ).taps,
    ).toBe(expected);
  });
});

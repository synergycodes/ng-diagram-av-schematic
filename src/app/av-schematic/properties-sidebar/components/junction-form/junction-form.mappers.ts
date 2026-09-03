import { InjectionToken } from '@angular/core';
import { type JunctionKind, type JunctionNodeData } from '../../../diagram/model/interfaces';
import { OPERATIONAL_LIMITS } from '../../../diagram/model/operational-limits.mjs';

export interface JunctionFormData {
  label: string;
  kind: JunctionKind;
  taps: number;
  notes: string;
}

export interface JunctionFieldChange {
  nodeId: string;
  fields: (keyof JunctionFormData)[];
  formData: JunctionFormData;
}

export const ON_JUNCTION_FIELD_CHANGE = new InjectionToken<(change: JunctionFieldChange) => void>(
  'ON_JUNCTION_FIELD_CHANGE',
);

export const EMPTY_JUNCTION_FORM: JunctionFormData = {
  label: '',
  kind: 'junction',
  taps: 1,
  notes: '',
};

export function junctionDataToFormData(data: JunctionNodeData): JunctionFormData {
  return {
    label: data.label,
    kind: data.kind,
    taps: data.taps,
    notes: data.notes ?? '',
  };
}

export function formDataToJunctionData(
  formData: JunctionFormData,
  existing: JunctionNodeData,
): JunctionNodeData {
  const taps = Number.isFinite(formData.taps)
    ? Math.min(OPERATIONAL_LIMITS.maxJunctionTaps, Math.max(1, Math.trunc(formData.taps)))
    : 1;
  return {
    ...existing,
    label: formData.label,
    kind: formData.kind,
    taps,
    notes: formData.notes || undefined,
  };
}

import { InjectionToken } from '@angular/core';
import { type WireEdgeData } from '../../../diagram/model/interfaces';
import { describeWireColorEmission } from '../../../wireviz-import/wireviz-color-report';
import {
  normalizeWireVizHexColor,
  paletteWireColor,
  type ResolvedWireColor,
} from '../../../wireviz-import/wireviz-colors';

export const WIRE_TYPES = [
  'audio',
  'video',
  'speaker',
  'ethernet',
  'power',
  'control',
  'usb',
  'fiber',
  'jumper',
] as const;

export type WireType = (typeof WIRE_TYPES)[number];

export const WIRE_TYPE_OPTIONS: readonly { value: WireType; label: string }[] = [
  { value: 'audio', label: 'Áudio' },
  { value: 'video', label: 'Vídeo' },
  { value: 'speaker', label: 'Alto-falante' },
  { value: 'ethernet', label: 'Ethernet' },
  { value: 'power', label: 'Energia' },
  { value: 'control', label: 'Controle' },
  { value: 'usb', label: 'USB' },
  { value: 'fiber', label: 'Fibra' },
  { value: 'jumper', label: 'Jumper de protoboard' },
];

export const CUSTOM_COLOR_CHOICE = 'custom';
export const DEFAULT_CUSTOM_COLOR = '#888888';

export interface WireFormData {
  wireId: string;
  /** Free text at the model boundary so imported values stay visible. */
  wireType: string;
  /** Derived net identity, displayed read-only in the form. */
  netId: string;
  /** Empty, a WireViz token, or `CUSTOM_COLOR_CHOICE`. */
  colorChoice: string;
  customColor: string;
  gauge: string;
  length: string;
  note: string;
}

export interface WireFieldChange {
  edgeId: string;
  fields: (keyof WireFormData)[];
  formData: WireFormData;
}

export const ON_WIRE_FIELD_CHANGE = new InjectionToken<(change: WireFieldChange) => void>(
  'ON_WIRE_FIELD_CHANGE',
);

export const EMPTY_WIRE_FORM: WireFormData = {
  wireId: '',
  wireType: '',
  netId: '',
  colorChoice: '',
  customColor: DEFAULT_CUSTOM_COLOR,
  gauge: '',
  length: '',
  note: '',
};

export function wireDataToFormData(data: WireEdgeData): WireFormData {
  const emission = describeWireColorEmission(data);
  return {
    wireId: data.wireId,
    wireType: data.wireType ?? '',
    netId: data.netName ?? data.netId ?? '',
    colorChoice:
      emission.kind === 'palette'
        ? emission.code
        : emission.kind === 'wireviz-opaque'
          ? emission.token
          : emission.kind === 'custom-emittable' || emission.kind === 'custom-unemittable'
            ? CUSTOM_COLOR_CHOICE
            : '',
    customColor:
      emission.kind === 'palette' ||
      emission.kind === 'custom-emittable' ||
      emission.kind === 'custom-unemittable'
        ? (emission.color ?? DEFAULT_CUSTOM_COLOR)
        : DEFAULT_CUSTOM_COLOR,
    gauge: data.gauge ?? '',
    length: data.length ?? '',
    note: data.notes ?? '',
  };
}

export function formDataToWireData(
  formData: WireFormData,
  existingData: WireEdgeData,
): WireEdgeData {
  const wireId = existingData.wirevizLoop ? '' : formData.wireId;
  const { color, colorCode } = resolveFormColor(formData, existingData.color);
  return {
    ...existingData,
    wireId,
    wireType: blankToUndefined(formData.wireType),
    color,
    colorCode,
    gauge: blankToUndefined(formData.gauge),
    length: blankToUndefined(formData.length),
    notes: blankToUndefined(formData.note),
    wirevizLink: wireId ? undefined : existingData.wirevizLink,
  };
}

/**
 * Converts picker state without collapsing an explicit custom choice back to
 * a palette entry. A custom RGB value keeps an RGB WireViz token even when its
 * channels happen to equal one palette color, so palette -> custom remains a
 * reachable and persistent transition.
 */
export function resolveFormColor(
  formData: WireFormData,
  unlistedRenderColor?: string,
): ResolvedWireColor {
  if (formData.colorChoice === '') return {};
  if (formData.colorChoice !== CUSTOM_COLOR_CHOICE) {
    const palette = paletteWireColor(formData.colorChoice);
    if (palette.colorCode) return palette;
    return {
      color: unlistedRenderColor,
      colorCode: formData.colorChoice.trim() || undefined,
    };
  }
  const custom = formData.customColor.trim();
  if (!custom) return {};
  return { color: custom, colorCode: normalizeWireVizHexColor(custom) };
}

function blankToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

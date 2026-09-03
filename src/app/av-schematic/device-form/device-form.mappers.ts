import { InjectionToken } from '@angular/core';
import { type DeviceNodeData, type DevicePort } from '../diagram/model/interfaces';

export interface DeviceFormData {
  deviceId: string;
  manufacturer: string;
  model: string;
  category: string;
  location: string;
  ports: DevicePort[];
}

export interface DeviceFieldChange {
  entityId: string;
  fields: (keyof DeviceFormData)[];
  formData: DeviceFormData;
}

export const ON_DEVICE_FIELD_CHANGE = new InjectionToken<(change: DeviceFieldChange) => void>(
  'ON_DEVICE_FIELD_CHANGE',
);

export const DEVICE_FORM_HIDDEN_FIELDS = new InjectionToken<readonly (keyof DeviceFormData)[]>(
  'DEVICE_FORM_HIDDEN_FIELDS',
  { factory: () => [] },
);

export const EMPTY_DEVICE_FORM: DeviceFormData = {
  deviceId: '',
  manufacturer: '',
  model: '',
  category: '',
  location: '',
  ports: [],
};

export function deviceDataToFormData(data: DeviceNodeData): DeviceFormData {
  return {
    deviceId: data.deviceId,
    manufacturer: data.manufacturer,
    model: data.model,
    category: data.category ?? '',
    location: data.location ?? '',
    ports: data.ports,
  };
}

export function formDataToDeviceData(
  formData: DeviceFormData,
  existingData: DeviceNodeData,
): DeviceNodeData {
  return {
    ...existingData,
    deviceId: formData.deviceId,
    manufacturer: formData.manufacturer,
    model: formData.model,
    category: formData.category || undefined,
    location: formData.location || undefined,
    // A footprint owns physical pin identity and placement owns hole mapping.
    // The generic AV editor may change descriptive fields, but not those ports.
    ports: existingData.footprintId !== undefined ? existingData.ports : formData.ports,
  };
}

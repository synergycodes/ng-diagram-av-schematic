import { type DeviceNodeData, type DevicePort } from '../diagram/model/interfaces';
import { SEED_LIBRARY, type LibraryDevice } from './seed-library';

export const LIBRARY_STORAGE_KEY = 'talus-wiring-editor.library.v1';
export const LIBRARY_STORAGE_VERSION = 1;

interface PersistedLibrary {
  version: typeof LIBRARY_STORAGE_VERSION;
  devices: LibraryDevice[];
}

export function browserLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadLibraryDevices(storage: Storage | null): LibraryDevice[] {
  if (!storage) return cloneSeedLibrary();
  try {
    const serialized = storage.getItem(LIBRARY_STORAGE_KEY);
    if (!serialized) return cloneSeedLibrary();
    const parsed: unknown = JSON.parse(serialized);
    const recovered = recoverPersistedLibrary(parsed);
    if (!recovered) return cloneSeedLibrary();
    if (recovered.wasRepaired) {
      persistLibraryDevices(storage, recovered.devices);
    }
    return recovered.devices;
  } catch {
    return cloneSeedLibrary();
  }
}

export function persistLibraryDevices(storage: Storage | null, devices: LibraryDevice[]): void {
  if (!storage) return;
  const payload: PersistedLibrary = { version: LIBRARY_STORAGE_VERSION, devices };
  try {
    storage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // The in-memory library remains usable when storage is unavailable or full.
  }
}

function recoverPersistedLibrary(
  value: unknown,
): { devices: LibraryDevice[]; wasRepaired: boolean } | null {
  if (!isRecord(value) || value['version'] !== LIBRARY_STORAGE_VERSION) return null;
  if (!Array.isArray(value['devices'])) return null;

  if (value['devices'].length === 0) {
    return { devices: [], wasRepaired: false };
  }

  const devices: LibraryDevice[] = [];
  const seenIds = new Set<string>();
  for (const candidate of value['devices']) {
    if (!isLibraryDevice(candidate) || seenIds.has(candidate.libraryId)) continue;
    devices.push(candidate);
    seenIds.add(candidate.libraryId);
  }

  if (devices.length === 0) {
    return { devices: cloneSeedLibrary(), wasRepaired: true };
  }
  return { devices, wasRepaired: devices.length !== value['devices'].length };
}

function isLibraryDevice(value: unknown): value is LibraryDevice {
  return (
    isRecord(value) &&
    typeof value['libraryId'] === 'string' &&
    value['libraryId'].length > 0 &&
    isDeviceTemplate(value['template'])
  );
}

function isDeviceTemplate(value: unknown): value is DeviceNodeData {
  if (!isRecord(value) || value['type'] !== 'device') return false;
  if (
    typeof value['deviceId'] !== 'string' ||
    typeof value['manufacturer'] !== 'string' ||
    typeof value['model'] !== 'string' ||
    !Array.isArray(value['ports']) ||
    !value['ports'].every(isDevicePort)
  ) {
    return false;
  }
  return (
    optionalString(value['category']) &&
    optionalString(value['location']) &&
    optionalString(value['notes'])
  );
}

function isDevicePort(value: unknown): value is DevicePort {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    value['id'].length > 0 &&
    typeof value['label'] === 'string' &&
    (value['direction'] === 'input' || value['direction'] === 'output') &&
    optionalString(value['connectorType'])
  );
}

const optionalString = (value: unknown): boolean =>
  value === undefined || typeof value === 'string';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const cloneSeedLibrary = (): LibraryDevice[] => structuredClone(SEED_LIBRARY);

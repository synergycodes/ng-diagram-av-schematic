import { computed, Injectable, signal } from '@angular/core';
import { type DeviceNodeData } from '../diagram/model/interfaces';
import { browserLocalStorage, loadLibraryDevices, persistLibraryDevices } from './library-storage';
import { matchesLibrarySearch } from './library-search';
import { SEED_LIBRARY, type LibraryDevice } from './seed-library';

type LibraryEditMode = 'create' | 'edit';

/** Page-scoped state for the device-library palette: list, expand/collapse, edit-mode lifecycle, and debounced search. */
@Injectable()
export class LibraryService {
  private readonly storage = browserLocalStorage();

  readonly devices = signal<LibraryDevice[]>(loadLibraryDevices(this.storage));
  readonly isExpanded = signal(false);
  readonly editingDeviceId = signal<string | null>(null);
  readonly editingMode = signal<LibraryEditMode | null>(null);
  readonly searchQuery = signal('');

  readonly editingDevice = computed<LibraryDevice | null>(() => {
    const id = this.editingDeviceId();
    if (!id) return null;
    return this.devices().find((d) => d.libraryId === id) ?? null;
  });

  readonly filteredDevices = computed<LibraryDevice[]>(() => {
    const query = this.searchQuery().trim();
    if (!query) return this.devices();
    return this.devices().filter((device) => matchesLibrarySearch(device, query));
  });

  expand(): void {
    this.isExpanded.set(true);
  }

  toggleVisibility(): void {
    this.isExpanded.update((v) => !v);
  }

  beginCreate(): void {
    this.editingDeviceId.set(`lib-custom-${createLibraryId()}`);
    this.editingMode.set('create');
  }

  beginEdit(libraryId: string): void {
    this.editingDeviceId.set(libraryId);
    this.editingMode.set('edit');
  }

  commitDraft(libraryId: string, template: DeviceNodeData): void {
    const mode = this.editingMode();
    if (mode === 'create') {
      this.devices.update((list) => [...list, { libraryId, template }]);
    } else if (mode === 'edit') {
      this.devices.update((list) =>
        list.map((d) => (d.libraryId === libraryId ? { ...d, template } : d)),
      );
    }
    persistLibraryDevices(this.storage, this.devices());
    this.closeDetail();
  }

  closeDetail(): void {
    this.editingDeviceId.set(null);
    this.editingMode.set(null);
  }

  removeDevice(libraryId: string): void {
    this.devices.update((list) => list.filter((d) => d.libraryId !== libraryId));
    persistLibraryDevices(this.storage, this.devices());
    if (this.editingDeviceId() === libraryId) {
      this.closeDetail();
    }
  }

  restoreDefaults(): void {
    const restored = [
      ...structuredClone(SEED_LIBRARY),
      ...this.devices().filter((device) => device.libraryId.startsWith('lib-custom-')),
    ];
    this.devices.set(restored);
    persistLibraryDevices(this.storage, restored);
    this.closeDetail();
  }
}

const createLibraryId = (): string => {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
};

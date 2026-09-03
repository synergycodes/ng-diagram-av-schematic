import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DEVICE_CATEGORIES, deviceCategoryLabel } from '../../../diagram/model/device-categories';
import { TooltipDirective } from '../../../shared/directives/tooltip/tooltip.directive';
import { LibraryService } from '../../library.service';
import { type LibraryDevice } from '../../seed-library';
import { LibraryListItemComponent } from '../library-list-item/library-list-item.component';
import { LibrarySearchComponent } from '../library-search/library-search.component';

const UNCATEGORIZED_KEY = '__uncategorized__';
const UNCATEGORIZED_LABEL = 'Outros';

interface DeviceGroup {
  key: string;
  label: string;
  devices: LibraryDevice[];
}

@Component({
  selector: 'app-library-list',
  imports: [LibraryListItemComponent, LibrarySearchComponent, TooltipDirective],
  templateUrl: './library-list.component.html',
  styleUrl: './library-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryListComponent {
  private readonly libraryService = inject(LibraryService);

  protected readonly devices = this.libraryService.devices;
  protected readonly filteredDevices = this.libraryService.filteredDevices;
  protected readonly searchQuery = this.libraryService.searchQuery;

  protected readonly groupedDevices = computed<DeviceGroup[]>(() =>
    groupDevicesByCategory(this.devices()),
  );

  private readonly collapsedGroups = signal<ReadonlySet<string>>(new Set());

  protected isGroupOpen(key: string): boolean {
    return !this.collapsedGroups().has(key);
  }

  protected onGroupToggle(key: string, event: Event): void {
    const open = (event.target as HTMLDetailsElement).open;
    this.collapsedGroups.update((set) => {
      const next = new Set(set);
      if (open) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  protected groupTooltip(group: DeviceGroup): string {
    return this.isGroupOpen(group.key) ? `Recolher ${group.label}` : `Expandir ${group.label}`;
  }

  protected onAddDevice(): void {
    this.libraryService.beginCreate();
  }

  protected onRestoreDefaults(): void {
    this.libraryService.restoreDefaults();
  }
}

const groupDevicesByCategory = (devices: readonly LibraryDevice[]): DeviceGroup[] => {
  const buckets = new Map<string, LibraryDevice[]>();
  for (const device of devices) {
    // `||` is intentional: an empty-after-trim category should also fall to uncategorized.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const key = device.template.category?.trim() || UNCATEGORIZED_KEY;
    const list = buckets.get(key) ?? [];
    list.push(device);
    buckets.set(key, list);
  }
  const ordered: DeviceGroup[] = [];
  for (const category of DEVICE_CATEGORIES) {
    const list = buckets.get(category);
    if (list && list.length > 0) {
      ordered.push({ key: category, label: deviceCategoryLabel(category), devices: list });
      buckets.delete(category);
    }
  }
  for (const [key, list] of buckets) {
    if (key === UNCATEGORIZED_KEY) continue;
    ordered.push({ key, label: deviceCategoryLabel(key), devices: list });
  }
  const uncategorized = buckets.get(UNCATEGORIZED_KEY);
  if (uncategorized && uncategorized.length > 0) {
    ordered.push({ key: UNCATEGORIZED_KEY, label: UNCATEGORIZED_LABEL, devices: uncategorized });
  }
  return ordered;
};

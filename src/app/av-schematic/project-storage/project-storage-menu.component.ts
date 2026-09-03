import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ProjectStorageService } from './project-storage.service';

export const DEFAULT_PROJECT_ID = 'talus-droid';

/**
 * Accessible Salvar/Abrir (Save/Open) controls for the local persistence
 * service (issue #1, AC 3: a project saved from one browser can be reopened
 * from another client on the Tailnet). Lives in the top navbar next to
 * Export, sharing the ProjectStorageService instance provided at the
 * av-schematic page level.
 */
@Component({
  selector: 'app-project-storage-menu',
  templateUrl: './project-storage-menu.component.html',
  styleUrl: './project-storage-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectStorageMenuComponent {
  private readonly storage = inject(ProjectStorageService);

  protected readonly projectId = signal(DEFAULT_PROJECT_ID);
  protected readonly status = this.storage.status;
  protected readonly message = this.storage.message;
  protected readonly isBusy = this.storage.isBusy;
  protected readonly diagnostics = this.storage.physicalDiagnostics;
  protected readonly diagnosticCount = this.storage.physicalDiagnosticCount;
  protected readonly diagnosticsOpen = signal(false);

  protected readonly statusRole = computed(() => (this.status() === 'error' ? 'alert' : 'status'));
  protected readonly operationIsSave = computed(() => this.storage.operation() === 'save');

  protected onProjectIdInput(event: Event): void {
    this.projectId.set((event.target as HTMLInputElement).value);
  }

  protected save(): void {
    if (this.isBusy()) return;
    void this.storage.save(this.projectId());
  }

  protected open(): void {
    if (this.isBusy()) return;
    void this.storage.open(this.projectId());
  }

  protected toggleDiagnostics(): void {
    this.storage.refreshPhysicalDiagnostics();
    this.diagnosticsOpen.update((open) => !open);
  }
}

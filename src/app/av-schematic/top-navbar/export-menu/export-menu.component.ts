import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { DiagramExportService } from '../../export/diagram-export.service';

@Component({
  selector: 'app-export-menu',
  templateUrl: './export-menu.component.html',
  styleUrl: './export-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExportMenuComponent {
  private readonly elRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly exportService = inject(DiagramExportService);

  protected readonly isOpen = signal(false);
  protected readonly isExporting = signal(false);
  protected readonly exportError = signal<string | null>(null);
  protected readonly canExport = this.exportService.canExport;

  constructor() {
    effect((onCleanup) => {
      if (!this.isOpen()) return;
      const handler = (event: MouseEvent) => {
        if (!this.elRef.nativeElement.contains(event.target as Node | null)) {
          this.isOpen.set(false);
        }
      };
      document.addEventListener('click', handler);
      onCleanup(() => {
        document.removeEventListener('click', handler);
      });
    });
  }

  protected toggle(): void {
    this.isOpen.update((open) => !open);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.isOpen()) {
      event.preventDefault();
      this.isOpen.set(false);
    }
  }

  protected async exportPng(): Promise<void> {
    if (!this.canExport() || this.isExporting()) return;
    this.exportError.set(null);
    this.isOpen.set(false);
    this.isExporting.set(true);
    try {
      await this.exportService.exportPng();
    } finally {
      this.isExporting.set(false);
    }
  }

  protected async exportSvg(): Promise<void> {
    if (!this.canExport() || this.isExporting()) return;
    this.exportError.set(null);
    this.isExporting.set(true);
    try {
      await this.exportService.exportSvg();
      this.exportError.set(null);
      this.isOpen.set(false);
    } catch {
      this.exportError.set(
        'Não foi possível exportar o SVG. Reduza a área do diagrama e tente novamente.',
      );
    } finally {
      this.isExporting.set(false);
    }
  }

  protected exportDxf(): void {
    if (!this.canExport() || this.isExporting()) return;
    this.exportError.set(null);
    this.isOpen.set(false);
    this.exportService.exportDxf();
  }
}

import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagramExportService } from '../../export/diagram-export.service';
import { ExportMenuComponent } from './export-menu.component';

describe('ExportMenuComponent', () => {
  let fixture: ComponentFixture<ExportMenuComponent>;
  let host: HTMLElement;
  let exportSvg: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    exportSvg = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      imports: [ExportMenuComponent],
      providers: [
        {
          provide: DiagramExportService,
          useValue: {
            canExport: signal(true),
            exportPng: vi.fn().mockResolvedValue(undefined),
            exportSvg,
            exportDxf: vi.fn(),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(ExportMenuComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('keeps the menu open and announces an SVG export failure', async () => {
    exportSvg.mockRejectedValueOnce(new Error('canvas allocation failed'));

    clickButton('Exportar');
    clickButton('Exportar para SVG');
    await fixture.whenStable();
    fixture.detectChanges();

    const alert = host.querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toContain('Não foi possível exportar o SVG');
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('clears the previous failure on retry and closes only after success', async () => {
    exportSvg.mockRejectedValueOnce(new Error('canvas allocation failed'));

    clickButton('Exportar');
    clickButton('Exportar para SVG');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();

    clickButton('Exportar para SVG');
    fixture.detectChanges();
    expect(host.querySelector('[role="alert"]')).toBeNull();

    await fixture.whenStable();
    fixture.detectChanges();
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  function clickButton(label: string): void {
    const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!button) throw new Error(`Button not found: ${label}`);
    button.click();
    fixture.detectChanges();
  }
});

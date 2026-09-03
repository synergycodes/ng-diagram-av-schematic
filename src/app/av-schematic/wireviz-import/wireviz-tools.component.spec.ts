import { signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WireVizExchangeService } from './wireviz-exchange.service';
import { type WireVizReportEntry } from './wireviz-report';
import { WireVizToolsComponent } from './wireviz-tools.component';

describe('WireVizToolsComponent', () => {
  let fixture: ComponentFixture<WireVizToolsComponent>;
  let host: HTMLElement;
  let exchange: {
    status: WritableSignal<'success'>;
    message: WritableSignal<string | null>;
    reportEntries: WritableSignal<WireVizReportEntry[]>;
    isBusy: WritableSignal<boolean>;
    importYaml: ReturnType<typeof vi.fn>;
    loadMultidropFixture: ReturnType<typeof vi.fn>;
    downloadYaml: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    exchange = {
      status: signal<'success'>('success'),
      message: signal<string | null>('Operação concluída.'),
      reportEntries: signal([
        {
          severity: 'warning',
          code: 'unknown-field',
          path: 'metadata',
          message: 'Campo global preservado somente no relatório.',
        },
      ]),
      isBusy: signal(false),
      importYaml: vi.fn(() => Promise.resolve(true)),
      loadMultidropFixture: vi.fn(() => Promise.resolve(true)),
      downloadYaml: vi.fn(() => true),
    };

    TestBed.configureTestingModule({
      imports: [WireVizToolsComponent],
      providers: [{ provide: WireVizExchangeService, useValue: exchange }],
    });
    fixture = TestBed.createComponent(WireVizToolsComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the import, multi-drop fixture, export and global report controls', () => {
    expect(host.textContent).toContain('Importar YAML');
    expect(host.textContent).toContain('Fixture multi-drop');
    expect(host.textContent).toContain('Exportar WireViz');
    expect(host.textContent).toContain('Relatório (1)');
  });

  it('sends the selected YAML file to the real import flow and opens the report', async () => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('file input not rendered');
    const text = vi.fn(() => Promise.resolve('connectors: {}\n'));
    const file = { text } as unknown as File;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });

    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text).toHaveBeenCalledOnce();
    expect(exchange.importYaml).toHaveBeenCalledWith('connectors: {}\n');
    expect(host.querySelector('.report-panel')?.textContent).toContain('unknown-field');
  });

  it('delegates replacement import without asking the UI to export the current canvas', async () => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('file input not rendered');
    const file = {
      text: () => Promise.resolve('connectors: {}\nconnections: []\n'),
    } as unknown as File;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });

    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(exchange.importYaml).toHaveBeenCalledOnce();
    expect(exchange.downloadYaml).not.toHaveBeenCalled();
  });

  it('loads the fixture and downloads WireViz from their navbar actions', async () => {
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')];
    const fixtureButton = buttons.find((button) => button.textContent?.includes('Fixture'));
    const exportButton = buttons.find((button) => button.textContent?.includes('Exportar'));
    if (!fixtureButton || !exportButton) throw new Error('WireViz action buttons not rendered');

    fixtureButton.click();
    await fixture.whenStable();
    exportButton.click();

    expect(exchange.loadMultidropFixture).toHaveBeenCalledOnce();
    expect(exchange.downloadYaml).toHaveBeenCalledOnce();
  });
});

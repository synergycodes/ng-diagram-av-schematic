import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { WireVizExchangeService } from './wireviz-exchange.service';

@Component({
  selector: 'app-wireviz-tools',
  templateUrl: './wireviz-tools.component.html',
  styleUrl: './wireviz-tools.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WireVizToolsComponent {
  private readonly exchange = inject(WireVizExchangeService);

  protected readonly status = this.exchange.status;
  protected readonly message = this.exchange.message;
  protected readonly entries = this.exchange.reportEntries;
  protected readonly isBusy = this.exchange.isBusy;
  protected readonly reportOpen = signal(false);

  protected async importFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.isBusy()) return;
    await this.exchange.importYaml(await file.text());
    this.reportOpen.set(true);
  }

  protected async loadFixture(): Promise<void> {
    if (this.isBusy()) return;
    await this.exchange.loadMultidropFixture();
    this.reportOpen.set(true);
  }

  protected exportWireViz(): void {
    if (this.isBusy()) return;
    this.exchange.downloadYaml();
    this.reportOpen.set(true);
  }

  protected toggleReport(): void {
    this.reportOpen.update((open) => !open);
  }
}

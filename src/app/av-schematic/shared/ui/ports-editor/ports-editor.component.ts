import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { type FormValueControl } from '@angular/forms/signals';
import { type DevicePort, type PortDirection } from '../../../diagram/model/interfaces';
import { AutofocusDirective } from '../../directives/autofocus/autofocus.directive';
import { TooltipDirective } from '../../directives/tooltip/tooltip.directive';
import { SelectComponent, type SelectOption } from '../select/select.component';
import { CONNECTOR_TYPES } from './connector-types';
import { generatePortId } from './generate-port-id';

@Component({
  selector: 'app-ports-editor',
  imports: [AutofocusDirective, TooltipDirective, SelectComponent],
  templateUrl: './ports-editor.component.html',
  styleUrl: './ports-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortsEditorComponent implements FormValueControl<DevicePort[]> {
  readonly value = model<DevicePort[]>([]);
  readonly triggerId = input<string>();

  /** The connector picker: an explicit "none" row first, so a set connector can be cleared. */
  protected readonly connectorOptions: readonly SelectOption<string>[] = [
    { value: '', label: '—' },
    ...CONNECTOR_TYPES.map((connector) => ({ value: connector, label: connector })),
  ];
  protected readonly autofocusPortId = signal<string | null>(null);
  protected readonly activeDirection = signal<PortDirection>('input');
  protected readonly addPortButton = viewChild<ElementRef<HTMLButtonElement>>('addPortButton');

  protected readonly inputs = computed<DevicePort[]>(() =>
    this.value().filter((p) => p.direction === 'input'),
  );
  protected readonly outputs = computed<DevicePort[]>(() =>
    this.value().filter((p) => p.direction === 'output'),
  );
  protected readonly visiblePorts = computed<DevicePort[]>(() =>
    this.activeDirection() === 'input' ? this.inputs() : this.outputs(),
  );

  protected connectorSelectId(port: DevicePort): string {
    return `port-${port.id}-connector`;
  }

  protected setActiveDirection(direction: PortDirection): void {
    this.activeDirection.set(direction);
  }

  protected addPort(): void {
    const newPort: DevicePort = {
      id: generatePortId(),
      label: '',
      direction: this.activeDirection(),
    };
    this.autofocusPortId.set(newPort.id);
    this.value.update((ports) => [...ports, newPort]);

    // Defer past the next render so the new row is laid out before scrolling.
    setTimeout(() => {
      this.addPortButton()?.nativeElement.scrollIntoView({
        block: 'end',
        behavior: 'smooth',
      });
    });
  }

  protected removePort(id: string): void {
    this.value.update((ports) => ports.filter((p) => p.id !== id));
  }

  protected updateLabel(id: string, label: string): void {
    this.value.update((ports) => ports.map((p) => (p.id === id ? { ...p, label } : p)));
  }

  protected updateConnectorType(id: string, connectorType: string): void {
    this.value.update((ports) =>
      ports.map((p) => (p.id === id ? { ...p, connectorType: connectorType || undefined } : p)),
    );
  }

  protected toggleDirection(id: string): void {
    this.value.update((ports) => {
      const target = ports.find((p) => p.id === id);
      if (!target) return ports;
      const flipped: PortDirection = target.direction === 'input' ? 'output' : 'input';
      const others = ports.filter((p) => p.id !== id);
      return [...others, { ...target, direction: flipped }];
    });
  }

  protected moveUp(id: string): void {
    this.movePortInDirection(id, -1);
  }

  protected moveDown(id: string): void {
    this.movePortInDirection(id, 1);
  }

  protected isFirstInDirection(port: DevicePort): boolean {
    const list = port.direction === 'input' ? this.inputs() : this.outputs();
    return list[0]?.id === port.id;
  }

  protected isLastInDirection(port: DevicePort): boolean {
    const list = port.direction === 'input' ? this.inputs() : this.outputs();
    return list[list.length - 1]?.id === port.id;
  }

  /** Reorders within one direction list, leaving the other direction's positions untouched. */
  private movePortInDirection(id: string, delta: -1 | 1): void {
    this.value.update((ports) => {
      const target = ports.find((p) => p.id === id);
      if (!target) return ports;
      const sameDirection = ports.filter((p) => p.direction === target.direction);
      const indexInList = sameDirection.findIndex((p) => p.id === id);
      const swapIndexInList = indexInList + delta;
      if (swapIndexInList < 0 || swapIndexInList >= sameDirection.length) return ports;

      const swapId = sameDirection[swapIndexInList].id;
      const indexInAll = ports.findIndex((p) => p.id === id);
      const swapIndexInAll = ports.findIndex((p) => p.id === swapId);

      const next = [...ports];
      next[indexInAll] = ports[swapIndexInAll];
      next[swapIndexInAll] = ports[indexInAll];
      return next;
    });
  }
}

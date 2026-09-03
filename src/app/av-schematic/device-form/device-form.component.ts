import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { DEVICE_CATEGORIES } from '../diagram/model/device-categories';
import { type DeviceNodeData } from '../diagram/model/interfaces';
import { AutofocusDirective } from '../shared/directives/autofocus/autofocus.directive';
import { ComboboxComponent } from '../shared/ui/combobox/combobox.component';
import { FormFieldComponent } from '../shared/ui/form-field/form-field.component';
import { PortsEditorComponent } from '../shared/ui/ports-editor/ports-editor.component';
import { deviceDataToFormData, DEVICE_FORM_HIDDEN_FIELDS } from './device-form.mappers';
import { DeviceFormService } from './device-form.service';

@Component({
  selector: 'app-device-form',
  imports: [
    FormField,
    FormFieldComponent,
    AutofocusDirective,
    PortsEditorComponent,
    ComboboxComponent,
  ],
  templateUrl: './device-form.component.html',
  styleUrl: './device-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeviceFormComponent {
  private readonly formService = inject(DeviceFormService);
  private readonly hiddenFields = inject(DEVICE_FORM_HIDDEN_FIELDS);

  readonly entityId = input.required<string>();
  readonly nodeData = input.required<DeviceNodeData>();
  readonly readonlyPorts = input(false);

  protected readonly fieldTree = this.formService.fieldTree;
  protected readonly showDeviceId = !this.hiddenFields.includes('deviceId');
  protected readonly showLocation = !this.hiddenFields.includes('location');
  protected readonly portsAreReadonly = computed(
    () => this.readonlyPorts() || this.nodeData().footprintId !== undefined,
  );
  protected readonly autofocusManufacturer = computed(() =>
    this.showDeviceId ? null : this.entityId(),
  );
  protected readonly categories = DEVICE_CATEGORIES;

  constructor() {
    this.syncFormWithInputs();

    inject(DestroyRef).onDestroy(() => {
      this.formService.commitPendingEdits();
    });
  }

  private syncFormWithInputs(): void {
    effect(() => {
      const entityId = this.entityId();
      const nodeData = this.nodeData();

      untracked(() => {
        this.formService.loadFormData(entityId, deviceDataToFormData(nodeData));
      });
    });
  }
}

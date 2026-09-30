import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { type WireEdgeData } from '../../../diagram/model/interfaces';
import { type WireEndpointInfo } from '../../properties-sidebar.service';
import { FormFieldComponent } from '../../../shared/ui/form-field/form-field.component';
import { SelectComponent, type SelectOption } from '../../../shared/ui/select/select.component';
import { wireDataToFormData, WIRE_TYPES, type WireType } from './wire-form.mappers';
import { WireFormService } from './wire-form.service';

/** The empty row keeps "no type" pickable, as the connection grid shows an unset value. */
const WIRE_TYPE_OPTIONS: readonly SelectOption<WireType | ''>[] = [
  { value: '', label: '—' },
  ...WIRE_TYPES.map((type) => ({ value: type, label: type })),
];

@Component({
  selector: 'app-wire-form',
  imports: [FormField, FormFieldComponent, SelectComponent],
  templateUrl: './wire-form.component.html',
  styleUrl: './wire-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WireFormComponent {
  private readonly formService = inject(WireFormService);

  readonly edgeId = input.required<string>();
  readonly edgeData = input.required<WireEdgeData>();
  readonly source = input.required<WireEndpointInfo | null>();
  readonly target = input.required<WireEndpointInfo | null>();

  protected readonly fieldTree = this.formService.fieldTree;
  protected readonly wireTypeOptions = WIRE_TYPE_OPTIONS;

  constructor() {
    this.syncFormWithInputs();

    inject(DestroyRef).onDestroy(() => {
      this.formService.commitPendingEdits();
    });
  }

  private syncFormWithInputs(): void {
    effect(() => {
      const edgeId = this.edgeId();
      const edgeData = this.edgeData();

      untracked(() => {
        this.formService.loadFormData(edgeId, wireDataToFormData(edgeData));
      });
    });
  }
}

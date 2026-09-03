import { inject, Injectable, Injector, signal } from '@angular/core';
import { disabled } from '@angular/forms/signals';
import { DebouncedFormController } from '../../../shared/forms/debounced-form-controller';
import { EMPTY_WIRE_FORM, ON_WIRE_FIELD_CHANGE, type WireFormData } from './wire-form.mappers';

const TRACKED_FIELDS = Object.keys(EMPTY_WIRE_FORM) as (keyof WireFormData)[];
// Free-text fields debounce so every keystroke isn't a model write; the two
// pickers (wire type, color choice) commit immediately.
const DEBOUNCED_FIELDS: readonly (keyof WireFormData)[] = [
  'wireId',
  'customColor',
  'gauge',
  'length',
  'note',
];

/**
 * Form controller for the wire properties sidebar; debounces the free-text
 * fields while emitting picker changes immediately.
 */
@Injectable()
export class WireFormService {
  private readonly onFieldChange = inject(ON_WIRE_FIELD_CHANGE);
  private readonly wireIdDisabled = signal(false);

  private readonly controller = new DebouncedFormController<WireFormData>({
    empty: EMPTY_WIRE_FORM,
    debouncedFields: DEBOUNCED_FIELDS,
    trackedFields: TRACKED_FIELDS,
    schema: (path) => {
      disabled(path.wireId, () => this.wireIdDisabled());
      disabled(path.netId, () => true);
    },
    onChange: (entityId, fields, formData) => {
      this.onFieldChange({ edgeId: entityId, fields, formData });
    },
    injector: inject(Injector),
  });

  readonly formModel = this.controller.formModel;
  readonly fieldTree = this.controller.fieldTree;

  loadFormData(edgeId: string, data: WireFormData, wireIdDisabled = false): void {
    this.wireIdDisabled.set(wireIdDisabled);
    this.controller.loadFormData(edgeId, data);
  }

  commitPendingEdits(): void {
    this.controller.commitPendingEdits();
  }
}

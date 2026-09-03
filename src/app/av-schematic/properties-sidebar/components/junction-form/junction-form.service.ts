import { inject, Injectable, Injector } from '@angular/core';
import { max, min } from '@angular/forms/signals';
import { OPERATIONAL_LIMITS } from '../../../diagram/model/operational-limits.mjs';
import { DebouncedFormController } from '../../../shared/forms/debounced-form-controller';
import {
  EMPTY_JUNCTION_FORM,
  ON_JUNCTION_FIELD_CHANGE,
  type JunctionFormData,
} from './junction-form.mappers';

const TRACKED_FIELDS = Object.keys(EMPTY_JUNCTION_FORM) as (keyof JunctionFormData)[];
const DEBOUNCED_FIELDS: readonly (keyof JunctionFormData)[] = ['label', 'notes'];

@Injectable()
export class JunctionFormService {
  private readonly onFieldChange = inject(ON_JUNCTION_FIELD_CHANGE);
  private readonly controller = new DebouncedFormController<JunctionFormData>({
    empty: EMPTY_JUNCTION_FORM,
    debouncedFields: DEBOUNCED_FIELDS,
    trackedFields: TRACKED_FIELDS,
    schema: (path) => {
      min(path.taps, 1);
      max(path.taps, OPERATIONAL_LIMITS.maxJunctionTaps);
    },
    onChange: (nodeId, fields, formData) => {
      this.onFieldChange({ nodeId, fields, formData });
    },
    injector: inject(Injector),
  });

  readonly fieldTree = this.controller.fieldTree;

  loadFormData(nodeId: string, data: JunctionFormData): void {
    this.controller.loadFormData(nodeId, data);
  }

  commitPendingEdits(): void {
    this.controller.commitPendingEdits();
  }
}

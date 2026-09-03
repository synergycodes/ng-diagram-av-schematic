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
import { type JunctionNodeData } from '../../../diagram/model/interfaces';
import { FormFieldComponent } from '../../../shared/ui/form-field/form-field.component';
import { junctionDataToFormData } from './junction-form.mappers';
import { JunctionFormService } from './junction-form.service';

@Component({
  selector: 'app-junction-form',
  imports: [FormField, FormFieldComponent],
  templateUrl: './junction-form.component.html',
  styleUrl: './junction-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JunctionFormComponent {
  private readonly formService = inject(JunctionFormService);

  readonly nodeId = input.required<string>();
  readonly nodeData = input.required<JunctionNodeData>();

  protected readonly fieldTree = this.formService.fieldTree;

  constructor() {
    effect(() => {
      const nodeId = this.nodeId();
      const data = this.nodeData();
      untracked(() => {
        this.formService.loadFormData(nodeId, junctionDataToFormData(data));
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.formService.commitPendingEdits();
    });
  }
}

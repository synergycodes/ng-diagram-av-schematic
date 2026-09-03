import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { NetHighlightService } from '../../../diagram/net-highlight/net-highlight.service';
import { type WireEdgeData } from '../../../diagram/model/interfaces';
import { type WireEndpointInfo } from '../../../diagram/model/wire-endpoints';
import { FormFieldComponent } from '../../../shared/ui/form-field/form-field.component';
import { describeWireColorEmission } from '../../../wireviz-import/wireviz-color-report';
import { WIREVIZ_COLOR_OPTIONS } from '../../../wireviz-import/wireviz-colors';
import { CUSTOM_COLOR_CHOICE, wireDataToFormData, WIRE_TYPE_OPTIONS } from './wire-form.mappers';
import { WireFormService } from './wire-form.service';

@Component({
  selector: 'app-wire-form',
  imports: [FormField, FormFieldComponent],
  templateUrl: './wire-form.component.html',
  styleUrl: './wire-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WireFormComponent {
  private readonly formService = inject(WireFormService);
  private readonly netHighlight = inject(NetHighlightService);

  readonly edgeId = input.required<string>();
  readonly edgeData = input.required<WireEdgeData>();
  readonly source = input.required<WireEndpointInfo | null>();
  readonly target = input.required<WireEndpointInfo | null>();
  readonly netId = input<string>('');
  readonly netName = input<string>('');
  readonly netSize = input<number>(0);
  readonly jumperLength = input<string | null>(null);

  protected readonly fieldTree = this.formService.fieldTree;
  protected readonly formModel = this.formService.formModel;
  protected readonly wireTypeOptions = WIRE_TYPE_OPTIONS;
  protected readonly colorOptions = WIREVIZ_COLOR_OPTIONS;
  protected readonly customChoice = CUSTOM_COLOR_CHOICE;

  protected readonly isCustomColor = computed(
    () => this.formModel().colorChoice === CUSTOM_COLOR_CHOICE,
  );

  protected readonly unlistedWireType = computed(() => {
    const value = this.formModel().wireType;
    if (!value || this.wireTypeOptions.some((option) => option.value === value)) return null;
    return value;
  });

  protected readonly unlistedColorCode = computed(() => {
    const value = this.formModel().colorChoice;
    if (
      !value ||
      value === CUSTOM_COLOR_CHOICE ||
      this.colorOptions.some((option) => option.code === value)
    ) {
      return null;
    }
    return value;
  });

  protected readonly previewColor = computed(() => {
    const emission = describeWireColorEmission(this.edgeData());
    return 'color' in emission && emission.color ? emission.color : 'var(--av-color-wire-stroke)';
  });

  protected readonly customColorWarning = computed(() => {
    const emission = describeWireColorEmission(this.edgeData());
    if (emission.kind !== 'custom-unemittable') return null;
    return `A cor personalizada ${emission.color} não pode ser emitida no YAML WireViz.`;
  });

  protected readonly netLabel = computed(() => this.netName() || this.netId());
  protected readonly isNetHighlighted = computed(
    () => !!this.netId() && this.netHighlight.netId() === this.netId(),
  );
  protected readonly dimOthers = this.netHighlight.dimOthers;

  constructor() {
    this.syncFormWithInputs();

    inject(DestroyRef).onDestroy(() => {
      this.formService.commitPendingEdits();
    });
  }

  protected onToggleNetHighlight(): void {
    this.netHighlight.toggleEdge(this.edgeId());
  }

  protected onDimOthersChange(event: Event): void {
    this.netHighlight.setDimOthers((event.target as HTMLInputElement).checked);
  }

  private syncFormWithInputs(): void {
    effect(() => {
      const edgeId = this.edgeId();

      untracked(() => {
        const edgeData = this.edgeData();
        this.formService.loadFormData(
          edgeId,
          wireDataToFormData(edgeData),
          edgeData.wirevizLoop === true,
        );
      });
    });
  }
}

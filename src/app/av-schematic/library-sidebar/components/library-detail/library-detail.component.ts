import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { type DeviceNodeData } from '../../../diagram/model/interfaces';
import { DeviceFormComponent } from '../../../device-form/device-form.component';
import {
  DEVICE_FORM_HIDDEN_FIELDS,
  ON_DEVICE_FIELD_CHANGE,
  type DeviceFieldChange,
} from '../../../device-form/device-form.mappers';
import { DeviceFormService } from '../../../device-form/device-form.service';
import { TooltipDirective } from '../../../shared/directives/tooltip/tooltip.directive';
import { LibraryDraftService } from '../../library-draft.service';
import { LibraryService } from '../../library.service';
import { createBlankTemplate } from '../../seed-library';

@Component({
  selector: 'app-library-detail',
  imports: [DeviceFormComponent, TooltipDirective],
  templateUrl: './library-detail.component.html',
  styleUrl: './library-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    LibraryDraftService,
    DeviceFormService,
    { provide: DEVICE_FORM_HIDDEN_FIELDS, useValue: ['deviceId', 'location'] },
    {
      provide: ON_DEVICE_FIELD_CHANGE,
      useFactory: () => {
        const draft = inject(LibraryDraftService);
        return (change: DeviceFieldChange) => {
          draft.applyChange(change);
        };
      },
    },
  ],
})
export class LibraryDetailComponent {
  private readonly libraryService = inject(LibraryService);
  private readonly draftService = inject(LibraryDraftService);

  readonly libraryId = input.required<string>();

  protected readonly mode = this.libraryService.editingMode;

  // Stable per editing session — only changes when libraryId/mode flip,
  // not on every keystroke. Bound to the form's `[nodeData]` so re-syncing
  // the form doesn't fight the user's typing.
  protected readonly initialTemplate = signal<DeviceNodeData>(createBlankTemplate());

  protected readonly title = computed(() =>
    this.mode() === 'create' ? 'Novo componente' : 'Editar componente',
  );

  protected readonly canSave = computed(() => {
    const draft = this.draftService.draft();
    return draft.manufacturer.trim() !== '' || draft.model.trim() !== '';
  });

  constructor() {
    effect(() => {
      const id = this.libraryId();
      const mode = this.libraryService.editingMode();
      untracked(() => {
        const initial =
          mode === 'edit'
            ? (this.libraryService.devices().find((d) => d.libraryId === id)?.template ??
              createBlankTemplate())
            : createBlankTemplate();
        this.initialTemplate.set(initial);
        this.draftService.reset(initial);
      });
    });
  }

  protected onSave(): void {
    if (!this.canSave()) return;
    this.libraryService.commitDraft(this.libraryId(), this.draftService.draft());
  }

  protected onBack(): void {
    this.libraryService.closeDetail();
  }

  protected onRemove(): void {
    this.libraryService.removeDevice(this.libraryId());
  }
}

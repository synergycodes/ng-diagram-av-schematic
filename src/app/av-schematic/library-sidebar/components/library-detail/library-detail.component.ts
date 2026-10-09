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
import { ConfirmDialogService } from '../../../shared/ui/confirm-dialog/confirm-dialog.service';
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
  private readonly confirmDialog = inject(ConfirmDialogService);

  readonly libraryId = input.required<string>();

  protected readonly mode = this.libraryService.editingMode;

  // Stable per editing session — only changes when libraryId/mode flip,
  // not on every keystroke. Bound to the form's `[nodeData]` so re-syncing
  // the form doesn't fight the user's typing.
  protected readonly initialTemplate = signal<DeviceNodeData>(createBlankTemplate());

  protected readonly title = computed(() =>
    this.mode() === 'create' ? 'New device' : 'Edit device',
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

  protected async onRemove(): Promise<void> {
    const libraryId = this.libraryId();
    const template = this.libraryService.devices().find((d) => d.libraryId === libraryId)?.template;
    const name = `${template?.manufacturer ?? ''} ${template?.model ?? ''}`.trim() || 'This device';
    const confirmed = await this.confirmDialog.confirm({
      title: 'Remove from library?',
      message: `“${name}” is removed from the library. Devices already placed on the canvas are not affected.`,
      confirmLabel: 'Remove from library',
    });
    if (confirmed) this.libraryService.removeDevice(libraryId);
  }
}

import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NgDiagramPaletteItemComponent, NgDiagramPaletteItemPreviewComponent } from 'ng-diagram';
import { deviceCategoryLabel } from '../../../diagram/model/device-categories';
import { HighlightSegmentsPipe } from '../../../shared/ui/highlight-segments/highlight-segments.pipe';
import { DeviceIllustrationComponent } from '../../../shared/ui/device-illustration/device-illustration.component';
import { LibraryService } from '../../library.service';
import { type LibraryDevice } from '../../seed-library';
import { asDevicePaletteItem } from './palette-item-cast';

@Component({
  selector: 'app-library-list-item',
  imports: [
    NgDiagramPaletteItemComponent,
    NgDiagramPaletteItemPreviewComponent,
    DeviceIllustrationComponent,
    HighlightSegmentsPipe,
  ],
  templateUrl: './library-list-item.component.html',
  styleUrl: './library-list-item.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryListItemComponent {
  private readonly libraryService = inject(LibraryService);

  readonly device = input.required<LibraryDevice>();

  protected readonly paletteItem = computed(() => asDevicePaletteItem(this.device().template));

  protected readonly searchQuery = this.libraryService.searchQuery;

  protected readonly categoryLabel = computed(() => {
    const c = this.device().template.category?.trim();
    return c ? deviceCategoryLabel(c) : '';
  });

  protected onOpenDetail(): void {
    this.libraryService.beginEdit(this.device().libraryId);
  }
}

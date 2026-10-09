import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { NgDiagramPaletteItemComponent, NgDiagramPaletteItemPreviewComponent } from 'ng-diagram';
import { TooltipDirective } from '../../../shared/directives/tooltip/tooltip.directive';
import { HighlightSegmentsPipe } from '../../../shared/ui/highlight-segments/highlight-segments.pipe';
import { LibraryService } from '../../library.service';
import { type LibraryDevice } from '../../seed-library';
import { asDevicePaletteItem } from './palette-item-cast';

@Component({
  selector: 'app-library-list-item',
  imports: [
    NgDiagramPaletteItemComponent,
    NgDiagramPaletteItemPreviewComponent,
    HighlightSegmentsPipe,
    TooltipDirective,
  ],
  templateUrl: './library-list-item.component.html',
  styleUrl: './library-list-item.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryListItemComponent {
  private readonly libraryService = inject(LibraryService);

  readonly device = input.required<LibraryDevice>();
  readonly editable = input<boolean>(false);
  // Off by default: the grouped list names the category in its group header, so the row would
  // only repeat it. The flat search results turn it on, where it is the only grouping cue.
  readonly showCategory = input<boolean>(false);
  readonly edit = output();

  protected readonly paletteItem = computed(() => asDevicePaletteItem(this.device().template));

  protected readonly searchQuery = this.libraryService.searchQuery;

  protected readonly categoryLabel = computed(() => {
    const c = this.device().template.category?.trim();
    return c ? c.replace(/-/g, ' ') : '';
  });

  // The tooltip shows the short "Edit"; the accessible name adds the model so screen reader
  // users can tell the buttons apart. "Edit" stays a prefix of it (WCAG 2.5.3 Label in Name).
  protected readonly editLabel = computed(() => {
    const model = this.device().template.model.trim();
    return `Edit ${model || 'device'}`;
  });
}

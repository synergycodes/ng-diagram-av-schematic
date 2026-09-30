import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { ConfirmDialogService } from './confirm-dialog.service';

/**
 * Renders the pending `ConfirmDialogService` request as a native `<dialog>` opened with
 * `showModal()`, which gives the focus trap, the inert background, Esc-to-dismiss and focus
 * return to the trigger for free. Initial focus goes to the dialog itself, not to a button, so a
 * reflexive Enter after Delete or Backspace neither confirms nor cancels; the user tabs to Cancel
 * first, then to the destructive action. Mount it once on the page.
 */
@Component({
  selector: 'app-confirm-dialog',
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // A click on the backdrop targets the <dialog> element itself and bubbles up to the host.
  host: { '(click)': 'onBackdropClick($event)' },
})
export class ConfirmDialogComponent {
  private readonly service = inject(ConfirmDialogService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly request = this.service.request;

  constructor() {
    afterRenderEffect(() => {
      const el = this.dialog().nativeElement;
      const shouldBeOpen = this.request() !== null;
      if (shouldBeOpen && !el.open) {
        // jsdom has no HTMLDialogElement API; the attribute fallback keeps unit tests honest.
        if (typeof el.showModal === 'function') {
          el.showModal();
        } else {
          el.setAttribute('open', '');
        }
        // showModal() would otherwise hand focus to the first button.
        el.focus();
      } else if (!shouldBeOpen && el.open) {
        if (typeof el.close === 'function') {
          el.close();
        } else {
          el.removeAttribute('open');
        }
      }
    });
  }

  protected confirm(): void {
    this.service.resolve(true);
  }

  protected cancel(): void {
    this.service.resolve(false);
  }

  /** Native close (Esc, or our own `close()` after resolving) - a no-op once resolved. */
  protected onClose(): void {
    this.service.resolve(false);
  }

  /** The dialog element itself is only the event target when the click lands on the backdrop. */
  protected onBackdropClick(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) {
      this.service.resolve(false);
    }
  }
}

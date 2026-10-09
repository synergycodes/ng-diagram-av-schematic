import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { ConfirmDialogService } from './confirm-dialog.service';

@Component({
  selector: 'app-confirm-dialog',
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(click)': 'onBackdropClick($event)' },
})
export class ConfirmDialogComponent {
  private readonly service = inject(ConfirmDialogService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly request = this.service.request;

  /**
   * How many of our own `close()` calls are still waiting for their `close` event: the browser
   * fires it a task later, by which time the request that opened next may already be on screen.
   */
  private selfIssuedCloses = 0;

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
        // Focus the box, not a button: showModal() would focus the first one, so a reflexive
        // Enter after Delete or Backspace would confirm the removal.
        el.focus();
      } else if (!shouldBeOpen && el.open) {
        this.selfIssuedCloses++;
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

  /** Esc dismisses the dialog, which counts as cancel; our own `close` echo must not. */
  protected onClose(): void {
    if (this.selfIssuedCloses > 0) {
      this.selfIssuedCloses--;
      return;
    }
    this.service.resolve(false);
  }

  /** The dialog element itself is only the event target when the click lands on the backdrop. */
  protected onBackdropClick(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) {
      this.service.resolve(false);
    }
  }
}

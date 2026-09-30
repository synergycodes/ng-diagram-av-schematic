import { Injectable, signal } from '@angular/core';

/** What a destructive action asks the user before it runs. */
export interface ConfirmDialogOptions {
  /** Names the decision, e.g. "Remove rack?". */
  title: string;
  /** One idea: what is removed and what happens to its contents. */
  message: string;
  /** Verb-led confirming label, e.g. "Remove rack". Rendered as the destructive button. */
  confirmLabel: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
}

export type ConfirmDialogRequest = Required<ConfirmDialogOptions>;

/**
 * Single-slot confirmation dialog state. `confirm()` returns a promise that settles when the
 * user picks a button (or dismisses, which counts as cancel). `ConfirmDialogComponent`, mounted
 * once on the page, renders whatever `request` holds.
 */
@Injectable()
export class ConfirmDialogService {
  private readonly currentRequest = signal<ConfirmDialogRequest | null>(null);
  private resolver: ((result: boolean) => void) | null = null;

  readonly request = this.currentRequest.asReadonly();

  /** Opens the dialog. A request opened while another is pending cancels the earlier one. */
  confirm(options: ConfirmDialogOptions): Promise<boolean> {
    this.resolve(false);
    return new Promise<boolean>((resolve) => {
      this.resolver = resolve;
      this.currentRequest.set({ cancelLabel: 'Cancel', ...options });
    });
  }

  /** Settles the pending request; a no-op when nothing is open. */
  resolve(result: boolean): void {
    const resolver = this.resolver;
    this.resolver = null;
    this.currentRequest.set(null);
    resolver?.(result);
  }
}

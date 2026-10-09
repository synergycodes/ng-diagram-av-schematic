import { Injectable, signal } from '@angular/core';

/** What a destructive action asks the user before it runs. */
export interface ConfirmDialogOptions {
  title: string;
  message: string;
  /** Verb-led label, e.g. "Remove rack". Rendered as the destructive button. */
  confirmLabel: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
}

export type ConfirmDialogRequest = Required<ConfirmDialogOptions>;

/** Single-slot confirmation dialog state, rendered by the `ConfirmDialogComponent` mounted once on the page. */
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

  resolve(result: boolean): void {
    const resolver = this.resolver;
    this.resolver = null;
    this.currentRequest.set(null);
    resolver?.(result);
  }
}

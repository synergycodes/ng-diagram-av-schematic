import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ConfirmDialogComponent } from './confirm-dialog.component';
import { ConfirmDialogService } from './confirm-dialog.service';

@Component({
  imports: [ConfirmDialogComponent],
  providers: [ConfirmDialogService],
  template: `<app-confirm-dialog />`,
})
class HostComponent {
  readonly dialog = inject(ConfirmDialogService);
}

const setup = () => {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  const host = fixture.debugElement.nativeElement as HTMLElement;
  const query = (selector: string): HTMLElement => {
    const el = host.querySelector(selector);
    if (!(el instanceof HTMLElement)) throw new Error(`${selector} not rendered`);
    return el;
  };
  return { fixture, service: fixture.componentInstance.dialog, host, query };
};

const options = {
  title: 'Remove rack?',
  message: '“Rack A” will be removed. Its devices go to the Unplaced tray.',
  confirmLabel: 'Remove rack',
};

describe('ConfirmDialogComponent', () => {
  it('renders nothing while no request is pending', () => {
    const { host } = setup();
    expect(host.querySelector('dialog')?.hasAttribute('open')).toBe(false);
    expect(host.querySelector('.dialog-title')).toBeNull();
  });

  it('opens a labelled dialog with the request copy and Cancel first', async () => {
    const { fixture, service, query } = setup();
    void service.confirm(options);
    fixture.detectChanges();
    await fixture.whenStable();

    const dialog = query('dialog');
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(query(`#${dialog.getAttribute('aria-labelledby')}`).textContent?.trim()).toBe(
      options.title,
    );
    expect(query(`#${dialog.getAttribute('aria-describedby')}`).textContent?.trim()).toBe(
      options.message,
    );
    const buttons = [...dialog.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(buttons).toEqual(['Cancel', 'Remove rack']);
  });

  it('focuses the dialog itself on open, so Enter does not pick a button', async () => {
    const { fixture, service, query } = setup();
    void service.confirm(options);
    fixture.detectChanges();
    await fixture.whenStable();

    const dialog = query('dialog');
    expect(document.activeElement).toBe(dialog);
    expect(dialog.getAttribute('tabindex')).toBe('-1');
  });

  it('confirm button resolves true and closes', async () => {
    const { fixture, service, query, host } = setup();
    const result = service.confirm(options);
    fixture.detectChanges();
    await fixture.whenStable();

    query('.dialog-confirm').click();
    fixture.detectChanges();
    await fixture.whenStable();

    await expect(result).resolves.toBe(true);
    expect(host.querySelector('dialog')?.hasAttribute('open')).toBe(false);
  });

  it('cancel button resolves false', async () => {
    const { fixture, service, query } = setup();
    const result = service.confirm(options);
    fixture.detectChanges();
    await fixture.whenStable();

    query('.dialog-cancel').click();
    await expect(result).resolves.toBe(false);
  });

  it('a native close (Esc) counts as cancel', async () => {
    const { fixture, service, query } = setup();
    const result = service.confirm(options);
    fixture.detectChanges();
    await fixture.whenStable();

    query('dialog').dispatchEvent(new Event('close'));
    await expect(result).resolves.toBe(false);
  });

  it('a close event from the previous dialog does not cancel the request that replaced it', async () => {
    const { fixture, service, query } = setup();
    const first = service.confirm(options);
    fixture.detectChanges();
    await fixture.whenStable();

    query('.dialog-confirm').click();
    fixture.detectChanges();
    await fixture.whenStable();
    await expect(first).resolves.toBe(true);

    const second = service.confirm({ ...options, title: 'Remove room?' });
    fixture.detectChanges();
    await fixture.whenStable();

    // The browser fires `close` for our own close() a task later - by now the next dialog is up.
    query('dialog').dispatchEvent(new Event('close'));
    fixture.detectChanges();

    expect(service.request()?.title).toBe('Remove room?');
    query('.dialog-confirm').click();
    await expect(second).resolves.toBe(true);
  });

  it('a click on the scrim counts as cancel, a click inside does not', async () => {
    const { fixture, service, query } = setup();
    const result = service.confirm(options);
    fixture.detectChanges();
    await fixture.whenStable();

    query('.dialog-body').click();
    expect(service.request()).not.toBeNull();
    query('dialog').click();
    await expect(result).resolves.toBe(false);
  });
});

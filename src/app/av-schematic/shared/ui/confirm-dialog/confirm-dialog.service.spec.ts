import { describe, expect, it } from 'vitest';
import { ConfirmDialogService } from './confirm-dialog.service';

const options = {
  title: 'Remove rack?',
  message: 'Devices go to the tray.',
  confirmLabel: 'Remove rack',
};

describe('ConfirmDialogService', () => {
  it('starts with no open request', () => {
    const service = new ConfirmDialogService();
    expect(service.request()).toBeNull();
  });

  it('confirm exposes the request with a default cancel label', () => {
    const service = new ConfirmDialogService();
    void service.confirm(options);
    expect(service.request()).toMatchObject({ ...options, cancelLabel: 'Cancel' });
  });

  it('resolve(true) settles the promise with true and clears the request', async () => {
    const service = new ConfirmDialogService();
    const result = service.confirm(options);
    service.resolve(true);
    await expect(result).resolves.toBe(true);
    expect(service.request()).toBeNull();
  });

  it('resolve(false) settles the promise with false', async () => {
    const service = new ConfirmDialogService();
    const result = service.confirm({ ...options, cancelLabel: 'Keep' });
    expect(service.request()?.cancelLabel).toBe('Keep');
    service.resolve(false);
    await expect(result).resolves.toBe(false);
  });

  it('a second request cancels the first one', async () => {
    const service = new ConfirmDialogService();
    const first = service.confirm(options);
    const second = service.confirm({ ...options, title: 'Remove room?' });
    await expect(first).resolves.toBe(false);
    expect(service.request()?.title).toBe('Remove room?');
    service.resolve(true);
    await expect(second).resolves.toBe(true);
  });

  it('resolve with nothing open is a no-op', () => {
    const service = new ConfirmDialogService();
    expect(() => {
      service.resolve(false);
    }).not.toThrow();
    expect(service.request()).toBeNull();
  });
});

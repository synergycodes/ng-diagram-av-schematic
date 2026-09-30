import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ConfirmDialogService } from '../../../shared/ui/confirm-dialog/confirm-dialog.service';
import { LibraryService } from '../../library.service';
import { SEED_LIBRARY } from '../../seed-library';
import { LibraryDetailComponent } from './library-detail.component';

@Component({
  imports: [LibraryDetailComponent],
  providers: [LibraryService, ConfirmDialogService],
  template: `<app-library-detail [libraryId]="libraryId()" />`,
})
class HostComponent {
  readonly library = inject(LibraryService);
  readonly confirmDialog = inject(ConfirmDialogService);
  readonly libraryId = signal(SEED_LIBRARY[0].libraryId);
}

const setup = (mode: 'edit' | 'create' = 'edit') => {
  const fixture = TestBed.createComponent(HostComponent);
  const { library, confirmDialog } = fixture.componentInstance;
  if (mode === 'create') {
    library.beginCreate();
    const id = library.editingDeviceId();
    if (!id) throw new Error('beginCreate did not assign an id');
    fixture.componentInstance.libraryId.set(id);
  } else {
    library.beginEdit(SEED_LIBRARY[0].libraryId);
  }
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const query = (selector: string): HTMLElement => {
    const el = host.querySelector(selector);
    if (!(el instanceof HTMLElement)) throw new Error(`${selector} not rendered`);
    return el;
  };
  return { fixture, host, query, library, confirmDialog };
};

describe('LibraryDetailComponent actions', () => {
  it('renders Save as the Primary button and Remove as ghost-critical in the actions footer', () => {
    const { query, host } = setup('edit');
    expect(query('.sidebar-actions button.primary-button').textContent?.trim()).toBe('Save');
    expect(query('.sidebar-actions button.remove-button').textContent?.trim()).toBe(
      'Remove from library',
    );
    expect(host.querySelector('.save-button')).toBeNull();
    expect(host.querySelector('.detail-actions')).toBeNull();
  });

  it('shows no Remove button when creating a new entry', () => {
    expect(setup('create').host.querySelector('.sidebar-actions .remove-button')).toBeNull();
  });
});

describe('LibraryDetailComponent toolbar', () => {
  it('leads with a back arrow named "Back to library" and has no close button', () => {
    const { query, host } = setup();
    const back = query('.detail-toolbar button.back-button');
    expect(back.getAttribute('type')).toBe('button');
    expect(back.getAttribute('aria-label')).toBe('Back to library');
    expect(back.getAttribute('apptooltip')).toBe('Back to library');
    expect(back.getAttribute('tooltipplacement')).toBe('right');
    expect(back.querySelector('.icon-arrow-left')).not.toBeNull();
    const title = query('.detail-toolbar .detail-title');
    expect(back.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(host.querySelector('.close-button')).toBeNull();
  });

  it('keeps the "New device" and "Edit device" titles', () => {
    expect(setup('create').query('.detail-title').textContent?.trim()).toBe('New device');
    expect(setup('edit').query('.detail-title').textContent?.trim()).toBe('Edit device');
  });

  it('returns to the list from the back arrow', () => {
    const { fixture, query, library } = setup();
    query('button.back-button').click();
    fixture.detectChanges();
    expect(library.editingDeviceId()).toBeNull();
  });
});

describe('LibraryDetailComponent remove confirmation', () => {
  it('asks for confirmation before removing and keeps the entry meanwhile', () => {
    const { fixture, query, library, confirmDialog } = setup('edit');
    const before = library.devices().length;
    query('button.remove-button').click();
    fixture.detectChanges();
    const request = confirmDialog.request();
    expect(request?.title).toBe('Remove from library?');
    expect(request?.confirmLabel).toBe('Remove from library');
    expect(request?.message).toContain(SEED_LIBRARY[0].template.model);
    expect(library.devices().length).toBe(before);
    expect(library.editingDeviceId()).toBe(SEED_LIBRARY[0].libraryId);
  });

  it('removes the entry and closes the detail once confirmed', async () => {
    const { fixture, query, library, confirmDialog } = setup('edit');
    query('button.remove-button').click();
    confirmDialog.resolve(true);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(library.devices().some((d) => d.libraryId === SEED_LIBRARY[0].libraryId)).toBe(false);
    expect(library.editingDeviceId()).toBeNull();
  });

  it('keeps the entry when the dialog is cancelled', async () => {
    const { fixture, query, library, confirmDialog } = setup('edit');
    query('button.remove-button').click();
    confirmDialog.resolve(false);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(library.devices().some((d) => d.libraryId === SEED_LIBRARY[0].libraryId)).toBe(true);
    expect(library.editingDeviceId()).toBe(SEED_LIBRARY[0].libraryId);
  });
});

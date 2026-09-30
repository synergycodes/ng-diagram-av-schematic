import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNgDiagram } from 'ng-diagram';
import { describe, expect, it } from 'vitest';
import { LibraryService } from '../../library.service';
import { LibraryListComponent } from './library-list.component';

@Component({
  imports: [LibraryListComponent],
  providers: [provideNgDiagram(), LibraryService],
  template: `<app-library-list />`,
})
class HostComponent {
  readonly library = inject(LibraryService);
}

const setup = () => {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  return { fixture, host, library: fixture.componentInstance.library };
};

describe('LibraryListComponent add button', () => {
  it('is a ghost button in a fixed footer under the scrolling list', () => {
    const { host } = setup();
    const button = host.querySelector('button.add-button');
    if (!(button instanceof HTMLButtonElement)) throw new Error('add button not rendered');
    expect(button.classList.contains('ghost-button')).toBe(true);
    expect(button.textContent?.trim()).toBe('+ Add device');
    expect(button.closest('.sidebar-actions')).not.toBeNull();
    expect(button.closest('.list-scroll')).toBeNull();
  });

  it('stays available while a search is active', () => {
    const { fixture, host, library } = setup();
    library.searchQuery.set('shure');
    fixture.detectChanges();
    expect(host.querySelector('button.add-button')).not.toBeNull();
  });

  it('opens the create form', () => {
    const { fixture, host, library } = setup();
    host.querySelector<HTMLButtonElement>('button.add-button')?.click();
    fixture.detectChanges();
    expect(library.editingMode()).toBe('create');
  });
});

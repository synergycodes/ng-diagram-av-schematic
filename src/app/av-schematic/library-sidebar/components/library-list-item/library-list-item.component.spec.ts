import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNgDiagram } from 'ng-diagram';
import { describe, expect, it } from 'vitest';
import { LibraryService } from '../../library.service';
import { SEED_LIBRARY } from '../../seed-library';
import { LibraryListItemComponent } from './library-list-item.component';

@Component({
  imports: [LibraryListItemComponent],
  providers: [provideNgDiagram(), LibraryService],
  template: `
    <app-library-list-item [device]="device" [editable]="editable()" (edit)="edits = edits + 1" />
  `,
})
class HostComponent {
  readonly device = SEED_LIBRARY[0];
  readonly editable = signal(true);
  edits = 0;
}

const setup = (editable = true) => {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.componentInstance.editable.set(editable);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const query = (selector: string): HTMLElement => {
    const el = host.querySelector(selector);
    if (!(el instanceof HTMLElement)) throw new Error(`${selector} not rendered`);
    return el;
  };
  return { fixture, host, query, component: fixture.componentInstance };
};

describe('LibraryListItemComponent', () => {
  it('renders the drag body without button semantics', () => {
    const { query, host } = setup();
    const body = query('.drag-body');
    expect(body.getAttribute('role')).toBeNull();
    expect(body.hasAttribute('tabindex')).toBe(false);
    expect(host.querySelector('[role="button"]')).toBeNull();
    expect(body.closest('ng-diagram-palette-item')).not.toBeNull();
  });

  it('puts a pencil edit button in the card trailing slot, outside the draggable area', () => {
    const { query, component } = setup();
    const button = query('button.edit-button');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-label')).toBe(`Edit ${component.device.template.model}`);
    expect(button.getAttribute('apptooltip')).toBe('Edit');
    expect(button.querySelector('.icon-pencil')).not.toBeNull();
    // Inside the bordered card so every row shares one right edge...
    expect(button.closest('.device-row')).not.toBeNull();
    // ...but a sibling of the palette item, so pressing it can never start a drag.
    expect(button.closest('ng-diagram-palette-item')).toBeNull();
    expect(button.closest('[draggable="true"]')).toBeNull();
  });

  it('emits edit from the button only, never from a click on the drag body', () => {
    const { fixture, query, component } = setup();
    query('.drag-body').click();
    fixture.detectChanges();
    expect(component.edits).toBe(0);

    query('button.edit-button').click();
    fixture.detectChanges();
    expect(component.edits).toBe(1);
  });

  it('highlights search matches the way the rack palette row does: accent text, no fill', () => {
    const { fixture, host } = setup();
    fixture.debugElement.injector.get(LibraryService).searchQuery.set('m5');
    fixture.detectChanges();

    const matches = host.querySelectorAll('.device-row__model span.is-match');
    expect(matches.length).toBe(1);
    expect(matches[0].textContent).toBe('M5');
    expect(host.querySelector('.device-row__model')?.textContent?.trim()).toBe('SM58');
    expect(host.querySelector('mark')).toBeNull();
    expect(host.querySelector('.device-row__manufacturer .is-match')).toBeNull();
  });

  it('renders no edit control on a non-editable row', () => {
    const { host } = setup(false);
    expect(host.querySelector('button.edit-button')).toBeNull();
    expect(host.querySelector('[role="button"]')).toBeNull();
  });
});

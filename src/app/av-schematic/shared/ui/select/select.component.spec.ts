import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { SelectComponent, type SelectOption } from './select.component';

const OPTIONS: readonly SelectOption<string>[] = [
  { value: '19in', label: '19in' },
  { value: '10in', label: '10in' },
  { value: '23in', label: '23in' },
];

@Component({
  imports: [SelectComponent],
  template: `
    <div class="scroller" style="overflow-y: auto">
      <label for="width">Width</label>
      <app-select selectId="width" [options]="options" [(value)]="value" [disabled]="disabled()" />
    </div>
  `,
})
class HostComponent {
  readonly options = OPTIONS;
  readonly value = signal('10in');
  readonly disabled = signal(false);
}

const setup = () => {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const query = (selector: string): HTMLElement => {
    const el = host.querySelector(selector);
    if (!(el instanceof HTMLElement)) throw new Error(`${selector} not rendered`);
    return el;
  };
  const trigger = () => query('button.select-trigger');
  const listbox = () => host.querySelector('[role="listbox"]');
  const options = () => Array.from(host.querySelectorAll<HTMLElement>('[role="option"]'));
  const key = (key: string) => {
    trigger().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    fixture.detectChanges();
  };
  return {
    fixture,
    host,
    query,
    trigger,
    listbox,
    options,
    key,
    component: fixture.componentInstance,
  };
};

describe('SelectComponent', () => {
  it('renders a labelled, collapsed combobox trigger showing the selected label', () => {
    const { trigger, listbox } = setup();
    const button = trigger();
    expect(button.getAttribute('type')).toBe('button');
    expect(button.id).toBe('width');
    expect(button.getAttribute('role')).toBe('combobox');
    expect(button.getAttribute('aria-haspopup')).toBe('listbox');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.textContent?.trim()).toBe('10in');
    expect(listbox()).toBeNull();
  });

  it('opens a listbox on click and marks the current value as selected with a check', () => {
    const { fixture, trigger, listbox, options } = setup();
    trigger().click();
    fixture.detectChanges();

    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(listbox()?.id).toBe('width-listbox');
    expect(trigger().getAttribute('aria-controls')).toBe('width-listbox');
    expect(options().map((o) => o.textContent?.trim())).toEqual(['19in', '10in', '23in']);
    expect(options()[1].getAttribute('aria-selected')).toBe('true');
    expect(options()[0].getAttribute('aria-selected')).toBe('false');
    expect(options()[1].querySelector('.check-icon')).not.toBeNull();
    expect(options()[0].querySelector('.check-icon')).toBeNull();
    // Keyboard highlight starts on the selected option.
    expect(trigger().getAttribute('aria-activedescendant')).toBe(options()[1].id);
    expect(options()[1].classList.contains('focused')).toBe(true);
  });

  it('selects an option on click, updates the value and closes', () => {
    const { fixture, trigger, listbox, options, component } = setup();
    trigger().click();
    fixture.detectChanges();
    options()[2].click();
    fixture.detectChanges();

    expect(component.value()).toBe('23in');
    expect(trigger().textContent?.trim()).toBe('23in');
    expect(listbox()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('supports the keyboard: arrows move the highlight, Enter commits, Escape cancels', () => {
    const { trigger, listbox, options, key, component } = setup();
    key('ArrowDown');
    expect(listbox()).not.toBeNull();
    expect(options()[1].classList.contains('focused')).toBe(true);

    key('ArrowDown');
    expect(options()[2].classList.contains('focused')).toBe(true);
    expect(trigger().getAttribute('aria-activedescendant')).toBe(options()[2].id);
    key('ArrowDown');
    expect(options()[2].classList.contains('focused')).toBe(true);

    key('Home');
    expect(options()[0].classList.contains('focused')).toBe(true);
    key('End');
    expect(options()[2].classList.contains('focused')).toBe(true);
    key('ArrowUp');
    expect(options()[1].classList.contains('focused')).toBe(true);

    key('Escape');
    expect(listbox()).toBeNull();
    expect(component.value()).toBe('10in');

    key('ArrowUp');
    key('ArrowUp');
    key('Enter');
    expect(listbox()).toBeNull();
    expect(component.value()).toBe('19in');
  });

  it('commits the highlighted option with Space and reopens with Enter', () => {
    const { listbox, options, key, component } = setup();
    key('Enter');
    expect(listbox()).not.toBeNull();
    key('ArrowDown');
    key(' ');
    expect(listbox()).toBeNull();
    expect(component.value()).toBe('23in');
    expect(options()).toHaveLength(0);
  });

  it('closes on an outside click without changing the value', () => {
    const { fixture, trigger, listbox, component } = setup();
    trigger().click();
    fixture.detectChanges();
    expect(listbox()).not.toBeNull();

    document.body.click();
    fixture.detectChanges();
    expect(listbox()).toBeNull();
    expect(component.value()).toBe('10in');
  });

  it('is disabled as a real button and never opens', () => {
    const { fixture, trigger, listbox, key, component } = setup();
    component.disabled.set(true);
    fixture.detectChanges();

    expect((trigger() as HTMLButtonElement).disabled).toBe(true);
    key('ArrowDown');
    expect(listbox()).toBeNull();
  });

  describe('viewport placement', () => {
    // The prototype method is stored to restore it, never called detached.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = HTMLElement.prototype.getBoundingClientRect;
    afterEach(() => {
      HTMLElement.prototype.getBoundingClientRect = original;
    });
    const mockRects = (triggerTop: number, listboxHeight: number, scrollerBottom = 10_000) => {
      HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
        const rect = { x: 0, y: 0, top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
        if (this.classList.contains('scroller')) {
          Object.assign(rect, { top: 0, bottom: scrollerBottom, height: scrollerBottom });
        } else if (this.classList.contains('select-trigger')) {
          Object.assign(rect, {
            top: triggerTop,
            bottom: triggerTop + 36,
            left: 40,
            width: 300,
            height: 36,
          });
        } else if (this.classList.contains('select-listbox')) {
          Object.assign(rect, { height: listboxHeight, width: 300 });
        }
        return { ...rect, toJSON: () => rect };
      };
    };

    it('positions the listbox against the viewport so panel overflow cannot clip it', async () => {
      const { fixture, trigger, query } = setup();
      mockRects(100, 200);
      trigger().click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const listbox = query('.select-listbox');
      expect(listbox.classList.contains('above')).toBe(false);
      expect(listbox.style.top).toBe('144px');
      expect(listbox.style.left).toBe('40px');
      expect(listbox.style.width).toBe('300px');
    });

    it('opens above the trigger when there is no room below', async () => {
      const { fixture, trigger, query } = setup();
      const triggerTop = window.innerHeight - 60;
      mockRects(triggerTop, 200);
      trigger().click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const listbox = query('.select-listbox');
      expect(listbox.classList.contains('above')).toBe(true);
      expect(listbox.style.top).toBe(`${triggerTop - 8 - 200}px`);
    });

    it('opens above when the enclosing scroll container ends before the list would', async () => {
      const { fixture, trigger, query } = setup();
      // Plenty of viewport below the trigger, but the panel content ends 60px under it.
      mockRects(100, 200, 196);
      trigger().click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(query('.select-listbox').classList.contains('above')).toBe(true);
    });

    it('closes when the page scrolls so a detached listbox is never left floating', () => {
      const { fixture, trigger, listbox } = setup();
      trigger().click();
      fixture.detectChanges();
      expect(listbox()).not.toBeNull();
      document.dispatchEvent(new Event('scroll', { bubbles: true }));
      fixture.detectChanges();
      expect(listbox()).toBeNull();
    });
  });

  it('steps the trigger and listbox down to size S through the size input', () => {
    @Component({
      imports: [SelectComponent],
      template: `<app-select selectId="conn" size="s" [options]="options" [(value)]="value" />`,
    })
    class SmallHost {
      readonly options = OPTIONS;
      readonly value = signal('10in');
    }
    const fixture = TestBed.createComponent(SmallHost);
    fixture.detectChanges();
    const root = (fixture.nativeElement as HTMLElement).querySelector('.select');
    expect(root?.classList.contains('size-s')).toBe(true);
  });

  it('shows the placeholder when the value matches no option', () => {
    const { fixture, trigger, component } = setup();
    component.value.set('');
    fixture.detectChanges();
    expect(trigger().querySelector('.select-value')?.classList.contains('placeholder')).toBe(true);
  });
});

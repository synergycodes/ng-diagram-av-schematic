import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  model,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { type FormValueControl } from '@angular/forms/signals';
import { computeListboxPlacement, type ListboxPlacement } from './select-placement';

export type SelectSize = 'm' | 's';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

/**
 * Select-only dropdown for picking one value from a fixed set (design-OS: "Text field with
 * dropdown" + List Box - Dropdown). The trigger is a real button with the combobox role, so a
 * `<label for>` names it and it takes part in the tab order; the popover is a listbox whose
 * highlighted row is exposed through aria-activedescendant. Works with `[formField]` through the
 * signal-forms value contract.
 *
 * The listbox is fixed to the viewport (measured from the trigger, like the tooltip) so a
 * scrolling panel cannot clip it. It stays within the panel's content area: it flips above the
 * trigger when the space below, before the panel footer, cannot hold it. Scrolling or resizing
 * closes it rather than leaving a detached list behind.
 */
@Component({
  selector: 'app-select',
  templateUrl: './select.component.html',
  styleUrl: './select.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectComponent<T extends string> implements FormValueControl<T> {
  private readonly elRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly value = model.required<T>();
  readonly options = input.required<readonly SelectOption<T>[]>();
  readonly selectId = input.required<string>();
  readonly placeholder = input('Select…');
  readonly disabled = input(false);
  /**
   * Text-field size (design-OS Text field and List Box both define S and M). S is for dense rows
   * such as the ports editor; M is the default for form fields.
   */
  readonly size = input<SelectSize>('m');
  /** Space-separated ids of the field's helper / error text, applied to the trigger. */
  readonly describedBy = input<string | null>(null);

  private readonly triggerEl = viewChild.required<ElementRef<HTMLElement>>('triggerEl');
  private readonly listboxEl = viewChild<ElementRef<HTMLElement>>('listboxEl');
  private readonly optionElements = viewChildren<ElementRef<HTMLElement>>('optionEl');

  protected readonly isOpen = signal(false);
  protected readonly focusedIndex = signal(-1);
  protected readonly placement = signal<ListboxPlacement | null>(null);

  protected readonly listboxId = computed(() => `${this.selectId()}-listbox`);
  protected readonly selected = computed<SelectOption<T> | null>(
    () => this.options().find((option) => option.value === this.value()) ?? null,
  );
  protected readonly activeId = computed(() => {
    const index = this.focusedIndex();
    return index >= 0 && index < this.options().length ? this.optionId(index) : null;
  });

  private removeDocumentListeners: (() => void) | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.removeDocumentListeners?.());
    // The list's height is only known once it is in the DOM, so measure after render.
    afterRenderEffect(() => {
      const listbox = this.listboxEl()?.nativeElement;
      if (!this.isOpen() || !listbox) return;
      const trigger = this.triggerEl().nativeElement.getBoundingClientRect();
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const container = this.findScrollContainer()?.getBoundingClientRect();
      this.placement.set(
        computeListboxPlacement(
          trigger,
          listbox.getBoundingClientRect().height,
          viewport,
          container,
        ),
      );
    });
  }

  protected optionId(index: number): string {
    return `${this.selectId()}-option-${index}`;
  }

  protected toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (this.disabled()) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        if (!this.isOpen()) this.open();
        else this.moveFocus(event.key === 'ArrowDown' ? 1 : -1);
        return;
      case 'Home':
      case 'End':
        if (!this.isOpen()) return;
        event.preventDefault();
        this.setFocus(event.key === 'Home' ? 0 : this.options().length - 1);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (!this.isOpen()) this.open();
        else this.selectFocused();
        return;
      case 'Escape':
        if (!this.isOpen()) return;
        event.preventDefault();
        this.close();
        return;
      case 'Tab':
        if (this.isOpen()) this.close();
        return;
    }
  }

  protected select(value: T): void {
    this.value.set(value);
    this.close();
  }

  private open(): void {
    if (this.disabled()) return;
    this.isOpen.set(true);
    const index = this.options().findIndex((option) => option.value === this.value());
    this.setFocus(index === -1 ? 0 : index);
    this.removeDocumentListeners?.();
    this.removeDocumentListeners = this.listenWhileOpen();
  }

  private close(): void {
    this.removeDocumentListeners?.();
    this.removeDocumentListeners = null;
    this.isOpen.set(false);
    this.focusedIndex.set(-1);
    this.placement.set(null);
  }

  /** The nearest scrolling ancestor bounds the list, so it never covers a panel's footer. */
  private findScrollContainer(): HTMLElement | null {
    let el = this.elRef.nativeElement.parentElement;
    while (el && el !== document.body) {
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') return el;
      el = el.parentElement;
    }
    return null;
  }

  /** Outside clicks close the list; so do scroll and resize, which would move the trigger away. */
  private listenWhileOpen(): () => void {
    const onClick = (event: MouseEvent) => {
      if (!this.elRef.nativeElement.contains(event.target as Node | null)) this.close();
    };
    const onScroll = (event: Event) => {
      if (!this.listboxEl()?.nativeElement.contains(event.target as Node | null)) this.close();
    };
    const onResize = () => {
      this.close();
    };
    document.addEventListener('click', onClick);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }

  private moveFocus(delta: number): void {
    const length = this.options().length;
    if (length === 0) return;
    this.setFocus(Math.max(0, Math.min(this.focusedIndex() + delta, length - 1)));
  }

  private setFocus(index: number): void {
    this.focusedIndex.set(index);
    requestAnimationFrame(() => {
      this.optionElements().at(index)?.nativeElement.scrollIntoView?.({ block: 'nearest' });
    });
  }

  private selectFocused(): void {
    const option = this.options().at(this.focusedIndex());
    if (option !== undefined) this.select(option.value);
  }
}

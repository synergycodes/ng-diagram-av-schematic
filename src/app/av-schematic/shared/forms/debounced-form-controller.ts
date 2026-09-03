import { effect, Injector, signal, untracked, WritableSignal } from '@angular/core';
import { debounce, form, type SchemaFn } from '@angular/forms/signals';

export const DEBOUNCE_TIME_MS = 300;

export interface DebouncedFormConfig<TFormData extends object> {
  /** Initial value loaded into the form before the first `loadFormData` call. */
  empty: TFormData;
  /** Field keys that get debounced AND that get touched on commit. */
  debouncedFields: readonly (keyof TFormData)[];
  /** Field keys that participate in change diffs (typically the visible fields). */
  trackedFields: readonly (keyof TFormData)[];
  /** Additional Signal Forms rules applied before the shared debounce rules. */
  schema?: SchemaFn<TFormData>;
  /** Called whenever a tracked field changes after debounce. */
  onChange: (entityId: string, fields: (keyof TFormData)[], formData: TFormData) => void;
  /** Injector to anchor the internal `effect()`. Pass `inject(Injector)`. */
  injector: Injector;
}

/**
 * Reusable controller that binds a signal-backed form to the same
 * load-then-emit-on-debounced-change shape both `device-form` and `wire-form`
 * use. Subclasses can stay tiny: collect config, instantiate one of these,
 * proxy `formModel` / `fieldTree` / `loadFormData` / `commitPendingEdits`.
 */
export class DebouncedFormController<TFormData extends object> {
  readonly formModel: WritableSignal<TFormData>;
  readonly fieldTree;

  private lastEmittedModel: TFormData;
  private currentEntityId: string | null = null;

  constructor(private readonly config: DebouncedFormConfig<TFormData>) {
    this.formModel = signal({ ...config.empty });
    this.lastEmittedModel = { ...config.empty };
    this.fieldTree = form(this.formModel, (path) => {
      config.schema?.(path);
      for (const fieldKey of config.debouncedFields) {
        // The form path tree types each field individually, so a loop variable
        // typed as `keyof TFormData` doesn't satisfy the indexed-access
        // constraint. The runtime contract (each `fieldKey` is a real key on
        // the model) is enforced by the caller's `debouncedFields` typing.
        debounce((path as Record<keyof TFormData, never>)[fieldKey], DEBOUNCE_TIME_MS);
      }
    });

    effect(
      () => {
        const model = this.formModel();
        untracked(() => {
          if (!this.fieldTree().dirty()) return;
          const diffs = config.trackedFields.filter(
            (key) => model[key] !== this.lastEmittedModel[key],
          );
          this.lastEmittedModel = { ...model };
          if (this.currentEntityId && diffs.length) {
            config.onChange(this.currentEntityId, diffs, model);
          }
        });
      },
      { injector: config.injector },
    );
  }

  /** Replaces the form value with `data` and starts emitting changes for `entityId`. */
  loadFormData(entityId: string, data: TFormData): void {
    this.commitPendingEdits();
    this.currentEntityId = entityId;
    this.lastEmittedModel = { ...data };
    this.formModel.set(data);
    this.fieldTree().reset();
  }

  /**
   * Forces any pending debounced edits to flush — `markAsTouched` causes the
   * `@angular/forms/signals` debounce wrapper to deliver its buffered value.
   * Call this before tearing the form down or switching entities, otherwise
   * the last keystroke is lost.
   */
  commitPendingEdits(): void {
    // Same indexed-access caveat as in the constructor — `fieldKey` is a
    // real field on the model by the caller's typing.
    const tree = this.fieldTree as Record<keyof TFormData, () => { markAsTouched(): void }>;
    for (const fieldKey of this.config.debouncedFields) {
      tree[fieldKey]().markAsTouched();
    }
  }
}

// Shared pointer-drag plumbing for the edge overlays. The component owns the
// typed state and the move/drop logic.

export interface PointerDragHandlers<TState> {
  onMove(event: PointerEvent, state: TState): void;
  // Commit the drop; runs on a real pointerup/cancel, never on teardown().
  onEnd(event: PointerEvent, state: TState): void | Promise<void>;
  // Clear gesture-scoped UI state; runs on both a real release and teardown().
  onTeardown?(): void;
}

export interface PointerDragOptions {
  // 'document' survives the handle re-rendering mid-drag; 'handle' binds the captured element.
  readonly listenerTarget: 'document' | 'handle';
  readonly coalesce: boolean;
}

export class PointerDragController<TState> {
  private state: TState | null = null;
  private handleEl: HTMLElement | null = null;
  private pointerId = -1;
  private listenerEl: Document | HTMLElement | null = null;
  private pendingEvent: PointerEvent | null = null;
  private rafHandle: number | null = null;
  private moveSeen = false;

  constructor(
    private readonly handlers: PointerDragHandlers<TState>,
    private readonly options: PointerDragOptions,
  ) {}

  get current(): TState | null {
    return this.state;
  }

  begin(event: PointerEvent, handleEl: HTMLElement, state: TState): void {
    this.state = state;
    this.moveSeen = false;
    this.handleEl = handleEl;
    this.pointerId = event.pointerId;
    try {
      handleEl.setPointerCapture(event.pointerId);
    } catch {
      // Best-effort; the listeners drive the gesture either way.
    }
    handleEl.classList.add('is-dragging');
    // Cast: the keyed EventMap overloads collapse on the Document|HTMLElement union.
    this.listenerEl = this.options.listenerTarget === 'document' ? document : handleEl;
    this.listenerEl.addEventListener('pointermove', this.onPointerMove as unknown as EventListener);
    this.listenerEl.addEventListener('pointerup', this.onPointerUp as unknown as EventListener);
    this.listenerEl.addEventListener('pointercancel', this.onPointerUp as unknown as EventListener);
  }

  // Idempotent teardown for a destroy hook; does NOT resolve a drop.
  teardown(): void {
    if (!this.state && this.listenerEl === null) return;
    this.cleanup();
    this.state = null;
    this.handlers.onTeardown?.();
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.state || event.pointerId !== this.pointerId) return;
    this.moveSeen = true;
    if (!this.options.coalesce) {
      this.handlers.onMove(event, this.state);
      return;
    }
    // One commit per frame -- high-rate pointers fire 1000+ Hz.
    this.pendingEvent = event;
    if (this.rafHandle !== null) return;
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      const pending = this.pendingEvent;
      this.pendingEvent = null;
      if (pending && this.state) this.handlers.onMove(pending, this.state);
    });
  };

  private readonly onPointerUp = async (event: PointerEvent): Promise<void> => {
    const state = this.state;
    if (!state || event.pointerId !== this.pointerId) return;
    // A frame-coalesced drag may still have one move buffered when the pointer
    // is released. Commit the release coordinates before canceling that frame
    // so the persisted bend lands exactly where the user dropped it.
    if (this.options.coalesce && this.moveSeen && event.type === 'pointerup') {
      this.handlers.onMove(event, state);
    }
    this.cleanup();
    this.state = null;
    try {
      await this.handlers.onEnd(event, state);
    } finally {
      this.handlers.onTeardown?.();
    }
  };

  private cleanup(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.pendingEvent = null;
    this.moveSeen = false;
    if (this.listenerEl) {
      this.listenerEl.removeEventListener(
        'pointermove',
        this.onPointerMove as unknown as EventListener,
      );
      this.listenerEl.removeEventListener(
        'pointerup',
        this.onPointerUp as unknown as EventListener,
      );
      this.listenerEl.removeEventListener(
        'pointercancel',
        this.onPointerUp as unknown as EventListener,
      );
      this.listenerEl = null;
    }
    if (this.handleEl) {
      try {
        this.handleEl.releasePointerCapture(this.pointerId);
      } catch {
        // Handle detached (selection changed or component destroyed).
      }
      this.handleEl.classList.remove('is-dragging');
      this.handleEl = null;
    }
    this.pointerId = -1;
  }
}

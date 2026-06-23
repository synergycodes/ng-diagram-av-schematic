import { Injectable, signal } from '@angular/core';

export interface RelinkTarget {
  nodeId: string;
  portId: string;
}

/**
 * Holds the port a relink drag is currently hovering, so the device node can
 * highlight it. During relink the endpoint handle captures the pointer, which
 * suppresses the native `:hover` that link-creation relies on — so the target
 * highlight has to be driven explicitly.
 */
@Injectable()
export class RelinkTargetHighlightService {
  private readonly _target = signal<RelinkTarget | null>(null);
  readonly target = this._target.asReadonly();

  set(nodeId: string, portId: string): void {
    this._target.set({ nodeId, portId });
  }

  clear(): void {
    this._target.set(null);
  }
}

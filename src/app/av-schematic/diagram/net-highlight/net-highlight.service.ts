import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { NgDiagramModelService } from 'ng-diagram';
import { deriveLiveWireNets, type LiveWireNet } from './live-wire-nets';
import { resolveNetEmphasis, type NetEmphasis } from './net-emphasis';

/**
 * Which electrical net is currently under inspection, and whether the rest of
 * the diagram is attenuated while it is.
 *
 * Highlighting is view state only -- it never touches `WireEdgeData`, so it is
 * not persisted and cannot drift from the saved project. Membership is derived
 * from the current endpoints, including newly drawn and relinked wires.
 */
@Injectable()
export class NetHighlightService {
  private readonly modelService = inject(NgDiagramModelService);
  private readonly _highlightedEdgeId = signal<string | null>(null);
  private readonly _dimOthers = signal(true);
  private readonly netsByEdgeId = computed(() =>
    deriveLiveWireNets(this.modelService.nodes(), this.modelService.edges()),
  );

  readonly netId = computed(() => {
    const edgeId = this._highlightedEdgeId();
    return edgeId ? (this.netForEdge(edgeId)?.id ?? null) : null;
  });
  readonly dimOthers = this._dimOthers.asReadonly();
  readonly isActive = computed(() => this.netId() !== null);

  constructor() {
    // Deleting the anchor wire must not make the highlight reappear if another
    // edge later reuses the same id.
    effect(() => {
      const edgeId = this._highlightedEdgeId();
      if (!edgeId) return;
      if (!this.netsByEdgeId().has(edgeId)) {
        untracked(() => {
          this._highlightedEdgeId.set(null);
        });
      }
    });
  }

  netForEdge(edgeId: string): LiveWireNet | null {
    return this.netsByEdgeId().get(edgeId) ?? null;
  }

  toggleEdge(edgeId: string): void {
    const next = this.netForEdge(edgeId);
    if (!next) {
      this.clear();
      return;
    }
    this._highlightedEdgeId.update((currentEdgeId) => {
      if (!currentEdgeId) return edgeId;
      return this.netForEdge(currentEdgeId)?.id === next.id ? null : edgeId;
    });
  }

  clear(): void {
    this._highlightedEdgeId.set(null);
  }

  setDimOthers(dim: boolean): void {
    this._dimOthers.set(dim);
  }

  emphasisForEdge(edgeId: string): NetEmphasis {
    return resolveNetEmphasis(this.netForEdge(edgeId)?.id, this.netId(), this._dimOthers());
  }
}

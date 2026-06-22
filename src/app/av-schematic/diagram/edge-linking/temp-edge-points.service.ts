import { Injectable } from '@angular/core';
import { type Point } from 'ng-diagram';

interface TempEdgeSnapshot {
  source: string;
  sourcePort: string | undefined;
  points: Point[];
}

/**
 * Bridges the live link-draw preview to edge creation. While a wire is being
 * drawn, the temporary `WireEdgeComponent` publishes its *rendered* (routed)
 * points here each frame; on drop-to-background `LinkDanglingService` takes the
 * last snapshot so the created dangling edge keeps the preview's exact bends —
 * which can't be recomputed afterwards (the routed points aren't on the model,
 * and a target-less edge can't be auto-routed).
 */
@Injectable()
export class TempEdgePointsService {
  private snapshot: TempEdgeSnapshot | null = null;

  publish(source: string, sourcePort: string | undefined, points: readonly Point[]): void {
    this.snapshot = { source, sourcePort, points: points.map((p) => ({ x: p.x, y: p.y })) };
  }

  /** Returns the last preview points for this source, clearing the snapshot. */
  take(source: string, sourcePort: string | undefined): Point[] | null {
    const snapshot = this.snapshot;
    this.snapshot = null;
    if (snapshot?.source !== source || snapshot.sourcePort !== sourcePort) return null;
    return snapshot.points.length >= 2 ? snapshot.points : null;
  }
}

import type { Point } from 'ng-diagram';
import type { Orientation } from '../logic';

// Low-level: replace an edge's route, pinned to manual mode.
export interface SetEdgeRouteCommand {
  readonly kind: 'set-edge-route';
  readonly edgeId: string;
  readonly points: readonly Point[];
}

// Reshape: apply one live segment move (re-anchor to ports, orthogonalize, write).
export interface ReshapeMoveCommand {
  readonly kind: 'reshape-move';
  readonly edgeId: string;
  readonly initialPoints: readonly Point[];
  readonly segmentIndex: number;
  readonly axis: Orientation;
  readonly anchorPortAtSource: boolean;
  readonly anchorPortAtTarget: boolean;
  readonly grid: { x: number; y: number } | null;
  readonly dxWorld: number;
  readonly dyWorld: number;
}

// Reshape: fold redundant bends once, on drop.
export interface ReshapeFinishCommand {
  readonly kind: 'reshape-finish';
  readonly edgeId: string;
}

// Bend editing: create a bend on a segment, drag one bend, delete one bend.
// All three act on a single vertex; `reshape-move` slides a whole segment.

// Insert a bend jog on `segmentIndex`, at the world point the user clicked.
export interface InsertBendCommand {
  readonly kind: 'insert-bend';
  readonly edgeId: string;
  readonly segmentIndex: number;
  readonly at: Point;
  readonly grid: { x: number; y: number } | null;
}

// Delete the bend at `bendIndex` (an interior vertex index).
export interface RemoveBendCommand {
  readonly kind: 'remove-bend';
  readonly edgeId: string;
  readonly bendIndex: number;
}

// Apply one live bend drag (snap, slide both incident segments, re-anchor, write).
export interface MoveBendCommand {
  readonly kind: 'move-bend';
  readonly edgeId: string;
  readonly initialPoints: readonly Point[];
  readonly bendIndex: number;
  readonly grid: { x: number; y: number } | null;
  readonly dxWorld: number;
  readonly dyWorld: number;
}

export type EdgeCommand =
  | SetEdgeRouteCommand
  | ReshapeMoveCommand
  | ReshapeFinishCommand
  | InsertBendCommand
  | RemoveBendCommand
  | MoveBendCommand;

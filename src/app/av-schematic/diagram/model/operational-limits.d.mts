export interface OperationalLimits {
  readonly maxPinsPerComponent: number;
  readonly maxWiresPerCable: number;
  readonly maxJunctionTaps: number;
  readonly maxExpandedRange: number;
  readonly maxBoardRows: number;
  readonly maxBoardCols: number;
  readonly maxBoardHoles: number;
  readonly maxBoardPitch: number;
  readonly maxBoardTraces: number;
  readonly maxTraceSegmentsPerBoard: number;
  readonly maxFootprintRows: number;
  readonly maxFootprintCols: number;
  readonly maxFootprintShapes: number;
  readonly maxVisualPlane: number;
  readonly maxTotalEntities: number;
}

export const OPERATIONAL_LIMITS: Readonly<OperationalLimits>;

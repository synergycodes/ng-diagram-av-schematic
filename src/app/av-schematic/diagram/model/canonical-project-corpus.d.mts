export interface CanonicalValidationCorpusCase {
  readonly name: string;
  readonly accepted: boolean;
  readonly raw: unknown;
}

export const canonicalValidationCorpus: readonly CanonicalValidationCorpusCase[];
export function basePhysicalProject(): unknown;
export function breadboardSurfaceProject(): unknown;
export function boardJumperProject(): unknown;

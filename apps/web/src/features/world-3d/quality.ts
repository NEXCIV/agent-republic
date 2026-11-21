/**
 * E6-07 — deterministic quality tier for the WebGL scene.
 *
 * The tier only controls rendering cost (pixel ratio, antialiasing, runtime
 * downgrade). It never changes world facts, agent positions or chain data.
 */
export type QualityTier = 'high' | 'low';

export type QualityInput = {
  readonly coarsePointer: boolean;
  readonly hardwareConcurrency: number;
  readonly deviceMemory?: number;
  readonly reducedMotion: boolean;
};

export function pickQualityTier(input: QualityInput): QualityTier {
  // Reduced motion must not carry expensive continuous effects.
  if (input.reducedMotion) return 'low';
  if (input.coarsePointer) return 'low';
  if (input.hardwareConcurrency > 0 && input.hardwareConcurrency <= 4) return 'low';
  if (input.deviceMemory !== undefined && input.deviceMemory <= 4) return 'low';
  return 'high';
}

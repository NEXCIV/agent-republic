import { describe, expect, it } from 'vitest';
import { pickQualityTier } from '../src/features/world-3d/quality';

/**
 * E6-07 — quality tier decisions are pure and never touch world facts.
 */
describe('pickQualityTier', () => {
  it('keeps high quality on a capable desktop', () => {
    expect(
      pickQualityTier({
        coarsePointer: false,
        hardwareConcurrency: 12,
        deviceMemory: 16,
        reducedMotion: false,
      }),
    ).toBe('high');
  });

  it('uses the low tier for coarse pointers, small CPUs and low memory', () => {
    expect(
      pickQualityTier({
        coarsePointer: true,
        hardwareConcurrency: 12,
        deviceMemory: 16,
        reducedMotion: false,
      }),
    ).toBe('low');
    expect(
      pickQualityTier({
        coarsePointer: false,
        hardwareConcurrency: 4,
        deviceMemory: 16,
        reducedMotion: false,
      }),
    ).toBe('low');
    expect(
      pickQualityTier({
        coarsePointer: false,
        hardwareConcurrency: 12,
        deviceMemory: 4,
        reducedMotion: false,
      }),
    ).toBe('low');
  });

  it('forces low quality when reduced motion is requested', () => {
    expect(
      pickQualityTier({
        coarsePointer: false,
        hardwareConcurrency: 16,
        deviceMemory: 32,
        reducedMotion: true,
      }),
    ).toBe('low');
  });

  it('keeps high quality when hardware hints are unavailable', () => {
    expect(
      pickQualityTier({
        coarsePointer: false,
        hardwareConcurrency: 0,
        reducedMotion: false,
      }),
    ).toBe('high');
  });
});

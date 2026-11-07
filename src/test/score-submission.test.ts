import { describe, expect, it } from 'vitest';
import {
  buildScoreStats,
  toDurationSec,
} from '../systems/ScoreSubmission';

describe('toDurationSec', () => {
  it('rounds milliseconds to whole seconds', () => {
    expect(toDurationSec(0)).toBe(0);
    expect(toDurationSec(61_400)).toBe(61);
    expect(toDurationSec(61_600)).toBe(62);
  });

  it('clamps nonsense to 0', () => {
    expect(toDurationSec(-5)).toBe(0);
    expect(toDurationSec(Number.NaN)).toBe(0);
    expect(toDurationSec(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('buildScoreStats', () => {
  it('carries exactly the four agreed stats — nothing personal', () => {
    const stats = buildScoreStats(
      { stacked: 12, heightCm: 34, goldenCount: 1 },
      75,
    );
    expect(stats).toEqual({
      duration_sec: 75,
      stacked_count: 12,
      height_cm: 34,
      golden_count: 1,
    });
    expect(Object.keys(stats).sort()).toEqual([
      'duration_sec',
      'golden_count',
      'height_cm',
      'stacked_count',
    ]);
  });
});

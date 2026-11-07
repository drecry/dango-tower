/**
 * Building the data sent to the ranking API (pure logic, no Phaser).
 *
 * Mirrors Dango Drop's `systems/ScoreSubmission.ts`: what gets sent
 * feeds the server's sanity checks, so it is kept as a pure function
 * the tests can pin down — including that nothing personal is in it.
 *
 * ★Do not add fields casually★ — the set of stored items is a family
 * decision (see dango-leaderboard/docs/api.md).
 */

/** The per-run numbers a Tower score is built from. */
export interface TowerRunStats {
  /** Dango that landed on the tower this run. */
  stacked: number;
  /** Final measured tower height (cm) at closing time. */
  heightCm: number;
  /** Golden dango that landed on the tower this run. */
  goldenCount: number;
}

/**
 * Stats sent with a score. Field names line up with what the server's
 * score-rules.json may reference.
 *
 * NOTE: a `type`, not an `interface` — the SDK's PlayStats allows
 * arbitrary keys via an index signature, which interfaces do not get
 * implicitly.
 */
export type ScoreStats = {
  /** Play time in seconds (the server's plausibility yardstick). */
  readonly duration_sec: number;
  readonly stacked_count: number;
  readonly height_cm: number;
  readonly golden_count: number;
};

/** Milliseconds → whole seconds, clamped to a sane non-negative int. */
export const toDurationSec = (elapsedMs: number): number => {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return 0;
  }
  return Math.round(elapsedMs / 1000);
};

/** Assemble the stats payload for one finished run. */
export const buildScoreStats = (
  run: TowerRunStats,
  durationSec: number,
): ScoreStats => ({
  duration_sec: durationSec,
  stacked_count: run.stacked,
  height_cm: run.heightCm,
  golden_count: run.goldenCount,
});

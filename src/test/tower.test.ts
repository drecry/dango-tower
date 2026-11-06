/**
 * Tests for the Dango Tower rules engine (src/logic/tower.ts).
 * Pure logic — no Phaser, no browser — so Vitest runs them in Node.
 */
import { describe, expect, it } from 'vitest';
import {
  applyDrop,
  DEFAULT_BALANCE,
  DEFAULT_ECONOMY,
  heightBonus,
  initialState,
  judgeLanding,
  landingDG,
  nextTopCenterX,
  rollNextKind,
  towerHeightCm,
} from '../logic/tower';

describe('judgeLanding', () => {
  it('perfect within the perfect window', () => {
    expect(judgeLanding('shiratama', 0)).toBe('perfect');
    expect(judgeLanding('shiratama', 10)).toBe('perfect');
    expect(judgeLanding('shiratama', -10)).toBe('perfect');
  });

  it('lands within the land window, misses outside it', () => {
    expect(judgeLanding('shiratama', 11)).toBe('land');
    expect(judgeLanding('shiratama', 48)).toBe('land');
    expect(judgeLanding('shiratama', 49)).toBe('miss');
    expect(judgeLanding('shiratama', -200)).toBe('miss');
  });

  it('golden always lands perfectly', () => {
    expect(judgeLanding('golden', 200)).toBe('perfect');
    expect(judgeLanding('golden', -500)).toBe('perfect');
  });
});

describe('landingDG — DG is the score, every dango is sold', () => {
  it('sells at 3x the menu price, no bonuses on the first dango', () => {
    // Shiratama 1 DG x3 = 3 DG. First dango: no height bonus yet.
    expect(landingDG('shiratama', 'land', 1, 0)).toBe(3);
    expect(landingDG('anko', 'land', 1, 0)).toBe(6);
    expect(landingDG('yomogi', 'land', 1, 0)).toBe(15);
  });

  it('adds the height bonus every 5 dango', () => {
    expect(heightBonus(4)).toBe(0);
    expect(heightBonus(5)).toBe(1);
    expect(heightBonus(10)).toBe(2);
    // 5th dango, shiratama, plain land: 3 + 1 = 4 DG.
    expect(landingDG('shiratama', 'land', 5, 0)).toBe(4);
  });

  it('adds the perfect bonus multiplied by the combo', () => {
    // Perfect, first in a row: 3 + 5x1 = 8 DG.
    expect(landingDG('shiratama', 'perfect', 1, 1)).toBe(8);
    // Perfect, third in a row: 3 + 5x3 = 18 DG.
    expect(landingDG('shiratama', 'perfect', 1, 3)).toBe(18);
    // Golden perfect: 100x3 + 5 = 305 DG.
    expect(landingDG('golden', 'perfect', 1, 1)).toBe(305);
  });

  it('a miss earns nothing', () => {
    expect(landingDG('golden', 'miss', 9, 3)).toBe(0);
  });
});

describe('rollNextKind', () => {
  it('rolls golden below the golden rate, matcha below the combined rate', () => {
    expect(rollNextKind(DEFAULT_ECONOMY, () => 0.005)).toBe('golden');
    expect(rollNextKind(DEFAULT_ECONOMY, () => 0.03)).toBe('matcha');
  });

  it('rolls a regular dango otherwise', () => {
    const kind = rollNextKind(DEFAULT_ECONOMY, () => 0.5);
    expect([
      'shiratama',
      'anko',
      'sakura',
      'mitarashi',
      'yomogi',
    ]).toContain(kind);
  });
});

describe('nextTopCenterX — the tower leans', () => {
  it('moves half the offset toward the dropped dango', () => {
    expect(nextTopCenterX(270, 290)).toBe(280);
    expect(nextTopCenterX(270, 270)).toBe(270);
  });
});

describe('towerHeightCm', () => {
  it('is 4 cm per dango', () => {
    expect(towerHeightCm(0)).toBe(0);
    expect(towerHeightCm(10)).toBe(40);
    expect(towerHeightCm(25)).toBe(100);
  });
});

describe('applyDrop — full game flow', () => {
  it('stacks landings, accrues DG, ends after 3 misses', () => {
    let state = initialState(270);
    // Three perfect shiratama drops in a row, dead center.
    for (const combo of [1, 2, 3]) {
      const r = applyDrop(state, 'shiratama', 270);
      expect(r.landing).toBe('perfect');
      expect(r.earnedDG).toBe(3 + 5 * combo);
      state = r.state;
    }
    expect(state.stacked).toBe(3);
    expect(state.totalDG).toBe(3 + 5 + (3 + 10) + (3 + 15));
    expect(state.perfectCombo).toBe(3);
    expect(state.over).toBe(false);

    // A plain landing breaks the combo.
    const plain = applyDrop(state, 'anko', 270 + 30);
    expect(plain.landing).toBe('land');
    expect(plain.earnedDG).toBe(6); // 2x3, no height bonus at 4 stacked
    state = plain.state;
    expect(state.perfectCombo).toBe(0);

    // Three misses in a row end the game.
    for (let i = 0; i < 3; i++) {
      const r = applyDrop(state, 'sakura', 270 + 200);
      expect(r.landing).toBe('miss');
      expect(r.earnedDG).toBe(0);
      state = r.state;
    }
    expect(state.misses).toBe(3);
    expect(state.over).toBe(true);
  });

  it('a golden drop far off-center still lands perfectly', () => {
    const state = initialState(270);
    const r = applyDrop(state, 'golden', 270 + 300);
    expect(r.landing).toBe('perfect');
    expect(r.earnedDG).toBe(305);
    expect(r.state.over).toBe(false);
  });
});

describe('simulated play-through — 30 drops with a seeded RNG', () => {
  it('plays a whole game: DG accrues, height grows, game ends', () => {
    // Deterministic pseudo-random generator (mulberry32).
    let seed = 42;
    const random = (): number => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    let state = initialState(270);
    let drops = 0;
    // A decent player whose aim gets worse as the tower (and the sway)
    // grows — so misses eventually happen and the game ends.
    while (!state.over && drops < 200) {
      const kind = rollNextKind(DEFAULT_ECONOMY, random);
      const errorRange = 60 + state.stacked * 8; // +/- px
      const aimError = (random() - 0.5) * errorRange;
      const r = applyDrop(state, kind, state.topCenterX + aimError);
      state = r.state;
      drops += 1;
    }
    expect(drops).toBeLessThan(200);
    expect(state.over).toBe(true);
    expect(state.misses).toBe(DEFAULT_BALANCE.missesToGameOver);
    expect(state.stacked).toBeGreaterThan(0);
    expect(state.totalDG).toBeGreaterThan(0);
    expect(towerHeightCm(state.stacked)).toBe(state.stacked * 4);
  });
});

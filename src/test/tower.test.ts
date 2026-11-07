/**
 * Tests for the Dango Tower rules engine (src/logic/tower.ts).
 * Pure logic — no Phaser, no browser — so Vitest runs them in Node.
 *
 * v2 judges drops by where the physics body COMES TO REST (judgeRest),
 * not by the release position: supported at/above counter level stacks,
 * below counter level is a miss, dead-center over the previous tower
 * top is a Perfect.
 */
import { describe, expect, it } from 'vitest';
import {
  addTimerBonus,
  applyResult,
  BASE_BODY_PARAMS,
  bodyParamsFor,
  DEFAULT_BALANCE,
  DEFAULT_ECONOMY,
  DEFAULT_SIZES,
  EXPRESSION_BY_SIZE,
  EXPRESSIVE_KINDS,
  finalHeightBonus,
  heightBonus,
  heightCmFromPx,
  initialState,
  initialTimer,
  judgeRest,
  landingDG,
  rollNextKind,
  rollNextSize,
  rollSpawn,
  startTimer,
  textureKeyForSpawn,
  tickTimer,
  towerHeightCm,
  type DangoSize,
  type RestOutcome,
} from '../logic/tower';
import { ALL_DANGO_KINDS, type DangoKind } from '../constants/assets';
import { loadEconomy, loadFeel } from '../systems/EconomyConfig';

const COUNTER_TOP_Y = 859;
const ON_COUNTER_Y = COUNTER_TOP_Y - 35; // center of a dango on the counter
const ON_FLOOR_Y = 946 - 35; // center of a dango on the street

const rest = (overrides: Partial<RestOutcome>): RestOutcome => ({
  restX: 270,
  restY: ON_COUNTER_Y,
  counterTopY: COUNTER_TOP_Y,
  referenceX: 270,
  ...overrides,
});

describe('judgeRest — judged by where the dango comes to rest', () => {
  it('perfect when resting dead-center over the reference', () => {
    expect(judgeRest(rest({}))).toBe('perfect');
    expect(judgeRest(rest({ restX: 270 + 14 }))).toBe('perfect');
    expect(judgeRest(rest({ restX: 270 - 14 }))).toBe('perfect');
  });

  it('a plain stack when supported but off-center', () => {
    expect(judgeRest(rest({ restX: 270 + 15 }))).toBe('land');
    expect(judgeRest(rest({ restX: 120 }))).toBe('land');
    // Higher up the tower, against a moved reference.
    expect(
      judgeRest(rest({ restX: 300, restY: 600, referenceX: 280 })),
    ).toBe('land');
    expect(
      judgeRest(rest({ restX: 300, restY: 600, referenceX: 292 })),
    ).toBe('perfect');
  });

  it('a miss when it comes to rest below counter support level', () => {
    // On the street in front of the shop.
    expect(judgeRest(rest({ restY: ON_FLOOR_Y }))).toBe('miss');
    // Slipped halfway off: center sank below the support margin.
    expect(
      judgeRest(
        rest({ restY: COUNTER_TOP_Y - DEFAULT_BALANCE.stackSupportMarginPx + 1 }),
      ),
    ).toBe('miss');
    // Exactly at the support margin still counts as supported.
    expect(
      judgeRest(
        rest({ restY: COUNTER_TOP_Y - DEFAULT_BALANCE.stackSupportMarginPx }),
      ),
    ).toBe('perfect');
  });

  it('a miss is a miss even when it stops dead-center', () => {
    expect(judgeRest(rest({ restX: 270, restY: ON_FLOOR_Y }))).toBe('miss');
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
    expect(['shiratama', 'anko', 'sakura', 'mitarashi', 'yomogi']).toContain(
      kind,
    );
  });
});

describe('rollNextSize (v2: sizes drawn independently of kind)', () => {
  it('ships three sizes: small 28 / medium 36 / large 46 at 30/50/20', () => {
    expect(DEFAULT_SIZES).toEqual([
      { size: 'small', radiusPx: 28, weight: 0.3 },
      { size: 'medium', radiusPx: 36, weight: 0.5 },
      { size: 'large', radiusPx: 46, weight: 0.2 },
    ]);
  });

  it('walks the weight bands in order', () => {
    expect(rollNextSize(DEFAULT_SIZES, () => 0)).toBe('small');
    expect(rollNextSize(DEFAULT_SIZES, () => 0.29)).toBe('small');
    expect(rollNextSize(DEFAULT_SIZES, () => 0.3)).toBe('medium');
    expect(rollNextSize(DEFAULT_SIZES, () => 0.79)).toBe('medium');
    expect(rollNextSize(DEFAULT_SIZES, () => 0.8)).toBe('large');
    expect(rollNextSize(DEFAULT_SIZES, () => 0.999)).toBe('large');
  });
});

describe('rollSpawn (kind and size are independent draws)', () => {
  it('can pair any kind with any size', () => {
    // random draws: kind band 0.0 -> golden, size draw 0.9 -> large
    const draws = [0.0, 0.9];
    const entry = rollSpawn(
      DEFAULT_ECONOMY,
      DEFAULT_SIZES,
      () => draws.shift() ?? 0,
    );
    expect(entry).toEqual({ kind: 'golden', size: 'large' });
    // kind band 0.5 -> regular kind, index draw 0 -> shiratama; size 0.1 -> small
    const draws2 = [0.5, 0, 0.1];
    const entry2 = rollSpawn(
      DEFAULT_ECONOMY,
      DEFAULT_SIZES,
      () => draws2.shift() ?? 0,
    );
    expect(entry2).toEqual({ kind: 'shiratama', size: 'small' });
  });
});

describe('towerHeightCm', () => {
  it('is 4 cm per dango', () => {
    expect(towerHeightCm(0)).toBe(0);
    expect(towerHeightCm(10)).toBe(40);
    expect(towerHeightCm(25)).toBe(100);
  });
});

describe('applyResult — full game flow', () => {
  it('stacks landings, accrues DG, ends after 3 misses', () => {
    let state = initialState();
    // Three perfect shiratama drops in a row, dead center.
    for (const combo of [1, 2, 3]) {
      const landing = judgeRest(rest({}));
      expect(landing).toBe('perfect');
      const r = applyResult(state, 'shiratama', landing);
      expect(r.earnedDG).toBe(3 + 5 * combo);
      state = r.state;
    }
    expect(state.stacked).toBe(3);
    expect(state.totalDG).toBe(3 + 5 + (3 + 10) + (3 + 15));
    expect(state.perfectCombo).toBe(3);
    expect(state.over).toBe(false);

    // A plain landing breaks the combo.
    const plainLanding = judgeRest(rest({ restX: 270 + 30, referenceX: 270 }));
    expect(plainLanding).toBe('land');
    const plain = applyResult(state, 'anko', plainLanding);
    expect(plain.earnedDG).toBe(6); // 2x3, no height bonus at 4 stacked
    state = plain.state;
    expect(state.perfectCombo).toBe(0);

    // Three misses in a row end the game.
    for (let i = 0; i < 3; i++) {
      const landing = judgeRest(rest({ restY: ON_FLOOR_Y }));
      expect(landing).toBe('miss');
      const r = applyResult(state, 'sakura', landing);
      expect(r.earnedDG).toBe(0);
      state = r.state;
    }
    expect(state.misses).toBe(3);
    expect(state.over).toBe(true);
  });

  it('a golden resting dead-center earns the full 305 DG', () => {
    const state = initialState();
    const landing = judgeRest(rest({}));
    const r = applyResult(state, 'golden', landing);
    expect(landing).toBe('perfect');
    expect(r.earnedDG).toBe(305);
    expect(r.state.over).toBe(false);
  });

  it('a golden that slips off the counter is a miss like any other', () => {
    const state = initialState();
    const landing = judgeRest(rest({ restY: ON_FLOOR_Y }));
    const r = applyResult(state, 'golden', landing);
    expect(landing).toBe('miss');
    expect(r.earnedDG).toBe(0);
    expect(r.state.misses).toBe(1);
  });

  it('does not mutate the input state', () => {
    const state = initialState();
    const r = applyResult(state, 'anko', 'land');
    expect(state.stacked).toBe(0);
    expect(state.totalDG).toBe(0);
    expect(r.state.stacked).toBe(1);
  });
});

describe('simulated play-through — 30+ drops with fake physics rests', () => {
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

    let state = initialState();
    let referenceX = 270; // the counter center, then the tower top
    let drops = 0;
    // A decent player whose aim gets worse as the tower grows: drops
    // land near the reference with growing error; wild ones roll off
    // the counter (rest below counter level) and count as misses.
    while (!state.over && drops < 200) {
      const kind = rollNextKind(DEFAULT_ECONOMY, random);
      const errorRange = 30 + state.stacked * 14; // +/- px
      const aimError = (random() - 0.5) * 2 * errorRange;
      const restX = referenceX + aimError;
      const offCounter = Math.abs(restX - 270) > 235;
      const restY = offCounter
        ? ON_FLOOR_Y
        : ON_COUNTER_Y - state.stacked * 52;
      const landing = judgeRest({
        restX,
        restY,
        counterTopY: COUNTER_TOP_Y,
        referenceX,
      });
      const r = applyResult(state, kind, landing);
      state = r.state;
      if (landing !== 'miss') referenceX = restX;
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

describe('textureKeyForSpawn (v3: expressions by size)', () => {
  it('maps size to expression: large happy, medium wink, small surprised', () => {
    expect(EXPRESSION_BY_SIZE).toEqual({
      large: 'happy',
      medium: 'wink',
      small: 'surprised',
    });
    expect(EXPRESSIVE_KINDS).toEqual(['shiratama', 'sakura', 'yomogi']);
  });

  it('covers all 7 kinds x 3 sizes', () => {
    const expressive: DangoKind[] = ['shiratama', 'sakura', 'yomogi'];
    const plain: DangoKind[] = ['anko', 'mitarashi', 'matcha', 'golden'];
    const sizes: DangoSize[] = ['small', 'medium', 'large'];
    for (const kind of expressive) {
      expect(textureKeyForSpawn(kind, 'large')).toBe(`${kind}-happy`);
      expect(textureKeyForSpawn(kind, 'medium')).toBe(`${kind}-wink`);
      expect(textureKeyForSpawn(kind, 'small')).toBe(`${kind}-surprised`);
    }
    for (const kind of plain) {
      for (const size of sizes) {
        expect(textureKeyForSpawn(kind, size)).toBe(kind);
      }
    }
    // Every kind in the game is covered by one of the two groups.
    expect([...expressive, ...plain].sort()).toEqual(
      [...ALL_DANGO_KINDS].sort(),
    );
  });
});

describe('heightCmFromPx (v3: measured bottom-up height)', () => {
  it('is 0 with no height', () => {
    expect(heightCmFromPx(0)).toBe(0);
    expect(heightCmFromPx(-30)).toBe(0);
  });

  it('converts with the dango ruler: 72 px (one medium dango) = 4 cm', () => {
    expect(heightCmFromPx(72)).toBe(4);
    expect(heightCmFromPx(36)).toBe(2);
    expect(heightCmFromPx(144)).toBe(8);
    // A large dango is 92 px across: 92/72*4 = 5.11 -> 5 cm.
    expect(heightCmFromPx(92)).toBe(5);
    // A small dango is 56 px across: 56/72*4 = 3.11 -> 3 cm.
    expect(heightCmFromPx(56)).toBe(3);
  });
});

describe('finalHeightBonus (v3: paid once at game end)', () => {
  it('is heightCm x heightBonusPerCm (1 DG per cm by default)', () => {
    expect(finalHeightBonus(0)).toBe(0);
    expect(finalHeightBonus(1)).toBe(1);
    expect(finalHeightBonus(132)).toBe(132);
  });

  it('follows the configured rate and never goes negative', () => {
    const rich = { ...DEFAULT_ECONOMY, heightBonusPerCm: 2 };
    expect(finalHeightBonus(132, rich)).toBe(264);
    expect(finalHeightBonus(-10)).toBe(0);
    // Fractional cm are floored before paying out.
    expect(finalHeightBonus(132.9)).toBe(132);
  });

  it('the shipped economy config wires the rate at 1 DG per cm', () => {
    expect(loadEconomy().heightBonusPerCm).toBe(1);
    expect(DEFAULT_ECONOMY.heightBonusPerCm).toBe(1);
  });
});

describe('countdown timer (v3: pure state machine)', () => {
  it('starts full and untouched', () => {
    expect(initialTimer(60)).toEqual({
      started: false,
      remainingMs: 60_000,
      expired: false,
    });
  });

  it('does not tick before the first drop starts it', () => {
    const t = initialTimer(60);
    expect(tickTimer(t, 5_000)).toEqual(t);
    expect(addTimerBonus(t, 3)).toEqual(t);
  });

  it('ticks down once started, and start is idempotent', () => {
    let t = startTimer(initialTimer(60));
    expect(t.started).toBe(true);
    expect(startTimer(t)).toEqual(t);
    t = tickTimer(t, 1_500);
    expect(t.remainingMs).toBe(58_500);
    expect(t.expired).toBe(false);
  });

  it('a stacked Matcha adds +3 s, even above the start value', () => {
    let t = startTimer(initialTimer(60));
    t = addTimerBonus(t, 3);
    expect(t.remainingMs).toBe(63_000);
    t = tickTimer(t, 10_000);
    t = addTimerBonus(t, 3);
    expect(t.remainingMs).toBe(56_000);
  });

  it('expires at zero, clamps, and ignores later ticks and bonuses', () => {
    let t = startTimer(initialTimer(60));
    t = tickTimer(t, 75_000);
    expect(t.remainingMs).toBe(0);
    expect(t.expired).toBe(true);
    expect(tickTimer(t, 1_000)).toEqual(t);
    // Time is up: a late Matcha verdict cannot resurrect the clock.
    expect(addTimerBonus(t, 3)).toEqual(t);
  });

  it('the shipped timer config is 60 s / +3 s / 700 ms spawn delay', () => {
    expect(loadFeel().timer).toEqual({
      startSeconds: 60,
      matchaBonusSeconds: 3,
      spawnDelayMs: 700,
    });
  });
});

describe('per-kind traits (v3: physics personality)', () => {
  const feel = loadFeel();
  const base = {
    ...BASE_BODY_PARAMS,
    friction: feel.physics.friction,
    restitution: feel.physics.restitution,
    frictionAir: feel.physics.frictionAir,
  };
  const traits = feel.physics.traits;

  it('the shipped table covers every kind', () => {
    expect(Object.keys(traits).sort()).toEqual([...ALL_DANGO_KINDS].sort());
  });

  it('shiratama and matcha keep the plain baseline', () => {
    expect(bodyParamsFor('shiratama', base, traits)).toEqual(base);
    expect(bodyParamsFor('matcha', base, traits)).toEqual(base);
  });

  it('sakura is light and anko is heavy (density only)', () => {
    const sakura = bodyParamsFor('sakura', base, traits);
    expect(sakura.density).toBeCloseTo(base.density * 0.55);
    expect(sakura.friction).toBe(base.friction);
    const anko = bodyParamsFor('anko', base, traits);
    expect(anko.density).toBeCloseTo(base.density * 1.8);
    expect(anko.restitution).toBe(base.restitution);
  });

  it('mitarashi is sticky: high grip, almost no bounce', () => {
    const m = bodyParamsFor('mitarashi', base, traits);
    expect(m.friction).toBe(0.95);
    expect(m.frictionStatic).toBe(2.0);
    expect(m.restitution).toBe(0.05);
    expect(m.frictionAir).toBe(base.frictionAir);
  });

  it('yomogi is calm: thick air, no bounce, spin damping', () => {
    const y = bodyParamsFor('yomogi', base, traits);
    expect(y.frictionAir).toBe(0.05);
    expect(y.restitution).toBe(0.05);
    expect(y.angularDampingPerSec).toBeGreaterThan(0);
  });

  it('golden keeps its v2 grip (moved into the trait table)', () => {
    const g = bodyParamsFor('golden', base, traits);
    expect(g.friction).toBe(0.95);
    expect(g.restitution).toBe(0.05);
  });
});

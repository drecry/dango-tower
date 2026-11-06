/**
 * Dango Tower — pure game rules (no Phaser, no DOM).
 *
 * Everything that decides the game lives here so Vitest can check it in
 * Node without a browser: which dango drops next, whether a drop lands,
 * and how many DG it earns. The Phaser scenes only render this state.
 *
 * DG formula (money earned IS the score, like Dango Drop — every dango
 * you stack is sold at the shop):
 *
 *   DG for one landed dango
 *     = price x SELL_MULTIPLIER            (sold as a shop item, x3)
 *     + HEIGHT_BONUS                       (floor(stacked / 5), +1 DG
 *                                           every 5 dango in the tower)
 *     + PERFECT_BONUS x perfectCombo      (only on a perfect landing;
 *                                           consecutive perfects raise
 *                                           the combo: 5, 10, 15 ... DG)
 *
 * Golden is always perfect. Matcha slows the sway for the next few
 * drops. A miss earns 0 DG. Three misses end the game.
 */
import type { DangoKind } from '../constants/assets';
import { REGULAR_KINDS } from '../constants/assets';

/** Menu price of each dango in DG (from dango-economy.json). */
export interface Economy {
  prices: Record<DangoKind, number>;
  /** Chance a drop is Golden (0.01 = 1 in 100). */
  goldenRate: number;
  /** Chance a drop is Matcha (0.04 = 1 in 25). */
  matchaRate: number;
  /** Multiplier applied to the menu price when a dango is sold. */
  sellMultiplier: number;
  /** +1 DG height bonus per this many dango stacked. */
  heightBonusEvery: number;
  /** DG for one perfect landing, multiplied by the perfect combo. */
  perfectBonus: number;
  /** Height of one dango in cm (for the height display). */
  dangoHeightCm: number;
}

/** Feel settings (from game-balance.json). */
export interface Balance {
  /** Perfect landing if |offset| <= this many px from the tower center. */
  perfectWindowPx: number;
  /** A landing at all if |offset| <= this many px. */
  landWindowPx: number;
  /** How much of the offset the tower leans by after a landing (0.5). */
  leanFactor: number;
  /** Misses before game over. */
  missesToGameOver: number;
}

/** Sensible defaults matching the shipped JSON configs. */
export const DEFAULT_ECONOMY: Economy = {
  prices: {
    shiratama: 1,
    anko: 2,
    sakura: 3,
    mitarashi: 4,
    yomogi: 5,
    matcha: 10,
    golden: 100,
  },
  goldenRate: 0.01,
  matchaRate: 0.04,
  sellMultiplier: 3,
  heightBonusEvery: 5,
  perfectBonus: 5,
  dangoHeightCm: 4,
};

export const DEFAULT_BALANCE: Balance = {
  perfectWindowPx: 10,
  landWindowPx: 48,
  leanFactor: 0.5,
  missesToGameOver: 3,
};

export type Landing = 'perfect' | 'land' | 'miss';

/**
 * Pick the next dango to drop.
 * Golden is rare (1%), Matcha is uncommon (4%), the rest is split
 * evenly between the five everyday friends. `random` is injectable so
 * tests can use a seeded RNG.
 */
export const rollNextKind = (
  economy: Economy = DEFAULT_ECONOMY,
  random: () => number = Math.random,
): DangoKind => {
  const r = random();
  if (r < economy.goldenRate) return 'golden';
  if (r < economy.goldenRate + economy.matchaRate) return 'matcha';
  const index = Math.floor(random() * REGULAR_KINDS.length);
  return REGULAR_KINDS[index];
};

/**
 * Judge a drop from its horizontal offset from the tower top center.
 * Golden always lands perfectly (it shines so brightly it guides itself).
 */
export const judgeLanding = (
  kind: DangoKind,
  offsetPx: number,
  balance: Balance = DEFAULT_BALANCE,
): Landing => {
  if (kind === 'golden') return 'perfect';
  const offset = Math.abs(offsetPx);
  if (offset <= balance.perfectWindowPx) return 'perfect';
  if (offset <= balance.landWindowPx) return 'land';
  return 'miss';
};

/** Height bonus: +1 DG for every `heightBonusEvery` dango stacked. */
export const heightBonus = (
  stackedCount: number,
  economy: Economy = DEFAULT_ECONOMY,
): number => Math.floor(stackedCount / economy.heightBonusEvery);

/**
 * DG earned by landing one dango.
 * `stackedCount` is the tower size AFTER this landing.
 * `perfectCombo` counts consecutive perfects INCLUDING this one (1+).
 */
export const landingDG = (
  kind: DangoKind,
  landing: Landing,
  stackedCount: number,
  perfectCombo: number,
  economy: Economy = DEFAULT_ECONOMY,
): number => {
  if (landing === 'miss') return 0;
  const sold = economy.prices[kind] * economy.sellMultiplier;
  const height = heightBonus(stackedCount, economy);
  const perfect =
    landing === 'perfect' ? economy.perfectBonus * perfectCombo : 0;
  return sold + height + perfect;
};

/** Tower height in cm (each dango is about 4 cm tall). */
export const towerHeightCm = (
  stackedCount: number,
  economy: Economy = DEFAULT_ECONOMY,
): number => stackedCount * economy.dangoHeightCm;

/** Where the tower top center moves to after a landing (it leans). */
export const nextTopCenterX = (
  topCenterX: number,
  droppedX: number,
  balance: Balance = DEFAULT_BALANCE,
): number => topCenterX + (droppedX - topCenterX) * balance.leanFactor;

/** Minimal per-game state, driven by the pure rules above. */
export interface TowerState {
  stacked: number;
  misses: number;
  totalDG: number;
  perfectCombo: number;
  topCenterX: number;
  over: boolean;
}

export const initialState = (startX: number): TowerState => ({
  stacked: 0,
  misses: 0,
  totalDG: 0,
  perfectCombo: 0,
  topCenterX: startX,
  over: false,
});

/**
 * Apply one drop to the state and return the new state plus what happened.
 * Pure: no mutation of the input state.
 */
export const applyDrop = (
  state: TowerState,
  kind: DangoKind,
  droppedX: number,
  economy: Economy = DEFAULT_ECONOMY,
  balance: Balance = DEFAULT_BALANCE,
): { state: TowerState; landing: Landing; earnedDG: number } => {
  const landing = judgeLanding(kind, droppedX - state.topCenterX, balance);
  if (landing === 'miss') {
    const misses = state.misses + 1;
    return {
      state: {
        ...state,
        misses,
        perfectCombo: 0,
        over: misses >= balance.missesToGameOver,
      },
      landing,
      earnedDG: 0,
    };
  }
  const stacked = state.stacked + 1;
  const perfectCombo =
    landing === 'perfect' ? state.perfectCombo + 1 : 0;
  const earnedDG = landingDG(kind, landing, stacked, perfectCombo, economy);
  return {
    state: {
      ...state,
      stacked,
      totalDG: state.totalDG + earnedDG,
      perfectCombo,
      topCenterX: nextTopCenterX(state.topCenterX, droppedX, balance),
    },
    landing,
    earnedDG,
  };
};

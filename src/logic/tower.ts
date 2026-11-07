/**
 * Dango Tower — pure game rules (no Phaser, no DOM).
 *
 * Everything that decides the game lives here so Vitest can check it in
 * Node without a browser: which dango drops next, how a dropped dango is
 * judged once its physics body comes to rest, and how many DG it earns.
 * The Phaser scenes only render this state and simulate the physics.
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
 *   At game end a FINAL HEIGHT BONUS is added once:
 *   final tower height (cm, measured) x HEIGHT_BONUS_PER_CM DG.
 *   The total including it is the run's DG (and the best-DG record).
 *
 * Judging (v2, real physics): a dropped dango is judged ONCE, when it
 * comes to rest. Resting supported at or above counter level is a stack;
 * ending up below counter level (on the floor, off the counter) is a
 * miss. A stack whose center rests within PERFECT_WINDOW of the previous
 * topmost dango's center is a Perfect. Golden gets no free pass any
 * more — it drops dead-center with no sway and extra grip, so it earns
 * its Perfect honestly. Matcha slows the sway for the next few drops.
 * A miss earns 0 DG. Three misses end the game.
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
  /** Final Height Bonus at game end: DG per cm of final tower height. */
  heightBonusPerCm: number;
}

/** Judging settings (from game-balance.json). */
export interface Balance {
  /** Perfect if the rest center is within this many px of the reference. */
  perfectWindowPx: number;
  /**
   * A rest center this many px above the counter top (or higher) still
   * counts as supported by the counter / tower. Half a dango radius:
   * the center of a dango sitting ON the counter sits a full radius
   * above the counter top, so anything whose center sank to below
   * counter level + margin has slipped off support.
   */
  stackSupportMarginPx: number;
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
  heightBonusPerCm: 1,
};

export const DEFAULT_BALANCE: Balance = {
  perfectWindowPx: 14,
  stackSupportMarginPx: 17,
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
 * Dango sizes (v2, like the prototype): size is drawn INDEPENDENTLY of
 * kind — kind decides price and effects, size only decides the body.
 * Big dango are heavier (mass follows area) and make a stable base;
 * small ones slip into gaps. DG prices never change with size.
 */
export type DangoSize = 'small' | 'medium' | 'large';

export interface SizeSpec {
  size: DangoSize;
  /** Physics body radius in px (the sprite is drawn to match). */
  radiusPx: number;
  /** Relative spawn weight (weights are normalized before use). */
  weight: number;
}

export const DEFAULT_SIZES: readonly SizeSpec[] = [
  { size: 'small', radiusPx: 28, weight: 0.3 },
  { size: 'medium', radiusPx: 36, weight: 0.5 },
  { size: 'large', radiusPx: 46, weight: 0.2 },
];

/** Pick the next dango's size by weight. */
export const rollNextSize = (
  sizes: readonly SizeSpec[] = DEFAULT_SIZES,
  random: () => number = Math.random,
): DangoSize => {
  const total = sizes.reduce((sum, s) => sum + s.weight, 0);
  let r = random() * total;
  for (const spec of sizes) {
    r -= spec.weight;
    if (r < 0) return spec.size;
  }
  return sizes[sizes.length - 1].size;
};

/** One spawn: a kind and a size, drawn independently. */
export interface SpawnEntry {
  kind: DangoKind;
  size: DangoSize;
}

export const rollSpawn = (
  economy: Economy = DEFAULT_ECONOMY,
  sizes: readonly SizeSpec[] = DEFAULT_SIZES,
  random: () => number = Math.random,
): SpawnEntry => ({
  kind: rollNextKind(economy, random),
  size: rollNextSize(sizes, random),
});

// ----- expressions by size (v3) ------------------------------------------

/**
 * Facial expressions (v3): three friends have expression variants in
 * the art set (happy / wink / surprised — the positive set). Which face
 * a dango wears is decided by its SIZE, so the tower reads at a glance:
 * big dango grin, medium ones wink, small ones look surprised. Kinds
 * without variants (anko, mitarashi, matcha, golden) always use their
 * base art. The variants share the base art's framing exactly, so the
 * v2 display sizing applies unchanged.
 */
export type DangoExpression = 'happy' | 'wink' | 'surprised';

export const DANGO_EXPRESSIONS: readonly DangoExpression[] = [
  'happy',
  'wink',
  'surprised',
];

/** Kinds that have expression variant art. */
export const EXPRESSIVE_KINDS: readonly DangoKind[] = [
  'shiratama',
  'sakura',
  'yomogi',
];

/** Size -> expression for the kinds that have variants. */
export const EXPRESSION_BY_SIZE: Record<DangoSize, DangoExpression> = {
  large: 'happy',
  medium: 'wink',
  small: 'surprised',
};

/**
 * Texture key for a spawn (kind + size). Used for the hovering spawner,
 * the falling/stacked body and the NEXT preview alike, so a dango never
 * changes face mid-flight.
 */
export const textureKeyForSpawn = (kind: DangoKind, size: DangoSize): string =>
  EXPRESSIVE_KINDS.includes(kind)
    ? `${kind}-${EXPRESSION_BY_SIZE[size]}`
    : kind;

/** Where a dropped dango came to rest (world coordinates). */
export interface RestOutcome {
  /** Center X of the dropped dango at rest. */
  restX: number;
  /** Center Y of the dropped dango at rest (smaller = higher up). */
  restY: number;
  /** Top surface of the shop counter (world Y). */
  counterTopY: number;
  /**
   * Center X of the previous topmost resting dango — the Perfect
   * reference. For the first dango this is the counter center.
   */
  referenceX: number;
}

/**
 * Judge a dropped dango from where it came to rest.
 *
 * - Below counter support level -> miss (it fell off the counter).
 * - Supported, dead-center over the previous tower top -> perfect.
 * - Supported, anything else -> a plain stack.
 */
export const judgeRest = (
  rest: RestOutcome,
  balance: Balance = DEFAULT_BALANCE,
): Landing => {
  const supportLevel = rest.counterTopY - balance.stackSupportMarginPx;
  if (rest.restY > supportLevel) return 'miss';
  if (Math.abs(rest.restX - rest.referenceX) <= balance.perfectWindowPx) {
    return 'perfect';
  }
  return 'land';
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

/**
 * Reference body diameter (px) that equals one `dangoHeightCm`: the
 * medium dango (radius 36 x 2). This is the game's px->cm conversion —
 * a dango's pixel diameter IS its height in the world, so a tower's
 * height in px converts with the same ruler.
 */
export const REFERENCE_DIAMETER_PX = 72;

/**
 * Tower height in cm from a measured pixel height (v3): the readout is
 * the real measured height — counter top surface up to the top of the
 * highest settled dango — not a per-dango estimate. 0 when the tower
 * has no height (nothing stacked).
 */
export const heightCmFromPx = (
  heightPx: number,
  economy: Economy = DEFAULT_ECONOMY,
  referenceDiameterPx: number = REFERENCE_DIAMETER_PX,
): number => {
  if (heightPx <= 0 || referenceDiameterPx <= 0) return 0;
  return Math.round((heightPx / referenceDiameterPx) * economy.dangoHeightCm);
};

/**
 * Final Height Bonus (v3), paid once at game end: the taller the tower
 * when the shop closes, the bigger the bonus — finalHeightCm x rate.
 * This is separate from the per-landing `heightBonus` above.
 */
export const finalHeightBonus = (
  heightCm: number,
  economy: Economy = DEFAULT_ECONOMY,
): number => Math.max(0, Math.floor(heightCm)) * economy.heightBonusPerCm;

// ----- per-kind physics traits (v3) --------------------------------------

/**
 * Per-kind physics traits (v3): each friend handles a little
 * differently, expressed purely as Matter body parameters so the
 * character shows in the physics, not in special-case code. Values
 * live in game-balance.json (`physics.traits`); a field left out falls
 * back to the shared baseline.
 */
export interface DangoTrait {
  /** Multiplier on the baseline body density (heavier / lighter). */
  densityFactor?: number;
  /** Sliding friction override. */
  friction?: number;
  /** Static (grip) friction override. */
  frictionStatic?: number;
  /** Bounciness override. */
  restitution?: number;
  /** Air friction override (also slows rolling creep). */
  frictionAir?: number;
  /**
   * Extra angular damping (1/sec): the scene decays the body's spin
   * exponentially at this rate while the dango is in play. Matter has
   * no per-body angular air friction, so the scene applies it.
   */
  angularDampingPerSec?: number;
}

export type TraitTable = Partial<Record<DangoKind, DangoTrait>>;

/** Fully-resolved Matter body parameters for one dango. */
export interface BodyParams {
  friction: number;
  frictionStatic: number;
  restitution: number;
  frictionAir: number;
  /** Absolute body density (baseline x the trait's densityFactor). */
  density: number;
  angularDampingPerSec: number;
}

/**
 * Baseline body parameters (v2 feel): the scene builds these from
 * game-balance.json's shared physics numbers plus Matter's defaults
 * (frictionStatic 0.5, density 0.001).
 */
export const BASE_BODY_PARAMS: BodyParams = {
  friction: 0.6,
  frictionStatic: 0.5,
  restitution: 0.15,
  frictionAir: 0.015,
  density: 0.001,
  angularDampingPerSec: 0,
};

/** Resolve the body parameters for one kind: baseline + trait overrides. */
export const bodyParamsFor = (
  kind: DangoKind,
  base: BodyParams = BASE_BODY_PARAMS,
  traits: TraitTable = {},
): BodyParams => {
  const trait = traits[kind] ?? {};
  return {
    friction: trait.friction ?? base.friction,
    frictionStatic: trait.frictionStatic ?? base.frictionStatic,
    restitution: trait.restitution ?? base.restitution,
    frictionAir: trait.frictionAir ?? base.frictionAir,
    density: base.density * (trait.densityFactor ?? 1),
    angularDampingPerSec:
      trait.angularDampingPerSec ?? base.angularDampingPerSec,
  };
};

// ----- countdown timer (v3) ----------------------------------------------

/**
 * The 60-second countdown (v3), as a pure state machine so the rules
 * are testable without Phaser. Time only ever moves when the scene
 * feeds it accumulated scene-time deltas — a backgrounded tab runs no
 * updates, so it cannot drain the clock.
 *
 * Rules:
 * - The clock starts on the player's FIRST drop (never before).
 * - A stacked Matcha adds bonus seconds — but only while the clock is
 *   still running; once time is up, time is up.
 * - Remaining time may rise above the start value (an early Matcha).
 */
export interface TimerState {
  started: boolean;
  remainingMs: number;
  expired: boolean;
}

export const initialTimer = (startSeconds: number): TimerState => ({
  started: false,
  remainingMs: Math.max(0, startSeconds * 1000),
  expired: false,
});

/** Start the clock (first drop). Idempotent. */
export const startTimer = (state: TimerState): TimerState =>
  state.started ? state : { ...state, started: true };

/** Advance the clock by a scene-time delta. No-op before the start. */
export const tickTimer = (state: TimerState, deltaMs: number): TimerState => {
  if (!state.started || state.expired || deltaMs <= 0) return state;
  const remainingMs = Math.max(0, state.remainingMs - deltaMs);
  return { ...state, remainingMs, expired: remainingMs <= 0 };
};

/** Add bonus seconds (a stacked Matcha). Only while the clock runs. */
export const addTimerBonus = (
  state: TimerState,
  bonusSeconds: number,
): TimerState => {
  if (!state.started || state.expired || bonusSeconds <= 0) return state;
  return { ...state, remainingMs: state.remainingMs + bonusSeconds * 1000 };
};

/** Minimal per-game state, driven by the pure rules above. */
export interface TowerState {
  stacked: number;
  misses: number;
  totalDG: number;
  perfectCombo: number;
  over: boolean;
}

export const initialState = (): TowerState => ({
  stacked: 0,
  misses: 0,
  totalDG: 0,
  perfectCombo: 0,
  over: false,
});

/**
 * Apply one judged drop to the state and return the new state plus the
 * DG earned. Pure: no mutation of the input state. Judging itself is
 * `judgeRest` — this function only does the bookkeeping (DG, combo,
 * misses, game over) so the scene stays a thin renderer.
 */
export const applyResult = (
  state: TowerState,
  kind: DangoKind,
  landing: Landing,
  economy: Economy = DEFAULT_ECONOMY,
  balance: Balance = DEFAULT_BALANCE,
): { state: TowerState; earnedDG: number } => {
  if (landing === 'miss') {
    const misses = state.misses + 1;
    return {
      state: {
        ...state,
        misses,
        perfectCombo: 0,
        over: misses >= balance.missesToGameOver,
      },
      earnedDG: 0,
    };
  }
  const stacked = state.stacked + 1;
  const perfectCombo = landing === 'perfect' ? state.perfectCombo + 1 : 0;
  const earnedDG = landingDG(kind, landing, stacked, perfectCombo, economy);
  return {
    state: { ...state, stacked, totalDG: state.totalDG + earnedDG, perfectCombo },
    earnedDG,
  };
};

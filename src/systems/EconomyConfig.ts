/**
 * Economy / balance config loaders (Dango Tower).
 *
 * Money and feel settings live in JSON, never hard-coded in game code —
 * the Dango Drop rule ("economy settings live outside the code"). Balance
 * tweaks are a JSON edit, not a code change.
 */
import economyJson from '../config/dango-economy.json';
import balanceJson from '../config/game-balance.json';
import type { Balance, Economy, SizeSpec, TraitTable } from '../logic/tower';
import type { DangoKind } from '../constants/assets';

interface EconomyJson {
  currency: string;
  prices: Record<DangoKind, number>;
  dropRates: { golden: number; matcha: number };
  tower: {
    sellMultiplier: number;
    heightBonusEvery: number;
    perfectBonus: number;
    dangoHeightCm: number;
    heightBonusPerCm: number;
  };
}

interface PhysicsJson {
  gravityY: number;
  restitution: number;
  friction: number;
  frictionAir: number;
  counterTopY: number;
  platformCenterX: number;
  platformWidthPx: number;
  floorTopY: number;
  settleSpeed: number;
  settleTimeMs: number;
  calmSpeed: number;
  calmTimeMs: number;
  resolveTimeoutMs: number;
  stackSupportMarginPx: number;
  sizes: SizeSpec[];
  /** Per-kind physics traits (v3); golden's grip lives here now too. */
  traits: TraitTable;
}

export interface TimerJson {
  /** Countdown length in seconds, from the player's first drop. */
  startSeconds: number;
  /** Seconds added when a Matcha stacks. */
  matchaBonusSeconds: number;
  /** Delay before the next spawner activates after a drop. */
  spawnDelayMs: number;
}

interface BalanceJson {
  landing: {
    perfectWindowPx: number;
  };
  missesToGameOver: number;
  sway: {
    baseAmplitudePx: number;
    amplitudePerStackPx: number;
    maxAmplitudePx: number;
    baseSpeedRadPerSec: number;
    speedPerStackRadPerSec: number;
    maxSpeedRadPerSec: number;
    matchaSlowFactor: number;
    matchaSlowDrops: number;
  };
  swayY: number;
  platformTopY: number;
  physics: PhysicsJson;
  cameraTargetTopY: number;
  timer: TimerJson;
}

/** The DG currency of this game (always "DG", shared with Dango Drop). */
export const CURRENCY = (economyJson as EconomyJson).currency;

export const loadEconomy = (): Economy => {
  const json = economyJson as EconomyJson;
  return {
    prices: json.prices,
    goldenRate: json.dropRates.golden,
    matchaRate: json.dropRates.matcha,
    sellMultiplier: json.tower.sellMultiplier,
    heightBonusEvery: json.tower.heightBonusEvery,
    perfectBonus: json.tower.perfectBonus,
    dangoHeightCm: json.tower.dangoHeightCm,
    heightBonusPerCm: json.tower.heightBonusPerCm ?? 1,
  };
};

export const loadBalance = (): Balance => {
  const json = balanceJson as BalanceJson;
  return {
    perfectWindowPx: json.landing.perfectWindowPx,
    stackSupportMarginPx: json.physics.stackSupportMarginPx,
    missesToGameOver: json.missesToGameOver,
  };
};

/** Full feel settings for the GameScene (sway, physics, camera, timer). */
export const loadFeel = (): {
  sway: BalanceJson['sway'];
  swayY: number;
  platformTopY: number;
  physics: PhysicsJson;
  cameraTargetTopY: number;
  timer: TimerJson;
} => {
  const json = balanceJson as BalanceJson;
  return {
    sway: json.sway,
    swayY: json.swayY,
    platformTopY: json.platformTopY,
    physics: json.physics,
    cameraTargetTopY: json.cameraTargetTopY,
    timer: json.timer,
  };
};

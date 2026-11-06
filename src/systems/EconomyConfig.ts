/**
 * Economy / balance config loaders (Dango Tower).
 *
 * Money and feel settings live in JSON, never hard-coded in game code —
 * the Dango Drop rule ("economy settings live outside the code"). Balance
 * tweaks are a JSON edit, not a code change.
 */
import economyJson from '../config/dango-economy.json';
import balanceJson from '../config/game-balance.json';
import type { Balance, Economy, SizeSpec } from '../logic/tower';
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
  };
}

interface PhysicsJson {
  gravityY: number;
  restitution: number;
  friction: number;
  frictionAir: number;
  goldenRestitution: number;
  goldenFriction: number;
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

/** Full feel settings for the GameScene (sway, physics, camera). */
export const loadFeel = (): {
  sway: BalanceJson['sway'];
  swayY: number;
  platformTopY: number;
  physics: PhysicsJson;
  cameraTargetTopY: number;
} => {
  const json = balanceJson as BalanceJson;
  return {
    sway: json.sway,
    swayY: json.swayY,
    platformTopY: json.platformTopY,
    physics: json.physics,
    cameraTargetTopY: json.cameraTargetTopY,
  };
};

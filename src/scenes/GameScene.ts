/**
 * Game scene (Dango Tower) — the full-screen play area.
 *
 * A dango hovers near the top of the camera view, swaying side to side.
 * Tap (or Space) to drop it: from that moment it is a REAL physics body
 * (Phaser Matter) — it falls, bounces, rolls and piles on the shop
 * counter or on the dango below. When it comes to rest it is judged
 * exactly once by the pure rules in src/logic/tower.ts: stacked at or
 * above counter level (dead-center = Perfect), or a miss if it slipped
 * off the counter to the floor. Three misses end the game.
 *
 * v3 changes:
 * - FAST-DROP PIPELINE: the next dango activates 0.7 s after a drop,
 *   even while earlier dango are still settling. Every dropped dango
 *   is tracked and judged independently when IT settles (Perfect is
 *   judged against the topmost settled dango at that moment).
 * - TIMER: a 60-second countdown starts on the first drop. A stacked
 *   Matcha adds +3 seconds. At zero the input locks; dango already in
 *   play are still judged, then the shop closes.
 * - EXPRESSIONS: shiratama / sakura / yomogi wear a face by SIZE
 *   (large = happy, medium = wink, small = surprised).
 * - TRAITS: each kind has its own physics feel (anko is heavy,
 *   mitarashi sticky, sakura light, yomogi calm...).
 * - HEIGHT: the cm readout is the measured tower height — counter top
 *   surface to the top of the highest settled dango — and at game end
 *   it pays a Final Height Bonus of heightCm x 100 DG (rate lives in
 *   dango-economy.json as heightBonusPerCm).
 *
 * v3.1 changes:
 * - SWAY FIX: the sway center/amplitude are frozen when a dango
 *   appears and its phase restarts at 0 — the hover no longer jitters
 *   with the settling pile, teleports when the topmost dango changes,
 *   or sticks flat against the screen edge.
 * - RANKING: at closing, the total DG is submitted to the shared
 *   family leaderboard (game_id "dango-tower") without waiting for
 *   the reply; the Result screen fills the rank in when it arrives.
 *
 * The background illustration is anchored to the world: the shop
 * counter in the art IS the physics platform, and as the tower grows
 * the camera pans up into the plain sky above the art.
 *
 * The play area fills the whole phone screen: only a slim HUD sits on
 * top (DG, height, timer, misses, sound, pause), pinned to the camera.
 * Rules and introductions live on their own screens.
 */
import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/dimensions';
import { BACKGROUND_KEY, SKY_FILL_COLOR } from '../constants/assets';
import type { DangoKind } from '../constants/assets';
import {
  addTimerBonus,
  applyResult,
  bodyParamsFor,
  finalHeightBonus,
  heightCmFromPx,
  initialState,
  initialTimer,
  judgeRest,
  rollSpawn,
  startTimer,
  textureKeyForSpawn,
  tickTimer,
  BASE_BODY_PARAMS,
  type BodyParams,
  type DangoSize,
  type Economy,
  type SpawnEntry,
  type TimerState,
  type TowerState,
} from '../logic/tower';
import { saveBest } from '../logic/storage';
import {
  CURRENCY,
  loadBalance,
  loadEconomy,
  loadFeel,
} from '../systems/EconomyConfig';
import { bgm } from '../systems/bgm';
import { isRankingEnabled, leaderboard } from '../systems/LeaderboardClient';
import {
  buildScoreStats,
  toDurationSec,
} from '../systems/ScoreSubmission';
import { sound } from '../systems/sound';
import { COLOR_TEXT, addSoftPanel, makeIconButton } from './ui';
import type { ResultData } from './ResultScene';

export const GAME_SCENE_KEY = 'GameScene';

type Phase = 'swaying' | 'dropping' | 'waiting' | 'over';
type MatterImage = Phaser.Physics.Matter.Image;

/** Minimal structural view of a Matter body (avoids MatterJS type noise). */
interface MatterBodyLike {
  label: string;
  speed: number;
  angularSpeed: number;
  angularVelocity: number;
  isSleeping: boolean;
  isStatic: boolean;
  position: { x: number; y: number };
  collisionFilter: { mask: number };
  gameObject: Phaser.GameObjects.GameObject | null;
}

interface CollisionStartLike {
  pairs: { bodyA: MatterBodyLike; bodyB: MatterBodyLike }[];
}

/**
 * One dropped dango still waiting for its verdict. v3 tracks every
 * in-flight dango separately so drops can pipeline.
 */
interface PendingDango {
  img: MatterImage;
  kind: DangoKind;
  radius: number;
  /** Ms since the drop, accumulated from update deltas (pause-safe). */
  elapsedMs: number;
  peakSpeed: number;
  collided: boolean;
  ponPlayed: boolean;
  settleStillMs: number;
  /** Ms spent slow but not still (rolling creep). */
  calmMs: number;
  /** Extra spin damping (yomogi's trait), 0 for the others. */
  angularDampingPerSec: number;
  /** The dango's size (pitches its stacking voice, v3.2). */
  size: DangoSize;
}

/** Debug/playtest surface, also handy from a browser console. */
export interface DangoTowerDebug {
  getState: () => {
    scene: string;
    phase: Phase;
    stacked: number;
    misses: number;
    totalDG: number;
    perfectCombo: number;
    over: boolean;
    bodies: number;
    referenceX: number;
    spawnerKind: DangoKind | null;
    spawnerSize: DangoSize | null;
    spawnerTexture: string | null;
    nextKind: DangoKind;
    nextSize: DangoSize;
    nextTexture: string;
    cameraScrollY: number;
    /** v3: measured tower height in cm (bottom-up). */
    heightCm: number;
    /** v3: countdown state. */
    timeLeftSec: number;
    timerStarted: boolean;
    timerExpired: boolean;
    timerBonusMs: number;
    /** v3: dropped dango still waiting for a verdict. */
    pendingCount: number;
  };
  drop: () => boolean;
  dropAt: (x: number) => boolean;
  setNextKind: (kind: DangoKind) => void;
  setNextSize: (size: DangoSize) => void;
  /** v3: set the countdown (seconds); starts the clock if needed. */
  forceTimeLeft: (seconds: number) => void;
  getActive: () => { x: number; y: number; speed: number } | null;
  getInternals: () => {
    collided: boolean;
    collisionEventsSeen: number;
    lastPairInfo: string | null;
    settleStillMs: number;
    calmMs: number;
    elapsedMs: number;
    speed: number;
    angularSpeed: number;
    sleeping: boolean;
  } | null;
  getLastJudge: () => {
    restX: number;
    restY: number;
    referenceX: number;
    landing: string;
  } | null;
  /** v3: the exact data handed to the Result scene at game end. */
  getLastResult: () => ResultData | null;
}

const HUD_TOP = 20;
/** Above this screen Y a tap belongs to the HUD, not the game. */
const HUD_GUARD_Y = 136;
/** The NEXT preview shows the dango at this fraction of its real size
 *  (relative sizes stay truthful, the panel stays compact). */
const NEXT_PREVIEW_SCALE = 0.62;
/** Keep at most this many stacked dango fully dynamic; older buried
 *  dango are quietly turned static so tall towers stay stable. */
const MAX_DYNAMIC_DANGO = 90;

export class GameScene extends Phaser.Scene {
  private economy: Economy = loadEconomy();
  private balance = loadBalance();
  private feel = loadFeel();
  private state: TowerState = initialState();
  private gameOver = false;
  private paused = false;

  private spawner: Phaser.GameObjects.Image | null = null;
  /** True while a hovering spawner is shown and can be dropped. */
  private spawnerActive = false;
  /** Spawn queue, always 2 deep: current (hovering) + next (preview). */
  private currentEntry: SpawnEntry = { kind: 'shiratama', size: 'medium' };
  private nextEntry: SpawnEntry = { kind: 'shiratama', size: 'medium' };
  private nextImage: Phaser.GameObjects.Image | null = null;
  private guide: Phaser.GameObjects.Rectangle | null = null;

  /** Dropped dango still waiting for their verdict (v3 pipeline). */
  private pending: PendingDango[] = [];
  private lastJudge: {
    restX: number;
    restY: number;
    referenceX: number;
    landing: string;
  } | null = null;
  /** Diagnostics for the playtest hook. */
  private collisionEventsSeen = 0;
  private lastPairInfo: string | null = null;

  private stackedDangos: MatterImage[] = [];
  private swayPhase = 0;
  private swayX = GAME_WIDTH / 2;
  /**
   * Sway geometry, captured ONCE when a spawner appears (v3.1 fix).
   *
   * Before this fix the sway center was the topmost dango's live X,
   * re-read every frame: the hovering dango jittered along with the
   * still-settling pile, teleported sideways whenever a new dango
   * became the topmost, jumped on its first frame because the sine
   * phase was carried over from the previous dango, and stuck flat
   * against the screen edge whenever the sine ran past the clamp.
   * Now the center and the effective amplitude are frozen at spawn,
   * the phase restarts at 0 (the dango appears exactly at its center),
   * and the amplitude is pre-shrunk so the swing never clips.
   */
  private swayCenterX = GAME_WIDTH / 2;
  private swayAmpEff = 0;
  private slowDropsLeft = 0;
  private swaySlowActive = false;
  private debugHoldX: number | null = null;

  private cameraScroll = 0;
  private nudgeAmp = 0;
  private nudgeT = -1;
  private squashAt = new Map<object, number>();

  // ----- v3: countdown timer ------------------------------------------
  private timer: TimerState = initialTimer(60);
  /** Input locked because the clock ran out (dango in play drain first). */
  private timeUp = false;
  /** Total Matcha time bonus actually applied (playtest diagnostics). */
  private timerBonusTotalMs = 0;
  /** Golden dango stacked this run (a ranking stat). */
  private goldenStacked = 0;
  /** Play time since the first drop (a ranking stat), in ms. */
  private playElapsedMs = 0;
  private timerText: Phaser.GameObjects.Text | null = null;
  private timerShownLabel = '';
  private timerUrgent = false;
  private timerPulse: Phaser.Tweens.Tween | null = null;
  private lastResult: ResultData | null = null;

  private dgText: Phaser.GameObjects.Text | null = null;
  private heightText: Phaser.GameObjects.Text | null = null;
  private lastShownCm = -1;
  private missDots: Phaser.GameObjects.Arc[] = [];
  private pauseOverlay: Phaser.GameObjects.Container | null = null;
  private soundText: Phaser.GameObjects.Text | null = null;

  constructor() {
    super(GAME_SCENE_KEY);
  }

  create(): void {
    bgm.start('game');
    this.economy = loadEconomy();
    this.balance = loadBalance();
    this.feel = loadFeel();
    this.state = initialState();
    this.gameOver = false;
    this.paused = false;
    this.pending = [];
    this.stackedDangos = [];
    this.swayPhase = 0;
    this.slowDropsLeft = 0;
    this.debugHoldX = null;
    this.cameraScroll = 0;
    this.nudgeT = -1;
    this.missDots = [];
    this.squashAt.clear();
    this.spawnerActive = false;
    this.lastJudge = null;
    this.collisionEventsSeen = 0;
    this.lastPairInfo = null;
    // v3 timer state.
    this.timer = initialTimer(this.feel.timer.startSeconds);
    this.timeUp = false;
    this.timerBonusTotalMs = 0;
    this.goldenStacked = 0;
    this.playElapsedMs = 0;
    this.timerShownLabel = '';
    this.timerUrgent = false;
    this.timerPulse = null;
    this.lastResult = null;
    this.lastShownCm = -1;

    const phys = this.feel.physics;
    const cam = this.cameras.main;
    // Sky above the illustration: the art's own sky color, so the
    // camera can rise past the top of the picture seamlessly.
    cam.setBackgroundColor(SKY_FILL_COLOR);
    cam.scrollY = 0;

    // World-anchored background: the counter in the art is the platform.
    this.add
      .image(GAME_WIDTH / 2, GAME_HEIGHT / 2, BACKGROUND_KEY)
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT)
      .setDepth(-10);

    // Physics world. Gravity comes from game-balance.json ("feel
    // settings live in JSON"), applied straight to the Matter engine.
    const engine = this.matter.world.engine as unknown as {
      gravity: { y: number };
    };
    engine.gravity.y = phys.gravityY;
    // The shop counter (matches the art): a static platform whose top
    // surface is the counter top in the illustration.
    this.matter.add.rectangle(
      phys.platformCenterX,
      phys.counterTopY + 24,
      phys.platformWidthPx,
      48,
      { isStatic: true, label: 'counter', friction: 0.9 },
    );
    // The street in front of the shop: missed dango come to rest here,
    // below counter level, where the rules judge them as misses.
    this.matter.add.rectangle(GAME_WIDTH / 2, phys.floorTopY + 30, 1600, 60, {
      isStatic: true,
      label: 'floor',
      friction: 0.9,
    });

    this.makeSparkleTexture();

    // Faint aiming guide under the hovering dango (world-anchored).
    this.guide = this.add
      .rectangle(GAME_WIDTH / 2, 200, 3, 120, 0xffffff, 0.25)
      .setDepth(5);

    // Spawn queue: current + next are drawn up front so the NEXT
    // preview is always accurate.
    this.currentEntry = rollSpawn(this.economy, this.feel.physics.sizes);
    this.nextEntry = rollSpawn(this.economy, this.feel.physics.sizes);

    this.buildHud();
    this.installDebugHook();
    this.placeSpawner();

    this.matter.world.off(
      'collisionstart',
      this.handleCollisions,
      this,
    );
    this.matter.world.on('collisionstart', this.handleCollisions, this);

    // Tap anywhere below the HUD to drop. Space / Enter also drops.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.paused || !this.spawnerActive) return;
      if (pointer.y < HUD_GUARD_Y) return; // HUD zone: buttons live here.
      this.drop();
    });
    this.input.keyboard?.on('keydown-SPACE', () => this.onDropKey());
    this.input.keyboard?.on('keydown-ENTER', () => this.onDropKey());
    this.input.keyboard?.on('keydown-P', () => this.togglePause());
    this.input.keyboard?.on('keydown-M', () => this.toggleSound());
  }

  update(_time: number, deltaMs: number): void {
    if (this.paused) return;
    const dt = Math.min(deltaMs / 1000, 0.05);

    this.updateCamera(dt);

    if (!this.gameOver) {
      // The countdown runs on accumulated scene time (update deltas),
      // so a backgrounded tab — which runs no updates — cannot drain
      // it. One frame's contribution is clamped so a resume hitch
      // cannot take a bite out of the clock either.
      this.updateTimer(Math.min(deltaMs, 250));
      // Play time for the ranking stats, on the same accumulated
      // clock (pausing cannot inflate it either).
      if (this.timer.started) {
        this.playElapsedMs += Math.min(deltaMs, 250);
      }
    }

    if (this.spawnerActive) {
      this.updateSway(dt);
    }
    if (!this.gameOver) {
      this.updatePending(deltaMs);
    }
    this.refreshHeightReadout();
  }

  // ----- sizes / traits --------------------------------------------------

  /** Physics radius for a size, from game-balance.json. */
  private radiusFor(size: DangoSize): number {
    const spec = this.feel.physics.sizes.find((s) => s.size === size);
    return spec ? spec.radiusPx : 36;
  }

  /**
   * Sprite display diameter for a body radius. The character art fills
   * about 94% of its square texture, so the texture is drawn a little
   * larger than the body for the visible dango to match the physics.
   */
  private displayFor(radius: number): number {
    return Math.round((radius * 2) / 0.94);
  }

  /** Top edge Y of a stacked dango (center minus its own radius). */
  private dangoTop(dango: MatterImage): number {
    const r = (dango.getData('radiusPx') as number | undefined) ?? 36;
    return dango.y - r;
  }

  /** Matter body parameters for a kind: shared baseline + its trait. */
  private bodyParams(kind: DangoKind): BodyParams {
    const phys = this.feel.physics;
    return bodyParamsFor(
      kind,
      {
        ...BASE_BODY_PARAMS,
        friction: phys.friction,
        restitution: phys.restitution,
        frictionAir: phys.frictionAir,
      },
      phys.traits,
    );
  }

  // ----- measured height (v3) ---------------------------------------------

  /**
   * The tower's height right now, in cm, measured from the counter top
   * surface to the top of the highest SETTLED (judged stacked) dango.
   * 0 when nothing is stacked.
   */
  private currentHeightCm(): number {
    let topY = Number.POSITIVE_INFINITY;
    for (const dango of this.stackedDangos) {
      if (!dango.active) continue;
      topY = Math.min(topY, this.dangoTop(dango));
    }
    if (topY === Number.POSITIVE_INFINITY) return 0;
    return heightCmFromPx(
      this.feel.physics.counterTopY - topY,
      this.economy,
    );
  }

  private refreshHeightReadout(): void {
    const cm = this.currentHeightCm();
    if (cm !== this.lastShownCm) {
      this.lastShownCm = cm;
      this.heightText?.setText(`${cm} cm`);
    }
  }

  // ----- timer (v3) --------------------------------------------------------

  private updateTimer(deltaMs: number): void {
    if (!this.timer.started || this.timer.expired) return;
    this.timer = tickTimer(this.timer, deltaMs);
    this.refreshTimerText();
    if (this.timer.expired) {
      this.onTimeUp();
      return;
    }
    // Under 10 seconds the readout turns red and pulses gently.
    const urgent = this.timer.remainingMs < 10_000;
    if (urgent !== this.timerUrgent) {
      this.timerUrgent = urgent;
      this.timerText?.setColor(urgent ? '#d94f5c' : COLOR_TEXT);
      if (urgent && this.timerText && !this.timerPulse) {
        this.timerPulse = this.tweens.add({
          targets: this.timerText,
          scale: 1.14,
          duration: 320,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.inOut',
        });
      }
      if (!urgent && this.timerPulse) {
        // A Matcha bonus lifted the clock back out of the red zone.
        this.timerPulse.stop();
        this.timerPulse = null;
        this.timerText?.setScale(1);
      }
    }
  }

  private refreshTimerText(): void {
    if (!this.timerText) return;
    const remainSec = this.timer.remainingMs / 1000;
    const label =
      remainSec >= 10
        ? `${Math.ceil(remainSec)}s`
        : `${Math.max(0, remainSec).toFixed(1)}s`;
    if (label !== this.timerShownLabel) {
      this.timerShownLabel = label;
      this.timerText.setText(label);
    }
  }

  /** The clock hit zero: lock the input and let in-play dango drain. */
  private onTimeUp(): void {
    if (this.timeUp || this.gameOver) return;
    this.timeUp = true;
    if (this.spawner) {
      this.tweens.killTweensOf(this.spawner);
      this.spawner.destroy();
      this.spawner = null;
    }
    this.spawnerActive = false;
    this.guide?.setVisible(false);
    if (this.timerPulse) {
      this.timerPulse.stop();
      this.timerPulse = null;
    }
    this.timerText?.setScale(1).setColor('#d94f5c');
    this.refreshTimerText();
    this.floatText(
      GAME_WIDTH / 2,
      this.cameras.main.scrollY + 300,
      'TIME UP!',
      '#d94f5c',
      30,
    );
    if (this.pending.length === 0) {
      this.endGame();
    }
  }

  // ----- camera ----------------------------------------------------------

  private updateCamera(dt: number): void {
    const top = this.topmostDango();
    const topY = top
      ? this.dangoTop(top)
      : this.feel.physics.counterTopY;
    const target = Math.min(0, topY - this.feel.cameraTargetTopY);
    this.cameraScroll += (target - this.cameraScroll) * Math.min(1, dt * 5);

    let nudgeOffset = 0;
    if (this.nudgeT >= 0) {
      this.nudgeT += dt;
      const p = this.nudgeT / 0.16;
      if (p >= 1) {
        this.nudgeT = -1;
      } else {
        nudgeOffset = this.nudgeAmp * Math.sin(p * Math.PI) * (1 - p * 0.5);
      }
    }
    this.cameras.main.scrollY = this.cameraScroll + nudgeOffset;
  }

  // ----- sway / drop ---------------------------------------------------

  private swaySpeed(): number {
    const { sway } = this.feel;
    const speed = Math.min(
      sway.baseSpeedRadPerSec +
        this.state.stacked * sway.speedPerStackRadPerSec,
      sway.maxSpeedRadPerSec,
    );
    return this.swaySlowActive ? speed * sway.matchaSlowFactor : speed;
  }

  private swayAmplitude(): number {
    const { sway } = this.feel;
    return Math.min(
      sway.baseAmplitudePx +
        this.state.stacked * sway.amplitudePerStackPx,
      sway.maxAmplitudePx,
    );
  }

  /** Center X of the current tower top (counter center when empty). */
  private referenceX(): number {
    return this.topmostDango()?.x ?? this.feel.physics.platformCenterX;
  }

  private topmostDango(): MatterImage | null {
    let best: MatterImage | null = null;
    for (const dango of this.stackedDangos) {
      if (!dango.active) continue;
      if (!best || dango.y < best.y) best = dango;
    }
    return best;
  }

  private spawnerWorldY(): number {
    return this.cameras.main.scrollY + this.feel.swayY;
  }

  private updateSway(dt: number): void {
    const spawner = this.spawner;
    if (!spawner) return;
    if (this.currentEntry.kind === 'golden') {
      // Golden does not sway: it hovers dead-center over the tower top
      // (the center captured when it appeared).
      this.swayX = this.swayCenterX;
    } else if (this.debugHoldX !== null) {
      this.swayX = this.debugHoldX;
    } else {
      // Pure sine around the frozen spawn center: smooth by
      // construction, and swayAmpEff already guarantees the swing
      // stays on screen, so no per-frame clamp is needed.
      this.swayPhase += this.swaySpeed() * dt;
      this.swayX =
        this.swayCenterX + this.swayAmpEff * Math.sin(this.swayPhase);
    }
    const y = this.spawnerWorldY();
    spawner.setPosition(this.swayX, y);
    if (this.guide) {
      const top = this.topmostDango();
      const bottomY = top
        ? this.dangoTop(top)
        : this.feel.physics.counterTopY;
      const topY =
        y + this.displayFor(this.radiusFor(this.currentEntry.size)) / 2 + 6;
      this.guide
        .setPosition(this.swayX, (topY + bottomY) / 2)
        .setSize(3, Math.max(10, bottomY - topY));
    }
  }

  private onDropKey(): void {
    if (this.paused) return;
    this.drop();
  }

  private drop(): void {
    if (!this.spawnerActive || !this.spawner || this.gameOver || this.timeUp) {
      return;
    }
    // The countdown starts on the player's FIRST drop.
    if (!this.timer.started) {
      this.timer = startTimer(this.timer);
      this.refreshTimerText();
    }
    const entry = this.currentEntry;
    const kind = entry.kind;
    const radius = this.radiusFor(entry.size);
    const display = this.displayFor(radius);
    const x = this.swayX;
    const y = this.spawnerWorldY();
    this.debugHoldX = null;
    this.guide?.setVisible(false);
    this.tweens.killTweensOf(this.spawner);
    this.spawner.destroy();
    this.spawner = null;
    this.spawnerActive = false;

    // The hovering preview becomes a real physics body, wearing the
    // face its size gives it.
    const img = this.matter.add.image(
      x,
      y,
      textureKeyForSpawn(kind, entry.size),
      undefined,
      { label: 'dango' },
    );
    img.setDisplaySize(display, display);
    img.setData('baseScale', img.scaleX);
    img.setData('radiusPx', radius);
    img.setCircle(radius);
    // setCircle replaces the body (and its label) — re-apply ours,
    // the collision handler identifies dango by it.
    (img.body as unknown as MatterBodyLike).label = 'dango';
    const params = this.bodyParams(kind);
    img.setFriction(params.friction);
    img.setFrictionStatic(params.frictionStatic);
    img.setBounce(params.restitution);
    img.setFrictionAir(params.frictionAir);
    img.setDensity(params.density);
    img.setDepth(2);

    this.pending.push({
      img,
      kind,
      radius,
      elapsedMs: 0,
      peakSpeed: 0,
      collided: false,
      ponPlayed: false,
      settleStillMs: 0,
      calmMs: 0,
      angularDampingPerSec: params.angularDampingPerSec,
      size: entry.size,
    });
    sound.drop();

    // Fast-drop pipeline: the next spawner activates on a fixed delay,
    // without waiting for this dango to settle.
    this.time.delayedCall(this.feel.timer.spawnDelayMs, () =>
      this.advanceQueue(),
    );
  }

  // ----- settling & judging (per pending dango) ---------------------------

  private updatePending(deltaMs: number): void {
    for (const p of [...this.pending]) {
      if (!this.updateOnePending(p, deltaMs)) continue;
      this.pending.splice(this.pending.indexOf(p), 1);
      this.resolvePending(p);
      if (this.gameOver) return;
    }
    // Time is up and the last in-play dango has been judged: close.
    if (this.timeUp && this.pending.length === 0) {
      this.endGame();
    }
  }

  /** Advance one in-flight dango; returns true once it has settled. */
  private updateOnePending(p: PendingDango, deltaMs: number): boolean {
    const dango = p.img;
    if (!dango.body) return true;
    const body = dango.body as unknown as MatterBodyLike;
    const phys = this.feel.physics;
    p.elapsedMs += deltaMs;
    p.peakSpeed = Math.max(p.peakSpeed, body.speed);

    // Trait: extra spin damping (yomogi) while the dango is in play.
    if (p.angularDampingPerSec > 0 && body.angularVelocity !== 0) {
      const keep = Math.exp(-p.angularDampingPerSec * (deltaMs / 1000));
      dango.setAngularVelocity(body.angularVelocity * keep);
    }

    // Safety net: somehow fell past the floor — judge it a miss.
    if (dango.y > phys.floorTopY + 200) {
      return true;
    }

    const still = body.speed < phys.settleSpeed && body.angularSpeed < 0.1;
    p.settleStillMs = still ? p.settleStillMs + deltaMs : 0;

    // Matter circles barely feel rolling friction: a dango that landed
    // can keep creeping at a slow roll for seconds. Once it has touched
    // something and stayed slow for a moment, put it to sleep — it is
    // resting, wherever exactly it stopped.
    const calm =
      p.collided && body.speed < phys.calmSpeed && body.angularSpeed < 0.2;
    p.calmMs = calm ? p.calmMs + deltaMs : 0;
    if (p.calmMs >= phys.calmTimeMs && !body.isSleeping) {
      dango.setToSleep();
    }

    const settled =
      body.isSleeping || (p.collided && p.settleStillMs >= phys.settleTimeMs);
    // The hard timeout may only judge a dango that is nearly stopped —
    // never one still falling (slow devices run physics behind the
    // clock). A final failsafe covers bodies that never calm down.
    const timedOut = p.elapsedMs >= phys.resolveTimeoutMs && body.speed < 2;
    const failsafe = p.elapsedMs >= phys.resolveTimeoutMs * 3;
    return settled || timedOut || failsafe;
  }

  private resolvePending(p: PendingDango): void {
    const dango = p.img;
    const kind = p.kind;
    const restX = dango.x;
    const restY = dango.y;
    // Perfect is judged against the topmost SETTLED dango right now.
    const referenceX = this.referenceX();
    const landing = judgeRest(
      {
        restX,
        restY,
        counterTopY: this.feel.physics.counterTopY,
        referenceX,
      },
      this.balance,
    );
    const result = applyResult(
      this.state,
      kind,
      landing,
      this.economy,
      this.balance,
    );
    this.lastJudge = { restX, restY, referenceX, landing };
    this.state = result.state;

    if (landing === 'miss') {
      sound.miss();
      this.floatText(restX, restY - 56, 'Miss!', '#e86a7a');
      this.updateMissDots();
      // The missed dango stops interacting and fades away on the floor.
      const body = dango.body as unknown as MatterBodyLike | null;
      if (body) body.collisionFilter.mask = 0;
      this.tweens.add({
        targets: dango,
        alpha: 0,
        duration: 550,
        ease: 'Quad.easeIn',
        onComplete: () => dango.destroy(),
      });
      if (result.state.over) {
        this.endGame();
      }
      return;
    }

    // Stacked: the dango stays in the world as part of the tower.
    this.stackedDangos.push(dango);
    this.enforceBodyCap();
    // Its own little voice, pitched by its size (v3.2).
    sound.voice(kind, p.size);

    if (landing === 'perfect') {
      sound.perfectCombo(result.state.perfectCombo);
      this.sparkleBurst(restX, restY - p.radius);
      const combo =
        result.state.perfectCombo > 1
          ? `PERFECT x${result.state.perfectCombo}!`
          : 'PERFECT!';
      this.floatText(restX, restY - p.radius - 46, combo, '#e86a7a', 26);
    } else if (!p.ponPlayed) {
      // A feather-light landing that never made a sound gets one now.
      sound.land();
    }
    this.floatText(
      restX,
      restY - p.radius - 16,
      `+${result.earnedDG} ${CURRENCY}`,
      '#5a8a4a',
      24,
    );
    if (kind === 'matcha') {
      this.slowDropsLeft = this.feel.sway.matchaSlowDrops;
      this.floatText(
        GAME_WIDTH / 2,
        this.cameras.main.scrollY + 250,
        'Matcha Time! The sway slows down.',
        '#5a8a4a',
        19,
      );
      // v3: a stacked Matcha also buys time — while the clock runs.
      const bonusSeconds = this.feel.timer.matchaBonusSeconds;
      const beforeMs = this.timer.remainingMs;
      this.timer = addTimerBonus(this.timer, bonusSeconds);
      if (this.timer.remainingMs > beforeMs) {
        this.timerBonusTotalMs += this.timer.remainingMs - beforeMs;
        sound.timeBonus();
        this.floatText(
          GAME_WIDTH / 2,
          this.cameras.main.scrollY + 128,
          `+${bonusSeconds}s`,
          '#5a8a4a',
          26,
        );
        this.refreshTimerText();
      }
    }
    if (kind === 'golden') {
      this.goldenStacked += 1;
      this.floatText(restX, restY - p.radius - 80, 'GOLDEN!', '#c89b00', 26);
    }
    this.updateHud();
  }

  /** The previewed NEXT dango becomes current; a new next is drawn. */
  private advanceQueue(): void {
    if (this.gameOver) return;
    this.currentEntry = this.nextEntry;
    this.nextEntry = rollSpawn(this.economy, this.feel.physics.sizes);
    this.refreshNextPanel();
    this.placeSpawner();
  }

  /** Show the hovering preview for the current queue entry. */
  private placeSpawner(): void {
    if (this.gameOver || this.timeUp) return;
    if (this.spawner) {
      this.tweens.killTweensOf(this.spawner);
      this.spawner.destroy();
      this.spawner = null;
    }
    // Matcha Time bookkeeping: exactly the next `matchaSlowDrops`
    // spawns sway slowly.
    this.swaySlowActive = this.slowDropsLeft > 0;
    if (this.swaySlowActive) this.slowDropsLeft -= 1;

    const display = this.displayFor(this.radiusFor(this.currentEntry.size));
    // Freeze the sway geometry for this dango (see swayCenterX note):
    // center = the tower top's X right now, kept at least 40px of
    // swing room from each screen edge; amplitude shrunk to fit, so
    // the motion is one clean sine from spawn to drop. Phase restarts
    // at 0, so the dango appears exactly at its center — no jump.
    const amplitude = this.swayAmplitude();
    const center = Phaser.Math.Clamp(
      this.referenceX(),
      86,
      GAME_WIDTH - 86,
    );
    this.swayCenterX = center;
    this.swayAmpEff = Math.min(
      amplitude,
      center - 46,
      GAME_WIDTH - 46 - center,
    );
    this.swayPhase = 0;
    this.swayX = center;
    const spawner = this.add
      .image(
        this.swayX,
        this.spawnerWorldY(),
        textureKeyForSpawn(this.currentEntry.kind, this.currentEntry.size),
      )
      .setDisplaySize(display, display)
      .setDepth(10);
    this.spawner = spawner;
    this.spawnerActive = true;
    if (this.currentEntry.kind === 'golden') {
      // A gentle pulse so the rare guest is impossible to miss.
      const base = spawner.scaleX;
      this.tweens.add({
        targets: spawner,
        scaleX: base * 1.1,
        scaleY: base * 1.1,
        duration: 480,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      });
    }
    this.guide?.setVisible(true);
  }

  /** Sync the NEXT panel with the queue's upcoming entry. */
  private refreshNextPanel(): void {
    if (!this.nextImage) return;
    const display =
      this.displayFor(this.radiusFor(this.nextEntry.size)) *
      NEXT_PREVIEW_SCALE;
    this.nextImage
      .setTexture(
        textureKeyForSpawn(this.nextEntry.kind, this.nextEntry.size),
      )
      .setDisplaySize(display, display);
  }

  private endGame(): void {
    if (this.gameOver) return;
    this.gameOver = true;
    sound.gameOver();
    // Final Height Bonus: the measured height, paid once at closing.
    const heightCm = this.currentHeightCm();
    const heightBonusDG = finalHeightBonus(heightCm, this.economy);
    const totalDG = this.state.totalDG + heightBonusDG;
    const { best, isNewRecord } = saveBest(
      totalDG,
      heightCm,
      this.state.stacked,
    );
    // Ranking submission (the Dango Drop way, ADR-0013): fired
    // WITHOUT awaiting — the result screen opens immediately and the
    // rank is filled in when the reply arrives. Offline or disabled,
    // the promise still resolves with the local best inside.
    const submission = isRankingEnabled()
      ? leaderboard.submitScore(
          totalDG,
          buildScoreStats(
            {
              stacked: this.state.stacked,
              heightCm,
              goldenCount: this.goldenStacked,
            },
            toDurationSec(this.playElapsedMs),
          ),
        )
      : undefined;
    const data: ResultData = {
      dg: totalDG,
      heightBonusDG,
      stacked: this.state.stacked,
      heightCm,
      bestDG: best.bestDG,
      bestHeight: best.bestHeight,
      bestStacked: best.bestStacked,
      isNewRecord,
      submission,
    };
    this.lastResult = data;
    this.time.delayedCall(900, () => {
      this.scene.start('ResultScene', data);
    });
  }

  /** Keep tall towers stable: bury the deepest dango as static bodies. */
  private enforceBodyCap(): void {
    let dynamic = this.stackedDangos.filter(
      (d) => d.active && d.body && !(d.body as unknown as MatterBodyLike).isStatic,
    );
    while (dynamic.length > MAX_DYNAMIC_DANGO) {
      // The bottom-most (largest y) dynamic dango is fully supported;
      // freezing it changes nothing the eye can see.
      dynamic.sort((a, b) => b.y - a.y);
      const victim = dynamic.shift();
      if (!victim) break;
      victim.setStatic(true);
    }
  }

  // ----- collisions: sound, squash, nudge --------------------------------

  private handleCollisions(event: CollisionStartLike): void {
    this.collisionEventsSeen += 1;
    for (const pair of event.pairs) {
      if (!this.lastPairInfo) {
        const fmt = (b: MatterBodyLike) =>
          `${b.label}/${b.gameObject ? b.gameObject.type : 'null'}`;
        this.lastPairInfo = `${fmt(pair.bodyA)} | ${fmt(pair.bodyB)}`;
      }
      const bodies = [pair.bodyA, pair.bodyB];
      for (const body of bodies) {
        if (body.label !== 'dango') continue;
        const obj = body.gameObject;
        if (!obj || !(obj instanceof Phaser.Physics.Matter.Image)) continue;
        const img = obj;
        const record = this.pending.find((p) => p.img === img);
        if (record) {
          if (!record.collided) {
            record.collided = true;
            const impact = Math.max(record.peakSpeed, body.speed);
            if (impact >= 1.6) {
              sound.pon(impact);
              record.ponPlayed = true;
            }
            if (impact >= 4) this.squash(img, impact);
            if (impact >= 11) {
              this.nudgeAmp = Math.min(7, 2.5 + (impact - 11) * 0.5);
              this.nudgeT = 0;
            }
          } else if (body.speed >= 4) {
            this.squash(img, body.speed);
          }
        } else if (body.speed >= 3) {
          // Tower dango shifting under a hit: a small squash, no sound.
          this.squash(img, body.speed * 0.7);
        }
      }
    }
  }

  /** Brief squash-and-stretch, sized by impact and capped. Display only —
   *  the physics body keeps its true circle. */
  private squash(img: MatterImage, strength: number): void {
    const now = this.time.now;
    if (now - (this.squashAt.get(img.body as object) ?? 0) < 160) return;
    this.squashAt.set(img.body as object, now);
    const base = (img.getData('baseScale') as number | undefined) ?? img.scaleX;
    const s = Math.min(1, strength / 16);
    this.tweens.killTweensOf(img);
    img.setScale(base * (1 + 0.22 * s), base * (1 - 0.3 * s));
    this.tweens.add({
      targets: img,
      scaleX: base,
      scaleY: base,
      duration: 170,
      ease: 'Back.easeOut',
    });
  }

  private makeSparkleTexture(): void {
    if (this.textures.exists('sparkle')) return;
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(8, 8, 6);
    g.fillStyle(0xffffff, 0.5);
    g.fillCircle(8, 8, 8);
    g.generateTexture('sparkle', 16, 16);
    g.destroy();
  }

  private sparkleBurst(x: number, y: number): void {
    const emitter = this.add.particles(x, y, 'sparkle', {
      speed: { min: 40, max: 170 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 300, max: 600 },
      scale: { start: 1, end: 0 },
      tint: [0xf5c542, 0xe86a7a, 0x8fbf7f, 0xffffff],
      gravityY: 120,
      emitting: false,
    });
    emitter.setDepth(15);
    emitter.explode(16);
    this.time.delayedCall(800, () => emitter.destroy());
  }

  // ----- HUD --------------------------------------------------------------

  private buildHud(): void {
    // Soft panels behind the HUD clusters (the art is busy up top).
    addSoftPanel(this, 88, HUD_TOP + 22, 176, 62, 0.55)
      .setScrollFactor(0)
      .setDepth(19);
    // Center cluster (v3): height on the first line, the countdown
    // under it — the two numbers the player steers by.
    addSoftPanel(this, GAME_WIDTH / 2, HUD_TOP + 36, 168, 96, 0.55)
      .setScrollFactor(0)
      .setDepth(19);
    addSoftPanel(this, 452, HUD_TOP + 44, 184, 128, 0.55)
      .setScrollFactor(0)
      .setDepth(19);

    // NEXT panel (left column, under the DG panel): the upcoming
    // dango's kind AND its true relative size, so drops can be planned.
    addSoftPanel(this, 54, HUD_TOP + 112, 96, 110, 0.55)
      .setScrollFactor(0)
      .setDepth(19);
    this.add
      .text(54, HUD_TOP + 66, 'NEXT', {
        fontFamily: '"Zen Maru Gothic", sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color: COLOR_TEXT,
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(20);
    this.nextImage = this.add
      .image(54, HUD_TOP + 122, this.nextEntry.kind)
      .setScrollFactor(0)
      .setDepth(20);
    this.refreshNextPanel();

    this.dgText = this.add
      .text(16, HUD_TOP, `0 ${CURRENCY}`, {
        fontFamily: '"Mochiy Pop One", "Zen Maru Gothic", sans-serif',
        fontSize: '30px',
        color: COLOR_TEXT,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(20);
    this.heightText = this.add
      .text(GAME_WIDTH / 2, HUD_TOP + 2, '0 cm', {
        fontFamily: '"Zen Maru Gothic", sans-serif',
        fontSize: '20px',
        fontStyle: 'bold',
        color: COLOR_TEXT,
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(20);
    this.timerText = this.add
      .text(GAME_WIDTH / 2, HUD_TOP + 34, '', {
        fontFamily: '"Mochiy Pop One", "Zen Maru Gothic", sans-serif',
        fontSize: '27px',
        color: COLOR_TEXT,
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(20);
    this.refreshTimerText();

    // Miss dots (3): filled while a miss is still allowed.
    for (let i = 0; i < 3; i++) {
      const dot = this.add
        .circle(420 + i * 22, HUD_TOP + 72, 7, 0xe86a7a, 1)
        .setScrollFactor(0)
        .setDepth(20);
      this.missDots.push(dot);
    }
    this.add
      .text(478, HUD_TOP + 64, 'MISS', {
        fontFamily: '"Zen Maru Gothic", sans-serif',
        fontSize: '14px',
        fontStyle: 'bold',
        color: COLOR_TEXT,
      })
      .setOrigin(0, 0)
      .setDepth(20);

    const soundButton = makeIconButton(
      this,
      GAME_WIDTH - 36,
      HUD_TOP + 24,
      sound.isMuted ? 'OFF' : 'ON',
      () => this.toggleSound(),
    );
    soundButton.setScrollFactor(0).setDepth(20);
    this.soundText = soundButton.getAt(1) as Phaser.GameObjects.Text;

    const pauseButton = makeIconButton(
      this,
      GAME_WIDTH - 92,
      HUD_TOP + 24,
      'II',
      () => this.togglePause(),
    );
    pauseButton.setScrollFactor(0).setDepth(20);

    // Pause overlay (hidden until paused).
    this.pauseOverlay = this.add
      .container(0, 0)
      .setScrollFactor(0)
      .setDepth(50)
      .setVisible(false);
    const dim = this.add.rectangle(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
      GAME_WIDTH,
      GAME_HEIGHT,
      0x000000,
      0.45,
    );
    const panel = this.add.rectangle(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
      380,
      300,
      0xfff7e6,
      1,
    );
    panel.setStrokeStyle(3, 0xc89b6a);
    const title = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 90, 'PAUSED', {
        fontFamily: '"Mochiy Pop One", "Zen Maru Gothic", sans-serif',
        fontSize: '40px',
        color: COLOR_TEXT,
      })
      .setOrigin(0.5);
    this.pauseOverlay.add([dim, panel, title]);
    // Buttons are added to the scene (not the overlay) so their input
    // still works while the overlay dims the game.
    const resume = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 10, 'RESUME', {
        fontFamily: '"Mochiy Pop One", "Zen Maru Gothic", sans-serif',
        fontSize: '26px',
        color: '#ffffff',
        backgroundColor: '#f6a8b8',
        padding: { x: 36, y: 12 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(51)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });
    resume.on('pointerup', () => this.togglePause());
    const quit = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 70, 'QUIT TO TITLE', {
        fontFamily: '"Mochiy Pop One", "Zen Maru Gothic", sans-serif',
        fontSize: '20px',
        color: '#ffffff',
        backgroundColor: '#c89b6a',
        padding: { x: 24, y: 10 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(51)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });
    quit.on('pointerup', () => this.scene.start('TitleScene'));
    this.pauseOverlay.setData('resumeButton', resume);
    this.pauseOverlay.setData('quitButton', quit);
  }

  private updateHud(): void {
    this.dgText?.setText(`${this.state.totalDG} ${CURRENCY}`);
    this.refreshHeightReadout();
  }

  private updateMissDots(): void {
    this.missDots.forEach((dot, i) => {
      const used = i < this.state.misses;
      dot.setFillStyle(used ? 0xd8cbb2 : 0xe86a7a, 1);
    });
  }

  private toggleSound(): void {
    const muted = sound.toggleMuted();
    this.soundText?.setText(muted ? 'OFF' : 'ON');
  }

  private togglePause(): void {
    if (this.gameOver) return;
    this.paused = !this.paused;
    if (this.paused) {
      this.matter.world.pause();
      this.tweens.pauseAll();
      this.time.paused = true;
    } else {
      this.matter.world.resume();
      this.tweens.resumeAll();
      this.time.paused = false;
    }
    this.pauseOverlay?.setVisible(this.paused);
    const resume = this.pauseOverlay?.getData(
      'resumeButton',
    ) as Phaser.GameObjects.Text | undefined;
    const quit = this.pauseOverlay?.getData(
      'quitButton',
    ) as Phaser.GameObjects.Text | undefined;
    resume?.setVisible(this.paused);
    quit?.setVisible(this.paused);
  }

  private floatText(
    x: number,
    y: number,
    message: string,
    color: string,
    fontSize = 22,
  ): void {
    const text = this.add
      .text(x, y, message, {
        fontFamily: '"Mochiy Pop One", "Zen Maru Gothic", sans-serif',
        fontSize: `${fontSize}px`,
        color,
        stroke: '#fff7e6',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(30);
    this.tweens.add({
      targets: text,
      y: y - 44,
      alpha: 0,
      duration: 900,
      ease: 'Sine.easeOut',
      onComplete: () => text.destroy(),
    });
  }

  // ----- debug / playtest hook -------------------------------------------

  private phaseNow(): Phase {
    if (this.gameOver) return 'over';
    if (this.spawnerActive) return 'swaying';
    if (this.pending.length > 0) return 'dropping';
    return 'waiting';
  }

  private installDebugHook(): void {
    const api: DangoTowerDebug = {
      getState: () => ({
        scene: GAME_SCENE_KEY,
        phase: this.phaseNow(),
        stacked: this.state.stacked,
        misses: this.state.misses,
        totalDG: this.state.totalDG,
        perfectCombo: this.state.perfectCombo,
        over: this.gameOver,
        bodies: this.stackedDangos.length + this.pending.length,
        referenceX: this.referenceX(),
        spawnerKind: this.spawnerActive ? this.currentEntry.kind : null,
        spawnerSize: this.spawnerActive ? this.currentEntry.size : null,
        spawnerTexture: this.spawner?.texture.key ?? null,
        nextKind: this.nextEntry.kind,
        nextSize: this.nextEntry.size,
        nextTexture: this.nextImage?.texture.key ?? this.nextEntry.kind,
        // The camera manager is gone once the scene has shut down
        // (result transition) — the debug hook must stay safe to call.
        cameraScrollY: this.cameras?.main?.scrollY ?? this.cameraScroll,
        heightCm: this.currentHeightCm(),
        timeLeftSec: this.timer.remainingMs / 1000,
        timerStarted: this.timer.started,
        timerExpired: this.timer.expired,
        timerBonusMs: this.timerBonusTotalMs,
        pendingCount: this.pending.length,
      }),
      drop: () => {
        if (!this.spawnerActive || this.paused) return false;
        this.drop();
        return true;
      },
      dropAt: (x: number) => {
        if (!this.spawnerActive || this.paused) return false;
        this.debugHoldX = x;
        this.swayX = x;
        this.drop();
        return true;
      },
      setNextKind: (kind: DangoKind) => {
        // Rewrite the previewed entry so the NEXT panel stays truthful.
        this.nextEntry = { ...this.nextEntry, kind };
        this.refreshNextPanel();
      },
      setNextSize: (size: DangoSize) => {
        this.nextEntry = { ...this.nextEntry, size };
        this.refreshNextPanel();
      },
      forceTimeLeft: (seconds: number) => {
        if (!this.timer.started) {
          this.timer = startTimer(this.timer);
        }
        const remainingMs = Math.max(0, seconds * 1000);
        this.timer = {
          ...this.timer,
          remainingMs,
          expired: remainingMs <= 0,
        };
        this.refreshTimerText();
        if (this.timer.expired) {
          this.onTimeUp();
        }
      },
      getActive: () => {
        const p = this.pending[0];
        if (!p) return null;
        const body = p.img.body as unknown as MatterBodyLike | null;
        return { x: p.img.x, y: p.img.y, speed: body?.speed ?? 0 };
      },
      getInternals: () => {
        const p = this.pending[0];
        if (!p) return null;
        const body = p.img.body as unknown as MatterBodyLike | null;
        if (!body) return null;
        return {
          collided: p.collided,
          collisionEventsSeen: this.collisionEventsSeen,
          lastPairInfo: this.lastPairInfo,
          settleStillMs: p.settleStillMs,
          calmMs: p.calmMs,
          elapsedMs: p.elapsedMs,
          speed: body.speed,
          angularSpeed: body.angularSpeed,
          sleeping: body.isSleeping,
        };
      },
      getLastJudge: () => this.lastJudge,
      getLastResult: () => this.lastResult,
    };
    (window as unknown as { __dangoTower?: DangoTowerDebug }).__dangoTower =
      api;
  }
}

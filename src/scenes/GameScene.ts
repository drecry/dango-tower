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
 * The background illustration is anchored to the world: the shop
 * counter in the art IS the physics platform, and as the tower grows
 * the camera pans up into the plain sky above the art.
 *
 * The play area fills the whole phone screen: only a slim HUD sits on
 * top (DG, height, misses, sound, pause), pinned to the camera.
 * Rules and introductions live on their own screens.
 */
import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/dimensions';
import { BACKGROUND_KEY, SKY_FILL_COLOR } from '../constants/assets';
import type { DangoKind } from '../constants/assets';
import {
  applyResult,
  initialState,
  judgeRest,
  rollSpawn,
  towerHeightCm,
  type DangoSize,
  type Economy,
  type SpawnEntry,
  type TowerState,
} from '../logic/tower';
import { saveBest } from '../logic/storage';
import {
  CURRENCY,
  loadBalance,
  loadEconomy,
  loadFeel,
} from '../systems/EconomyConfig';
import { sound } from '../systems/sound';
import { COLOR_TEXT, addSoftPanel, makeIconButton } from './ui';

export const GAME_SCENE_KEY = 'GameScene';

type Phase = 'swaying' | 'dropping' | 'waiting' | 'over';
type MatterImage = Phaser.Physics.Matter.Image;

/** Minimal structural view of a Matter body (avoids MatterJS type noise). */
interface MatterBodyLike {
  label: string;
  speed: number;
  angularSpeed: number;
  isSleeping: boolean;
  isStatic: boolean;
  position: { x: number; y: number };
  collisionFilter: { mask: number };
  gameObject: Phaser.GameObjects.GameObject | null;
}

interface CollisionStartLike {
  pairs: { bodyA: MatterBodyLike; bodyB: MatterBodyLike }[];
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
    nextKind: DangoKind;
    nextSize: DangoSize;
    cameraScrollY: number;
  };
  drop: () => boolean;
  dropAt: (x: number) => boolean;
  setNextKind: (kind: DangoKind) => void;
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
  private phase: Phase = 'swaying';
  private paused = false;

  private spawner: Phaser.GameObjects.Image | null = null;
  /** Spawn queue, always 2 deep: current (hovering) + next (preview). */
  private currentEntry: SpawnEntry = { kind: 'shiratama', size: 'medium' };
  private nextEntry: SpawnEntry = { kind: 'shiratama', size: 'medium' };
  private nextImage: Phaser.GameObjects.Image | null = null;
  private guide: Phaser.GameObjects.Rectangle | null = null;

  private activeDango: MatterImage | null = null;
  private activeKind: DangoKind = 'shiratama';
  private activeRadius = 36;
  private lastJudge: {
    restX: number;
    restY: number;
    referenceX: number;
    landing: string;
  } | null = null;
  private activeReferenceX = GAME_WIDTH / 2;
  /** Ms since the drop, accumulated from update deltas (pause-safe). */
  private activeElapsedMs = 0;
  private activePeakSpeed = 0;
  private activeCollided = false;
  private activePonPlayed = false;
  private settleStillMs = 0;
  /** Ms the active dango has spent slow but not still (rolling creep). */
  private calmMs = 0;
  /** Diagnostics for the playtest hook. */
  private collisionEventsSeen = 0;
  private lastPairInfo: string | null = null;

  private stackedDangos: MatterImage[] = [];
  private swayPhase = 0;
  private swayX = GAME_WIDTH / 2;
  private slowDropsLeft = 0;
  private swaySlowActive = false;
  private debugHoldX: number | null = null;

  private cameraScroll = 0;
  private nudgeAmp = 0;
  private nudgeT = -1;
  private squashAt = new Map<object, number>();

  private dgText: Phaser.GameObjects.Text | null = null;
  private heightText: Phaser.GameObjects.Text | null = null;
  private missDots: Phaser.GameObjects.Arc[] = [];
  private pauseOverlay: Phaser.GameObjects.Container | null = null;
  private soundText: Phaser.GameObjects.Text | null = null;

  constructor() {
    super(GAME_SCENE_KEY);
  }

  create(): void {
    this.economy = loadEconomy();
    this.balance = loadBalance();
    this.feel = loadFeel();
    this.state = initialState();
    this.phase = 'swaying';
    this.paused = false;
    this.stackedDangos = [];
    this.swayPhase = 0;
    this.slowDropsLeft = 0;
    this.debugHoldX = null;
    this.cameraScroll = 0;
    this.nudgeT = -1;
    this.missDots = [];
    this.squashAt.clear();

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
      if (this.paused || this.phase !== 'swaying') return;
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

    if (this.phase === 'swaying') {
      this.updateSway(dt);
    } else if (this.phase === 'dropping') {
      this.updateSettle(deltaMs);
    }
  }

  // ----- sizes -----------------------------------------------------------

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
      // Golden does not sway: it hovers dead-center over the tower top.
      this.swayX = this.referenceX();
    } else if (this.debugHoldX !== null) {
      this.swayX = this.debugHoldX;
    } else {
      this.swayPhase += this.swaySpeed() * dt;
      const center = this.referenceX();
      const raw = center + this.swayAmplitude() * Math.sin(this.swayPhase);
      this.swayX = Phaser.Math.Clamp(raw, 46, GAME_WIDTH - 46);
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
    if (this.paused || this.phase !== 'swaying') return;
    this.drop();
  }

  private drop(): void {
    if (this.phase !== 'swaying' || !this.spawner) return;
    const phys = this.feel.physics;
    const kind = this.currentEntry.kind;
    const radius = this.radiusFor(this.currentEntry.size);
    const display = this.displayFor(radius);
    const x = this.swayX;
    const y = this.spawnerWorldY();
    this.debugHoldX = null;
    this.guide?.setVisible(false);
    if (this.spawner) {
      this.tweens.killTweensOf(this.spawner);
      this.spawner.destroy();
      this.spawner = null;
    }

    // The hovering preview becomes a real physics body.
    const img = this.matter.add.image(x, y, kind, undefined, {
      label: 'dango',
    });
    img.setDisplaySize(display, display);
    img.setData('baseScale', img.scaleX);
    img.setData('radiusPx', radius);
    img.setCircle(radius);
    // setCircle replaces the body (and its label) — re-apply ours,
    // the collision handler identifies dango by it.
    (img.body as unknown as MatterBodyLike).label = 'dango';
    img.setFriction(kind === 'golden' ? phys.goldenFriction : phys.friction);
    img.setBounce(kind === 'golden' ? phys.goldenRestitution : phys.restitution);
    img.setFrictionAir(phys.frictionAir);
    img.setDepth(2);

    this.activeDango = img;
    this.activeKind = kind;
    this.activeRadius = radius;
    this.activeReferenceX = this.referenceX();
    this.activeElapsedMs = 0;
    this.activePeakSpeed = 0;
    this.activeCollided = false;
    this.activePonPlayed = false;
    this.settleStillMs = 0;
    this.calmMs = 0;
    this.phase = 'dropping';
    sound.drop();
  }

  // ----- settling & judging ---------------------------------------------

  private updateSettle(deltaMs: number): void {
    const dango = this.activeDango;
    if (!dango || !dango.body) return;
    const body = dango.body as unknown as MatterBodyLike;
    const phys = this.feel.physics;
    this.activeElapsedMs += deltaMs;
    this.activePeakSpeed = Math.max(this.activePeakSpeed, body.speed);

    // Safety net: somehow fell past the floor — judge it a miss.
    if (dango.y > phys.floorTopY + 200) {
      this.resolveDrop();
      return;
    }

    const still =
      body.speed < phys.settleSpeed && body.angularSpeed < 0.1;
    this.settleStillMs = still ? this.settleStillMs + deltaMs : 0;

    // Matter circles barely feel rolling friction: a dango that landed
    // can keep creeping at a slow roll for seconds. Once it has touched
    // something and stayed slow for a moment, put it to sleep — it is
    // resting, wherever exactly it stopped.
    const calm =
      this.activeCollided &&
      body.speed < phys.calmSpeed &&
      body.angularSpeed < 0.2;
    this.calmMs = calm ? this.calmMs + deltaMs : 0;
    if (this.calmMs >= phys.calmTimeMs && !body.isSleeping) {
      dango.setToSleep();
    }

    const settled =
      body.isSleeping ||
      (this.activeCollided && this.settleStillMs >= phys.settleTimeMs);
    // The hard timeout may only judge a dango that is nearly stopped —
    // never one still falling (slow devices run physics behind the
    // clock). A final failsafe covers bodies that never calm down.
    const timedOut =
      this.activeElapsedMs >= phys.resolveTimeoutMs && body.speed < 2;
    const failsafe = this.activeElapsedMs >= phys.resolveTimeoutMs * 3;
    if (settled || timedOut || failsafe) {
      this.resolveDrop();
    }
  }

  private resolveDrop(): void {
    const dango = this.activeDango;
    if (!dango) return;
    this.phase = 'waiting';
    const kind = this.activeKind;
    const restX = dango.x;
    const restY = dango.y;
    const landing = judgeRest(
      {
        restX,
        restY,
        counterTopY: this.feel.physics.counterTopY,
        referenceX: this.activeReferenceX,
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
    this.lastJudge = {
      restX,
      restY,
      referenceX: this.activeReferenceX,
      landing,
    };
    this.state = result.state;
    this.activeDango = null;

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
      } else {
        this.time.delayedCall(560, () => this.advanceQueue());
      }
      return;
    }

    // Stacked: the dango stays in the world as part of the tower.
    this.stackedDangos.push(dango);
    this.enforceBodyCap();

    if (landing === 'perfect') {
      sound.perfectCombo(result.state.perfectCombo);
      this.sparkleBurst(restX, restY - this.activeRadius);
      const combo =
        result.state.perfectCombo > 1
          ? `PERFECT x${result.state.perfectCombo}!`
          : 'PERFECT!';
      this.floatText(restX, restY - this.activeRadius - 46, combo, '#e86a7a', 26);
    } else if (!this.activePonPlayed) {
      // A feather-light landing that never made a sound gets one now.
      sound.land();
    }
    this.floatText(
      restX,
      restY - this.activeRadius - 16,
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
    }
    if (kind === 'golden') {
      this.floatText(restX, restY - this.activeRadius - 80, 'GOLDEN!', '#c89b00', 26);
    }
    this.updateHud();
    this.time.delayedCall(430, () => this.advanceQueue());
  }

  /** The previewed NEXT dango becomes current; a new next is drawn. */
  private advanceQueue(): void {
    if (this.phase === 'over') return;
    this.currentEntry = this.nextEntry;
    this.nextEntry = rollSpawn(this.economy, this.feel.physics.sizes);
    this.refreshNextPanel();
    this.placeSpawner();
  }

  /** Show the hovering preview for the current queue entry. */
  private placeSpawner(): void {
    if (this.phase === 'over') return;
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
    this.swayX = this.referenceX();
    const spawner = this.add
      .image(this.swayX, this.spawnerWorldY(), this.currentEntry.kind)
      .setDisplaySize(display, display)
      .setDepth(10);
    this.spawner = spawner;
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
    this.phase = 'swaying';
  }

  /** Sync the NEXT panel with the queue's upcoming entry. */
  private refreshNextPanel(): void {
    if (!this.nextImage) return;
    const display =
      this.displayFor(this.radiusFor(this.nextEntry.size)) *
      NEXT_PREVIEW_SCALE;
    this.nextImage
      .setTexture(this.nextEntry.kind)
      .setDisplaySize(display, display);
  }

  private endGame(): void {
    this.phase = 'over';
    sound.gameOver();
    const dg = this.state.totalDG;
    const heightCm = towerHeightCm(this.state.stacked, this.economy);
    const { best, isNewRecord } = saveBest(dg, heightCm, this.state.stacked);
    this.time.delayedCall(900, () => {
      this.scene.start('ResultScene', {
        dg,
        stacked: this.state.stacked,
        heightCm,
        bestDG: best.bestDG,
        bestHeight: best.bestHeight,
        bestStacked: best.bestStacked,
        isNewRecord,
      });
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
        if (this.activeDango && img === this.activeDango) {
          if (!this.activeCollided) {
            this.activeCollided = true;
            const impact = Math.max(this.activePeakSpeed, body.speed);
            if (impact >= 1.6) {
              sound.pon(impact);
              this.activePonPlayed = true;
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
    addSoftPanel(this, GAME_WIDTH / 2, HUD_TOP + 18, 148, 54, 0.55)
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
      .text(GAME_WIDTH / 2, HUD_TOP + 6, '0 cm', {
        fontFamily: '"Zen Maru Gothic", sans-serif',
        fontSize: '20px',
        fontStyle: 'bold',
        color: COLOR_TEXT,
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(20);

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
      .setScrollFactor(0)
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
    this.heightText?.setText(
      `${towerHeightCm(this.state.stacked, this.economy)} cm`,
    );
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
    if (this.phase === 'over') return;
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

  private installDebugHook(): void {
    const api: DangoTowerDebug = {
      getState: () => ({
        scene: GAME_SCENE_KEY,
        phase: this.phase,
        stacked: this.state.stacked,
        misses: this.state.misses,
        totalDG: this.state.totalDG,
        perfectCombo: this.state.perfectCombo,
        over: this.state.over,
        bodies: this.stackedDangos.length + (this.activeDango ? 1 : 0),
        referenceX: this.referenceX(),
        spawnerKind: this.phase === 'swaying' ? this.currentEntry.kind : null,
        spawnerSize: this.phase === 'swaying' ? this.currentEntry.size : null,
        nextKind: this.nextEntry.kind,
        nextSize: this.nextEntry.size,
        // The camera manager is gone once the scene has shut down
        // (result transition) — the debug hook must stay safe to call.
        cameraScrollY: this.cameras?.main?.scrollY ?? this.cameraScroll,
      }),
      drop: () => {
        if (this.phase !== 'swaying' || this.paused) return false;
        this.drop();
        return true;
      },
      dropAt: (x: number) => {
        if (this.phase !== 'swaying' || this.paused) return false;
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
      getActive: () => {
        if (!this.activeDango) return null;
        const body = this.activeDango.body as unknown as MatterBodyLike | null;
        return {
          x: this.activeDango.x,
          y: this.activeDango.y,
          speed: body?.speed ?? 0,
        };
      },
      getInternals: () => {
        if (!this.activeDango) return null;
        const body = this.activeDango.body as unknown as MatterBodyLike | null;
        if (!body) return null;
        return {
          collided: this.activeCollided,
          collisionEventsSeen: this.collisionEventsSeen,
          lastPairInfo: this.lastPairInfo,
          settleStillMs: this.settleStillMs,
          calmMs: this.calmMs,
          elapsedMs: this.activeElapsedMs,
          speed: body.speed,
          angularSpeed: body.angularSpeed,
          sleeping: body.isSleeping,
        };
      },
      getLastJudge: () => this.lastJudge,
    };
    (window as unknown as { __dangoTower?: DangoTowerDebug }).__dangoTower =
      api;
  }
}

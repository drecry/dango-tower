/**
 * Game scene (Dango Tower) — the full-screen play area.
 *
 * A dango swings above the plate. Tap (or Space) to drop it. It falls
 * straight down and lands on the tower — or misses it. Perfect center
 * drops earn bonus DG and build a combo. Three misses end the game.
 * The camera rises as the tower grows so the top stays in view.
 *
 * The play area fills the whole phone screen: only a slim HUD sits on
 * top (DG, height, misses, sound, pause). Rules and introductions live
 * on their own screens (Title -> How to Play / Meet the Dango).
 *
 * All rules (landing windows, DG, drop rates) come from the pure logic
 * in src/logic/tower.ts and the JSON configs — this scene only renders.
 */
import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/dimensions';
import type { DangoKind } from '../constants/assets';
import {
  applyDrop,
  initialState,
  rollNextKind,
  towerHeightCm,
  type Economy,
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
import { COLOR_TEXT, makeIconButton } from './ui';

export const GAME_SCENE_KEY = 'GameScene';

type Phase = 'swaying' | 'falling' | 'resolving' | 'over';

const DANGO_SIZE = 64;
const HUD_TOP = 20;

export class GameScene extends Phaser.Scene {
  private economy: Economy = loadEconomy();
  private feel = loadFeel();
  private state: TowerState = initialState(GAME_WIDTH / 2);
  private phase: Phase = 'swaying';
  private paused = false;

  private world: Phaser.GameObjects.Container | null = null;
  private current: Phaser.GameObjects.Image | null = null;
  private currentKind: DangoKind = 'shiratama';
  private guide: Phaser.GameObjects.Rectangle | null = null;
  private dgText: Phaser.GameObjects.Text | null = null;
  private heightText: Phaser.GameObjects.Text | null = null;
  private missDots: Phaser.GameObjects.Arc[] = [];
  private pauseOverlay: Phaser.GameObjects.Container | null = null;
  private soundText: Phaser.GameObjects.Text | null = null;

  private swayPhase = 0;
  private fallVy = 0;
  private slowDropsLeft = 0;
  private swayX = GAME_WIDTH / 2;

  constructor() {
    super(GAME_SCENE_KEY);
  }

  create(): void {
    this.economy = loadEconomy();
    this.feel = loadFeel();
    this.state = initialState(GAME_WIDTH / 2);
    this.phase = 'swaying';
    this.paused = false;
    this.swayPhase = 0;
    this.slowDropsLeft = 0;
    this.missDots = [];

    // World container: plate + stacked dango. It slides down as the
    // tower grows so the top stays near the camera target line.
    this.world = this.add.container(0, 0);
    const plate = this.add.ellipse(
      GAME_WIDTH / 2,
      this.feel.platformTopY + 8,
      230,
      26,
      0xc89b6a,
    );
    const plateRim = this.add.ellipse(
      GAME_WIDTH / 2,
      this.feel.platformTopY + 2,
      230,
      22,
      0xe0aa7a,
    );
    this.world.add([plateRim, plate]);

    // Faint aiming guide under the swinging dango.
    this.guide = this.add.rectangle(
      GAME_WIDTH / 2,
      200,
      3,
      120,
      0xffffff,
      0.25,
    );

    this.buildHud();
    this.spawnNext();

    // Tap anywhere below the HUD to drop. Space / Enter also drops.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.paused || this.phase !== 'swaying') return;
      if (pointer.y < 100) return; // HUD zone: buttons live here.
      this.drop();
    });
    this.input.keyboard?.on('keydown-SPACE', () => this.onDropKey());
    this.input.keyboard?.on('keydown-ENTER', () => this.onDropKey());
    this.input.keyboard?.on('keydown-P', () => this.togglePause());
    this.input.keyboard?.on('keydown-M', () => this.toggleSound());
  }

  update(_time: number, deltaMs: number): void {
    if (this.paused || this.phase === 'over') return;
    const dt = Math.min(deltaMs / 1000, 0.05);

    // Camera: keep the tower top near the target line as it grows.
    const topWorldY =
      this.feel.platformTopY -
      32 -
      Math.max(0, this.state.stacked - 1) * this.feel.dangoPitchPx;
    const targetWorldY = Math.max(
      0,
      this.feel.cameraTargetTopY - topWorldY,
    );
    if (this.world) {
      this.world.y += (targetWorldY - this.world.y) * Math.min(1, dt * 6);
    }

    if (this.phase === 'swaying') {
      this.updateSway(dt);
    } else if (this.phase === 'falling') {
      this.updateFall(dt);
    }
  }

  // ----- sway / fall -------------------------------------------------

  private swaySpeed(): number {
    const { sway } = this.feel;
    const speed = Math.min(
      sway.baseSpeedRadPerSec +
        this.state.stacked * sway.speedPerStackRadPerSec,
      sway.maxSpeedRadPerSec,
    );
    return this.slowDropsLeft > 0 ? speed * sway.matchaSlowFactor : speed;
  }

  private swayAmplitude(): number {
    const { sway } = this.feel;
    return Math.min(
      sway.baseAmplitudePx +
        this.state.stacked * sway.amplitudePerStackPx,
      sway.maxAmplitudePx,
    );
  }

  private updateSway(dt: number): void {
    this.swayPhase += this.swaySpeed() * dt;
    this.swayX =
      GAME_WIDTH / 2 + this.swayAmplitude() * Math.sin(this.swayPhase);
    this.current?.setPosition(this.swayX, this.feel.swayY);
    if (this.guide) {
      const topScreenY = this.restCenterScreenY();
      this.guide
        .setPosition(this.swayX, (this.feel.swayY + 30 + topScreenY) / 2)
        .setSize(3, Math.max(10, topScreenY - this.feel.swayY - 30));
    }
  }

  /** Screen Y where the falling dango's center comes to rest. */
  private restCenterScreenY(): number {
    const restWorldY =
      this.feel.platformTopY - 32 - this.state.stacked * this.feel.dangoPitchPx;
    return restWorldY + (this.world?.y ?? 0);
  }

  private updateFall(dt: number): void {
    const falling = this.current;
    if (!falling) return;
    this.fallVy += this.feel.gravityPxPerSec2 * dt;
    falling.y += this.fallVy * dt;
    if (falling.y >= this.restCenterScreenY()) {
      falling.y = this.restCenterScreenY();
      this.resolveDrop();
    }
  }

  private onDropKey(): void {
    if (this.paused || this.phase !== 'swaying') return;
    this.drop();
  }

  private drop(): void {
    if (this.phase !== 'swaying') return;
    this.phase = 'falling';
    this.fallVy = 0;
    this.guide?.setVisible(false);
    sound.drop();
  }

  private resolveDrop(): void {
    const falling = this.current;
    if (!falling) return;
    this.phase = 'resolving';
    const dropX = falling.x;
    const fallingY = falling.y;
    const result = applyDrop(
      this.state,
      this.currentKind,
      dropX,
      this.economy,
      loadBalance(),
    );
    this.state = result.state;

    if (result.landing === 'miss') {
      sound.miss();
      this.floatText(dropX, fallingY - 50, 'Miss!', '#e86a7a');
      this.updateMissDots();
      this.tweens.add({
        targets: falling,
        y: GAME_HEIGHT + 60,
        alpha: 0,
        duration: 450,
        ease: 'Quad.easeIn',
        onComplete: () => falling.destroy(),
      });
      this.current = null;
      if (result.state.over) {
        this.endGame();
      } else {
        this.time.delayedCall(500, () => this.spawnNext());
      }
      return;
    }

    // Landed: move the dango into the world (it leans with the tower).
    const restWorldY =
      this.feel.platformTopY -
      32 -
      (this.state.stacked - 1) * this.feel.dangoPitchPx;
    const placed = this.add
      .image(dropX, restWorldY, this.currentKind)
      .setDisplaySize(DANGO_SIZE, DANGO_SIZE);
    this.world?.add(placed);
    falling.destroy();
    this.current = null;
    this.tweens.add({
      targets: placed,
      x: result.state.topCenterX,
      duration: 140,
      ease: 'Sine.easeOut',
    });

    if (result.landing === 'perfect') {
      sound.perfect();
      const combo =
        result.state.perfectCombo > 1
          ? `PERFECT x${result.state.perfectCombo}!`
          : 'PERFECT!';
      this.floatText(dropX, fallingY - 60, combo, '#e86a7a', 26);
    } else {
      sound.land();
    }
    this.floatText(
      GAME_WIDTH / 2,
      210,
      `+${result.earnedDG} ${CURRENCY}`,
      '#5a8a4a',
      24,
    );
    if (this.currentKind === 'matcha') {
      this.slowDropsLeft = this.feel.sway.matchaSlowDrops;
      this.floatText(
        GAME_WIDTH / 2,
        250,
        'Matcha Time! The sway slows down.',
        '#5a8a4a',
        19,
      );
    }
    if (this.currentKind === 'golden') {
      this.floatText(GAME_WIDTH / 2, 250, 'GOLDEN!', '#c89b00', 26);
    }
    this.updateHud();
    this.time.delayedCall(320, () => this.spawnNext());
  }

  private spawnNext(): void {
    if (this.phase === 'over') return;
    if (this.slowDropsLeft > 0) this.slowDropsLeft -= 1;
    this.currentKind = rollNextKind(this.economy);
    this.current = this.add
      .image(this.swayX, this.feel.swayY, this.currentKind)
      .setDisplaySize(DANGO_SIZE, DANGO_SIZE)
      .setDepth(10);
    this.guide?.setVisible(true);
    this.phase = 'swaying';
  }

  private endGame(): void {
    this.phase = 'over';
    sound.gameOver();
    const dg = this.state.totalDG;
    const heightCm = towerHeightCm(this.state.stacked, this.economy);
    const { best, isNewRecord } = saveBest(
      dg,
      heightCm,
      this.state.stacked,
    );
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

  // ----- HUD ----------------------------------------------------------

  private buildHud(): void {
    this.dgText = this.add
      .text(16, HUD_TOP, `0 ${CURRENCY}`, {
        fontFamily: '"Mochiy Pop One", "Zen Maru Gothic", sans-serif',
        fontSize: '30px',
        color: COLOR_TEXT,
      })
      .setOrigin(0, 0)
      .setDepth(20);
    this.heightText = this.add
      .text(GAME_WIDTH / 2, HUD_TOP + 6, '0 cm', {
        fontFamily: '"Zen Maru Gothic", sans-serif',
        fontSize: '20px',
        fontStyle: 'bold',
        color: COLOR_TEXT,
      })
      .setOrigin(0.5, 0)
      .setDepth(20);

    // Miss dots (3): filled while a miss is still allowed.
    for (let i = 0; i < 3; i++) {
      const dot = this.add
        .circle(GAME_WIDTH - 118 + i * 22, HUD_TOP + 64, 7, 0xe86a7a, 1)
        .setDepth(20);
      this.missDots.push(dot);
    }
    this.add
      .text(GAME_WIDTH - 52, HUD_TOP + 56, 'MISS', {
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
    soundButton.setDepth(20);
    this.soundText = soundButton.getAt(1) as Phaser.GameObjects.Text;

    const pauseButton = makeIconButton(
      this,
      GAME_WIDTH - 92,
      HUD_TOP + 24,
      'II',
      () => this.togglePause(),
    );
    pauseButton.setDepth(20);

    // Pause overlay (hidden until paused).
    this.pauseOverlay = this.add.container(0, 0).setDepth(50).setVisible(false);
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
}

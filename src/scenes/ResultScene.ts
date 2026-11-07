/**
 * Result screen (Dango Tower) — "Today's Dango Tower".
 *
 * Like Dango Drop's "Today's Dango Shop", a failed run is reframed as a
 * shop report: the dango you stacked were sold, and here is the total.
 * Shows DG earned, dango stacked, tower height, best results, and a
 * NEW RECORD badge when a record was broken.
 */
import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/dimensions';
import { BACKGROUND_KEY } from '../constants/assets';
import { CURRENCY } from '../systems/EconomyConfig';
import { addSoftPanel, bodyText, headingText, makeButton } from './ui';

export const RESULT_SCENE_KEY = 'ResultScene';

export interface ResultData {
  /** Total DG for the run, INCLUDING the Final Height Bonus. */
  dg: number;
  /** Final Height Bonus portion of the total (v3), for the breakdown. */
  heightBonusDG: number;
  stacked: number;
  heightCm: number;
  bestDG: number;
  bestHeight: number;
  bestStacked: number;
  isNewRecord: boolean;
}

export class ResultScene extends Phaser.Scene {
  constructor() {
    super(RESULT_SCENE_KEY);
  }

  create(data: ResultData): void {
    // Shop background illustration (drawn first, behind everything).
    this.add
      .image(GAME_WIDTH / 2, GAME_HEIGHT / 2, BACKGROUND_KEY)
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
    // Soft panels keep the headings and the score readable over the art.
    addSoftPanel(this, GAME_WIDTH / 2, 122, 440, 140, 0.45);
    addSoftPanel(this, GAME_WIDTH / 2, 318, 460, 190, 0.5);

    headingText(this, GAME_WIDTH / 2, 96, "Today's", 36);
    headingText(this, GAME_WIDTH / 2, 148, 'Dango Tower', 44);

    if (data.isNewRecord) {
      const badge = this.add
        .text(GAME_WIDTH / 2, 206, 'NEW RECORD!', {
          fontFamily: '"Mochiy Pop One", "Zen Maru Gothic", sans-serif',
          fontSize: '26px',
          color: '#ffffff',
          backgroundColor: '#e86a7a',
          padding: { x: 18, y: 8 },
        })
        .setOrigin(0.5);
      this.tweens.add({
        targets: badge,
        scale: 1.1,
        duration: 400,
        yoyo: true,
        repeat: -1,
      });
    }

    this.add
      .text(GAME_WIDTH / 2, 292, `${data.dg} ${CURRENCY}`, {
        fontFamily: '"Mochiy Pop One", "Zen Maru Gothic", sans-serif',
        fontSize: '64px',
        color: '#5a3a28',
      })
      .setOrigin(0.5);
    bodyText(
      this,
      GAME_WIDTH / 2,
      368,
      'sold at the shop today!',
      20,
    ).setOrigin(0.5);

    const panel = this.add.rectangle(
      GAME_WIDTH / 2,
      516,
      420,
      224,
      0xfff7e6,
      1,
    );
    panel.setStrokeStyle(2, 0xc89b6a);
    const rows: [string, string][] = [
      ['Dango stacked', `${data.stacked}`],
      ['Tower height', `${data.heightCm} cm`],
      [
        `Height Bonus (${data.heightCm} cm)`,
        `+${data.heightBonusDG} ${CURRENCY}`,
      ],
      ['Best DG', `${data.bestDG} ${CURRENCY}`],
      ['Best height', `${data.bestHeight} cm`],
    ];
    rows.forEach(([label, value], i) => {
      const y = 446 + i * 36;
      this.add
        .text(GAME_WIDTH / 2 - 190, y, label, {
          fontFamily: '"Zen Maru Gothic", sans-serif',
          fontSize: '20px',
          color: '#5a3a28',
        })
        .setOrigin(0, 0.5);
      this.add
        .text(GAME_WIDTH / 2 + 190, y, value, {
          fontFamily: '"Zen Maru Gothic", sans-serif',
          fontSize: '20px',
          fontStyle: 'bold',
          color: '#5a3a28',
        })
        .setOrigin(1, 0.5);
    });

    makeButton(this, GAME_WIDTH / 2, 680, 300, 72, 'PLAY AGAIN', () => {
      this.scene.start('GameScene');
    });
    makeButton(
      this,
      GAME_WIDTH / 2,
      772,
      300,
      56,
      'TITLE',
      () => {
        this.scene.start('TitleScene');
      },
      22,
    );
  }
}

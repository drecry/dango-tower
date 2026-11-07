/**
 * Meet the Dango screen (Dango Tower).
 *
 * Introduces the seven dango friends with their real character art,
 * menu prices, one-line personalities and (v3) their gameplay trait —
 * each friend handles a little differently in the physics.
 * Reached from the title screen.
 */
import Phaser from 'phaser';
import { GAME_WIDTH } from '../config/dimensions';
import { ALL_DANGO_KINDS, DANGO_INFO } from '../constants/assets';
import { loadEconomy } from '../systems/EconomyConfig';
import { bodyText, headingText, makeButton } from './ui';

export const MEET_SCENE_KEY = 'MeetScene';

export class MeetScene extends Phaser.Scene {
  constructor() {
    super(MEET_SCENE_KEY);
  }

  create(): void {
    const economy = loadEconomy();
    headingText(this, GAME_WIDTH / 2, 60, 'MEET THE DANGO', 36);
    bodyText(
      this,
      GAME_WIDTH / 2,
      100,
      'Seven friends run the dango shop together.',
      18,
    ).setOrigin(0.5);

    let y = 138;
    for (const kind of ALL_DANGO_KINDS) {
      const info = DANGO_INFO[kind];
      this.add.image(70, y + 40, kind).setDisplaySize(64, 64);
      this.add
        .text(116, y, `${info.name}  ·  ${economy.prices[kind]} DG`, {
          fontFamily: '"Mochiy Pop One", "Zen Maru Gothic", sans-serif',
          fontSize: '20px',
          color: '#5a3a28',
        })
        .setOrigin(0, 0);
      bodyText(this, 116, y + 27, info.intro, 16, 408).setOrigin(0, 0);
      this.add
        .text(116, y + 72, info.trait, {
          fontFamily: '"Zen Maru Gothic", sans-serif',
          fontSize: '15px',
          fontStyle: 'bold',
          color: '#c04a63',
        })
        .setOrigin(0, 0);
      y += 104;
    }

    makeButton(this, GAME_WIDTH / 2, 892, 240, 56, 'BACK', () => {
      this.scene.start('TitleScene');
    });
  }
}

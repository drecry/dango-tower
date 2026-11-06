/**
 * How to Play screen (Dango Tower).
 *
 * The rules live on their own screen, reached from the title — never as
 * an overlay on the game, so the game itself can use the whole phone
 * screen. All text is English.
 */
import Phaser from 'phaser';
import { GAME_WIDTH } from '../config/dimensions';
import { loadEconomy } from '../systems/EconomyConfig';
import { bodyText, headingText, makeButton } from './ui';

export const HOW_TO_SCENE_KEY = 'HowToScene';

export class HowToScene extends Phaser.Scene {
  constructor() {
    super(HOW_TO_SCENE_KEY);
  }

  create(): void {
    const economy = loadEconomy();
    headingText(this, GAME_WIDTH / 2, 84, 'HOW TO PLAY', 40);

    const steps: { icon: string; title: string; text: string }[] = [
      {
        icon: 'shiratama',
        title: '1. Tap to drop',
        text: 'A dango hovers and sways above the counter. Tap anywhere (or press Space) to drop it.',
      },
      {
        icon: 'sakura',
        title: '2. Balance matters!',
        text: 'Dango roll and pile up for real — balance matters! Land dead-center on the top dango for a Perfect.',
      },
      {
        icon: 'matcha',
        title: '3. Three misses and it is over',
        text: 'A dango that falls off the counter is a miss. Three dango off the counter and the shop closes for today.',
      },
      {
        icon: 'golden',
        title: '4. Every dango is sold',
        text: 'Each dango you stack is sold at the shop. DG is your score — the taller the tower, the richer the shop!',
      },
    ];

    let y = 140;
    for (const step of steps) {
      this.add.image(64, y + 22, step.icon).setDisplaySize(52, 52);
      this.add
        .text(100, y, step.title, {
          fontFamily: '"Mochiy Pop One", "Zen Maru Gothic", sans-serif',
          fontSize: '21px',
          color: '#5a3a28',
        })
        .setOrigin(0, 0);
      bodyText(this, 100, y + 30, step.text, 18, 420).setOrigin(0, 0);
      y += 108;
    }

    // DG formula box.
    const box = this.add.rectangle(
      GAME_WIDTH / 2,
      y + 74,
      460,
      148,
      0xfff7e6,
      1,
    );
    box.setStrokeStyle(2, 0xc89b6a);
    headingText(this, GAME_WIDTH / 2, y + 22, 'HOW DG IS EARNED', 22);
    bodyText(
      this,
      GAME_WIDTH / 2,
      y + 52,
      `DG = price x ${economy.sellMultiplier} + height bonus (+1 DG every ${economy.heightBonusEvery} dango) + Perfect bonus (${economy.perfectBonus} DG x combo)\nMatcha (10 DG) slows the sway for 3 drops. Golden (100 DG) drops straight down with no sway!`,
      17,
    ).setOrigin(0.5, 0);

    makeButton(this, GAME_WIDTH / 2, 868, 240, 60, 'BACK', () => {
      this.scene.start('TitleScene');
    });
  }
}

import Phaser from 'phaser';
import { COLORS, GAME_HEIGHT, GAME_WIDTH, SCENE_KEYS } from '../config/constants';
import { TextureFactory } from '../systems/TextureFactory';
import { SaveSystem } from '../systems/SaveSystem';

/**
 * BootScene.
 *
 * Generates every texture procedurally (the game ships with no binary art),
 * loads the local save, and shows a short branded splash before handing off to
 * the menu.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: SCENE_KEYS.BOOT });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.bgDeep);

    // 1. Procedural art.
    TextureFactory.generateAll(this);

    // 2. Local save (server state overrides this once authenticated).
    const save = SaveSystem.load();
    this.registry.set('save', save);

    // 3. Splash.
    this.drawSplash();

    // 4. Hand off.
    this.time.delayedCall(1400, () => {
      this.cameras.main.fadeOut(320, 5, 6, 15);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start(SCENE_KEYS.MENU);
      });
    });
  }

  private drawSplash(): void {
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;

    // Starfield behind the logo.
    const g = this.add.graphics();
    for (let i = 0; i < 160; i++) {
      const x = Math.random() * GAME_WIDTH;
      const y = Math.random() * GAME_HEIGHT;
      g.fillStyle(0xffffff, 0.15 + Math.random() * 0.5);
      g.fillCircle(x, y, Math.random() * 1.6 + 0.4);
    }

    // Logo.
    const title = this.add
      .text(cx, cy - 40, 'ROCKET RIFT', {
        fontFamily: 'Orbitron, Impact, sans-serif',
        fontSize: '76px',
        color: '#e8f1ff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setAlpha(0);

    const sub = this.add
      .text(cx, cy + 30, 'F R O N T I E R', {
        fontFamily: 'Orbitron, Impact, sans-serif',
        fontSize: '30px',
        color: '#4fd1ff',
        letterSpacing: 8,
      })
      .setOrigin(0.5)
      .setAlpha(0);

    const tag = this.add
      .text(cx, cy + 96, 'FREE TO PLAY  ·  OWN YOUR SHIP', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#8fa3c8',
      })
      .setOrigin(0.5)
      .setAlpha(0);

    this.tweens.add({ targets: title, alpha: 1, y: cy - 50, duration: 700, ease: 'Cubic.easeOut' });
    this.tweens.add({ targets: sub, alpha: 1, duration: 700, delay: 220 });
    this.tweens.add({ targets: tag, alpha: 1, duration: 700, delay: 420 });

    // Loading bar.
    const barW = 320;
    const barX = cx - barW / 2;
    const barY = cy + 160;
    const bar = this.add.graphics();
    bar.fillStyle(0x1e2b4d, 1);
    bar.fillRect(barX, barY, barW, 6);
    const fill = this.add.graphics();

    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 1200,
      onUpdate: (tween) => {
        const v = tween.getValue() ?? 0;
        fill.clear();
        fill.fillStyle(0x4fd1ff, 1);
        fill.fillRect(barX, barY, barW * v, 6);
      },
    });
  }
}

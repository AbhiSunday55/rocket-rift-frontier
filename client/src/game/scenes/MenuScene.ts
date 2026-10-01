import Phaser from 'phaser';
import { COLORS, GAME_HEIGHT, GAME_WIDTH, SCENE_KEYS } from '../config/constants';
import { bus } from '../systems/EventBus';
import { SaveSystem } from '../systems/SaveSystem';
import { RAPTOR_X, getShip } from '../config/ships';
import { computeShipStats } from '../systems/ProgressionSystem';
import type { SaveData } from '../systems/types';

/**
 * MenuScene — the in-canvas attract screen.
 *
 * The full command centre (PLAY / MISSIONS / MARKETPLACE / TRADE / HANGAR /
 * PROFILE / WALLET) is the React shell layered over this scene. This scene
 * provides the animated backdrop and the PLAY button, and emits `menu:play` so
 * the shell can react.
 */
export class MenuScene extends Phaser.Scene {
  private ship!: Phaser.GameObjects.Image;
  private stars: Phaser.GameObjects.Graphics[] = [];

  constructor() {
    super({ key: SCENE_KEYS.MENU });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.bgDeep);
    this.buildStarfield();
    this.buildHangarBay();
    this.buildTitle();
    this.buildPlayButton();
    this.buildFooter();

    this.cameras.main.fadeIn(400, 5, 6, 15);
  }

  private buildStarfield(): void {
    for (let layer = 0; layer < 3; layer++) {
      const g = this.add.graphics().setDepth(layer);
      const count = 120 - layer * 30;
      for (let i = 0; i < count; i++) {
        g.fillStyle(0xffffff, 0.12 + Math.random() * 0.5);
        g.fillCircle(Math.random() * GAME_WIDTH, Math.random() * GAME_HEIGHT, 0.5 + Math.random() * (1.6 - layer * 0.4));
      }
      this.stars.push(g);
      this.tweens.add({
        targets: g,
        x: -40 - layer * 20,
        duration: 24000 + layer * 9000,
        repeat: -1,
        yoyo: true,
        ease: 'Sine.easeInOut',
      });
    }
  }

  private buildHangarBay(): void {
    // A soft glow behind the hero ship.
    const glow = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 40, 'glow').setScale(4.2).setAlpha(0.22).setDepth(3);
    this.tweens.add({ targets: glow, alpha: 0.34, scale: 4.6, duration: 2600, yoyo: true, repeat: -1 });

    this.ship = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 40, 'ship_default').setScale(2.6).setDepth(4);
    this.tweens.add({
      targets: this.ship,
      y: this.ship.y - 14,
      duration: 2200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Engine trail.
    const trail = this.add.particles(0, 0, 'p_spark', {
      speed: { min: 30, max: 90 },
      angle: { min: 70, max: 110 },
      scale: { start: 1.1, end: 0 },
      alpha: { start: 0.7, end: 0 },
      lifespan: 600,
      frequency: 30,
      tint: [0x4fd1ff, 0x9ef7ff],
      blendMode: Phaser.BlendModes.ADD,
    });
    trail.setDepth(3);
    this.events.on(Phaser.Scenes.Events.UPDATE, () => {
      trail.setPosition(this.ship.x, this.ship.y + 62);
    });
  }

  private buildTitle(): void {
    this.add
      .text(GAME_WIDTH / 2, 96, 'ROCKET RIFT', {
        fontFamily: 'Orbitron, Impact, sans-serif',
        fontSize: '64px',
        color: '#e8f1ff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(10);

    this.add
      .text(GAME_WIDTH / 2, 146, 'F R O N T I E R', {
        fontFamily: 'Orbitron, Impact, sans-serif',
        fontSize: '22px',
        color: '#4fd1ff',
      })
      .setOrigin(0.5)
      .setDepth(10);

    this.add
      .text(GAME_WIDTH / 2, 180, 'SEASON 01 · THE VOID WAR', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#b14aff',
      })
      .setOrigin(0.5)
      .setDepth(10);
  }

  private buildPlayButton(): void {
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT - 150;

    const container = this.add.container(cx, cy).setDepth(20);
    const bg = this.add.graphics();
    const label = this.add
      .text(0, 0, '▶  LAUNCH', {
        fontFamily: 'Orbitron, Impact, sans-serif',
        fontSize: '26px',
        color: '#05060f',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const draw = (hover: boolean) => {
      bg.clear();
      bg.fillStyle(hover ? 0x9ef7ff : 0x4fd1ff, 1);
      bg.fillRoundedRect(-140, -30, 280, 60, 12);
      bg.lineStyle(2, 0xffffff, hover ? 0.9 : 0.4);
      bg.strokeRoundedRect(-140, -30, 280, 60, 12);
    };
    draw(false);

    container.add([bg, label]);
    container.setSize(280, 60);
    container.setInteractive(new Phaser.Geom.Rectangle(-140, -30, 280, 60), Phaser.Geom.Rectangle.Contains);

    container.on('pointerover', () => {
      draw(true);
      this.tweens.add({ targets: container, scale: 1.05, duration: 140 });
    });
    container.on('pointerout', () => {
      draw(false);
      this.tweens.add({ targets: container, scale: 1, duration: 140 });
    });
    container.on('pointerdown', () => this.startRun());

    // Keyboard shortcut.
    this.input.keyboard?.once('keydown-SPACE', () => this.startRun());
    this.input.keyboard?.once('keydown-ENTER', () => this.startRun());

    this.tweens.add({ targets: container, y: cy - 6, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  private buildFooter(): void {
    const save = (this.registry.get('save') as SaveData) ?? SaveSystem.load();
    const ship = getShip(save.profile.ships.find((s) => s.id === save.profile.equippedShipId)?.shipKey ?? RAPTOR_X.key);
    const stats = computeShipStats(ship.stats, 1, {});

    this.add
      .text(
        24,
        GAME_HEIGHT - 34,
        `LV ${save.profile.level}  ·  ${ship.name.toUpperCase()}  ·  HP ${stats.health}  SH ${stats.shield}  DMG ${stats.damage}`,
        { fontFamily: 'monospace', fontSize: '13px', color: '#8fa3c8' }
      )
      .setDepth(20);

    this.add
      .text(GAME_WIDTH - 24, GAME_HEIGHT - 34, 'ARROWS/WASD · SPACE FIRE · E ABILITY · SHIFT DASH · ESC PAUSE', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#8fa3c8',
      })
      .setOrigin(1, 0)
      .setDepth(20);
  }

  private startRun(): void {
    this.cameras.main.fadeOut(280, 5, 6, 15);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      bus.emit('toast', { message: 'Launching into the Rift…', tone: 'info' });
      this.scene.start(SCENE_KEYS.GAME, { sectorIndex: 1, seed: Math.floor(Math.random() * 1e9) });
    });
  }
}

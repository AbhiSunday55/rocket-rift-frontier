import Phaser from 'phaser';
import { COLORS, GAME_HEIGHT, GAME_WIDTH, SCENE_KEYS } from '../config/constants';
import { bus } from '../systems/EventBus';
import type { RunResult } from '../systems/types';

/**
 * GameOverScene.
 *
 * Shows the run summary, the anti-cheat verdict, and the rewards that were
 * actually granted. Rewards shown here are the *server-validated* amounts when
 * online; offline they are the locally-computed amounts, clearly labelled.
 */
export class GameOverScene extends Phaser.Scene {
  private result?: RunResult;
  private verified = false;

  constructor() {
    super({ key: SCENE_KEYS.GAME_OVER });
  }

  init(data: { result?: RunResult; verified?: boolean }): void {
    this.result = data?.result;
    this.verified = data?.verified ?? false;
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.bgDeep);
    this.buildStarfield();

    const r = this.result;
    const cx = GAME_WIDTH / 2;

    this.add
      .text(cx, 70, 'RUN TERMINATED', {
        fontFamily: 'Orbitron, Impact, sans-serif',
        fontSize: '52px',
        color: '#ff2e63',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(cx, 118, 'Your hull has been recovered. The Rift keeps what it takes.', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#8fa3c8',
      })
      .setOrigin(0.5);

    if (r) {
      this.buildStats(r);
      this.buildVerdict(r);
    }

    this.buildButtons();
    this.cameras.main.fadeIn(400, 5, 6, 15);
  }

  private buildStarfield(): void {
    const g = this.add.graphics();
    for (let i = 0; i < 140; i++) {
      g.fillStyle(0xffffff, 0.1 + Math.random() * 0.4);
      g.fillCircle(Math.random() * GAME_WIDTH, Math.random() * GAME_HEIGHT, Math.random() * 1.5 + 0.4);
    }
  }

  private buildStats(r: RunResult): void {
    const cx = GAME_WIDTH / 2;
    const panelW = 720;
    const panelX = cx - panelW / 2;
    const panelY = 160;

    const g = this.add.graphics();
    g.fillStyle(0x0b1020, 0.9);
    g.fillRoundedRect(panelX, panelY, panelW, 300, 14);
    g.lineStyle(2, 0x1e2b4d, 1);
    g.strokeRoundedRect(panelX, panelY, panelW, 300, 14);

    const rows: [string, string, string][] = [
      ['SECTOR REACHED', String(r.sectorReached), '#4fd1ff'],
      ['SCORE', r.score.toLocaleString(), '#ffd166'],
      ['KILLS', String(r.kills), '#ff5d73'],
      ['DAMAGE DEALT', r.damageDealt.toLocaleString(), '#b14aff'],
      ['LOOT VALUE', r.lootValue.toLocaleString(), '#3ddc97'],
      ['XP EARNED', r.xpGained.toLocaleString(), '#9ef7ff'],
      ['SCRAP', r.scrapGained.toLocaleString(), '#ff9f43'],
      ['PLASMA', r.plasmaGained.toLocaleString(), '#5ce1e6'],
      ['DURATION', `${Math.floor(r.durationMs / 60000)}m ${Math.floor((r.durationMs % 60000) / 1000)}s`, '#8fa3c8'],
    ];

    rows.forEach((row, i) => {
      const col = i % 2;
      const line = Math.floor(i / 2);
      const x = panelX + 40 + col * (panelW / 2 - 20);
      const y = panelY + 40 + line * 56;

      this.add.text(x, y, row[0], { fontFamily: 'monospace', fontSize: '12px', color: '#8fa3c8' });
      this.add.text(x, y + 18, row[1], {
        fontFamily: 'Orbitron, Impact, sans-serif',
        fontSize: '24px',
        color: row[2],
        fontStyle: 'bold',
      });
    });
  }

  private buildVerdict(r: RunResult): void {
    const cx = GAME_WIDTH / 2;
    const y = 486;

    if (r.clientFlagged) {
      this.add
        .text(cx, y, `⚠ RUN FLAGGED — ${r.clientFlagReason ?? 'validation failed'}`, {
          fontFamily: 'monospace',
          fontSize: '13px',
          color: '#ff2e63',
          wordWrap: { width: 700 },
          align: 'center',
        })
        .setOrigin(0.5);
      this.add
        .text(cx, y + 34, 'Rewards withheld pending server review.', {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#8fa3c8',
        })
        .setOrigin(0.5);
      return;
    }

    this.add
      .text(
        cx,
        y,
        this.verified ? '✓ RUN VERIFIED BY SERVER' : '✓ RUN VALID (offline — rewards applied locally)',
        { fontFamily: 'monospace', fontSize: '13px', color: this.verified ? '#3ddc97' : '#ffd166' }
      )
      .setOrigin(0.5);
  }

  private buildButtons(): void {
    const cx = GAME_WIDTH / 2;
    const y = GAME_HEIGHT - 90;

    this.makeButton(cx - 150, y, 'RETRY', 0x4fd1ff, () => {
      this.scene.start(SCENE_KEYS.GAME, { sectorIndex: 1, seed: Math.floor(Math.random() * 1e9) });
    });

    this.makeButton(cx + 150, y, 'COMMAND CENTRE', 0xb14aff, () => {
      bus.emit('toast', { message: 'Returning to command centre', tone: 'info' });
      this.scene.start(SCENE_KEYS.MENU);
    });
  }

  private makeButton(x: number, y: number, label: string, tint: number, onClick: () => void): void {
    const container = this.add.container(x, y);
    const bg = this.add.graphics();
    const text = this.add
      .text(0, 0, label, {
        fontFamily: 'Orbitron, Impact, sans-serif',
        fontSize: '18px',
        color: '#05060f',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const draw = (hover: boolean) => {
      bg.clear();
      bg.fillStyle(tint, hover ? 1 : 0.85);
      bg.fillRoundedRect(-130, -26, 260, 52, 10);
    };
    draw(false);

    container.add([bg, text]);
    container.setSize(260, 52);
    container.setInteractive(new Phaser.Geom.Rectangle(-130, -26, 260, 52), Phaser.Geom.Rectangle.Contains);
    container.on('pointerover', () => draw(true));
    container.on('pointerout', () => draw(false));
    container.on('pointerdown', onClick);
  }
}

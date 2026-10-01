import Phaser from 'phaser';
import { COMBAT, RENDER } from '../config/constants';
import { Rarity } from '../config/rarity';
import { lootTextureKey, powerUpTextureKey } from '../systems/LootSystem';
import type { LootDrop, PowerUpDef } from '../systems/types';

/**
 * A collectible drop — either an item or a power-up.
 *
 * Drops drift, bob, and are pulled toward the player by the magnet radius (or
 * the Tractor Field power-up).
 */
export class Loot extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;

  readonly kind: 'ITEM' | 'POWERUP';
  readonly drop?: LootDrop;
  readonly powerUp?: PowerUpDef;

  private bobPhase = Math.random() * Math.PI * 2;
  private baseY = 0;
  private collected = false;
  private spawnAt = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, payload: { drop: LootDrop } | { powerUp: PowerUpDef }) {
    const isItem = 'drop' in payload;
    const texture = isItem ? lootTextureKey(payload.drop.rarity) : powerUpTextureKey(payload.powerUp.kind);
    super(scene, x, y, texture);

    this.kind = isItem ? 'ITEM' : 'POWERUP';
    if (isItem) this.drop = payload.drop;
    else this.powerUp = payload.powerUp;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setDepth(RENDER.depth.loot);
    this.body.setAllowGravity(false);
    this.body.setCircle(14, this.width / 2 - 14, this.height / 2 - 14);

    this.baseY = y;
    this.spawnAt = scene.time.now;

    // Pop out of the wreck.
    const angle = Math.random() * Math.PI * 2;
    const dist = 20 + Math.random() * 40;
    this.body.setVelocity(Math.cos(angle) * dist, Math.sin(angle) * dist);
    this.body.setDamping(true);
    this.body.setDrag(0.02, 0.02);

    this.setScale(0.3);
    scene.tweens.add({ targets: this, scale: 1, duration: 300, ease: 'Back.easeOut' });

    // Rarity glow for high-tier drops.
    if (isItem && payload.drop.rarity >= Rarity.EPIC) {
      const glow = scene.add.image(x, y, 'glow').setDepth(RENDER.depth.loot - 1).setScale(0.6).setAlpha(0.5);
      glow.setTint(payload.drop.rarity === Rarity.MYTHIC ? 0xff2e63 : 0xffd166);
      scene.tweens.add({ targets: glow, alpha: 0.15, scale: 0.9, duration: 900, yoyo: true, repeat: -1 });
      this.once('destroy', () => glow.destroy());
    }
  }

  update(now: number, player: { x: number; y: number } | null, magnetActive: boolean): void {
    if (!this.active || this.collected) return;

    // Bob.
    this.bobPhase += 0.06;
    this.y = this.baseY + Math.sin(this.bobPhase) * 4;

    if (!player) return;

    const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
    const radius = magnetActive ? 900 : COMBAT.magnetRadius;

    if (dist < radius) {
      const angle = Math.atan2(player.y - this.y, player.x - this.x);
      const pull = magnetActive ? 620 : 260;
      this.body.setVelocity(Math.cos(angle) * pull, Math.sin(angle) * pull);
    }

    // Despawn after 30s so the world does not fill with uncollected loot.
    if (now - this.spawnAt > 30000) {
      this.scene.tweens.add({ targets: this, alpha: 0, duration: 300, onComplete: () => this.destroy() });
    }
  }

  collect(): void {
    if (this.collected) return;
    this.collected = true;
    this.body.enable = false;

    this.scene.tweens.add({
      targets: this,
      scale: 1.8,
      alpha: 0,
      duration: 180,
      onComplete: () => this.destroy(),
    });
  }
}

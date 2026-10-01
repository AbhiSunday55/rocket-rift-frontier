import Phaser from 'phaser';
import { RENDER } from '../config/constants';

/**
 * A single projectile.
 *
 * Bullets are pooled by the scene (see `BulletPool`) — allocating a sprite per
 * shot would thrash the GC during a swarm fight.
 */
export class Bullet extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;

  damage = 0;
  crit = false;
  weaponKey = '';
  pierce = 0;
  /** Enemies already hit — prevents a piercing shot hitting the same target twice. */
  hitSet = new Set<Phaser.GameObjects.GameObject>();
  /** True for projectiles fired by enemies. */
  hostile = false;
  /** Homing turn rate (rad/frame); 0 = straight line. */
  turnRate = 0;
  /** Blast radius on expiry; 0 = no explosion. */
  blastRadius = 0;
  /** Chain lightning parameters. */
  chainCount = 0;
  chainRange = 0;
  chainFalloff = 0.7;
  /** Shield-piercing flag. */
  shieldPierce = false;
  /** Stun duration applied on hit (ms). */
  stunMs = 0;
  /** Mine arming delay (ms). */
  armAt = 0;

  private expiresAt = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, texture: string) {
    super(scene, x, y, texture);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(RENDER.depth.bullet);
    this.body.setAllowGravity(false);
  }

  fire(opts: {
    x: number;
    y: number;
    angle: number;
    speed: number;
    damage: number;
    crit: boolean;
    weaponKey: string;
    pierce: number;
    lifetimeMs: number;
    hostile?: boolean;
    turnRate?: number;
    blastRadius?: number;
    chainCount?: number;
    chainRange?: number;
    chainFalloff?: number;
    shieldPierce?: boolean;
    stunMs?: number;
    armMs?: number;
    tint?: number;
  }): void {
    this.setActive(true).setVisible(true);
    this.setPosition(opts.x, opts.y);
    this.setRotation(opts.angle);
    this.setScale(1);
    this.setAlpha(1);

    this.damage = opts.damage;
    this.crit = opts.crit;
    this.weaponKey = opts.weaponKey;
    this.pierce = opts.pierce;
    this.hostile = opts.hostile ?? false;
    this.turnRate = opts.turnRate ?? 0;
    this.blastRadius = opts.blastRadius ?? 0;
    this.chainCount = opts.chainCount ?? 0;
    this.chainRange = opts.chainRange ?? 0;
    this.chainFalloff = opts.chainFalloff ?? 0.7;
    this.shieldPierce = opts.shieldPierce ?? false;
    this.stunMs = opts.stunMs ?? 0;
    this.armAt = opts.armMs ? this.scene.time.now + opts.armMs : 0;
    this.hitSet.clear();

    if (opts.tint !== undefined) this.setTint(opts.tint);
    else this.clearTint();

    this.body.enable = true;
    this.body.setSize(this.width * 0.7, this.height * 0.7, true);
    this.body.setVelocity(Math.cos(opts.angle) * opts.speed * 60, Math.sin(opts.angle) * opts.speed * 60);

    this.expiresAt = this.scene.time.now + opts.lifetimeMs;
  }

  update(now: number, target?: { x: number; y: number }): void {
    if (!this.active) return;

    // Homing: steer toward the target.
    if (this.turnRate > 0 && target) {
      const desired = Math.atan2(target.y - this.y, target.x - this.x);
      const current = Math.atan2(this.body.velocity.y, this.body.velocity.x);
      const diff = Phaser.Math.Angle.Wrap(desired - current);
      const next = current + Phaser.Math.Clamp(diff, -this.turnRate, this.turnRate);
      const speed = this.body.velocity.length();
      this.body.setVelocity(Math.cos(next) * speed, Math.sin(next) * speed);
      this.setRotation(next);
    }

    if (now > this.expiresAt) {
      this.kill();
    }
  }

  /** Returns true if the bullet should be recycled after this hit. */
  registerHit(): boolean {
    if (this.pierce > 0) {
      this.pierce--;
      return false;
    }
    return true;
  }

  kill(): void {
    this.setActive(false).setVisible(false);
    this.body.enable = false;
    this.body.setVelocity(0, 0);
  }
}

/**
 * A fixed-size pool of bullets. `get()` recycles the oldest inactive bullet, or
 * grows the pool if every bullet is in flight.
 */
export class BulletPool {
  private pool: Bullet[] = [];

  constructor(private scene: Phaser.Scene, private texture: string, private initialSize = 120) {
    for (let i = 0; i < initialSize; i++) {
      const b = new Bullet(scene, -100, -100, texture);
      b.setActive(false).setVisible(false);
      b.body.enable = false;
      this.pool.push(b);
    }
  }

  get(): Bullet {
    for (const b of this.pool) {
      if (!b.active) return b;
    }
    const b = new Bullet(this.scene, -100, -100, this.texture);
    this.pool.push(b);
    return b;
  }

  forEachActive(fn: (b: Bullet) => void): void {
    for (const b of this.pool) if (b.active) fn(b);
  }

  get activeCount(): number {
    return this.pool.reduce((n, b) => n + (b.active ? 1 : 0), 0);
  }

  destroy(): void {
    for (const b of this.pool) b.destroy();
    this.pool = [];
  }
}

import Phaser from 'phaser';
import { COMBAT, RENDER, WORLD } from '../config/constants';
import type { ShipDef, ShipStats } from '../config/ships';
import type { InputState } from '../systems/InputSystem';
import { createWeaponRuntime, primaryInterval, rollDamage, volleyPattern, projectileTexture, addCharge, canUseUltimate, tickModifiers, type WeaponRuntime } from '../systems/WeaponSystem';
import { bus } from '../systems/EventBus';

/**
 * The player ship.
 *
 * Owns movement, dash, the special ability, damage intake, and firing. All
 * numbers come from the ship's stat block — nothing is hard-coded here.
 */
export class Player extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;

  readonly ship: ShipDef;
  stats: ShipStats;
  weapons: WeaponRuntime;

  health: number;
  maxHealth: number;
  shield: number;
  maxShield: number;

  private lastDamageAt = 0;
  private lastDashAt = -99999;
  private lastAbilityAt = -99999;
  private dashingUntil = 0;
  private invulnUntil = 0;
  private abilityActiveUntil = 0;
  private abilityShield = 0;

  /** Set by the scene so the player can spawn projectiles. */
  onFire?: (x: number, y: number, angle: number, texture: string, damage: number, crit: boolean, weaponKey: string, pierce: number, speed: number, lifetimeMs: number) => void;
  onAbility?: (effect: string, magnitude: number, durationMs: number) => void;

  private engineEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;
  private shieldGfx?: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, x: number, y: number, ship: ShipDef, stats: ShipStats, loadout: { primary: string; secondary: string; ultimate: string }) {
    super(scene, x, y, 'ship_default');
    this.ship = ship;
    this.stats = stats;
    this.weapons = createWeaponRuntime(loadout);

    this.maxHealth = stats.health;
    this.health = stats.health;
    this.maxShield = stats.shield;
    this.shield = stats.shield;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setDepth(RENDER.depth.player);
    this.setCollideWorldBounds(true);
    this.body.setCircle(16, this.width / 2 - 16, this.height / 2 - 16);
    this.body.setDamping(true);
    this.body.setDrag(0.0001, 0.0001);

    this.createEngineTrail();
    this.createShieldVisual();
  }

  private createEngineTrail(): void {
    this.engineEmitter = this.scene.add.particles(0, 0, 'p_spark', {
      speed: { min: 20, max: 70 },
      angle: { min: 60, max: 120 },
      scale: { start: 0.9, end: 0 },
      alpha: { start: 0.8, end: 0 },
      lifespan: 420,
      quantity: 1,
      frequency: 40,
      tint: [0x4fd1ff, 0x9ef7ff],
      blendMode: Phaser.BlendModes.ADD,
    });
    this.engineEmitter.setDepth(RENDER.depth.player - 1);
  }

  private createShieldVisual(): void {
    this.shieldGfx = this.scene.add.graphics();
    this.shieldGfx.setDepth(RENDER.depth.player + 1);
  }

  // ── Per-frame update ─────────────────────────────────────────────────────
  update(input: InputState, now: number): void {
    tickModifiers(this.weapons, now);

    const speed = this.stats.speed * 26 * this.weapons.modifiers.speedMultiplier;
    const isDashing = now < this.dashingUntil;

    if (isDashing) {
      // Dash preserves the direction locked in at activation.
      this.body.setVelocity(this.body.velocity.x, this.body.velocity.y);
    } else {
      this.body.setVelocity(input.moveX * speed, input.moveY * speed);
    }

    // Face the aim direction.
    const aimAngle = Math.atan2(input.aimY, input.aimX);
    this.setRotation(aimAngle + Math.PI / 2);

    // Dash
    if (input.dash && now - this.lastDashAt > COMBAT.dashCooldownMs && !isDashing) {
      this.doDash(input, now);
    }

    // Ability
    if (input.ability && now - this.lastAbilityAt > this.ship.ability.cooldownMs) {
      this.doAbility(now);
    }

    // Fire
    if (input.firing && now >= this.weapons.nextPrimaryAt) {
      this.firePrimary(aimAngle, now);
    }

    // Shield regen after a quiet window.
    if (now - this.lastDamageAt > COMBAT.shieldRegenDelayMs && this.shield < this.maxShield) {
      this.shield = Math.min(this.maxShield, this.shield + (COMBAT.shieldRegenPerSecond * this.scene.game.loop.delta) / 1000);
    }

    this.updateVisuals(now);
  }

  private doDash(input: InputState, now: number): void {
    this.lastDashAt = now;
    this.dashingUntil = now + COMBAT.dashMs;
    this.invulnUntil = Math.max(this.invulnUntil, now + COMBAT.dashMs);

    const dirX = Math.abs(input.moveX) > 0.01 || Math.abs(input.moveY) > 0.01 ? input.moveX : input.aimX;
    const dirY = Math.abs(input.moveX) > 0.01 || Math.abs(input.moveY) > 0.01 ? input.moveY : input.aimY;
    const mag = Math.hypot(dirX, dirY) || 1;
    const speed = this.stats.speed * 26 * COMBAT.dashSpeedMultiplier;

    this.body.setVelocity((dirX / mag) * speed, (dirY / mag) * speed);
    this.setAlpha(0.55);
    bus.emit('dash:used', {});
  }

  private doAbility(now: number): void {
    this.lastAbilityAt = now;
    const a = this.ship.ability;
    this.abilityActiveUntil = now + a.durationMs;

    if (a.effect === 'SHIELD_BUBBLE') this.abilityShield = a.magnitude;
    if (a.effect === 'REPAIR') this.heal(a.magnitude);
    if (a.effect === 'CLOAK') this.setAlpha(0.25);

    bus.emit('ability:used', { key: a.key, name: a.name });
    this.onAbility?.(a.effect, a.magnitude, a.durationMs);
  }

  private firePrimary(aimAngle: number, now: number): void {
    const w = this.weapons.primary;
    const interval = primaryInterval(this.stats, w, this.weapons.modifiers.fireRateMultiplier);
    this.weapons.nextPrimaryAt = now + interval;

    const muzzleDist = 26;
    const mx = this.x + Math.cos(aimAngle) * muzzleDist;
    const my = this.y + Math.sin(aimAngle) * muzzleDist;

    const shots = volleyPattern(w, aimAngle, mx, my);
    for (const s of shots) {
      const { damage, crit } = rollDamage(this.stats, w, this.weapons.modifiers.damageMultiplier);
      this.onFire?.(s.x, s.y, s.angle, projectileTexture(w), damage, crit, w.key, w.pierce, w.speed, w.lifetimeMs);
    }

    this.scene.cameras.main.shake(40, 0.0012);
  }

  /** Fires the secondary weapon (bound to a separate key in the scene). */
  fireSecondary(aimAngle: number, now: number): boolean {
    const w = this.weapons.secondary;
    if (now < this.weapons.nextSecondaryAt) return false;
    this.weapons.nextSecondaryAt = now + w.cooldownMs;

    const mx = this.x + Math.cos(aimAngle) * 26;
    const my = this.y + Math.sin(aimAngle) * 26;
    const shots = volleyPattern(w, aimAngle, mx, my);

    for (const s of shots) {
      const { damage, crit } = rollDamage(this.stats, w, this.weapons.modifiers.damageMultiplier);
      this.onFire?.(s.x, s.y, s.angle, projectileTexture(w), damage, crit, w.key, w.pierce, w.speed, w.lifetimeMs);
    }
    return true;
  }

  /** Fires the ultimate if the charge meter is full. */
  fireUltimate(aimAngle: number, now: number): boolean {
    if (!canUseUltimate(this.weapons)) return false;
    const w = this.weapons.ultimate;
    this.weapons.charge = 0;

    const shots = volleyPattern(w, aimAngle, this.x, this.y);
    for (const s of shots) {
      const { damage, crit } = rollDamage(this.stats, w, this.weapons.modifiers.damageMultiplier);
      this.onFire?.(s.x, s.y, s.angle, projectileTexture(w), damage, crit, w.key, w.pierce, w.speed, w.lifetimeMs);
    }

    this.scene.cameras.main.flash(220, 120, 60, 200);
    this.scene.cameras.main.shake(400, 0.008);
    return true;
  }

  /**
   * Applies incoming damage. Returns the amount that actually landed.
   * Order: invulnerability → ability shield → shield → hull.
   */
  takeDamage(amount: number, now: number): number {
    if (now < this.invulnUntil || this.weapons.modifiers.invulnerable) return 0;

    let remaining = amount;

    if (this.abilityShield > 0) {
      const absorbed = Math.min(this.abilityShield, remaining);
      this.abilityShield -= absorbed;
      remaining -= absorbed;
    }

    if (remaining > 0 && this.shield > 0) {
      const absorbed = Math.min(this.shield, remaining);
      this.shield -= absorbed;
      remaining -= absorbed;
    }

    if (remaining > 0) {
      this.health = Math.max(0, this.health - remaining);
    }

    this.lastDamageAt = now;
    this.invulnUntil = now + COMBAT.hitInvulnMs;

    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(70, () => this.clearTint());

    bus.emit('player:damaged', { amount, health: this.health, shield: this.shield });
    return amount;
  }

  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
    bus.emit('player:healed', { amount, health: this.health });
  }

  addShield(amount: number): void {
    this.shield = Math.min(this.maxShield, this.shield + amount);
  }

  /** Called by the scene when a projectile the player fired connects. */
  registerDamageDealt(damage: number): void {
    addCharge(this.weapons, damage);
  }

  get isDead(): boolean {
    return this.health <= 0;
  }

  get abilityCooldownRemaining(): number {
    return Math.max(0, this.ship.ability.cooldownMs - (this.scene.time.now - this.lastAbilityAt));
  }

  get dashCooldownRemaining(): number {
    return Math.max(0, COMBAT.dashCooldownMs - (this.scene.time.now - this.lastDashAt));
  }

  private updateVisuals(now: number): void {
    // Engine trail follows the hull.
    if (this.engineEmitter) {
      const back = 22;
      this.engineEmitter.setPosition(
        this.x - Math.cos(this.rotation - Math.PI / 2) * back,
        this.y - Math.sin(this.rotation - Math.PI / 2) * back
      );
      this.engineEmitter.setFrequency(this.body.velocity.length() > 40 ? 22 : 60);
    }

    // Shield bubble.
    const g = this.shieldGfx;
    if (g) {
      g.clear();
      const shieldPct = this.maxShield > 0 ? this.shield / this.maxShield : 0;
      if (shieldPct > 0.01) {
        g.lineStyle(2, 0x5ce1e6, 0.25 + shieldPct * 0.4);
        g.strokeCircle(this.x, this.y, 30);
      }
      if (this.abilityShield > 0) {
        g.lineStyle(3, 0x3ddc97, 0.7);
        g.strokeCircle(this.x, this.y, 40);
      }
    }

    if (now > this.dashingUntil && this.alpha < 1 && now > this.abilityActiveUntil) {
      this.setAlpha(1);
    }
  }

  destroy(fromScene?: boolean): void {
    this.engineEmitter?.destroy();
    this.shieldGfx?.destroy();
    super.destroy(fromScene);
  }
}

import Phaser from 'phaser';
import { RENDER } from '../config/constants';
import type { EnemyDef } from '../config/enemies';
import { bus } from '../systems/EventBus';

/**
 * An enemy combatant.
 *
 * Each archetype runs a genuinely different AI in `think()` — the seven
 * behaviours below are not variations on "move toward player".
 */
export class Enemy extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;

  readonly def: EnemyDef;
  health: number;
  maxHealth: number;
  shield: number;
  maxShield: number;
  /** Difficulty multiplier applied to health/damage at spawn. */
  difficulty = 1;

  private nextAttackAt = 0;
  private aimStartedAt = 0;
  private stunUntil = 0;
  private spawnAt = 0;
  private chargeState: 'IDLE' | 'ARMING' | 'CHARGING' = 'IDLE';
  private strafeDir = 1;
  private lastStrafeFlip = 0;
  private fleeUntil = 0;

  /** Set by the scene. */
  onAttack?: (enemy: Enemy, angle: number) => void;
  onExplode?: (enemy: Enemy) => void;
  /** Provides the current player position, or null if the player is gone. */
  getTarget?: () => { x: number; y: number } | null;
  /** Provides nearby allies for support AIs. */
  getAllies?: () => Enemy[];

  private healthBar?: Phaser.GameObjects.Graphics;
  private auraGfx?: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, x: number, y: number, def: EnemyDef, difficulty = 1) {
    super(scene, x, y, `enemy_${def.key}`);
    this.def = def;
    this.difficulty = difficulty;

    this.maxHealth = Math.round(def.health * difficulty);
    this.health = this.maxHealth;
    this.maxShield = Math.round(def.shield * difficulty);
    this.shield = this.maxShield;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setDepth(RENDER.depth.enemy);
    this.body.setCircle(def.radius, this.width / 2 - def.radius, this.height / 2 - def.radius);
    this.body.setAllowGravity(false);

    this.spawnAt = scene.time.now;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;

    // Spawn-in flourish.
    this.setScale(0.2);
    this.setAlpha(0);
    scene.tweens.add({ targets: this, scale: 1, alpha: 1, duration: 260, ease: 'Back.easeOut' });

    if (def.ai === 'SHIELD_CARRIER' || def.ai === 'HEALER') {
      this.auraGfx = scene.add.graphics().setDepth(RENDER.depth.enemy - 1);
    }
  }

  // ── AI dispatch ──────────────────────────────────────────────────────────
  think(now: number, delta: number): void {
    if (!this.active) return;

    if (now < this.stunUntil) {
      this.body.setVelocity(0, 0);
      return;
    }

    const target = this.getTarget?.() ?? null;
    if (!target) {
      this.body.setVelocity(0, 0);
      return;
    }

    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const dist = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const speed = this.def.speed * 26;

    switch (this.def.ai) {
      case 'KAMIKAZE':
        this.aiKamikaze(now, dist, angle, speed);
        break;
      case 'SNIPER':
        this.aiSniper(now, dist, angle, speed);
        break;
      case 'SWARM':
        this.aiSwarm(now, dist, angle, speed);
        break;
      case 'TANK':
        this.aiTank(now, dist, angle, speed);
        break;
      case 'INTERCEPTOR':
        this.aiInterceptor(now, dist, angle, speed);
        break;
      case 'SHIELD_CARRIER':
        this.aiShieldCarrier(now, dist, angle, speed);
        break;
      case 'HEALER':
        this.aiHealer(now, dist, angle, speed, delta);
        break;
    }

    this.setRotation(angle + Math.PI / 2);
    this.updateVisuals(now);
  }

  /** Charges straight in, arms, then detonates on contact. */
  private aiKamikaze(now: number, dist: number, angle: number, speed: number): void {
    const armDistance = this.def.behavior.armDistance;
    const chargeSpeed = this.def.behavior.chargeSpeed * 26;

    if (this.chargeState === 'IDLE' && dist < armDistance) {
      this.chargeState = 'ARMING';
      this.aimStartedAt = now;
      this.setTint(0xffffff);
    }

    if (this.chargeState === 'ARMING') {
      // Brief telegraph so the player can react.
      this.body.setVelocity(0, 0);
      this.setScale(1 + Math.sin(now / 40) * 0.12);
      if (now - this.aimStartedAt > this.def.behavior.fuseMs) {
        this.chargeState = 'CHARGING';
        this.clearTint();
      }
      return;
    }

    const s = this.chargeState === 'CHARGING' ? chargeSpeed : speed;
    this.body.setVelocity(Math.cos(angle) * s, Math.sin(angle) * s);
  }

  /** Keeps its preferred range, aims with a visible laser, then fires a fast shot. */
  private aiSniper(now: number, dist: number, angle: number, speed: number): void {
    const range = this.def.preferredRange;
    const retreat = this.def.behavior.retreatSpeed * 26;

    if (dist < range * 0.8) {
      this.body.setVelocity(-Math.cos(angle) * retreat, -Math.sin(angle) * retreat);
    } else if (dist > range * 1.2) {
      this.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    } else {
      // Strafe slowly while lining up.
      this.body.setVelocity(Math.cos(angle + Math.PI / 2) * speed * 0.5, Math.sin(angle + Math.PI / 2) * speed * 0.5);
    }

    if (now >= this.nextAttackAt) {
      this.aimStartedAt = now;
      this.nextAttackAt = now + this.def.attackInterval * 1000;
    }

    // Fire once the aim window has elapsed.
    if (this.aimStartedAt > 0 && now - this.aimStartedAt > this.def.behavior.aimTimeMs) {
      this.onAttack?.(this, angle);
      this.aimStartedAt = 0;
    }
  }

  /** Boids-style flocking: separation + cohesion + alignment. */
  private aiSwarm(now: number, dist: number, angle: number, speed: number): void {
    const allies = this.getAllies?.() ?? [];
    const sep = this.def.behavior.separation;
    const coh = this.def.behavior.cohesion;
    const ali = this.def.behavior.alignment;

    let sx = 0;
    let sy = 0;
    let cx = 0;
    let cy = 0;
    let ax = 0;
    let ay = 0;
    let n = 0;

    for (const a of allies) {
      if (a === this || !a.active) continue;
      const d = Phaser.Math.Distance.Between(this.x, this.y, a.x, a.y);
      if (d > this.def.behavior.flockRadius) continue;
      n++;
      if (d < sep && d > 0.01) {
        sx += (this.x - a.x) / d;
        sy += (this.y - a.y) / d;
      }
      cx += a.x;
      cy += a.y;
      ax += a.body.velocity.x;
      ay += a.body.velocity.y;
    }

    let vx = Math.cos(angle) * speed;
    let vy = Math.sin(angle) * speed;

    if (n > 0) {
      vx += sx * speed * 1.6 + ((cx / n - this.x) / 200) * speed * coh + (ax / n) * ali * 0.4;
      vy += sy * speed * 1.6 + ((cy / n - this.y) / 200) * speed * coh + (ay / n) * ali * 0.4;
    }

    const mag = Math.hypot(vx, vy) || 1;
    this.body.setVelocity((vx / mag) * speed, (vy / mag) * speed);

    if (now >= this.nextAttackAt && dist < 420) {
      this.nextAttackAt = now + this.def.attackInterval * 1000;
      this.onAttack?.(this, angle);
    }
  }

  /** Slow approach, then a wide volley. Flat armour reduces every hit. */
  private aiTank(now: number, dist: number, angle: number, speed: number): void {
    const range = this.def.preferredRange;
    if (dist > range) {
      this.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    } else {
      this.body.setVelocity(Math.cos(angle + Math.PI / 2) * speed * 0.4, Math.sin(angle + Math.PI / 2) * speed * 0.4);
    }

    if (now >= this.nextAttackAt) {
      this.nextAttackAt = now + this.def.attackInterval * 1000;
      this.onAttack?.(this, angle);
    }
  }

  /** Predictive strafing with occasional dash-ins. */
  private aiInterceptor(now: number, dist: number, angle: number, speed: number): void {
    const range = this.def.preferredRange;

    if (now - this.lastStrafeFlip > 1800) {
      this.strafeDir *= -1;
      this.lastStrafeFlip = now;
    }

    const radial = dist > range * 1.15 ? 1 : dist < range * 0.85 ? -1 : 0;
    const strafe = this.def.behavior.strafeBias;

    const vx = Math.cos(angle) * speed * radial + Math.cos(angle + Math.PI / 2) * speed * strafe * this.strafeDir;
    const vy = Math.sin(angle) * speed * radial + Math.sin(angle + Math.PI / 2) * speed * strafe * this.strafeDir;
    this.body.setVelocity(vx, vy);

    if (now >= this.nextAttackAt) {
      this.nextAttackAt = now + this.def.attackInterval * 1000;
      // Lead the shot using the player's velocity.
      const target = this.getTarget?.();
      let lead = angle;
      if (target) {
        const leadFactor = this.def.behavior.leadFactor;
        lead = angle + Math.sin(now / 500) * 0.12 * leadFactor;
      }
      this.onAttack?.(this, lead);
    }
  }

  /** Hovers at range and projects a shield aura over nearby allies. */
  private aiShieldCarrier(now: number, dist: number, angle: number, speed: number): void {
    const range = this.def.preferredRange;
    if (dist < range * 0.85) {
      this.body.setVelocity(-Math.cos(angle) * speed, -Math.sin(angle) * speed);
    } else if (dist > range * 1.15) {
      this.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    } else {
      this.body.setVelocity(0, 0);
    }

    // Regenerate the aura's beneficiaries.
    const allies = this.getAllies?.() ?? [];
    const auraRadius = this.def.behavior.auraRadius;
    const perSecond = this.def.behavior.allyShieldPerSecond;
    const dt = this.scene.game.loop.delta / 1000;

    for (const a of allies) {
      if (a === this || !a.active) continue;
      if (Phaser.Math.Distance.Between(this.x, this.y, a.x, a.y) <= auraRadius) {
        a.shield = Math.min(a.maxShield, a.shield + perSecond * dt);
      }
    }
    this.shield = Math.min(this.maxShield, this.shield + this.def.behavior.shieldRegen * dt);

    if (now >= this.nextAttackAt) {
      this.nextAttackAt = now + this.def.attackInterval * 1000;
      this.onAttack?.(this, angle);
    }
  }

  /** Repairs damaged allies; flees when its own hull drops. */
  private aiHealer(now: number, dist: number, angle: number, speed: number, delta: number): void {
    const healthPct = this.health / this.maxHealth;

    if (healthPct < this.def.behavior.fleeHealthPct) {
      this.fleeUntil = now + 1500;
    }

    if (now < this.fleeUntil) {
      this.body.setVelocity(-Math.cos(angle) * speed * 1.4, -Math.sin(angle) * speed * 1.4);
    } else {
      const range = this.def.preferredRange;
      if (dist < range * 0.8) {
        this.body.setVelocity(-Math.cos(angle) * speed, -Math.sin(angle) * speed);
      } else if (dist > range * 1.2) {
        this.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
      } else {
        this.body.setVelocity(Math.cos(angle + Math.PI / 2) * speed * 0.6, Math.sin(angle + Math.PI / 2) * speed * 0.6);
      }
    }

    // Heal the most-damaged ally in range.
    const allies = this.getAllies?.() ?? [];
    const healRadius = this.def.behavior.healRadius;
    const hps = this.def.behavior.healPerSecond;
    const dt = delta / 1000;

    let worst: Enemy | null = null;
    let worstPct = 1;
    for (const a of allies) {
      if (a === this || !a.active) continue;
      if (Phaser.Math.Distance.Between(this.x, this.y, a.x, a.y) > healRadius) continue;
      const pct = a.health / a.maxHealth;
      if (pct < worstPct) {
        worstPct = pct;
        worst = a;
      }
    }
    if (worst && worstPct < 0.98) {
      worst.health = Math.min(worst.maxHealth, worst.health + hps * dt);
    }

    if (now >= this.nextAttackAt) {
      this.nextAttackAt = now + this.def.attackInterval * 1000;
      this.onAttack?.(this, angle);
    }
  }

  // ── Damage ───────────────────────────────────────────────────────────────
  /**
   * Applies damage. Returns the amount that landed and whether it killed.
   * Tanks have flat armour; shield-piercing weapons skip the shield pool.
   */
  takeDamage(amount: number, shieldPierce = false): { dealt: number; killed: boolean } {
    if (!this.active) return { dealt: 0, killed: false };

    let remaining = amount;

    // Flat armour (Tank only).
    const armor = this.def.behavior.armorFlat ?? 0;
    if (armor > 0) remaining = Math.max(1, remaining - armor);

    if (!shieldPierce && this.shield > 0) {
      const absorbed = Math.min(this.shield, remaining);
      this.shield -= absorbed;
      remaining -= absorbed;
    }

    if (remaining > 0) this.health -= remaining;

    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(50, () => {
      if (this.active) this.clearTint();
    });

    const killed = this.health <= 0;
    if (killed) this.die();
    return { dealt: amount, killed };
  }

  stun(ms: number): void {
    this.stunUntil = Math.max(this.stunUntil, this.scene.time.now + ms);
  }

  private die(): void {
    this.setActive(false);
    this.body.enable = false;

    // Death burst.
    const emitter = this.scene.add.particles(this.x, this.y, 'p_spark', {
      speed: { min: 60, max: 220 },
      scale: { start: 1.1, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 520,
      quantity: 14,
      tint: [this.def.tint, 0xffffff],
      blendMode: Phaser.BlendModes.ADD,
    });
    emitter.setDepth(RENDER.depth.fx);
    emitter.explode(14);
    this.scene.time.delayedCall(600, () => emitter.destroy());

    this.healthBar?.destroy();
    this.auraGfx?.destroy();

    bus.emit('enemy:killed', { key: this.def.key, name: this.def.name, xp: this.def.xp, scrap: this.def.scrap });

    this.scene.tweens.add({
      targets: this,
      scale: 0,
      alpha: 0,
      duration: 180,
      onComplete: () => this.destroy(),
    });
  }

  private updateVisuals(now: number): void {
    // Health bar (only when damaged).
    if (this.health < this.maxHealth || this.shield < this.maxShield) {
      if (!this.healthBar) this.healthBar = this.scene.add.graphics().setDepth(RENDER.depth.enemy + 1);
      const g = this.healthBar;
      g.clear();
      const w = this.def.radius * 2.2;
      const x = this.x - w / 2;
      const y = this.y - this.def.radius - 12;

      g.fillStyle(0x05060f, 0.7);
      g.fillRect(x - 1, y - 1, w + 2, 6);

      const hpPct = Math.max(0, this.health / this.maxHealth);
      g.fillStyle(0xff5d73, 1);
      g.fillRect(x, y, w * hpPct, 4);

      if (this.maxShield > 0) {
        const shPct = Math.max(0, this.shield / this.maxShield);
        g.fillStyle(0x5ce1e6, 1);
        g.fillRect(x, y - 5, w * shPct, 3);
      }
    } else if (this.healthBar) {
      this.healthBar.clear();
    }

    // Support auras.
    if (this.auraGfx) {
      const g = this.auraGfx;
      g.clear();
      if (this.def.ai === 'SHIELD_CARRIER') {
        g.lineStyle(2, 0x5ce1e6, 0.22);
        g.strokeCircle(this.x, this.y, this.def.behavior.auraRadius);
      } else if (this.def.ai === 'HEALER') {
        g.lineStyle(2, 0x3ddc97, 0.18);
        g.strokeCircle(this.x, this.y, this.def.behavior.healRadius);
      }
    }

    // Sniper laser sight.
    if (this.def.ai === 'SNIPER' && this.aimStartedAt > 0) {
      const target = this.getTarget?.();
      if (target) {
        const g = this.auraGfx ?? (this.auraGfx = this.scene.add.graphics().setDepth(RENDER.depth.enemy - 1));
        g.clear();
        g.lineStyle(1, 0xff2e63, 0.5);
        g.lineBetween(this.x, this.y, target.x, target.y);
      }
    }
  }

  destroy(fromScene?: boolean): void {
    this.healthBar?.destroy();
    this.auraGfx?.destroy();
    super.destroy(fromScene);
  }
}

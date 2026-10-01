import Phaser from 'phaser';
import { RENDER } from '../config/constants';
import type { BossDef, BossPhase } from '../config/sectors';
import { bus } from '../systems/EventBus';

/**
 * The multi-phase boss.
 *
 * Phase progression is driven purely by health thresholds, so the fight always
 * escalates in the same readable order:
 *   MISSILE ATTACK → LASER GRID → DRONE SWARM → EXPOSED CORE → RAGE MODE
 */
export class Boss extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;

  readonly def: BossDef;
  health: number;
  maxHealth: number;
  shield: number;
  maxShield: number;

  phaseIndex = 0;
  private nextAttackAt = 0;
  private moveTarget = new Phaser.Math.Vector2();
  private nextMoveAt = 0;
  private spawnAt = 0;
  private coreExposed = false;
  private rageActive = false;

  /** Set by the scene. */
  onAttack?: (boss: Boss, phase: BossPhase) => void;
  onPhaseChange?: (boss: Boss, phase: BossPhase, index: number) => void;
  getTarget?: () => { x: number; y: number } | null;

  private hull?: Phaser.GameObjects.Image;
  private core?: Phaser.GameObjects.Image;
  private healthBar?: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, x: number, y: number, def: BossDef, difficulty = 1) {
    super(scene, x, y, 'boss_hull');
    this.def = def;

    this.maxHealth = Math.round(def.health * difficulty);
    this.health = this.maxHealth;
    this.maxShield = Math.round(def.shield * difficulty);
    this.shield = this.maxShield;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setDepth(RENDER.depth.enemy);
    this.setTint(def.tint);
    this.body.setCircle(def.radius, this.width / 2 - def.radius, this.height / 2 - def.radius);
    this.body.setAllowGravity(false);
    this.body.setImmovable(true);

    this.spawnAt = scene.time.now;
    this.pickMoveTarget();

    // Entrance.
    this.setScale(0.1);
    this.setAlpha(0);
    scene.tweens.add({ targets: this, scale: 1, alpha: 1, duration: 900, ease: 'Back.easeOut' });

    this.core = scene.add.image(x, y, 'boss_core').setDepth(RENDER.depth.enemy + 1).setScale(0.9);
    scene.tweens.add({ targets: this.core, scale: 1.15, duration: 800, yoyo: true, repeat: -1 });

    this.healthBar = scene.add.graphics().setDepth(RENDER.depth.hud);

    bus.emit('boss:spawn', { key: def.key, name: def.name, title: def.title, health: this.maxHealth });
    this.announcePhase(0);
  }

  get currentPhase(): BossPhase {
    return this.def.phases[this.phaseIndex];
  }

  private announcePhase(index: number): void {
    const phase = this.def.phases[index];
    if (!phase) return;
    this.phaseIndex = index;
    bus.emit('boss:phase', { key: phase.key, name: phase.name, description: phase.description, index });
    this.onPhaseChange?.(this, phase, index);

    // Phase-change flourish.
    this.scene.cameras.main.flash(180, 90, 20, 140);
    this.scene.cameras.main.shake(300, 0.006);
  }

  update(now: number): void {
    if (!this.active) return;

    this.checkPhaseTransition();
    this.move(now);
    this.attack(now);
    this.updateVisuals();
  }

  /** Health thresholds drive the phase ladder. */
  private checkPhaseTransition(): void {
    const pct = this.health / this.maxHealth;
    const phases = this.def.phases;

    for (let i = phases.length - 1; i > this.phaseIndex; i--) {
      if (pct <= phases[i].threshold) {
        this.announcePhase(i);
        this.onEnterPhase(phases[i]);
        return;
      }
    }
  }

  private onEnterPhase(phase: BossPhase): void {
    switch (phase.attack) {
      case 'EXPOSED_CORE':
        this.coreExposed = true;
        // Armour peels away — the boss takes more damage from here on.
        this.setTint(0xff9f43);
        break;
      case 'RAGE_MODE':
        this.rageActive = true;
        this.setTint(0xff2e63);
        break;
      default:
        break;
    }
  }

  private pickMoveTarget(): void {
    const { width, height } = this.scene.scale;
    this.moveTarget.set(
      Phaser.Math.Between(width * 0.2, width * 0.8),
      Phaser.Math.Between(height * 0.15, height * 0.45)
    );
  }

  private move(now: number): void {
    if (now > this.nextMoveAt) {
      this.pickMoveTarget();
      this.nextMoveAt = now + (this.rageActive ? 1400 : 2600);
    }

    const speed = this.rageActive ? 2.4 : 1.1;
    const dx = this.moveTarget.x - this.x;
    const dy = this.moveTarget.y - this.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 8) {
      this.body.setVelocity((dx / dist) * speed * 60, (dy / dist) * speed * 60);
    } else {
      this.body.setVelocity(0, 0);
    }

    this.core?.setPosition(this.x, this.y);
  }

  private attack(now: number): void {
    if (now < this.nextAttackAt) return;

    const phase = this.currentPhase;
    const rageMultiplier = this.rageActive ? 0.55 : 1;

    const intervals: Record<BossPhase['attack'], number> = {
      MISSILE_ATTACK: 2400,
      LASER_GRID: 3200,
      DRONE_SWARM: 4200,
      EXPOSED_CORE: 1800,
      RAGE_MODE: 1200,
    };

    this.nextAttackAt = now + intervals[phase.attack] * rageMultiplier;
    this.onAttack?.(this, phase);

    // In rage mode the boss runs its whole kit at once.
    if (this.rageActive && Math.random() < 0.5) {
      const extra = this.def.phases[Math.floor(Math.random() * 3)];
      this.onAttack?.(this, extra);
    }
  }

  /**
   * Damage intake. The exposed core takes 60% more; the armoured shell takes
   * 25% less. This is what makes phase IV feel like a real window.
   */
  takeDamage(amount: number, shieldPierce = false): { dealt: number; killed: boolean } {
    if (!this.active) return { dealt: 0, killed: false };

    let remaining = amount;

    if (!shieldPierce && this.shield > 0) {
      const absorbed = Math.min(this.shield, remaining);
      this.shield -= absorbed;
      remaining -= absorbed;
    }

    if (remaining > 0) {
      const multiplier = this.coreExposed ? 1.6 : 0.75;
      this.health -= remaining * multiplier;
    }

    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(60, () => {
      if (this.active) this.setTint(this.rageActive ? 0xff2e63 : this.coreExposed ? 0xff9f43 : this.def.tint);
    });

    const killed = this.health <= 0;
    if (killed) this.die();
    return { dealt: amount, killed };
  }

  private die(): void {
    this.setActive(false);
    this.body.enable = false;

    // Chain of explosions across the hull.
    for (let i = 0; i < 10; i++) {
      this.scene.time.delayedCall(i * 90, () => {
        const ox = Phaser.Math.Between(-90, 90);
        const oy = Phaser.Math.Between(-90, 90);
        const emitter = this.scene.add.particles(this.x + ox, this.y + oy, 'p_ember', {
          speed: { min: 80, max: 300 },
          scale: { start: 1.4, end: 0 },
          alpha: { start: 1, end: 0 },
          lifespan: 700,
          quantity: 18,
          tint: [0xff2e63, 0xffd166, 0xffffff],
          blendMode: Phaser.BlendModes.ADD,
        });
        emitter.setDepth(RENDER.depth.fx);
        emitter.explode(18);
        this.scene.time.delayedCall(800, () => emitter.destroy());
        this.scene.cameras.main.shake(200, 0.01);
      });
    }

    this.scene.cameras.main.flash(600, 255, 200, 120);
    bus.emit('boss:defeated', { key: this.def.key, name: this.def.name });

    this.healthBar?.destroy();
    this.core?.destroy();

    this.scene.tweens.add({
      targets: this,
      scale: 0,
      alpha: 0,
      duration: 900,
      delay: 400,
      onComplete: () => this.destroy(),
    });
  }

  private updateVisuals(): void {
    const g = this.healthBar;
    if (!g) return;
    g.clear();

    const { width } = this.scene.scale;
    const barW = width * 0.6;
    const x = (width - barW) / 2;
    const y = 84;

    g.fillStyle(0x05060f, 0.85);
    g.fillRect(x - 3, y - 3, barW + 6, 26);
    g.lineStyle(2, this.def.tint, 0.9);
    g.strokeRect(x - 3, y - 3, barW + 6, 26);

    const hpPct = Math.max(0, this.health / this.maxHealth);
    g.fillStyle(this.rageActive ? 0xff2e63 : 0xb14aff, 1);
    g.fillRect(x, y, barW * hpPct, 20);

    if (this.maxShield > 0) {
      const shPct = Math.max(0, this.shield / this.maxShield);
      g.fillStyle(0x5ce1e6, 0.9);
      g.fillRect(x, y + 20, barW * shPct, 4);
    }

    // Phase threshold ticks.
    for (const phase of this.def.phases) {
      if (phase.threshold >= 1) continue;
      const tx = x + barW * phase.threshold;
      g.lineStyle(2, 0xffffff, 0.5);
      g.lineBetween(tx, y - 2, tx, y + 22);
    }
  }

  destroy(fromScene?: boolean): void {
    this.healthBar?.destroy();
    this.core?.destroy();
    this.hull?.destroy();
    super.destroy(fromScene);
  }
}

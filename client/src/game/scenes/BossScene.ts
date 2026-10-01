import Phaser from 'phaser';
import { COLORS, GAME_HEIGHT, GAME_WIDTH, RENDER, SCENE_KEYS, SECTOR, WORLD } from '../config/constants';
import { Rarity } from '../config/rarity';
import { getShip, RAPTOR_X } from '../config/ships';
import { bossForSector, planSector, type BossPhase } from '../config/sectors';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { Boss } from '../entities/Boss';
import { BulletPool } from '../entities/Bullet';
import { Loot } from '../entities/Loot';
import { InputSystem } from '../systems/InputSystem';
import { SectorGenerator } from '../systems/SectorGenerator';
import { bus } from '../systems/EventBus';
import { rollLoot } from '../systems/LootSystem';
import { computeShipStats, applyXp } from '../systems/ProgressionSystem';
import { RunTracker, buildRunResult } from '../systems/AntiCheat';
import { SaveSystem } from '../systems/SaveSystem';
import { getEnemy } from '../config/enemies';
import type { RunState, SaveData } from '../systems/types';

interface Carried {
  score: number;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  lootValue: number;
  xpGained: number;
  scrapGained: number;
  plasmaGained: number;
  abilitiesUsed: number;
  startedAt: number;
}

/**
 * BossScene — the multi-phase boss encounter.
 *
 * VOID TITAN phase ladder (health-threshold driven):
 *   I   MISSILE ATTACK  — homing ordnance volleys
 *   II  LASER GRID      — sweeping laser lattices with safe lanes
 *   III DRONE SWARM     — the boss stops attacking and spawns adds
 *   IV  EXPOSED CORE    — armour peels; the boss takes 60% more damage
 *   V   RAGE MODE       — everything at once, faster
 */
export class BossScene extends Phaser.Scene {
  private player!: Player;
  private input$!: InputSystem;
  private boss!: Boss;
  private sectorGen!: SectorGenerator;

  private enemies: Enemy[] = [];
  private loot: Loot[] = [];
  private playerBullets!: BulletPool;
  private enemyBullets!: BulletPool;
  private lasers: Phaser.GameObjects.Image[] = [];

  private run!: RunState;
  private tracker!: RunTracker;
  private sessionKey = 'offline-session-key';
  private carried!: Carried;

  private paused = false;
  private ended = false;
  private bossKilled = false;
  private phaseBanner?: Phaser.GameObjects.Text;
  private phaseSub?: Phaser.GameObjects.Text;

  private hud!: Phaser.GameObjects.Graphics;
  private hudText!: Phaser.GameObjects.Text;
  private save!: SaveData;

  constructor() {
    super({ key: SCENE_KEYS.BOSS });
  }

  init(data: { sectorIndex?: number; seed?: number; sessionKey?: string; sessionId?: string; carried?: Carried }): void {
    const sectorIndex = data?.sectorIndex ?? SECTOR.bossEvery;
    const seed = data?.seed ?? Math.floor(Math.random() * 1e9);
    this.sessionKey = data?.sessionKey ?? 'offline-session-key';

    this.carried = data?.carried ?? {
      score: 0,
      kills: 0,
      damageDealt: 0,
      damageTaken: 0,
      lootValue: 0,
      xpGained: 0,
      scrapGained: 0,
      plasmaGained: 0,
      abilitiesUsed: 0,
      startedAt: Date.now(),
    };

    const plan = planSector(sectorIndex, seed, {
      bossEvery: SECTOR.bossEvery,
      baseEnemyCount: SECTOR.baseEnemyCount,
      enemyCountPerSector: SECTOR.enemyCountPerSector,
      difficultyPerSector: SECTOR.difficultyPerSector,
    });

    this.run = {
      sessionId: data?.sessionId ?? `sess_${Date.now().toString(36)}`,
      seed,
      sectorIndex,
      biome: plan.biome.key,
      isBoss: true,
      startedAt: this.carried.startedAt,
      score: this.carried.score,
      kills: this.carried.kills,
      damageDealt: this.carried.damageDealt,
      damageTaken: this.carried.damageTaken,
      lootValue: this.carried.lootValue,
      xpGained: this.carried.xpGained,
      scrapGained: this.carried.scrapGained,
      plasmaGained: this.carried.plasmaGained,
      abilitiesUsed: this.carried.abilitiesUsed,
      scoreBuckets: [],
      killBuckets: [],
    };

    this.paused = false;
    this.ended = false;
    this.bossKilled = false;
    this.enemies = [];
    this.loot = [];
    this.lasers = [];
  }

  create(): void {
    this.save = (this.registry.get('save') as SaveData) ?? SaveSystem.load();

    this.physics.world.setBounds(0, 0, WORLD.width, WORLD.height);
    this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height);
    this.cameras.main.setBackgroundColor(COLORS.bgDeep);

    const plan = planSector(this.run.sectorIndex, this.run.seed, {
      bossEvery: SECTOR.bossEvery,
      baseEnemyCount: SECTOR.baseEnemyCount,
      enemyCountPerSector: SECTOR.enemyCountPerSector,
      difficultyPerSector: SECTOR.difficultyPerSector,
    });

    this.sectorGen = new SectorGenerator(this, plan);
    this.sectorGen.buildBackground();

    // Player
    const ownedShip = this.save.profile.ships.find((s) => s.id === this.save.profile.equippedShipId);
    const shipDef = getShip(ownedShip?.shipKey ?? RAPTOR_X.key);
    const stats = computeShipStats(shipDef.stats, ownedShip?.level ?? 1, {});

    this.player = new Player(this, WORLD.width / 2, WORLD.height - 260, shipDef, stats, this.save.profile.loadout);
    this.player.onFire = (x, y, angle, texture, damage, crit, weaponKey, pierce, speed, lifetimeMs) =>
      this.spawnPlayerBullet(x, y, angle, texture, damage, crit, weaponKey, pierce, speed, lifetimeMs);
    this.player.onAbility = (effect, magnitude, durationMs) => this.handleAbility(effect, magnitude, durationMs);

    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);

    this.playerBullets = new BulletPool(this, 'bullet_player', 160);
    this.enemyBullets = new BulletPool(this, 'bullet_enemy', 240);

    this.input$ = new InputSystem(this, {
      joystick: this.save.settings.virtualJoystick,
      onPause: () => this.togglePause(),
    });

    this.input.keyboard?.on('keydown-Q', () => this.player.fireSecondary(this.player.rotation - Math.PI / 2, this.time.now));
    this.input.keyboard?.on('keydown-R', () => this.player.fireUltimate(this.player.rotation - Math.PI / 2, this.time.now));

    // Boss
    const bossDef = bossForSector(this.run.sectorIndex);
    this.boss = new Boss(this, WORLD.width / 2, WORLD.height / 2 - 120, bossDef, 1 + this.run.sectorIndex * 0.05);
    this.boss.getTarget = () => (this.player.active ? { x: this.player.x, y: this.player.y } : null);
    this.boss.onAttack = (b, phase) => this.bossAttack(b, phase);
    this.boss.onPhaseChange = (b, phase, index) => this.onPhaseChange(phase, index);

    this.buildHud();
    this.tracker = new RunTracker(this.run);

    bus.emit('sector:enter', {
      index: this.run.sectorIndex,
      biome: plan.biome.name,
      designation: `BOSS · ${bossDef.name}`,
      isBoss: true,
    });

    this.cameras.main.fadeIn(600, 5, 6, 15);
  }

  // ── HUD ──────────────────────────────────────────────────────────────────
  private buildHud(): void {
    this.hud = this.add.graphics().setScrollFactor(0).setDepth(RENDER.depth.hud);

    this.hudText = this.add
      .text(24, 22, '', { fontFamily: 'monospace', fontSize: '14px', color: '#e8f1ff' })
      .setScrollFactor(0)
      .setDepth(RENDER.depth.hud + 1);

    this.phaseBanner = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, '', {
        fontFamily: 'Orbitron, Impact, sans-serif',
        fontSize: '40px',
        color: '#ff2e63',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(RENDER.depth.overlay)
      .setAlpha(0);

    this.phaseSub = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 10, '', {
        fontFamily: 'monospace',
        fontSize: '15px',
        color: '#e8f1ff',
        wordWrap: { width: 700 },
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(RENDER.depth.overlay)
      .setAlpha(0);
  }

  private onPhaseChange(phase: BossPhase, index: number): void {
    this.phaseBanner?.setText(phase.name).setAlpha(1).setScale(0.85);
    this.phaseSub?.setText(phase.description).setAlpha(1);

    this.tweens.add({ targets: this.phaseBanner, scale: 1, duration: 300, ease: 'Back.easeOut' });
    this.tweens.add({ targets: [this.phaseBanner, this.phaseSub], alpha: 0, delay: 2400, duration: 600 });

    // Phase III spawns the drone swarm.
    if (phase.attack === 'DRONE_SWARM') this.spawnDroneSwarm();
  }

  private drawHud(): void {
    const g = this.hud;
    g.clear();

    const p = this.player;
    const barW = 260;
    const x = 24;
    const y = 52;

    g.fillStyle(0x05060f, 0.8);
    g.fillRoundedRect(x - 2, y - 2, barW + 4, 18, 4);
    const hpPct = Math.max(0, p.health / p.maxHealth);
    g.fillStyle(hpPct > 0.3 ? 0x3ddc97 : 0xff2e63, 1);
    g.fillRoundedRect(x, y, barW * hpPct, 14, 3);

    const sy = y + 22;
    g.fillStyle(0x05060f, 0.8);
    g.fillRoundedRect(x - 2, sy - 2, barW + 4, 12, 4);
    const shPct = p.maxShield > 0 ? Math.max(0, p.shield / p.maxShield) : 0;
    g.fillStyle(0x5ce1e6, 1);
    g.fillRoundedRect(x, sy, barW * shPct, 8, 3);

    const uy = sy + 18;
    g.fillStyle(0x05060f, 0.8);
    g.fillRoundedRect(x - 2, uy - 2, barW + 4, 10, 4);
    g.fillStyle(p.weapons.charge >= 100 ? 0xffd166 : 0xb14aff, 1);
    g.fillRoundedRect(x, uy, barW * (p.weapons.charge / 100), 6, 3);
  }

  private updateHudText(): void {
    const p = this.player;
    this.hudText.setText(
      [
        `HP ${Math.ceil(p.health)}/${p.maxHealth}   SH ${Math.ceil(p.shield)}/${p.maxShield}`,
        `SCORE ${this.run.score.toLocaleString()}   PHASE ${this.boss.phaseIndex + 1}/${this.boss.def.phases.length}`,
        `[E] ${p.abilityCooldownRemaining <= 0 ? 'READY' : `${(p.abilityCooldownRemaining / 1000).toFixed(1)}s`}   [SHIFT] ${p.dashCooldownRemaining <= 0 ? 'READY' : `${(p.dashCooldownRemaining / 1000).toFixed(1)}s`}   [Q] 2nd   [R] ULT`,
      ].join('\n')
    );
  }

  // ── Boss attacks ─────────────────────────────────────────────────────────
  private bossAttack(boss: Boss, phase: BossPhase): void {
    switch (phase.attack) {
      case 'MISSILE_ATTACK':
        this.attackMissiles(boss);
        break;
      case 'LASER_GRID':
        this.attackLaserGrid(boss);
        break;
      case 'DRONE_SWARM':
        this.spawnDroneSwarm();
        break;
      case 'EXPOSED_CORE':
        this.attackCoreBeam(boss);
        break;
      case 'RAGE_MODE':
        this.attackRage(boss);
        break;
    }
  }

  /** Phase I — homing missile volleys. */
  private attackMissiles(boss: Boss): void {
    const count = 6;
    for (let i = 0; i < count; i++) {
      this.time.delayedCall(i * 120, () => {
        if (!boss.active || this.ended) return;
        const angle = Math.atan2(this.player.y - boss.y, this.player.x - boss.x) + (Math.random() - 0.5) * 0.9;
        const b = this.enemyBullets.get();
        b.setTexture('missile');
        b.fire({
          x: boss.x,
          y: boss.y,
          angle,
          speed: 5.5,
          damage: 14,
          crit: false,
          weaponKey: 'boss_missile',
          pierce: 0,
          lifetimeMs: 5000,
          hostile: true,
          turnRate: 0.035,
          blastRadius: 70,
        });
      });
    }
  }

  /** Phase II — sweeping laser lattices with readable safe lanes. */
  private attackLaserGrid(boss: Boss): void {
    const lanes = 5;
    const gapIndex = Phaser.Math.Between(0, lanes - 1);

    for (let i = 0; i < lanes; i++) {
      if (i === gapIndex) continue; // the safe lane

      const x = (WORLD.width / (lanes + 1)) * (i + 1);
      const laser = this.add.image(x, WORLD.height / 2, 'laser_segment').setDepth(RENDER.depth.fx);
      laser.setDisplaySize(10, WORLD.height);
      laser.setAlpha(0);
      this.lasers.push(laser);

      // Telegraph, then fire.
      this.tweens.add({ targets: laser, alpha: 0.35, duration: 500 });
      this.time.delayedCall(500, () => {
        if (!laser.active || this.ended) return;
        laser.setAlpha(1);
        this.cameras.main.shake(120, 0.004);

        // Damage anything in the beam.
        const check = this.time.addEvent({
          delay: 100,
          repeat: 8,
          callback: () => {
            if (!laser.active) return;
            if (Math.abs(this.player.x - laser.x) < 22) {
              const dealt = this.player.takeDamage(9, this.time.now);
              this.run.damageTaken += dealt;
            }
          },
        });

        this.time.delayedCall(900, () => {
          check.remove();
          this.tweens.add({ targets: laser, alpha: 0, duration: 200, onComplete: () => laser.destroy() });
        });
      });
    }
  }

  /** Phase III — the boss stops attacking and floods the arena with adds. */
  private spawnDroneSwarm(): void {
    const count = 8;
    for (let i = 0; i < count; i++) {
      this.time.delayedCall(i * 180, () => {
        if (this.ended) return;
        const def = getEnemy(i % 3 === 0 ? 'kamikaze' : 'swarm');
        const angle = (Math.PI * 2 * i) / count;
        const x = this.boss.x + Math.cos(angle) * 220;
        const y = this.boss.y + Math.sin(angle) * 220;

        const e = new Enemy(this, x, y, def, 1 + this.run.sectorIndex * 0.05);
        e.getTarget = () => (this.player.active ? { x: this.player.x, y: this.player.y } : null);
        e.getAllies = () => this.enemies;
        e.onAttack = (en, a) => this.enemyAttack(en, a);
        this.enemies.push(e);
      });
    }
  }

  /** Phase IV — a tracking beam from the exposed core. */
  private attackCoreBeam(boss: Boss): void {
    const beam = this.add.graphics().setDepth(RENDER.depth.fx);
    let ticks = 0;

    const timer = this.time.addEvent({
      delay: 90,
      repeat: 22,
      callback: () => {
        if (!boss.active || this.ended) {
          timer.remove();
          beam.destroy();
          return;
        }
        ticks++;
        beam.clear();
        beam.lineStyle(6, 0xff2e63, 0.85);
        beam.lineBetween(boss.x, boss.y, this.player.x, this.player.y);

        if (ticks % 4 === 0) {
          const dealt = this.player.takeDamage(6, this.time.now);
          this.run.damageTaken += dealt;
        }

        // Final tick (initial call + `repeat` repeats) — clean the beam up.
        if (ticks > 22) beam.destroy();
      },
    });
  }

  /** Phase V — everything, faster. */
  private attackRage(boss: Boss): void {
    this.attackMissiles(boss);
    this.time.delayedCall(400, () => {
      if (boss.active && !this.ended) this.attackLaserGrid(boss);
    });
  }

  private enemyAttack(enemy: Enemy, angle: number): void {
    const def = enemy.def;
    const damage = Math.round(def.damage * (1 + this.run.sectorIndex * 0.05));

    if (def.ai === 'KAMIKAZE') {
      this.explodeAt(enemy.x, enemy.y, def.behavior.blastRadius, damage);
      enemy.takeDamage(99999);
      return;
    }
    if (def.projectileSpeed > 0) {
      const b = this.enemyBullets.get();
      b.setTexture('bullet_enemy');
      b.fire({ x: enemy.x, y: enemy.y, angle, speed: def.projectileSpeed, damage, crit: false, weaponKey: 'enemy', pierce: 0, lifetimeMs: 3000, hostile: true });
    }
  }

  private explodeAt(x: number, y: number, radius: number, damage: number): void {
    const emitter = this.add.particles(x, y, 'p_ember', {
      speed: { min: 80, max: 260 },
      scale: { start: 1.3, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 500,
      quantity: 18,
      tint: [0xff5d73, 0xffd166],
      blendMode: Phaser.BlendModes.ADD,
    });
    emitter.setDepth(RENDER.depth.fx);
    emitter.explode(18);
    this.time.delayedCall(600, () => emitter.destroy());

    if (Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) <= radius) {
      const dealt = this.player.takeDamage(damage, this.time.now);
      this.run.damageTaken += dealt;
    }
  }

  private handleAbility(effect: string, magnitude: number, durationMs: number): void {
    this.run.abilitiesUsed++;

    if (effect === 'BURST') {
      const radius = 300;
      const targets: (Enemy | Boss)[] = [...this.enemies.filter((e) => e.active), this.boss];
      for (const t of targets) {
        if (!t.active) continue;
        if (Phaser.Math.Distance.Between(this.player.x, this.player.y, t.x, t.y) > radius) continue;
        const dmg = Math.round(this.player.stats.damage * magnitude);
        const res = t.takeDamage(dmg);
        this.run.damageDealt += res.dealt;
        this.player.registerDamageDealt(res.dealt);
        if (res.killed && t instanceof Enemy) this.onEnemyKilled(t);
      }
      this.cameras.main.flash(200, 120, 60, 200);
    }

    if (effect === 'TIME_DILATION') {
      for (const e of this.enemies) if (e.active) e.stun(durationMs);
    }
  }

  private spawnPlayerBullet(
    x: number,
    y: number,
    angle: number,
    texture: string,
    damage: number,
    crit: boolean,
    weaponKey: string,
    pierce: number,
    speed: number,
    lifetimeMs: number
  ): void {
    const b = this.playerBullets.get();
    b.setTexture(texture);
    b.fire({ x, y, angle, speed, damage, crit, weaponKey, pierce, lifetimeMs });

    if (weaponKey === 'seeker_pod') {
      b.turnRate = 0.09;
      b.blastRadius = 60;
    }
    if (weaponKey === 'rail_lance') b.shieldPierce = true;
    if (weaponKey === 'void_needler') {
      b.chainCount = 3;
      b.chainRange = 190;
      b.chainFalloff = 0.65;
    }
    if (weaponKey === 'arc_tesla') {
      b.chainCount = 6;
      b.chainRange = 260;
      b.stunMs = 400;
    }
    if (weaponKey === 'orbital_barrage') b.blastRadius = 130;
    if (weaponKey === 'rift_singularity') b.blastRadius = 300;
  }

  // ── Loop ─────────────────────────────────────────────────────────────────
  update(_time: number, delta: number): void {
    if (this.paused || this.ended) return;

    const now = this.time.now;
    const input = this.input$.update();

    this.player.update(input, now);
    if (this.boss.active) this.boss.update(now);

    for (const e of this.enemies) if (e.active) e.think(now, delta);

    this.playerBullets.forEachActive((b) => b.update(now, this.nearestTarget(b.x, b.y)));
    this.enemyBullets.forEachActive((b) => b.update(now, { x: this.player.x, y: this.player.y }));

    for (const l of this.loot) {
      if (l.active) l.update(now, this.player.active ? this.player : null, this.player.weapons.modifiers.magnet);
    }

    this.resolveCollisions();
    this.cleanup();

    this.tracker.tick(now);
    this.drawHud();
    this.updateHudText();

    if (this.player.isDead) this.finishRun(false);
  }

  private nearestTarget(x: number, y: number): { x: number; y: number } | undefined {
    let best: { x: number; y: number } | undefined;
    let bestD = Infinity;

    if (this.boss.active) {
      const d = Phaser.Math.Distance.Between(x, y, this.boss.x, this.boss.y);
      bestD = d;
      best = { x: this.boss.x, y: this.boss.y };
    }

    for (const e of this.enemies) {
      if (!e.active) continue;
      const d = Phaser.Math.Distance.Between(x, y, e.x, e.y);
      if (d < bestD) {
        bestD = d;
        best = { x: e.x, y: e.y };
      }
    }
    return best;
  }

  private resolveCollisions(): void {
    const now = this.time.now;

    this.playerBullets.forEachActive((b) => {
      if (!b.active) return;

      // Boss
      if (this.boss.active && !b.hitSet.has(this.boss)) {
        if (Phaser.Math.Distance.Between(b.x, b.y, this.boss.x, this.boss.y) <= this.boss.def.radius + 12) {
          b.hitSet.add(this.boss);
          const res = this.boss.takeDamage(b.damage, b.shieldPierce);
          this.run.damageDealt += res.dealt;
          this.player.registerDamageDealt(res.dealt);

          if (res.killed) this.onBossKilled();

          if (b.registerHit()) {
            if (b.blastRadius > 0) this.explodeAt(b.x, b.y, b.blastRadius, b.damage);
            b.kill();
            return;
          }
        }
      }

      // Adds
      for (const e of this.enemies) {
        if (!e.active || b.hitSet.has(e)) continue;
        if (Phaser.Math.Distance.Between(b.x, b.y, e.x, e.y) > e.def.radius + 10) continue;

        b.hitSet.add(e);
        const res = e.takeDamage(b.damage, b.shieldPierce);
        this.run.damageDealt += res.dealt;
        this.player.registerDamageDealt(res.dealt);
        if (res.killed) this.onEnemyKilled(e);

        if (b.registerHit()) {
          if (b.blastRadius > 0) this.explodeAt(b.x, b.y, b.blastRadius, b.damage);
          b.kill();
          break;
        }
      }
    });

    this.enemyBullets.forEachActive((b) => {
      if (!b.active) return;
      if (Phaser.Math.Distance.Between(b.x, b.y, this.player.x, this.player.y) > 24) return;
      const dealt = this.player.takeDamage(b.damage, now);
      this.run.damageTaken += dealt;
      if (b.blastRadius > 0) this.explodeAt(b.x, b.y, b.blastRadius, 0);
      b.kill();
    });

    for (const e of this.enemies) {
      if (!e.active) continue;
      if (Phaser.Math.Distance.Between(e.x, e.y, this.player.x, this.player.y) > e.def.radius + 18) continue;
      if (e.def.ai === 'KAMIKAZE') {
        this.explodeAt(e.x, e.y, e.def.behavior.blastRadius, Math.round(e.def.damage));
        e.takeDamage(99999);
        this.onEnemyKilled(e);
      } else {
        const dealt = this.player.takeDamage(Math.round(e.def.damage * 0.5), now);
        this.run.damageTaken += dealt;
      }
    }

    for (const l of this.loot) {
      if (!l.active) continue;
      if (Phaser.Math.Distance.Between(l.x, l.y, this.player.x, this.player.y) > 30) continue;
      this.collectLoot(l);
    }
  }

  private onEnemyKilled(e: Enemy): void {
    this.run.kills++;
    this.run.xpGained += e.def.xp;
    this.run.scrapGained += e.def.scrap;
    this.run.score += e.def.xp * 10;

    if (Math.random() < e.def.lootChance) {
      const drop = rollLoot(0.2, e.def.maxDropRarity);
      if (drop) this.loot.push(new Loot(this, e.x, e.y, { drop }));
    }
  }

  private collectLoot(l: Loot): void {
    l.collect();
    if (l.kind === 'ITEM' && l.drop) {
      this.run.lootValue += l.drop.value;
      this.run.scrapGained += Math.round(l.drop.value * 0.4);
      this.run.score += l.drop.value * 3;
      bus.emit('loot:pickup', { itemKey: l.drop.itemKey, name: l.drop.name, rarity: l.drop.rarity, value: l.drop.value });
    } else if (l.kind === 'POWERUP' && l.powerUp) {
      const pu = l.powerUp;
      if (pu.kind === 'HEAL') this.player.heal(pu.magnitude);
      else if (pu.kind === 'SHIELD') this.player.addShield(pu.magnitude);
      bus.emit('powerup:pickup', { kind: pu.kind, name: pu.name });
    }
  }

  private onBossKilled(): void {
    if (this.bossKilled) return;
    this.bossKilled = true;

    const def = this.boss.def;
    this.run.xpGained += def.xp;
    this.run.scrapGained += def.scrap;
    this.run.plasmaGained += def.plasma;
    this.run.score += 10000;

    // Guaranteed drop.
    const drop = rollLoot(1, Rarity.LEGENDARY);
    if (drop) {
      drop.itemKey = def.guaranteedDrop.itemKey;
      drop.name = def.guaranteedDrop.itemKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      drop.rarity = def.guaranteedDrop.rarity as Rarity;
      drop.value = 900;
      this.loot.push(new Loot(this, this.boss.x, this.boss.y, { drop }));
    }

    this.time.delayedCall(2600, () => this.finishRun(true));
  }

  private cleanup(): void {
    this.enemies = this.enemies.filter((e) => e.active);
    this.loot = this.loot.filter((l) => l.active);
    this.lasers = this.lasers.filter((l) => l.active);
  }

  private togglePause(): void {
    if (this.ended) return;
    this.paused = !this.paused;
    if (this.paused) {
      this.physics.pause();
      this.input$.setEnabled(false);
      bus.emit('pause', {});
    } else {
      this.physics.resume();
      this.input$.setEnabled(true);
      bus.emit('resume', {});
    }
  }

  private async finishRun(bossKilled: boolean): Promise<void> {
    if (this.ended) return;
    this.ended = true;

    this.physics.pause();
    this.input$.setEnabled(false);

    const result = await buildRunResult(this.run, this.sessionKey, bossKilled);

    if (!result.clientFlagged) {
      this.applyLocalRewards(result.xpGained, result.scrapGained, result.plasmaGained);
    }

    bus.emit('run:end', { result });

    this.cameras.main.fadeOut(700, 5, 6, 15);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(SCENE_KEYS.GAME_OVER, { result, verified: false });
    });
  }

  private applyLocalRewards(xp: number, scrap: number, plasma: number): void {
    const p = this.save.profile;
    p.scrap += scrap;
    p.plasma += plasma;
    p.seasonXp += Math.round(xp * 0.5);

    const res = applyXp(p.level, p.xp, xp);
    p.level = res.level;
    p.xp = res.xp;

    p.stats.runsPlayed++;
    p.stats.totalKills += this.run.kills;
    p.stats.bestScore = Math.max(p.stats.bestScore, this.run.score);
    p.stats.bestSector = Math.max(p.stats.bestSector, this.run.sectorIndex);
    p.stats.totalPlaytimeMs += Date.now() - this.run.startedAt;
    p.stats.totalLootValue += this.run.lootValue;
    if (this.bossKilled) p.stats.totalBossesKilled++;

    SaveSystem.save(this.save);
    this.registry.set('save', this.save);

    if (res.levelsGained > 0) bus.emit('player:levelup', { level: res.level });
    bus.emit('currency:changed', { scrap: p.scrap, plasma: p.plasma, riftCrystal: p.riftCrystal });
  }

  shutdown(): void {
    this.input$?.destroy();
    this.sectorGen?.destroy();
    this.playerBullets?.destroy();
    this.enemyBullets?.destroy();
  }
}

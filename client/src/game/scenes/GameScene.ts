import Phaser from 'phaser';
import { COLORS, COMBAT, ECONOMY, GAME_HEIGHT, GAME_WIDTH, LIMITS, RENDER, SCENE_KEYS, SECTOR, WORLD } from '../config/constants';
import { Rarity } from '../config/rarity';
import { getShip, RAPTOR_X } from '../config/ships';
import { planSector, type SectorPlan } from '../config/sectors';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { Bullet, BulletPool } from '../entities/Bullet';
import { Loot } from '../entities/Loot';
import { InputSystem } from '../systems/InputSystem';
import { SectorGenerator } from '../systems/SectorGenerator';
import { bus } from '../systems/EventBus';
import { rollLoot, rollPowerUp, scrapForKill, scrapForLoot } from '../systems/LootSystem';
import { applyModifier } from '../systems/WeaponSystem';
import { computeShipStats, applyXp } from '../systems/ProgressionSystem';
import { RunTracker, buildRunResult } from '../systems/AntiCheat';
import { SaveSystem } from '../systems/SaveSystem';
import type { RunState, SaveData } from '../systems/types';

/**
 * GameScene — the main endless-run gameplay loop.
 *
 * Responsibilities:
 *   · own the run state (the thing anti-cheat validates)
 *   · spawn and drive enemies, bullets, loot, and power-ups
 *   · resolve all collisions
 *   · render the in-canvas HUD
 *   · hand off to BossScene on boss sectors and GameOverScene on death
 */
export class GameScene extends Phaser.Scene {
  private player!: Player;
  private input$!: InputSystem;
  private sectorGen!: SectorGenerator;
  private plan!: SectorPlan;

  private enemies: Enemy[] = [];
  private loot: Loot[] = [];
  private playerBullets!: BulletPool;
  private enemyBullets!: BulletPool;

  private run!: RunState;
  private tracker!: RunTracker;
  private sessionKey = 'offline-session-key';

  private killsThisSector = 0;
  private spawnTimer = 0;
  private paused = false;
  private ended = false;
  private bossKilled = false;

  private hud!: Phaser.GameObjects.Graphics;
  private hudText!: Phaser.GameObjects.Text;
  private sectorText!: Phaser.GameObjects.Text;
  private toastText!: Phaser.GameObjects.Text;
  private pauseOverlay?: Phaser.GameObjects.Container;

  private save!: SaveData;

  constructor() {
    super({ key: SCENE_KEYS.GAME });
  }

  init(data: { sectorIndex?: number; seed?: number; sessionKey?: string; sessionId?: string }): void {
    const sectorIndex = data?.sectorIndex ?? 1;
    const seed = data?.seed ?? Math.floor(Math.random() * 1e9);
    this.sessionKey = data?.sessionKey ?? 'offline-session-key';

    this.plan = planSector(sectorIndex, seed, {
      bossEvery: SECTOR.bossEvery,
      baseEnemyCount: SECTOR.baseEnemyCount,
      enemyCountPerSector: SECTOR.enemyCountPerSector,
      difficultyPerSector: SECTOR.difficultyPerSector,
    });

    this.run = {
      sessionId: data?.sessionId ?? `sess_${Date.now().toString(36)}`,
      seed,
      sectorIndex,
      biome: this.plan.biome.key,
      isBoss: this.plan.isBoss,
      startedAt: Date.now(),
      score: 0,
      kills: 0,
      damageDealt: 0,
      damageTaken: 0,
      lootValue: 0,
      xpGained: 0,
      scrapGained: 0,
      plasmaGained: 0,
      abilitiesUsed: 0,
      scoreBuckets: [],
      killBuckets: [],
    };

    this.killsThisSector = 0;
    this.spawnTimer = 0;
    this.paused = false;
    this.ended = false;
    this.bossKilled = false;
    this.enemies = [];
    this.loot = [];
  }

  create(): void {
    this.save = (this.registry.get('save') as SaveData) ?? SaveSystem.load();

    this.physics.world.setBounds(0, 0, WORLD.width, WORLD.height);
    this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height);
    this.cameras.main.setBackgroundColor(COLORS.bgDeep);

    // World content.
    this.sectorGen = new SectorGenerator(this, this.plan);
    this.sectorGen.buildBackground();

    // Player.
    const ownedShip = this.save.profile.ships.find((s) => s.id === this.save.profile.equippedShipId);
    const shipDef = getShip(ownedShip?.shipKey ?? RAPTOR_X.key);
    const stats = computeShipStats(shipDef.stats, ownedShip?.level ?? 1, {});

    this.player = new Player(this, WORLD.width / 2, WORLD.height / 2, shipDef, stats, this.save.profile.loadout);
    this.player.onFire = (x, y, angle, texture, damage, crit, weaponKey, pierce, speed, lifetimeMs) =>
      this.spawnPlayerBullet(x, y, angle, texture, damage, crit, weaponKey, pierce, speed, lifetimeMs);
    this.player.onAbility = (effect, magnitude, durationMs) => this.handleAbility(effect, magnitude, durationMs);

    this.cameras.main.startFollow(this.player, true, 0.09, 0.09);

    // Pools.
    this.playerBullets = new BulletPool(this, 'bullet_player', 160);
    this.enemyBullets = new BulletPool(this, 'bullet_enemy', 200);

    // Input.
    this.input$ = new InputSystem(this, {
      joystick: this.save.settings.virtualJoystick,
      onPause: () => this.togglePause(),
    });

    // Secondary / ultimate keys.
    this.input.keyboard?.on('keydown-Q', () => this.player.fireSecondary(this.player.rotation - Math.PI / 2, this.time.now));
    this.input.keyboard?.on('keydown-R', () => this.player.fireUltimate(this.player.rotation - Math.PI / 2, this.time.now));

    this.buildHud();
    this.bindEvents();

    this.tracker = new RunTracker(this.run);

    bus.emit('run:start', { sessionId: this.run.sessionId, seed: this.run.seed, sectorIndex: this.run.sectorIndex });
    bus.emit('sector:enter', {
      index: this.plan.index,
      biome: this.plan.biome.name,
      designation: this.plan.designation,
      isBoss: this.plan.isBoss,
    });

    this.showToast(this.plan.designation, 2200);
    this.cameras.main.fadeIn(400, 5, 6, 15);

    // Boss sectors hand straight off to the dedicated boss scene.
    if (this.plan.isBoss) {
      this.time.delayedCall(900, () => this.enterBoss());
    }
  }

  // ── HUD ──────────────────────────────────────────────────────────────────
  private buildHud(): void {
    this.hud = this.add.graphics().setScrollFactor(0).setDepth(RENDER.depth.hud);

    this.hudText = this.add
      .text(24, 22, '', { fontFamily: 'monospace', fontSize: '14px', color: '#e8f1ff' })
      .setScrollFactor(0)
      .setDepth(RENDER.depth.hud + 1);

    this.sectorText = this.add
      .text(GAME_WIDTH - 24, 22, '', { fontFamily: 'monospace', fontSize: '14px', color: '#4fd1ff' })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(RENDER.depth.hud + 1);

    this.toastText = this.add
      .text(GAME_WIDTH / 2, 150, '', {
        fontFamily: 'Orbitron, Impact, sans-serif',
        fontSize: '26px',
        color: '#ffd166',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(RENDER.depth.overlay)
      .setAlpha(0);
  }

  private showToast(message: string, durationMs = 1800): void {
    this.toastText.setText(message).setAlpha(1).setScale(0.9);
    this.tweens.add({ targets: this.toastText, scale: 1, duration: 220, ease: 'Back.easeOut' });
    this.tweens.add({ targets: this.toastText, alpha: 0, delay: durationMs, duration: 400 });
  }

  private drawHud(): void {
    const g = this.hud;
    g.clear();

    const p = this.player;
    const barW = 260;
    const x = 24;
    const y = 52;

    // Health
    g.fillStyle(0x05060f, 0.8);
    g.fillRoundedRect(x - 2, y - 2, barW + 4, 18, 4);
    const hpPct = Math.max(0, p.health / p.maxHealth);
    g.fillStyle(hpPct > 0.3 ? 0x3ddc97 : 0xff2e63, 1);
    g.fillRoundedRect(x, y, barW * hpPct, 14, 3);

    // Shield
    const sy = y + 22;
    g.fillStyle(0x05060f, 0.8);
    g.fillRoundedRect(x - 2, sy - 2, barW + 4, 12, 4);
    const shPct = p.maxShield > 0 ? Math.max(0, p.shield / p.maxShield) : 0;
    g.fillStyle(0x5ce1e6, 1);
    g.fillRoundedRect(x, sy, barW * shPct, 8, 3);

    // Ultimate charge
    const uy = sy + 18;
    g.fillStyle(0x05060f, 0.8);
    g.fillRoundedRect(x - 2, uy - 2, barW + 4, 10, 4);
    g.fillStyle(p.weapons.charge >= 100 ? 0xffd166 : 0xb14aff, 1);
    g.fillRoundedRect(x, uy, barW * (p.weapons.charge / 100), 6, 3);

    // Ability + dash cooldown pips
    const cdY = uy + 20;
    const abilityReady = p.abilityCooldownRemaining <= 0;
    const dashReady = p.dashCooldownRemaining <= 0;

    g.fillStyle(abilityReady ? 0xb14aff : 0x2a2a44, 1);
    g.fillRoundedRect(x, cdY, 90, 16, 4);
    g.fillStyle(dashReady ? 0x3ddc97 : 0x2a2a44, 1);
    g.fillRoundedRect(x + 98, cdY, 90, 16, 4);

    // Sector progress
    const progW = 200;
    const px = GAME_WIDTH - 24 - progW;
    const py = 52;
    g.fillStyle(0x05060f, 0.8);
    g.fillRoundedRect(px - 2, py - 2, progW + 4, 12, 4);
    const prog = Math.min(1, this.killsThisSector / SECTOR.killsToClear);
    g.fillStyle(0x4fd1ff, 1);
    g.fillRoundedRect(px, py, progW * prog, 8, 3);
  }

  private updateHudText(): void {
    const p = this.player;
    this.hudText.setText(
      [
        `HP ${Math.ceil(p.health)}/${p.maxHealth}   SH ${Math.ceil(p.shield)}/${p.maxShield}`,
        `SCORE ${this.run.score.toLocaleString()}   KILLS ${this.run.kills}`,
        `[E] ${p.abilityCooldownRemaining <= 0 ? 'READY' : `${(p.abilityCooldownRemaining / 1000).toFixed(1)}s`}   [SHIFT] ${p.dashCooldownRemaining <= 0 ? 'READY' : `${(p.dashCooldownRemaining / 1000).toFixed(1)}s`}   [Q] 2nd   [R] ULT`,
      ].join('\n')
    );

    this.sectorText.setText(
      `${this.plan.designation}\nCLEAR ${this.killsThisSector}/${SECTOR.killsToClear}   SCRAP ${this.run.scrapGained}   PLASMA ${this.run.plasmaGained}`
    );
  }

  // ── Events ───────────────────────────────────────────────────────────────
  private bindEvents(): void {
    const onKilled = (payload: { key: string; name: string; xp: number; scrap: number }) => {
      this.run.kills++;
      this.killsThisSector++;
      this.run.xpGained += payload.xp;

      const scrap = scrapForKill(payload.scrap, this.player.weapons.modifiers.scrapMultiplier);
      this.run.scrapGained += scrap;
      this.run.score += payload.xp * 10 + scrap * 2;

      if (this.killsThisSector >= SECTOR.killsToClear && !this.plan.isBoss) {
        this.clearSector();
      }
    };

    bus.on('enemy:killed', onKilled);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('enemy:killed', onKilled));
  }

  private handleAbility(effect: string, magnitude: number, durationMs: number): void {
    this.run.abilitiesUsed++;

    switch (effect) {
      case 'BURST': {
        // Radial shockwave: damage + knockback everything nearby.
        const radius = 260;
        for (const e of this.enemies) {
          if (!e.active) continue;
          const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y);
          if (d > radius) continue;
          const dmg = Math.round(this.player.stats.damage * magnitude);
          const res = e.takeDamage(dmg);
          this.run.damageDealt += res.dealt;
          this.player.registerDamageDealt(res.dealt);
          const angle = Math.atan2(e.y - this.player.y, e.x - this.player.x);
          e.body.setVelocity(Math.cos(angle) * 700, Math.sin(angle) * 700);
        }
        this.ringEffect(this.player.x, this.player.y, radius, 0xb14aff);
        break;
      }
      case 'TIME_DILATION': {
        for (const e of this.enemies) {
          if (e.active) e.stun(durationMs);
        }
        this.cameras.main.flash(200, 60, 120, 200);
        break;
      }
      case 'MISSILE_SALVO': {
        for (let i = 0; i < magnitude; i++) {
          const angle = (Math.PI * 2 * i) / magnitude;
          this.spawnPlayerBullet(
            this.player.x,
            this.player.y,
            angle,
            'missile',
            Math.round(this.player.stats.damage * 1.4),
            false,
            'salvo',
            0,
            6,
            2400
          );
        }
        break;
      }
      case 'OVERCHARGE': {
        const angle = this.player.rotation - Math.PI / 2;
        this.spawnPlayerBullet(
          this.player.x,
          this.player.y,
          angle,
          'bullet_player_heavy',
          Math.round(this.player.stats.damage * magnitude),
          true,
          'overcharge',
          8,
          30,
          1200
        );
        break;
      }
      default:
        break;
    }
  }

  private ringEffect(x: number, y: number, radius: number, tint: number): void {
    const g = this.add.graphics().setDepth(RENDER.depth.fx);
    g.lineStyle(6, tint, 0.9);
    g.strokeCircle(x, y, 10);
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 420,
      onUpdate: (t) => {
        const v = t.getValue() ?? 0;
        g.clear();
        g.lineStyle(6 * (1 - v), tint, 0.9 * (1 - v));
        g.strokeCircle(x, y, 10 + radius * v);
      },
      onComplete: () => g.destroy(),
    });
  }

  // ── Spawning ─────────────────────────────────────────────────────────────
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

    // Weapon-specific behaviour.
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
    if (weaponKey === 'mine_layer') b.armAt = this.time.now + 500;
    if (weaponKey === 'orbital_barrage') b.blastRadius = 130;
    if (weaponKey === 'rift_singularity') b.blastRadius = 300;
  }

  private spawnEnemyBullet(x: number, y: number, angle: number, damage: number, texture = 'bullet_enemy', speed = 7): void {
    const b = this.enemyBullets.get();
    b.setTexture(texture);
    b.fire({ x, y, angle, speed, damage, crit: false, weaponKey: 'enemy', pierce: 0, lifetimeMs: 3000, hostile: true });
  }

  private spawnEnemy(): void {
    if (this.enemies.filter((e) => e.active).length >= SECTOR.maxEnemiesAlive) return;

    const table = this.sectorGen.buildSpawnTable();
    const def = this.sectorGen.pickEnemy(table);
    const pos = this.sectorGen.spawnPoint(this.cameras.main);

    const enemy = new Enemy(this, pos.x, pos.y, def, this.plan.difficulty);
    enemy.getTarget = () => (this.player.active ? { x: this.player.x, y: this.player.y } : null);
    enemy.getAllies = () => this.enemies;
    enemy.onAttack = (e, angle) => this.enemyAttack(e, angle);

    this.enemies.push(enemy);
  }

  private enemyAttack(enemy: Enemy, angle: number): void {
    const def = enemy.def;
    const damage = Math.round(def.damage * this.plan.difficulty);

    if (def.ai === 'KAMIKAZE') {
      // Contact detonation.
      this.explodeAt(enemy.x, enemy.y, def.behavior.blastRadius, damage);
      enemy.takeDamage(99999);
      return;
    }

    if (def.ai === 'TANK') {
      const count = def.behavior.volleyCount;
      const spread = Phaser.Math.DegToRad(def.behavior.spreadDeg);
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0.5 : i / (count - 1);
        this.spawnEnemyBullet(enemy.x, enemy.y, angle + (t - 0.5) * spread, damage, 'bullet_enemy', def.projectileSpeed);
      }
      return;
    }

    if (def.projectileSpeed > 0) {
      const texture = def.ai === 'SNIPER' ? 'bullet_sniper' : 'bullet_enemy';
      this.spawnEnemyBullet(enemy.x, enemy.y, angle, damage, texture, def.projectileSpeed);
    }
  }

  private explodeAt(x: number, y: number, radius: number, damage: number): void {
    const emitter = this.add.particles(x, y, 'p_ember', {
      speed: { min: 80, max: 260 },
      scale: { start: 1.3, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 500,
      quantity: 20,
      tint: [0xff5d73, 0xffd166],
      blendMode: Phaser.BlendModes.ADD,
    });
    emitter.setDepth(RENDER.depth.fx);
    emitter.explode(20);
    this.time.delayedCall(600, () => emitter.destroy());

    this.ringEffect(x, y, radius, 0xff5d73);
    this.cameras.main.shake(160, 0.006);

    const d = Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y);
    if (d <= radius) {
      const dealt = this.player.takeDamage(damage, this.time.now);
      this.run.damageTaken += dealt;
    }
  }

  private dropLoot(x: number, y: number, maxRarity: Rarity, lootChance: number): void {
    const luck = this.plan.lootBonus;

    if (Math.random() < lootChance) {
      const drop = rollLoot(luck, maxRarity);
      if (drop) {
        const item = new Loot(this, x, y, { drop });
        this.loot.push(item);
        bus.emit('loot:drop', { itemKey: drop.itemKey, name: drop.name, rarity: drop.rarity, value: drop.value });
      }
    }

    // Power-ups are rarer than loot and independent of it.
    if (Math.random() < 0.07) {
      const pu = rollPowerUp();
      const item = new Loot(this, x, y, { powerUp: pu });
      this.loot.push(item);
    }
  }

  // ── Sector flow ──────────────────────────────────────────────────────────
  private clearSector(): void {
    this.run.score += 500 + this.plan.index * 120;
    bus.emit('sector:clear', { index: this.plan.index, score: this.run.score });
    this.showToast('SECTOR CLEARED', 1600);

    this.time.delayedCall(1400, () => this.advanceSector());
  }

  private advanceSector(): void {
    const nextIndex = this.plan.index + 1;
    const nextPlan = planSector(nextIndex, this.run.seed, {
      bossEvery: SECTOR.bossEvery,
      baseEnemyCount: SECTOR.baseEnemyCount,
      enemyCountPerSector: SECTOR.enemyCountPerSector,
      difficultyPerSector: SECTOR.difficultyPerSector,
    });

    if (nextPlan.isBoss) {
      this.enterBoss();
      return;
    }

    this.scene.restart({ sectorIndex: nextIndex, seed: this.run.seed, sessionKey: this.sessionKey, sessionId: this.run.sessionId });
  }

  private enterBoss(): void {
    this.cameras.main.fadeOut(500, 5, 6, 15);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(SCENE_KEYS.BOSS, {
        sectorIndex: this.plan.index,
        seed: this.run.seed,
        sessionKey: this.sessionKey,
        sessionId: this.run.sessionId,
        carried: {
          score: this.run.score,
          kills: this.run.kills,
          damageDealt: this.run.damageDealt,
          damageTaken: this.run.damageTaken,
          lootValue: this.run.lootValue,
          xpGained: this.run.xpGained,
          scrapGained: this.run.scrapGained,
          plasmaGained: this.run.plasmaGained,
          abilitiesUsed: this.run.abilitiesUsed,
          startedAt: this.run.startedAt,
        },
      });
    });
  }

  // ── Pause ────────────────────────────────────────────────────────────────
  private togglePause(): void {
    if (this.ended) return;
    this.paused = !this.paused;

    if (this.paused) {
      this.physics.pause();
      this.input$.setEnabled(false);
      this.buildPauseOverlay();
      bus.emit('pause', {});
    } else {
      this.physics.resume();
      this.input$.setEnabled(true);
      this.pauseOverlay?.destroy();
      this.pauseOverlay = undefined;
      bus.emit('resume', {});
    }
  }

  private buildPauseOverlay(): void {
    const c = this.add.container(0, 0).setScrollFactor(0).setDepth(RENDER.depth.overlay);

    const dim = this.add.graphics();
    dim.fillStyle(0x02030a, 0.82);
    dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    const title = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, 'PAUSED', {
        fontFamily: 'Orbitron, Impact, sans-serif',
        fontSize: '56px',
        color: '#4fd1ff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const hint = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 10, 'ESC / P to resume', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#8fa3c8',
      })
      .setOrigin(0.5);

    const quit = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 70, '[ ABANDON RUN ]', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ff2e63',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    quit.on('pointerdown', () => {
      this.paused = false;
      this.physics.resume();
      this.finishRun(false);
    });

    c.add([dim, title, hint, quit]);
    this.pauseOverlay = c;
  }

  // ── Run end ──────────────────────────────────────────────────────────────
  private async finishRun(bossKilled: boolean): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.bossKilled = bossKilled;

    this.physics.pause();
    this.input$.setEnabled(false);

    const result = await buildRunResult(this.run, this.sessionKey, bossKilled);

    // Apply rewards locally. When online, the server's validated amounts replace
    // these — the client never mints anything on its own authority.
    if (!result.clientFlagged) {
      this.applyLocalRewards(result.xpGained, result.scrapGained, result.plasmaGained);
    }

    bus.emit('run:end', { result });

    this.cameras.main.fadeOut(600, 5, 6, 15);
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

    SaveSystem.save(this.save);
    this.registry.set('save', this.save);

    if (res.levelsGained > 0) bus.emit('player:levelup', { level: res.level });
    bus.emit('currency:changed', { scrap: p.scrap, plasma: p.plasma, riftCrystal: p.riftCrystal });
  }

  // ── Main loop ────────────────────────────────────────────────────────────
  update(_time: number, delta: number): void {
    if (this.paused || this.ended) return;

    const now = this.time.now;
    const input = this.input$.update();

    this.player.update(input, now);

    // Enemies
    for (const e of this.enemies) {
      if (e.active) e.think(now, delta);
    }

    // Bullets
    this.playerBullets.forEachActive((b) => b.update(now, this.nearestEnemy(b.x, b.y)));
    this.enemyBullets.forEachActive((b) => b.update(now));

    // Loot
    for (const l of this.loot) {
      if (l.active) l.update(now, this.player.active ? this.player : null, this.player.weapons.modifiers.magnet);
    }

    this.resolveCollisions();
    this.cleanup();

    // Spawning
    this.spawnTimer -= delta;
    if (this.spawnTimer <= 0 && !this.plan.isBoss) {
      this.spawnEnemy();
      this.spawnTimer = Math.max(320, 1100 - this.plan.index * 40);
    }

    // Anti-cheat buckets + HUD
    this.tracker.tick(now);
    this.drawHud();
    this.updateHudText();

    if (this.player.isDead) this.finishRun(false);
  }

  private nearestEnemy(x: number, y: number): { x: number; y: number } | undefined {
    let best: Enemy | undefined;
    let bestD = Infinity;
    for (const e of this.enemies) {
      if (!e.active) continue;
      const d = Phaser.Math.Distance.Between(x, y, e.x, e.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best ? { x: best.x, y: best.y } : undefined;
  }

  private resolveCollisions(): void {
    const now = this.time.now;

    // Player bullets → enemies
    this.playerBullets.forEachActive((b) => {
      if (!b.active) return;
      for (const e of this.enemies) {
        if (!e.active || b.hitSet.has(e)) continue;
        if (Phaser.Math.Distance.Between(b.x, b.y, e.x, e.y) > e.def.radius + 10) continue;

        b.hitSet.add(e);
        const res = e.takeDamage(b.damage, b.shieldPierce);
        this.run.damageDealt += res.dealt;
        this.player.registerDamageDealt(res.dealt);

        // Chain lightning.
        if (b.chainCount > 0) this.chainFrom(e, b.chainCount, b.chainRange, b.damage * b.chainFalloff, b.chainFalloff);
        if (b.stunMs > 0) e.stun(b.stunMs);

        if (res.killed) this.onEnemyKilled(e);

        if (b.registerHit()) {
          if (b.blastRadius > 0) this.explodeAt(b.x, b.y, b.blastRadius, b.damage);
          b.kill();
          break;
        }
      }
    });

    // Enemy bullets → player
    this.enemyBullets.forEachActive((b) => {
      if (!b.active) return;
      if (Phaser.Math.Distance.Between(b.x, b.y, this.player.x, this.player.y) > 24) return;
      const dealt = this.player.takeDamage(b.damage, now);
      this.run.damageTaken += dealt;
      b.kill();
    });

    // Enemies → player (contact)
    for (const e of this.enemies) {
      if (!e.active) continue;
      if (Phaser.Math.Distance.Between(e.x, e.y, this.player.x, this.player.y) > e.def.radius + 18) continue;

      if (e.def.ai === 'KAMIKAZE') {
        this.explodeAt(e.x, e.y, e.def.behavior.blastRadius, Math.round(e.def.damage * this.plan.difficulty));
        e.takeDamage(99999);
        this.onEnemyKilled(e);
      } else {
        const dealt = this.player.takeDamage(Math.round(e.def.damage * 0.5 * this.plan.difficulty), now);
        this.run.damageTaken += dealt;
      }
    }

    // Player → loot
    for (const l of this.loot) {
      if (!l.active) continue;
      if (Phaser.Math.Distance.Between(l.x, l.y, this.player.x, this.player.y) > 30) continue;
      this.collectLoot(l);
    }
  }

  private chainFrom(source: Enemy, count: number, range: number, damage: number, falloff: number): void {
    let current = source;
    let dmg = damage;
    const hit = new Set<Enemy>([source]);

    for (let i = 0; i < count; i++) {
      let next: Enemy | undefined;
      let bestD = range;
      for (const e of this.enemies) {
        if (!e.active || hit.has(e)) continue;
        const d = Phaser.Math.Distance.Between(current.x, current.y, e.x, e.y);
        if (d < bestD) {
          bestD = d;
          next = e;
        }
      }
      if (!next) break;

      // Visual arc.
      const g = this.add.graphics().setDepth(RENDER.depth.fx);
      g.lineStyle(3, 0x9ef7ff, 0.9);
      g.lineBetween(current.x, current.y, next.x, next.y);
      this.tweens.add({ targets: g, alpha: 0, duration: 220, onComplete: () => g.destroy() });

      const res = next.takeDamage(Math.round(dmg));
      this.run.damageDealt += res.dealt;
      this.player.registerDamageDealt(res.dealt);
      if (res.killed) this.onEnemyKilled(next);

      hit.add(next);
      current = next;
      dmg *= falloff;
    }
  }

  private onEnemyKilled(e: Enemy): void {
    this.dropLoot(e.x, e.y, e.def.maxDropRarity, e.def.lootChance);
  }

  private collectLoot(l: Loot): void {
    l.collect();

    if (l.kind === 'ITEM' && l.drop) {
      const scrap = scrapForLoot(l.drop.value, this.player.weapons.modifiers.scrapMultiplier);
      this.run.scrapGained += scrap;
      this.run.lootValue += l.drop.value;
      this.run.score += l.drop.value * 3;
      bus.emit('loot:pickup', {
        itemKey: l.drop.itemKey,
        name: l.drop.name,
        rarity: l.drop.rarity,
        value: l.drop.value,
      });
    } else if (l.kind === 'POWERUP' && l.powerUp) {
      const pu = l.powerUp;
      switch (pu.kind) {
        case 'HEAL':
          this.player.heal(pu.magnitude);
          break;
        case 'SHIELD':
          this.player.addShield(pu.magnitude);
          break;
        default:
          applyModifier(this.player.weapons, pu.kind, pu.magnitude, pu.durationMs, this.time.now);
          break;
      }
      bus.emit('powerup:pickup', { kind: pu.kind, name: pu.name });
    }
  }

  private cleanup(): void {
    this.enemies = this.enemies.filter((e) => e.active);
    this.loot = this.loot.filter((l) => l.active);
  }

  shutdown(): void {
    this.input$?.destroy();
    this.sectorGen?.destroy();
    this.playerBullets?.destroy();
    this.enemyBullets?.destroy();
  }
}

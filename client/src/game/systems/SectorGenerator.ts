import Phaser from 'phaser';
import { RENDER, WORLD } from '../config/constants';
import { mulberry32, type BiomeDef, type SectorPlan } from '../config/sectors';
import { spawnTableForSector, getEnemy, type EnemyDef } from '../config/enemies';

/**
 * Builds the visual and spatial content of a sector.
 *
 * Everything is derived from the sector's seed, so the same sector always looks
 * and plays the same — which is what lets the server regenerate and validate a
 * submitted run.
 */
export class SectorGenerator {
  private rng: () => number;
  private layers: Phaser.GameObjects.GameObject[] = [];

  constructor(private scene: Phaser.Scene, private plan: SectorPlan) {
    this.rng = mulberry32(plan.seed);
  }

  /** Draws the parallax background, starfield, and biome set dressing. */
  buildBackground(): void {
    const { width, height } = this.scene.scale;
    const biome = this.plan.biome;

    // Base gradient.
    const bg = this.scene.add.graphics().setDepth(RENDER.depth.background).setScrollFactor(0);
    const steps = 32;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const color = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(biome.gradient[0]),
        Phaser.Display.Color.ValueToColor(biome.gradient[1]),
        steps - 1,
        i
      );
      bg.fillStyle(Phaser.Display.Color.GetColor(color.r, color.g, color.b), 1);
      bg.fillRect(0, (height / steps) * i, width, height / steps + 1);
    }
    this.layers.push(bg);

    // Parallax star layers.
    for (let layer = 0; layer < biome.parallaxLayers; layer++) {
      const depthFactor = 0.08 + layer * 0.12;
      const count = 90 - layer * 18;
      const g = this.scene.add.graphics().setDepth(RENDER.depth.parallax + layer);
      g.setScrollFactor(depthFactor);

      for (let i = 0; i < count; i++) {
        const x = this.rng() * WORLD.width;
        const y = this.rng() * WORLD.height;
        const r = 0.6 + this.rng() * (1.6 - layer * 0.3);
        const alpha = 0.25 + this.rng() * 0.6;
        g.fillStyle(biome.particleTint, alpha);
        g.fillCircle(x, y, Math.max(0.5, r));
      }
      this.layers.push(g);
    }

    // Biome set dressing.
    this.buildDressing(biome);

    // Ambient drifting particles.
    const emitter = this.scene.add.particles(0, 0, 'p_star', {
      x: { min: 0, max: WORLD.width },
      y: { min: 0, max: WORLD.height },
      speedX: { min: -14, max: 14 },
      speedY: { min: -14, max: 14 },
      scale: { start: 0.7, end: 0 },
      alpha: { start: 0.5, end: 0 },
      lifespan: 4000,
      frequency: 90,
      quantity: 1,
      tint: biome.particleTint,
      blendMode: Phaser.BlendModes.ADD,
    });
    emitter.setDepth(RENDER.depth.parallax + 1);
    this.layers.push(emitter);
  }

  private buildDressing(biome: BiomeDef): void {
    const g = this.scene.add.graphics().setDepth(RENDER.depth.parallax + 2);
    this.layers.push(g);

    switch (biome.key) {
      case 'PLANET_FIELD':
      case 'SOLAR_SYSTEM': {
        // Large soft planets in the far background.
        for (let i = 0; i < 3; i++) {
          const x = this.rng() * WORLD.width;
          const y = this.rng() * WORLD.height;
          const r = 120 + this.rng() * 220;
          g.fillStyle(biome.particleTint, 0.07);
          g.fillCircle(x, y, r);
          g.lineStyle(2, biome.particleTint, 0.12);
          g.strokeCircle(x, y, r);
        }
        break;
      }
      case 'ASTEROID_BELT': {
        for (let i = 0; i < 70; i++) {
          const x = this.rng() * WORLD.width;
          const y = this.rng() * WORLD.height;
          const r = 6 + this.rng() * 26;
          g.fillStyle(0x3a2a12, 0.55);
          g.fillCircle(x, y, r);
          g.lineStyle(1, 0x6b4f22, 0.4);
          g.strokeCircle(x, y, r);
        }
        break;
      }
      case 'BLACK_HOLE': {
        const cx = WORLD.width / 2;
        const cy = WORLD.height / 2;
        for (let i = 14; i > 0; i--) {
          g.fillStyle(0x000000, 0.16);
          g.fillCircle(cx, cy, i * 26);
        }
        g.lineStyle(3, 0xb14aff, 0.5);
        g.strokeCircle(cx, cy, 90);
        g.lineStyle(1, 0xffffff, 0.25);
        g.strokeCircle(cx, cy, 130);
        break;
      }
      case 'ALIEN_TERRITORY': {
        for (let i = 0; i < 26; i++) {
          const x = this.rng() * WORLD.width;
          const y = this.rng() * WORLD.height;
          const r = 20 + this.rng() * 60;
          g.lineStyle(2, 0x3ddc97, 0.14);
          g.strokeCircle(x, y, r);
          g.strokeCircle(x, y, r * 0.6);
        }
        break;
      }
      case 'SPACE_STATION': {
        for (let i = 0; i < 8; i++) {
          const x = this.rng() * WORLD.width;
          const y = this.rng() * WORLD.height;
          const w = 90 + this.rng() * 200;
          const h = 40 + this.rng() * 90;
          g.fillStyle(0x1f2233, 0.5);
          g.fillRect(x, y, w, h);
          g.lineStyle(1, 0x4fd1ff, 0.2);
          g.strokeRect(x, y, w, h);
        }
        break;
      }
      case 'NEBULA':
      default: {
        for (let i = 0; i < 12; i++) {
          const x = this.rng() * WORLD.width;
          const y = this.rng() * WORLD.height;
          const r = 100 + this.rng() * 260;
          g.fillStyle(0x8f6bff, 0.05);
          g.fillCircle(x, y, r);
        }
        break;
      }
    }
  }

  /**
   * Picks the enemy archetypes for this sector, honouring the biome's spawn bias.
   */
  buildSpawnTable(): { def: EnemyDef; weight: number }[] {
    const base = spawnTableForSector(this.plan.index);
    return base.map((entry) => {
      const bias = this.plan.biome.spawnBias[entry.key] ?? 1;
      return { def: getEnemy(entry.key), weight: entry.weight * bias };
    });
  }

  /** Weighted pick from the sector's spawn table. */
  pickEnemy(table: { def: EnemyDef; weight: number }[]): EnemyDef {
    const total = table.reduce((s, e) => s + e.weight, 0);
    let roll = this.rng() * total;
    for (const e of table) {
      roll -= e.weight;
      if (roll <= 0) return e.def;
    }
    return table[table.length - 1].def;
  }

  /**
   * A spawn position just outside the camera view, so enemies never pop in
   * on top of the player.
   */
  spawnPoint(camera: Phaser.Cameras.Scene2D.Camera): { x: number; y: number } {
    const margin = 120;
    const side = Math.floor(this.rng() * 4);
    const view = camera.worldView;

    switch (side) {
      case 0:
        return { x: view.x + this.rng() * view.width, y: view.y - margin };
      case 1:
        return { x: view.right + margin, y: view.y + this.rng() * view.height };
      case 2:
        return { x: view.x + this.rng() * view.width, y: view.bottom + margin };
      default:
        return { x: view.x - margin, y: view.y + this.rng() * view.height };
    }
  }

  /** Random point inside the world, used for loot scatter. */
  worldPoint(): { x: number; y: number } {
    return {
      x: WORLD.margin + this.rng() * (WORLD.width - WORLD.margin * 2),
      y: WORLD.margin + this.rng() * (WORLD.height - WORLD.margin * 2),
    };
  }

  destroy(): void {
    for (const l of this.layers) l.destroy();
    this.layers = [];
  }
}

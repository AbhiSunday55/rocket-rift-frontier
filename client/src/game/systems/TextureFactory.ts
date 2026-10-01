import Phaser from 'phaser';

/**
 * Procedural texture factory.
 *
 * The whole game ships with ZERO binary art assets: every sprite is drawn into a
 * canvas at boot. That keeps the bundle tiny, makes the build fully reproducible,
 * and means a new ship or enemy is a config entry rather than an art request.
 */

export interface HullSpec {
  width: number;
  length: number;
  wings: number;
  accent: number;
  body?: number;
}

export const TextureFactory = {
  /** Generates every texture the game needs. Safe to call more than once. */
  generateAll(scene: Phaser.Scene): void {
    this.playerShip(scene, 'ship_default', { width: 34, length: 46, wings: 2, accent: 0xffd166 });
    this.enemyShapes(scene);
    this.projectiles(scene);
    this.pickups(scene);
    this.particles(scene);
    this.bossParts(scene);
    this.uiBits(scene);
  },

  // ── Ships ────────────────────────────────────────────────────────────────
  playerShip(scene: Phaser.Scene, key: string, spec: HullSpec): void {
    if (scene.textures.exists(key)) return;
    const w = spec.width + 24;
    const h = spec.length + 24;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    const cx = w / 2;
    const cy = h / 2;
    const body = spec.body ?? 0x1b2a4a;

    // Engine glow
    g.fillStyle(0x4fd1ff, 0.25);
    g.fillEllipse(cx, cy + spec.length * 0.42, spec.width * 0.7, spec.length * 0.5);

    // Wings
    g.fillStyle(body, 1);
    for (let i = 0; i < spec.wings; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const tier = Math.floor(i / 2);
      const span = spec.width * (0.9 - tier * 0.22);
      const yOff = cy + tier * 8 - 4;
      g.beginPath();
      g.moveTo(cx, yOff - 6);
      g.lineTo(cx + side * span, yOff + 10);
      g.lineTo(cx + side * span * 0.6, yOff + 16);
      g.lineTo(cx, yOff + 8);
      g.closePath();
      g.fillPath();
    }

    // Fuselage
    g.fillStyle(body, 1);
    g.beginPath();
    g.moveTo(cx, cy - spec.length / 2);
    g.lineTo(cx + spec.width / 2, cy + spec.length / 4);
    g.lineTo(cx + spec.width / 3, cy + spec.length / 2);
    g.lineTo(cx - spec.width / 3, cy + spec.length / 2);
    g.lineTo(cx - spec.width / 2, cy + spec.length / 4);
    g.closePath();
    g.fillPath();

    // Cockpit
    g.fillStyle(0x9ef7ff, 0.9);
    g.fillEllipse(cx, cy - spec.length * 0.12, spec.width * 0.34, spec.length * 0.26);

    // Accent stripes
    g.fillStyle(spec.accent, 1);
    g.fillRect(cx - spec.width * 0.42, cy + spec.length * 0.1, spec.width * 0.84, 3);
    g.fillRect(cx - 2, cy - spec.length * 0.42, 4, spec.length * 0.3);

    // Outline
    g.lineStyle(2, 0x4fd1ff, 0.85);
    g.strokeEllipse(cx, cy, spec.width * 1.05, spec.length * 1.02);

    g.generateTexture(key, w, h);
    g.destroy();
  },

  // ── Enemies ──────────────────────────────────────────────────────────────
  enemyShapes(scene: Phaser.Scene): void {
    const defs: { key: string; r: number; tint: number; shape: 'diamond' | 'triangle' | 'hex' | 'square' | 'star' }[] = [
      { key: 'enemy_kamikaze', r: 14, tint: 0xff5d73, shape: 'triangle' },
      { key: 'enemy_sniper', r: 16, tint: 0xff9f43, shape: 'diamond' },
      { key: 'enemy_swarm', r: 9, tint: 0x9ef7ff, shape: 'triangle' },
      { key: 'enemy_tank', r: 30, tint: 0xb14aff, shape: 'hex' },
      { key: 'enemy_interceptor', r: 15, tint: 0x4fd1ff, shape: 'diamond' },
      { key: 'enemy_shield_carrier', r: 24, tint: 0x5ce1e6, shape: 'hex' },
      { key: 'enemy_healer', r: 18, tint: 0x3ddc97, shape: 'star' },
    ];

    for (const d of defs) {
      if (scene.textures.exists(d.key)) continue;
      const size = d.r * 2 + 12;
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      const c = size / 2;

      g.fillStyle(d.tint, 0.22);
      g.fillCircle(c, c, d.r + 5);
      g.fillStyle(d.tint, 1);

      switch (d.shape) {
        case 'triangle':
          g.beginPath();
          g.moveTo(c, c - d.r);
          g.lineTo(c + d.r, c + d.r * 0.8);
          g.lineTo(c - d.r, c + d.r * 0.8);
          g.closePath();
          g.fillPath();
          break;
        case 'diamond':
          g.beginPath();
          g.moveTo(c, c - d.r);
          g.lineTo(c + d.r, c);
          g.lineTo(c, c + d.r);
          g.lineTo(c - d.r, c);
          g.closePath();
          g.fillPath();
          break;
        case 'hex':
          g.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i - Math.PI / 2;
            const px = c + Math.cos(a) * d.r;
            const py = c + Math.sin(a) * d.r;
            if (i === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
          }
          g.closePath();
          g.fillPath();
          break;
        case 'square':
          g.fillRect(c - d.r, c - d.r, d.r * 2, d.r * 2);
          break;
        case 'star':
          g.beginPath();
          for (let i = 0; i < 10; i++) {
            const a = (Math.PI / 5) * i - Math.PI / 2;
            const rr = i % 2 === 0 ? d.r : d.r * 0.45;
            const px = c + Math.cos(a) * rr;
            const py = c + Math.sin(a) * rr;
            if (i === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
          }
          g.closePath();
          g.fillPath();
          break;
      }

      // Core dot so every enemy reads as "alive"
      g.fillStyle(0x05060f, 0.85);
      g.fillCircle(c, c, Math.max(2, d.r * 0.22));

      g.generateTexture(d.key, size, size);
      g.destroy();
    }
  },

  // ── Projectiles ──────────────────────────────────────────────────────────
  projectiles(scene: Phaser.Scene): void {
    const defs: { key: string; w: number; h: number; tint: number; glow: number }[] = [
      { key: 'bullet_player', w: 6, h: 18, tint: 0x9ef7ff, glow: 0x4fd1ff },
      { key: 'bullet_player_heavy', w: 10, h: 26, tint: 0xffd166, glow: 0xff9f43 },
      { key: 'bullet_enemy', w: 7, h: 14, tint: 0xff5d73, glow: 0xff2e63 },
      { key: 'bullet_sniper', w: 5, h: 22, tint: 0xff9f43, glow: 0xff5d73 },
      { key: 'missile', w: 10, h: 22, tint: 0xffd166, glow: 0xff2e63 },
      { key: 'mine', w: 18, h: 18, tint: 0xff9f43, glow: 0xff2e63 },
    ];

    for (const d of defs) {
      if (scene.textures.exists(d.key)) continue;
      const pad = 10;
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      const cx = (d.w + pad * 2) / 2;
      const cy = (d.h + pad * 2) / 2;

      g.fillStyle(d.glow, 0.3);
      g.fillEllipse(cx, cy, d.w * 2.2, d.h * 1.5);
      g.fillStyle(d.tint, 1);
      g.fillEllipse(cx, cy, d.w, d.h);
      g.fillStyle(0xffffff, 0.9);
      g.fillEllipse(cx, cy - d.h * 0.15, d.w * 0.4, d.h * 0.4);

      g.generateTexture(d.key, d.w + pad * 2, d.h + pad * 2);
      g.destroy();
    }
  },

  // ── Pickups ──────────────────────────────────────────────────────────────
  pickups(scene: Phaser.Scene): void {
    const defs: { key: string; tint: number; label: string }[] = [
      { key: 'loot_common', tint: 0x9aa7bd, label: 'C' },
      { key: 'loot_uncommon', tint: 0x3ddc97, label: 'U' },
      { key: 'loot_rare', tint: 0x4fd1ff, label: 'R' },
      { key: 'loot_epic', tint: 0xb14aff, label: 'E' },
      { key: 'loot_legendary', tint: 0xffd166, label: 'L' },
      { key: 'loot_mythic', tint: 0xff2e63, label: 'M' },
      { key: 'powerup_heal', tint: 0x3ddc97, label: '+' },
      { key: 'powerup_shield', tint: 0x5ce1e6, label: 'S' },
      { key: 'powerup_damage', tint: 0xff5d73, label: 'D' },
      { key: 'powerup_firerate', tint: 0xffd166, label: 'F' },
      { key: 'powerup_speed', tint: 0x4fd1ff, label: '>' },
      { key: 'powerup_magnet', tint: 0xb14aff, label: 'M' },
      { key: 'powerup_invuln', tint: 0xffffff, label: 'I' },
      { key: 'powerup_scrap', tint: 0xff9f43, label: '$' },
    ];

    for (const d of defs) {
      if (scene.textures.exists(d.key)) continue;
      const size = 34;
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      const c = size / 2;

      g.fillStyle(d.tint, 0.25);
      g.fillCircle(c, c, 15);
      g.lineStyle(2, d.tint, 1);
      g.strokeCircle(c, c, 12);
      g.fillStyle(d.tint, 0.9);
      g.fillCircle(c, c, 7);

      g.generateTexture(d.key, size, size);
      g.destroy();
    }
  },

  // ── Particles ────────────────────────────────────────────────────────────
  particles(scene: Phaser.Scene): void {
    const defs: { key: string; tint: number; r: number }[] = [
      { key: 'p_spark', tint: 0x9ef7ff, r: 3 },
      { key: 'p_smoke', tint: 0x8fa3c8, r: 6 },
      { key: 'p_star', tint: 0xffffff, r: 2 },
      { key: 'p_ember', tint: 0xff9f43, r: 4 },
      { key: 'p_rift', tint: 0xb14aff, r: 5 },
    ];
    for (const d of defs) {
      if (scene.textures.exists(d.key)) continue;
      const size = d.r * 2 + 4;
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(d.tint, 1);
      g.fillCircle(size / 2, size / 2, d.r);
      g.generateTexture(d.key, size, size);
      g.destroy();
    }
  },

  // ── Boss parts ───────────────────────────────────────────────────────────
  bossParts(scene: Phaser.Scene): void {
    if (!scene.textures.exists('boss_core')) {
      const size = 64;
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xff2e63, 0.3);
      g.fillCircle(32, 32, 30);
      g.fillStyle(0xff2e63, 1);
      g.fillCircle(32, 32, 18);
      g.fillStyle(0xffffff, 0.9);
      g.fillCircle(32, 32, 8);
      g.generateTexture('boss_core', size, size);
      g.destroy();
    }

    if (!scene.textures.exists('boss_hull')) {
      const size = 220;
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      const c = size / 2;
      g.fillStyle(0x1b0b3a, 1);
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i - Math.PI / 2;
        const rr = i % 2 === 0 ? 100 : 74;
        const px = c + Math.cos(a) * rr;
        const py = c + Math.sin(a) * rr;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fillPath();
      g.lineStyle(4, 0xb14aff, 0.9);
      g.strokePath();
      g.fillStyle(0xb14aff, 0.35);
      g.fillCircle(c, c, 46);
      g.generateTexture('boss_hull', size, size);
      g.destroy();
    }

    if (!scene.textures.exists('laser_segment')) {
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xff2e63, 0.85);
      g.fillRect(0, 0, 8, 64);
      g.fillStyle(0xffffff, 0.9);
      g.fillRect(2, 0, 4, 64);
      g.generateTexture('laser_segment', 8, 64);
      g.destroy();
    }
  },

  // ── UI bits ──────────────────────────────────────────────────────────────
  uiBits(scene: Phaser.Scene): void {
    if (!scene.textures.exists('px')) {
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 0, 2, 2);
      g.generateTexture('px', 2, 2);
      g.destroy();
    }
    if (!scene.textures.exists('glow')) {
      const size = 128;
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      for (let i = 12; i > 0; i--) {
        g.fillStyle(0x4fd1ff, (i / 12) * 0.06);
        g.fillCircle(size / 2, size / 2, (size / 2) * (i / 12));
      }
      g.generateTexture('glow', size, size);
      g.destroy();
    }
  },
};

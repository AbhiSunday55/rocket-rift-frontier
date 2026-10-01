import { Rarity } from './rarity';

/**
 * Three-slot weapon system:
 *   PRIMARY   — your always-on gun (infinite ammo, scales with ship damage)
 *   SECONDARY — a cooldown-gated alternate fire (missiles, beams, mines)
 *   ULTIMATE  — a charge-meter super, built by dealing damage
 *
 * Every weapon is obtainable in-game. Rarity changes feel and flair, not
 * whether the weapon is usable.
 */
export type WeaponSlot = 'PRIMARY' | 'SECONDARY' | 'ULTIMATE';

export type WeaponPattern =
  | 'SINGLE'
  | 'DOUBLE'
  | 'SPREAD'
  | 'BEAM'
  | 'HOMING'
  | 'ORBITAL'
  | 'CHAIN'
  | 'MINE';

export interface WeaponDef {
  key: string;
  name: string;
  slot: WeaponSlot;
  pattern: WeaponPattern;
  rarity: Rarity;
  /** Damage multiplier applied to the ship's damage stat. */
  damageMultiplier: number;
  /** Shots per second, multiplied by the ship's fire rate. */
  fireRateMultiplier: number;
  /** Projectiles per volley. */
  projectiles: number;
  /** Total spread in degrees across the volley. */
  spreadDeg: number;
  /** Projectile lifetime in ms. */
  lifetimeMs: number;
  /** Projectile speed in px/frame. */
  speed: number;
  /** Cooldown between uses (SECONDARY/ULTIMATE only). */
  cooldownMs: number;
  /** Ultimate charge cost (0..100). */
  chargeCost: number;
  /** Pierces this many enemies before expiring. */
  pierce: number;
  /** Extra behaviour knobs. */
  mods: Record<string, number>;
  blurb: string;
}

export const WEAPONS: WeaponDef[] = [
  // ── Primaries ────────────────────────────────────────────────────────────
  {
    key: 'pulse_cannon',
    name: 'Pulse Cannon',
    slot: 'PRIMARY',
    pattern: 'SINGLE',
    rarity: Rarity.COMMON,
    damageMultiplier: 1.0,
    fireRateMultiplier: 1.0,
    projectiles: 1,
    spreadDeg: 0,
    lifetimeMs: 1100,
    speed: 13,
    cooldownMs: 0,
    chargeCost: 0,
    pierce: 0,
    mods: { knockback: 40 },
    blurb: 'Standard-issue autocannon. Reliable, cheap, never jams.',
  },
  {
    key: 'twin_repeater',
    name: 'Twin Repeater',
    slot: 'PRIMARY',
    pattern: 'DOUBLE',
    rarity: Rarity.UNCOMMON,
    damageMultiplier: 0.72,
    fireRateMultiplier: 1.35,
    projectiles: 2,
    spreadDeg: 4,
    lifetimeMs: 1000,
    speed: 14,
    cooldownMs: 0,
    chargeCost: 0,
    pierce: 0,
    mods: { knockback: 25 },
    blurb: 'Alternating barrels. Lower per-shot damage, far higher output.',
  },
  {
    key: 'scatter_blaster',
    name: 'Scatter Blaster',
    slot: 'PRIMARY',
    pattern: 'SPREAD',
    rarity: Rarity.RARE,
    damageMultiplier: 0.5,
    fireRateMultiplier: 0.85,
    projectiles: 5,
    spreadDeg: 34,
    lifetimeMs: 620,
    speed: 12,
    cooldownMs: 0,
    chargeCost: 0,
    pierce: 0,
    mods: { knockback: 90 },
    blurb: 'Close-range shredder. Devastating inside 200px, useless outside it.',
  },
  {
    key: 'rail_lance',
    name: 'Rail Lance',
    slot: 'PRIMARY',
    pattern: 'BEAM',
    rarity: Rarity.EPIC,
    damageMultiplier: 2.4,
    fireRateMultiplier: 0.45,
    projectiles: 1,
    spreadDeg: 0,
    lifetimeMs: 900,
    speed: 26,
    cooldownMs: 0,
    chargeCost: 0,
    pierce: 4,
    mods: { knockback: 120, shieldPierce: 1 },
    blurb: 'Hypervelocity slug. Punches through four hulls and ignores shields.',
  },
  {
    key: 'void_needler',
    name: 'Void Needler',
    slot: 'PRIMARY',
    pattern: 'CHAIN',
    rarity: Rarity.LEGENDARY,
    damageMultiplier: 0.9,
    fireRateMultiplier: 1.2,
    projectiles: 1,
    spreadDeg: 0,
    lifetimeMs: 1200,
    speed: 15,
    cooldownMs: 0,
    chargeCost: 0,
    pierce: 1,
    mods: { chainCount: 3, chainRange: 190, chainFalloff: 0.65 },
    blurb: 'Rift-forged needles that arc between clustered targets.',
  },

  // ── Secondaries ──────────────────────────────────────────────────────────
  {
    key: 'seeker_pod',
    name: 'Seeker Pod',
    slot: 'SECONDARY',
    pattern: 'HOMING',
    rarity: Rarity.UNCOMMON,
    damageMultiplier: 1.6,
    fireRateMultiplier: 1,
    projectiles: 3,
    spreadDeg: 60,
    lifetimeMs: 2600,
    speed: 7.5,
    cooldownMs: 4200,
    chargeCost: 0,
    pierce: 0,
    mods: { turnRate: 0.09, blastRadius: 60 },
    blurb: 'Fire-and-forget micro-missiles. They will find something.',
  },
  {
    key: 'arc_tesla',
    name: 'Arc Tesla',
    slot: 'SECONDARY',
    pattern: 'CHAIN',
    rarity: Rarity.RARE,
    damageMultiplier: 1.1,
    fireRateMultiplier: 1,
    projectiles: 1,
    spreadDeg: 0,
    lifetimeMs: 500,
    speed: 0,
    cooldownMs: 6000,
    chargeCost: 0,
    pierce: 0,
    mods: { chainCount: 6, chainRange: 260, chainFalloff: 0.8, stunMs: 400 },
    blurb: 'Instantaneous arc that stuns everything it touches.',
  },
  {
    key: 'mine_layer',
    name: 'Mine Layer',
    slot: 'SECONDARY',
    pattern: 'MINE',
    rarity: Rarity.RARE,
    damageMultiplier: 2.2,
    fireRateMultiplier: 1,
    projectiles: 4,
    spreadDeg: 360,
    lifetimeMs: 12000,
    speed: 2.0,
    cooldownMs: 8000,
    chargeCost: 0,
    pierce: 0,
    mods: { blastRadius: 110, armMs: 500 },
    blurb: 'Drops proximity mines. Perfect for kiting a swarm into a trap.',
  },

  // ── Ultimates ────────────────────────────────────────────────────────────
  {
    key: 'orbital_barrage',
    name: 'Orbital Barrage',
    slot: 'ULTIMATE',
    pattern: 'ORBITAL',
    rarity: Rarity.EPIC,
    damageMultiplier: 3.0,
    fireRateMultiplier: 1,
    projectiles: 14,
    spreadDeg: 360,
    lifetimeMs: 3000,
    speed: 9,
    cooldownMs: 0,
    chargeCost: 100,
    pierce: 0,
    mods: { blastRadius: 130, delayMs: 700 },
    blurb: 'Calls a saturation strike down on the whole sector.',
  },
  {
    key: 'rift_singularity',
    name: 'Rift Singularity',
    slot: 'ULTIMATE',
    pattern: 'ORBITAL',
    rarity: Rarity.MYTHIC,
    damageMultiplier: 4.5,
    fireRateMultiplier: 1,
    projectiles: 1,
    spreadDeg: 0,
    lifetimeMs: 5000,
    speed: 0,
    cooldownMs: 0,
    chargeCost: 100,
    pierce: 0,
    mods: { pullRadius: 420, pullForce: 2.4, tickDamage: 0.35, blastRadius: 300 },
    blurb: 'Collapses a singularity that drags everything in, then detonates.',
  },
];

export const WEAPON_BY_KEY: Record<string, WeaponDef> = Object.fromEntries(WEAPONS.map((w) => [w.key, w]));

export function getWeapon(key: string): WeaponDef {
  return WEAPON_BY_KEY[key] ?? WEAPONS[0];
}

export function weaponsForSlot(slot: WeaponSlot): WeaponDef[] {
  return WEAPONS.filter((w) => w.slot === slot);
}

export const DEFAULT_LOADOUT = {
  primary: 'pulse_cannon',
  secondary: 'seeker_pod',
  ultimate: 'orbital_barrage',
} as const;

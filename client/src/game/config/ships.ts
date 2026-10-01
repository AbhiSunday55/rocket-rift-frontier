import { Rarity } from './rarity';

/**
 * Ship stat block. Mirrors the on-chain `ShipNFT.ShipStats` struct exactly so a
 * ship can round-trip between the game and the chain without translation loss.
 */
export interface ShipStats {
  health: number;
  shield: number;
  damage: number;
  /** Displayed as-is (7 = 7.00). On-chain this is stored x100. */
  speed: number;
  /** Shots per second. On-chain x100. */
  fireRate: number;
  /** 0..1. On-chain in bps. */
  critChance: number;
  cargo: number;
}

export type ShipRole = 'STARTER' | 'BRAWLER' | 'SNIPER' | 'SKIRMISHER' | 'SUPPORT' | 'HAULER' | 'EXOTIC';

export interface ShipDef {
  key: string;
  name: string;
  role: ShipRole;
  rarity: Rarity;
  /** One-line pitch shown in the hangar. */
  blurb: string;
  stats: ShipStats;
  /** Free-to-play ships are earnable through progression, never purchase-only. */
  acquisition: 'STARTER' | 'PROGRESSION' | 'MISSION' | 'CRAFT' | 'MARKET';
  /** Cosmetic-only flag: true means the ship is a skin variant of another hull. */
  cosmeticOnly?: boolean;
  /** Special ability granted while flying this hull. */
  ability: ShipAbility;
  /** Hull silhouette parameters used by the procedural texture factory. */
  hull: { width: number; length: number; wings: number; accent: number };
}

export interface ShipAbility {
  key: string;
  name: string;
  description: string;
  cooldownMs: number;
  /** Effect descriptor consumed by WeaponSystem/Player. */
  effect: 'BURST' | 'SHIELD_BUBBLE' | 'TIME_DILATION' | 'MISSILE_SALVO' | 'REPAIR' | 'CLOAK' | 'OVERCHARGE';
  magnitude: number;
  durationMs: number;
}

/**
 * THE STARTER HULL — Raptor-X.
 * Health 100 / Shield 50 / Damage 10 / Speed 7 / Fire Rate 1.0 / Crit 5% / Cargo 10.
 * Every player begins here, and it stays viable all the way to endgame.
 */
export const RAPTOR_X: ShipDef = {
  key: 'raptor_x',
  name: 'Raptor-X',
  role: 'STARTER',
  rarity: Rarity.COMMON,
  blurb: 'The Frontier standard. Balanced, forgiving, and endlessly upgradeable.',
  stats: { health: 100, shield: 50, damage: 10, speed: 7, fireRate: 1.0, critChance: 0.05, cargo: 10 },
  acquisition: 'STARTER',
  ability: {
    key: 'burst',
    name: 'Overdrive Burst',
    description: 'Fires a 360° shockwave that damages and knocks back everything nearby.',
    cooldownMs: 9000,
    effect: 'BURST',
    magnitude: 2.2,
    durationMs: 400,
  },
  hull: { width: 34, length: 46, wings: 2, accent: 0xffd166 },
};

export const SHIPS: ShipDef[] = [
  RAPTOR_X,
  {
    key: 'lancer_mk2',
    name: 'Lancer Mk-II',
    role: 'SNIPER',
    rarity: Rarity.UNCOMMON,
    blurb: 'Long-barrel railgun hull. Slow to fire, brutal at range.',
    stats: { health: 85, shield: 40, damage: 22, speed: 6.4, fireRate: 0.6, critChance: 0.12, cargo: 8 },
    acquisition: 'PROGRESSION',
    ability: {
      key: 'overcharge',
      name: 'Rail Overcharge',
      description: 'Charges a piercing shot that ignores shields.',
      cooldownMs: 11000,
      effect: 'OVERCHARGE',
      magnitude: 4.0,
      durationMs: 1200,
    },
    hull: { width: 28, length: 58, wings: 2, accent: 0x4fd1ff },
  },
  {
    key: 'bulwark',
    name: 'Bulwark',
    role: 'BRAWLER',
    rarity: Rarity.RARE,
    blurb: 'Heavy plating and a shield projector. Built to hold the line.',
    stats: { health: 190, shield: 120, damage: 14, speed: 5.2, fireRate: 0.9, critChance: 0.04, cargo: 14 },
    acquisition: 'CRAFT',
    ability: {
      key: 'shield_bubble',
      name: 'Aegis Bubble',
      description: 'Projects an absorbing bubble that soaks incoming fire.',
      cooldownMs: 14000,
      effect: 'SHIELD_BUBBLE',
      magnitude: 90,
      durationMs: 5000,
    },
    hull: { width: 46, length: 44, wings: 4, accent: 0x3ddc97 },
  },
  {
    key: 'wraith',
    name: 'Wraith',
    role: 'SKIRMISHER',
    rarity: Rarity.EPIC,
    blurb: 'Phase-shifted interceptor. Fast, fragile, and nearly impossible to track.',
    stats: { health: 70, shield: 60, damage: 16, speed: 9.4, fireRate: 1.6, critChance: 0.18, cargo: 6 },
    acquisition: 'MISSION',
    ability: {
      key: 'cloak',
      name: 'Phase Cloak',
      description: 'Vanishes from enemy targeting and gains a damage bonus on exit.',
      cooldownMs: 12000,
      effect: 'CLOAK',
      magnitude: 1.8,
      durationMs: 3000,
    },
    hull: { width: 30, length: 50, wings: 3, accent: 0xb14aff },
  },
  {
    key: 'mender',
    name: 'Mender',
    role: 'SUPPORT',
    rarity: Rarity.RARE,
    blurb: 'Salvage rig with a nanite foundry. Repairs mid-fight, hauls more loot.',
    stats: { health: 110, shield: 70, damage: 9, speed: 6.8, fireRate: 1.1, critChance: 0.06, cargo: 22 },
    acquisition: 'CRAFT',
    ability: {
      key: 'repair',
      name: 'Nanite Bloom',
      description: 'Restores hull and shield over a short window.',
      cooldownMs: 13000,
      effect: 'REPAIR',
      magnitude: 45,
      durationMs: 3000,
    },
    hull: { width: 38, length: 42, wings: 2, accent: 0x5ce1e6 },
  },
  {
    key: 'hauler_ix',
    name: 'Hauler IX',
    role: 'HAULER',
    rarity: Rarity.UNCOMMON,
    blurb: 'Bulk freighter refit. Enormous cargo hold, modest guns.',
    stats: { health: 150, shield: 55, damage: 11, speed: 5.6, fireRate: 0.8, critChance: 0.03, cargo: 40 },
    acquisition: 'PROGRESSION',
    ability: {
      key: 'salvo',
      name: 'Cargo Salvo',
      description: 'Dumps a spread of improvised mines behind the hull.',
      cooldownMs: 10000,
      effect: 'MISSILE_SALVO',
      magnitude: 8,
      durationMs: 600,
    },
    hull: { width: 52, length: 62, wings: 2, accent: 0xff9f43 },
  },
  {
    key: 'chronos',
    name: 'Chronos',
    role: 'EXOTIC',
    rarity: Rarity.LEGENDARY,
    blurb: 'Prototype temporal drive. Bends local time around the hull.',
    stats: { health: 95, shield: 85, damage: 18, speed: 8.2, fireRate: 1.3, critChance: 0.15, cargo: 12 },
    acquisition: 'MISSION',
    ability: {
      key: 'dilation',
      name: 'Time Dilation',
      description: 'Slows every enemy in the sector while you keep full speed.',
      cooldownMs: 18000,
      effect: 'TIME_DILATION',
      magnitude: 0.35,
      durationMs: 4000,
    },
    hull: { width: 36, length: 54, wings: 4, accent: 0xffd166 },
  },
  {
    key: 'void_reaver',
    name: 'Void Reaver',
    role: 'EXOTIC',
    rarity: Rarity.MYTHIC,
    blurb: 'Salvaged from the Void Titan itself. Unstable, and it knows it.',
    stats: { health: 130, shield: 100, damage: 26, speed: 8.8, fireRate: 1.5, critChance: 0.22, cargo: 16 },
    acquisition: 'MISSION',
    ability: {
      key: 'rift_burst',
      name: 'Rift Cascade',
      description: 'Tears a rift that chains damage between every nearby enemy.',
      cooldownMs: 20000,
      effect: 'BURST',
      magnitude: 3.6,
      durationMs: 900,
    },
    hull: { width: 40, length: 60, wings: 6, accent: 0xff2e63 },
  },
];

export const SHIP_BY_KEY: Record<string, ShipDef> = Object.fromEntries(SHIPS.map((s) => [s.key, s]));

export function getShip(key: string): ShipDef {
  return SHIP_BY_KEY[key] ?? RAPTOR_X;
}

/**
 * Applies level growth to a base stat block. Growth is deliberately gentle —
 * a level-60 Raptor-X is strong but never invalidates a level-1 player's skill.
 */
export function statsAtLevel(base: ShipStats, level: number, growth: Record<string, number>): ShipStats {
  const l = Math.max(0, level - 1);
  return {
    health: Math.round(base.health * (1 + growth.health * l)),
    shield: Math.round(base.shield * (1 + growth.shield * l)),
    damage: Math.round(base.damage * (1 + growth.damage * l)),
    speed: Number((base.speed * (1 + growth.speed * l)).toFixed(2)),
    fireRate: Number((base.fireRate * (1 + growth.fireRate * l)).toFixed(2)),
    critChance: Math.min(0.75, Number((base.critChance + 0.002 * l).toFixed(4))),
    cargo: base.cargo + Math.floor(l / 4),
  };
}

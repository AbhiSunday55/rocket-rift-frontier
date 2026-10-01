import { PROGRESSION, ECONOMY } from '../config/constants';
import { Rarity } from '../config/rarity';
import { statsAtLevel, type ShipStats } from '../config/ships';
import type { UpgradeOption } from './types';

/**
 * XP, levels, and ship upgrades.
 *
 * Design rule: progression is *earned*, never bought. Rift Crystals (the premium
 * currency) can accelerate cosmetics and convenience, but every stat-bearing
 * upgrade in this file is purchasable with Scrap/Plasma earned by playing.
 */

export const UPGRADE_OPTIONS: UpgradeOption[] = [
  {
    key: 'health',
    name: 'Hull Plating',
    description: 'Reinforces the hull. +6% base health per point.',
    baseCost: 120,
    exponent: 1.35,
    perPoint: 0.06,
    maxPoints: 20,
  },
  {
    key: 'shield',
    name: 'Shield Capacitor',
    description: 'Larger shield buffer. +5% base shield per point.',
    baseCost: 140,
    exponent: 1.38,
    perPoint: 0.05,
    maxPoints: 20,
  },
  {
    key: 'damage',
    name: 'Weapon Core',
    description: 'Hotter plasma. +5% base damage per point.',
    baseCost: 180,
    exponent: 1.42,
    perPoint: 0.05,
    maxPoints: 20,
  },
  {
    key: 'speed',
    name: 'Thruster Tuning',
    description: 'Sharper handling. +1% base speed per point.',
    baseCost: 160,
    exponent: 1.4,
    perPoint: 0.01,
    maxPoints: 15,
  },
  {
    key: 'fireRate',
    name: 'Autoloader',
    description: 'Faster cycling. +2% base fire rate per point.',
    baseCost: 200,
    exponent: 1.45,
    perPoint: 0.02,
    maxPoints: 15,
  },
  {
    key: 'critChance',
    name: 'Targeting Array',
    description: 'Precision optics. +0.5% crit chance per point.',
    baseCost: 240,
    exponent: 1.5,
    perPoint: 0.005,
    maxPoints: 12,
  },
  {
    key: 'cargo',
    name: 'Cargo Bay',
    description: 'More hold space. +1 cargo per point.',
    baseCost: 100,
    exponent: 1.3,
    perPoint: 1,
    maxPoints: 20,
  },
];

export const UPGRADE_BY_KEY: Record<string, UpgradeOption> = Object.fromEntries(
  UPGRADE_OPTIONS.map((u) => [u.key, u])
);

/** XP needed to advance FROM `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  return Math.round(PROGRESSION.xpBase * Math.pow(level, PROGRESSION.xpExponent));
}

/** Total XP needed to reach `level` from level 1. */
export function totalXpForLevel(level: number): number {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += xpForLevel(l);
  return sum;
}

/**
 * Applies an XP gain, returning the new level/xp and how many levels were gained.
 * Handles multi-level gains in a single call (a boss kill can do that).
 */
export function applyXp(
  level: number,
  xp: number,
  gained: number
): { level: number; xp: number; levelsGained: number; xpToNext: number } {
  let newLevel = level;
  let newXp = xp + Math.max(0, Math.round(gained));
  let levelsGained = 0;

  while (newLevel < PROGRESSION.maxLevel) {
    const need = xpForLevel(newLevel);
    if (newXp < need) break;
    newXp -= need;
    newLevel++;
    levelsGained++;
  }

  if (newLevel >= PROGRESSION.maxLevel) newXp = 0;

  return { level: newLevel, xp: newXp, levelsGained, xpToNext: xpForLevel(newLevel) };
}

/** Cost of the NEXT upgrade point for a given stat at a given current level. */
export function upgradeCost(option: UpgradeOption, currentPoints: number): number {
  return Math.round(option.baseCost * Math.pow(currentPoints + 1, option.exponent));
}

/**
 * Recomputes a ship's effective stats from its base block plus upgrade points.
 * Pure function — the server runs the identical calculation.
 */
export function computeShipStats(
  base: ShipStats,
  shipLevel: number,
  upgrades: Partial<Record<UpgradeOption['key'], number>>
): ShipStats {
  const leveled = statsAtLevel(base, shipLevel, PROGRESSION.perLevel);
  const u = (k: UpgradeOption['key']) => upgrades[k] ?? 0;

  return {
    health: Math.round(leveled.health * (1 + UPGRADE_BY_KEY.health.perPoint * u('health'))),
    shield: Math.round(leveled.shield * (1 + UPGRADE_BY_KEY.shield.perPoint * u('shield'))),
    damage: Math.round(leveled.damage * (1 + UPGRADE_BY_KEY.damage.perPoint * u('damage'))),
    speed: Number((leveled.speed * (1 + UPGRADE_BY_KEY.speed.perPoint * u('speed'))).toFixed(2)),
    fireRate: Number((leveled.fireRate * (1 + UPGRADE_BY_KEY.fireRate.perPoint * u('fireRate'))).toFixed(2)),
    critChance: Math.min(0.75, Number((leveled.critChance + UPGRADE_BY_KEY.critChance.perPoint * u('critChance')).toFixed(4))),
    cargo: leveled.cargo + UPGRADE_BY_KEY.cargo.perPoint * u('cargo'),
  };
}

/** Season tier from season XP — drives the seasonal reward track. */
export function seasonTier(seasonXp: number): number {
  return Math.max(1, Math.floor(seasonXp / 2500) + 1);
}

export function seasonTierProgress(seasonXp: number): { tier: number; into: number; needed: number } {
  const tier = seasonTier(seasonXp);
  const into = seasonXp % 2500;
  return { tier, into, needed: 2500 };
}

/** Rift Crystals granted when a season tier is reached. */
export function seasonTierReward(tier: number): { riftCrystal: number; scrap: number; plasma: number } {
  return {
    riftCrystal: tier % 5 === 0 ? ECONOMY.riftCrystalPerSeasonTier : 0,
    scrap: 200 + tier * 40,
    plasma: 10 + tier * 3,
  };
}

/** Rarity of a ship's upgrade tier — purely a display flourish. */
export function upgradeTierRarity(totalPoints: number): Rarity {
  if (totalPoints >= 90) return Rarity.MYTHIC;
  if (totalPoints >= 70) return Rarity.LEGENDARY;
  if (totalPoints >= 50) return Rarity.EPIC;
  if (totalPoints >= 30) return Rarity.RARE;
  if (totalPoints >= 12) return Rarity.UNCOMMON;
  return Rarity.COMMON;
}

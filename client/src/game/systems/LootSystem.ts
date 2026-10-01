import { Rarity, rollRarity, RARITY } from '../config/rarity';
import { ECONOMY } from '../config/constants';
import type { LootDrop, PowerUpDef, PowerUpKind } from './types';

/**
 * Loot generation.
 *
 * Loot is the *gameplay* economy: everything dropped here is earnable by playing.
 * Nothing in this table is purchase-only, and nothing here is required to win.
 */

interface LootEntry {
  itemKey: string;
  name: string;
  category: LootDrop['category'];
  /** Base rarity weight tier — the actual roll can go higher with luck. */
  tier: Rarity;
  weight: number;
  /** Scrap value at COMMON; scaled by the rolled rarity. */
  baseValue: number;
}

const LOOT_TABLE: LootEntry[] = [
  // Materials — the crafting backbone. Always useful, never exciting.
  { itemKey: 'scrap_plate', name: 'Scrap Plate', category: 'EQUIPMENT', tier: Rarity.COMMON, weight: 220, baseValue: 6 },
  { itemKey: 'rift_alloy', name: 'Rift Alloy', category: 'EQUIPMENT', tier: Rarity.UNCOMMON, weight: 120, baseValue: 18 },
  { itemKey: 'plasma_cell', name: 'Plasma Cell', category: 'EQUIPMENT', tier: Rarity.UNCOMMON, weight: 110, baseValue: 22 },
  { itemKey: 'void_shard', name: 'Void Shard', category: 'EQUIPMENT', tier: Rarity.RARE, weight: 60, baseValue: 55 },
  { itemKey: 'titan_core', name: 'Titan Core', category: 'EQUIPMENT', tier: Rarity.LEGENDARY, weight: 8, baseValue: 320 },

  // Weapons
  { itemKey: 'pulse_cannon', name: 'Pulse Cannon', category: 'WEAPON', tier: Rarity.COMMON, weight: 90, baseValue: 30 },
  { itemKey: 'twin_repeater', name: 'Twin Repeater', category: 'WEAPON', tier: Rarity.UNCOMMON, weight: 55, baseValue: 70 },
  { itemKey: 'scatter_blaster', name: 'Scatter Blaster', category: 'WEAPON', tier: Rarity.RARE, weight: 30, baseValue: 150 },
  { itemKey: 'rail_lance', name: 'Rail Lance', category: 'WEAPON', tier: Rarity.EPIC, weight: 12, baseValue: 340 },
  { itemKey: 'void_needler', name: 'Void Needler', category: 'WEAPON', tier: Rarity.LEGENDARY, weight: 4, baseValue: 700 },

  // Skins — pure cosmetics. Never affect stats.
  { itemKey: 'skin_arctic', name: 'Arctic Camo', category: 'SKIN', tier: Rarity.UNCOMMON, weight: 45, baseValue: 40 },
  { itemKey: 'skin_ember', name: 'Ember Coat', category: 'SKIN', tier: Rarity.RARE, weight: 25, baseValue: 95 },
  { itemKey: 'skin_void', name: 'Void Etch', category: 'SKIN', tier: Rarity.EPIC, weight: 10, baseValue: 240 },
  { itemKey: 'skin_gilded', name: 'Gilded Hull', category: 'SKIN', tier: Rarity.LEGENDARY, weight: 3, baseValue: 520 },

  // Equipment — sidegrades with real trade-offs.
  { itemKey: 'shield_booster', name: 'Shield Booster', category: 'EQUIPMENT', tier: Rarity.UNCOMMON, weight: 50, baseValue: 60 },
  { itemKey: 'targeting_chip', name: 'Targeting Chip', category: 'EQUIPMENT', tier: Rarity.RARE, weight: 28, baseValue: 130 },
  { itemKey: 'cargo_expander', name: 'Cargo Expander', category: 'EQUIPMENT', tier: Rarity.UNCOMMON, weight: 48, baseValue: 55 },
  { itemKey: 'engine_overdrive', name: 'Engine Overdrive', category: 'EQUIPMENT', tier: Rarity.RARE, weight: 26, baseValue: 140 },

  // Collectibles — lore + flex. Soulbound once claimed.
  { itemKey: 'log_fragment', name: 'Station Log Fragment', category: 'COLLECTIBLE', tier: Rarity.RARE, weight: 22, baseValue: 110 },
  { itemKey: 'titan_sigil', name: 'Titan Sigil', category: 'COLLECTIBLE', tier: Rarity.EPIC, weight: 7, baseValue: 300 },

  // Accessories — small, always-on perks.
  { itemKey: 'magnet_coil', name: 'Magnet Coil', category: 'ACCESSORY', tier: Rarity.UNCOMMON, weight: 40, baseValue: 50 },
  { itemKey: 'lucky_charm', name: 'Lucky Charm', category: 'ACCESSORY', tier: Rarity.RARE, weight: 20, baseValue: 120 },
];

export const POWER_UPS: PowerUpDef[] = [
  { kind: 'HEAL', name: 'Repair Kit', description: 'Restores 35 hull.', durationMs: 0, magnitude: 35, tint: 0x3ddc97, weight: 100 },
  { kind: 'SHIELD', name: 'Shield Cell', description: 'Restores 40 shield.', durationMs: 0, magnitude: 40, tint: 0x5ce1e6, weight: 100 },
  { kind: 'DAMAGE_BOOST', name: 'Overcharge', description: '+50% damage for 12s.', durationMs: 12000, magnitude: 0.5, tint: 0xff5d73, weight: 70 },
  { kind: 'FIRE_RATE_BOOST', name: 'Rapid Loader', description: '+60% fire rate for 12s.', durationMs: 12000, magnitude: 0.6, tint: 0xffd166, weight: 70 },
  { kind: 'SPEED_BOOST', name: 'Afterburner', description: '+40% speed for 10s.', durationMs: 10000, magnitude: 0.4, tint: 0x4fd1ff, weight: 80 },
  { kind: 'MAGNET', name: 'Tractor Field', description: 'Pulls all loot to you for 15s.', durationMs: 15000, magnitude: 1, tint: 0xb14aff, weight: 60 },
  { kind: 'INVULN', name: 'Phase Shield', description: 'Invulnerable for 5s.', durationMs: 5000, magnitude: 1, tint: 0xffffff, weight: 30 },
  { kind: 'SCRAP_MULTIPLIER', name: 'Salvage Rig', description: 'Double scrap for 20s.', durationMs: 20000, magnitude: 2, tint: 0xff9f43, weight: 55 },
];

export const POWER_UP_BY_KIND: Record<PowerUpKind, PowerUpDef> = Object.fromEntries(
  POWER_UPS.map((p) => [p.kind, p])
) as Record<PowerUpKind, PowerUpDef>;

function weightedPick<T extends { weight: number }>(entries: T[], rng: () => number): T {
  const total = entries.reduce((s, e) => s + e.weight, 0);
  let roll = rng() * total;
  for (const e of entries) {
    roll -= e.weight;
    if (roll <= 0) return e;
  }
  return entries[entries.length - 1];
}

/**
 * Rolls a loot drop.
 *
 * @param luck       0..1 — raises the rarity ceiling (biome bonus + accessories).
 * @param maxRarity  Hard ceiling from the enemy that dropped it.
 * @param rng        Injectable RNG so a run can be replayed deterministically.
 */
export function rollLoot(
  luck: number,
  maxRarity: Rarity,
  rng: () => number = Math.random
): LootDrop | null {
  const entry = weightedPick(LOOT_TABLE, rng);
  let rarity = rollRarity(luck, rng);

  // Never exceed the source's ceiling, and never drop below the entry's tier.
  rarity = Math.min(rarity, maxRarity) as Rarity;
  rarity = Math.max(rarity, entry.tier) as Rarity;

  const value = Math.round(entry.baseValue * RARITY[rarity].statMultiplier);

  return {
    itemKey: entry.itemKey,
    name: entry.name,
    category: entry.category,
    rarity,
    quantity: 1,
    value,
  };
}

export function rollPowerUp(rng: () => number = Math.random): PowerUpDef {
  return weightedPick(POWER_UPS, rng);
}

/** Scrap awarded for a kill, before multipliers. */
export function scrapForKill(base: number, multiplier = 1): number {
  return Math.max(1, Math.round(base * multiplier));
}

/** Scrap awarded for picking up a loot drop. */
export function scrapForLoot(value: number, multiplier = 1): number {
  return Math.max(1, Math.round(value * ECONOMY.dismantleReturnRatio * multiplier));
}

export function lootTextureKey(rarity: Rarity): string {
  const map: Record<Rarity, string> = {
    [Rarity.COMMON]: 'loot_common',
    [Rarity.UNCOMMON]: 'loot_uncommon',
    [Rarity.RARE]: 'loot_rare',
    [Rarity.EPIC]: 'loot_epic',
    [Rarity.LEGENDARY]: 'loot_legendary',
    [Rarity.MYTHIC]: 'loot_mythic',
  };
  return map[rarity];
}

export function powerUpTextureKey(kind: PowerUpKind): string {
  const map: Record<PowerUpKind, string> = {
    HEAL: 'powerup_heal',
    SHIELD: 'powerup_shield',
    DAMAGE_BOOST: 'powerup_damage',
    FIRE_RATE_BOOST: 'powerup_firerate',
    SPEED_BOOST: 'powerup_speed',
    MAGNET: 'powerup_magnet',
    INVULN: 'powerup_invuln',
    SCRAP_MULTIPLIER: 'powerup_scrap',
  };
  return map[kind];
}

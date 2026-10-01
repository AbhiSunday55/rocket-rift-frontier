import { Rarity } from '../config/rarity';
import type { CraftingRecipe } from './types';

/**
 * Crafting.
 *
 * Every recipe consumes materials that drop from normal play. Crafting is the
 * main way a free-to-play player reaches high-rarity gear without ever touching
 * the marketplace.
 */

export const RECIPES: CraftingRecipe[] = [
  {
    key: 'craft_twin_repeater',
    name: 'Twin Repeater',
    output: { itemKey: 'twin_repeater', category: 'WEAPON', rarity: Rarity.UNCOMMON, quantity: 1 },
    inputs: [
      { itemKey: 'scrap_plate', quantity: 6 },
      { itemKey: 'rift_alloy', quantity: 2 },
    ],
    cost: { scrap: 150 },
    craftTimeSec: 30,
    requiredLevel: 3,
    blurb: 'Two barrels, one trigger. A solid step up from the stock cannon.',
  },
  {
    key: 'craft_scatter_blaster',
    name: 'Scatter Blaster',
    output: { itemKey: 'scatter_blaster', category: 'WEAPON', rarity: Rarity.RARE, quantity: 1 },
    inputs: [
      { itemKey: 'scrap_plate', quantity: 10 },
      { itemKey: 'rift_alloy', quantity: 5 },
      { itemKey: 'plasma_cell', quantity: 3 },
    ],
    cost: { scrap: 400, plasma: 10 },
    craftTimeSec: 120,
    requiredLevel: 8,
    blurb: 'Close-quarters shredder. Bring it to a knife fight.',
  },
  {
    key: 'craft_rail_lance',
    name: 'Rail Lance',
    output: { itemKey: 'rail_lance', category: 'WEAPON', rarity: Rarity.EPIC, quantity: 1 },
    inputs: [
      { itemKey: 'rift_alloy', quantity: 12 },
      { itemKey: 'plasma_cell', quantity: 8 },
      { itemKey: 'void_shard', quantity: 3 },
    ],
    cost: { scrap: 1200, plasma: 45 },
    craftTimeSec: 600,
    requiredLevel: 18,
    blurb: 'Hypervelocity slug thrower. Punches through anything in a line.',
  },
  {
    key: 'craft_shield_booster',
    name: 'Shield Booster',
    output: { itemKey: 'shield_booster', category: 'EQUIPMENT', rarity: Rarity.UNCOMMON, quantity: 1 },
    inputs: [
      { itemKey: 'scrap_plate', quantity: 4 },
      { itemKey: 'plasma_cell', quantity: 2 },
    ],
    cost: { scrap: 120 },
    craftTimeSec: 20,
    requiredLevel: 2,
    blurb: 'Auxiliary capacitor. More shield, slightly slower recharge.',
  },
  {
    key: 'craft_targeting_chip',
    name: 'Targeting Chip',
    output: { itemKey: 'targeting_chip', category: 'EQUIPMENT', rarity: Rarity.RARE, quantity: 1 },
    inputs: [
      { itemKey: 'rift_alloy', quantity: 4 },
      { itemKey: 'void_shard', quantity: 1 },
    ],
    cost: { scrap: 350, plasma: 12 },
    craftTimeSec: 90,
    requiredLevel: 10,
    blurb: 'Predictive targeting firmware. Crit chance up, hull down.',
  },
  {
    key: 'craft_engine_overdrive',
    name: 'Engine Overdrive',
    output: { itemKey: 'engine_overdrive', category: 'EQUIPMENT', rarity: Rarity.RARE, quantity: 1 },
    inputs: [
      { itemKey: 'rift_alloy', quantity: 5 },
      { itemKey: 'plasma_cell', quantity: 4 },
    ],
    cost: { scrap: 380, plasma: 14 },
    craftTimeSec: 90,
    requiredLevel: 10,
    blurb: 'Overclocked injectors. Faster, but the hull runs hot.',
  },
  {
    key: 'craft_cargo_expander',
    name: 'Cargo Expander',
    output: { itemKey: 'cargo_expander', category: 'EQUIPMENT', rarity: Rarity.UNCOMMON, quantity: 1 },
    inputs: [
      { itemKey: 'scrap_plate', quantity: 8 },
      { itemKey: 'rift_alloy', quantity: 2 },
    ],
    cost: { scrap: 200 },
    craftTimeSec: 45,
    requiredLevel: 5,
    blurb: 'Folding hold. Haul more loot per run.',
  },
  {
    key: 'craft_magnet_coil',
    name: 'Magnet Coil',
    output: { itemKey: 'magnet_coil', category: 'ACCESSORY', rarity: Rarity.UNCOMMON, quantity: 1 },
    inputs: [
      { itemKey: 'rift_alloy', quantity: 3 },
      { itemKey: 'plasma_cell', quantity: 1 },
    ],
    cost: { scrap: 180 },
    craftTimeSec: 40,
    requiredLevel: 4,
    blurb: 'Widens your pickup radius. Never miss a drop again.',
  },
  {
    key: 'craft_lucky_charm',
    name: 'Lucky Charm',
    output: { itemKey: 'lucky_charm', category: 'ACCESSORY', rarity: Rarity.RARE, quantity: 1 },
    inputs: [
      { itemKey: 'void_shard', quantity: 2 },
      { itemKey: 'rift_alloy', quantity: 4 },
    ],
    cost: { scrap: 500, plasma: 20 },
    craftTimeSec: 180,
    requiredLevel: 12,
    blurb: 'Biases every loot roll upward. Subtle, and very real.',
  },
  {
    key: 'craft_skin_ember',
    name: 'Ember Coat',
    output: { itemKey: 'skin_ember', category: 'SKIN', rarity: Rarity.RARE, quantity: 1 },
    inputs: [
      { itemKey: 'plasma_cell', quantity: 6 },
      { itemKey: 'void_shard', quantity: 1 },
    ],
    cost: { scrap: 300, plasma: 15 },
    craftTimeSec: 60,
    requiredLevel: 6,
    blurb: 'Cosmetic only. Looks like it is still burning.',
  },
  {
    key: 'craft_skin_void',
    name: 'Void Etch',
    output: { itemKey: 'skin_void', category: 'SKIN', rarity: Rarity.EPIC, quantity: 1 },
    inputs: [
      { itemKey: 'void_shard', quantity: 5 },
      { itemKey: 'titan_core', quantity: 1 },
    ],
    cost: { scrap: 1500, plasma: 60 },
    craftTimeSec: 900,
    requiredLevel: 22,
    blurb: 'Cosmetic only. The etchings move when you are not looking.',
  },
];

export const RECIPE_BY_KEY: Record<string, CraftingRecipe> = Object.fromEntries(RECIPES.map((r) => [r.key, r]));

export interface CraftCheck {
  ok: boolean;
  reason?: string;
  missing: { itemKey: string; need: number; have: number }[];
}

/**
 * Validates a craft against the player's materials, currency, and level.
 * The server re-runs this exact check before granting the output.
 */
export function canCraft(
  recipe: CraftingRecipe,
  materials: Record<string, number>,
  currency: { scrap: number; plasma: number },
  playerLevel: number
): CraftCheck {
  if (playerLevel < recipe.requiredLevel) {
    return { ok: false, reason: `Requires level ${recipe.requiredLevel}`, missing: [] };
  }

  const missing = recipe.inputs
    .map((i) => ({ itemKey: i.itemKey, need: i.quantity, have: materials[i.itemKey] ?? 0 }))
    .filter((m) => m.have < m.need);

  if (missing.length) return { ok: false, reason: 'Missing materials', missing };

  if ((recipe.cost.scrap ?? 0) > currency.scrap) {
    return { ok: false, reason: 'Not enough Scrap', missing: [] };
  }
  if ((recipe.cost.plasma ?? 0) > currency.plasma) {
    return { ok: false, reason: 'Not enough Plasma', missing: [] };
  }

  return { ok: true, missing: [] };
}

/** Consumes the inputs, returning the new material map. */
export function consumeInputs(
  recipe: CraftingRecipe,
  materials: Record<string, number>
): Record<string, number> {
  const next = { ...materials };
  for (const i of recipe.inputs) {
    next[i.itemKey] = Math.max(0, (next[i.itemKey] ?? 0) - i.quantity);
    if (next[i.itemKey] === 0) delete next[i.itemKey];
  }
  return next;
}

/** Recipes the player can currently see (level-gated). */
export function visibleRecipes(playerLevel: number): CraftingRecipe[] {
  return RECIPES.filter((r) => r.requiredLevel <= playerLevel + 3);
}

import { Rarity, RARITY } from '../config/rarity';
import { ECONOMY } from '../config/constants';
import type { InventoryItem, ItemCategory, ItemState, LootDrop } from './types';

/**
 * Inventory management.
 *
 * Ownership states are the bridge between the game and Web3:
 *   LOCKED    — cannot leave the account (starter gear, soulbound collectibles)
 *   TRADEABLE — can be listed on the marketplace or offered in a P2P trade
 *   LISTED    — currently escrowed in a marketplace listing
 *   EQUIPPED  — currently in a loadout slot
 *
 * The client only *proposes* state changes; the server validates and persists.
 */

export function makeItemId(): string {
  return `it_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Converts a loot drop into an inventory entry. */
export function itemFromLoot(drop: LootDrop, state: ItemState = 'TRADEABLE'): InventoryItem {
  return {
    id: makeItemId(),
    itemKey: drop.itemKey,
    name: drop.name,
    category: drop.category,
    rarity: drop.rarity,
    state,
    quantity: drop.quantity,
    level: 1,
    stats: {},
    acquiredVia: 'LOOT',
    acquiredAt: Date.now(),
  };
}

/**
 * Adds an item, stacking where the category allows it.
 * Materials and consumables stack; weapons/skins/ships do not.
 */
export function addItem(inventory: InventoryItem[], item: InventoryItem): InventoryItem[] {
  const stackable = item.category === 'EQUIPMENT' || item.category === 'COLLECTIBLE';
  if (stackable) {
    const existing = inventory.find(
      (i) => i.itemKey === item.itemKey && i.rarity === item.rarity && i.state === item.state
    );
    if (existing) {
      return inventory.map((i) =>
        i.id === existing.id ? { ...i, quantity: i.quantity + item.quantity } : i
      );
    }
  }
  return [...inventory, item];
}

export function removeItem(inventory: InventoryItem[], itemId: string, quantity = 1): InventoryItem[] {
  return inventory
    .map((i) => (i.id === itemId ? { ...i, quantity: i.quantity - quantity } : i))
    .filter((i) => i.quantity > 0);
}

export function setItemState(inventory: InventoryItem[], itemId: string, state: ItemState): InventoryItem[] {
  return inventory.map((i) => (i.id === itemId ? { ...i, state } : i));
}

/** Material counts keyed by itemKey — the shape crafting consumes. */
export function materialCounts(inventory: InventoryItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of inventory) {
    if (i.category === 'EQUIPMENT' || i.category === 'COLLECTIBLE') {
      out[i.itemKey] = (out[i.itemKey] ?? 0) + i.quantity;
    }
  }
  return out;
}

/** Scrap returned when dismantling an item. */
export function dismantleValue(item: InventoryItem): number {
  const base = RARITY[item.rarity].dismantleValue;
  return Math.round(base * item.quantity * ECONOMY.dismantleReturnRatio * 2);
}

/**
 * Dismantling is blocked for LOCKED and LISTED items — you cannot destroy
 * something you do not control, and you cannot destroy something in escrow.
 */
export function canDismantle(item: InventoryItem): { ok: boolean; reason?: string } {
  if (item.state === 'LOCKED') return { ok: false, reason: 'Item is locked to your account' };
  if (item.state === 'LISTED') return { ok: false, reason: 'Item is listed on the marketplace' };
  if (item.state === 'EQUIPPED') return { ok: false, reason: 'Unequip the item first' };
  return { ok: true };
}

export function canList(item: InventoryItem): { ok: boolean; reason?: string } {
  if (item.state === 'LOCKED') return { ok: false, reason: 'Item is locked to your account' };
  if (item.state === 'LISTED') return { ok: false, reason: 'Item is already listed' };
  if (item.state === 'EQUIPPED') return { ok: false, reason: 'Unequip the item first' };
  return { ok: true };
}

export function canTrade(item: InventoryItem): { ok: boolean; reason?: string } {
  if (item.state === 'LOCKED') return { ok: false, reason: 'Item is locked to your account' };
  if (item.state === 'LISTED') return { ok: false, reason: 'Item is listed on the marketplace' };
  return { ok: true };
}

export function filterByCategory(inventory: InventoryItem[], category: ItemCategory | 'ALL'): InventoryItem[] {
  return category === 'ALL' ? inventory : inventory.filter((i) => i.category === category);
}

export function sortInventory(
  inventory: InventoryItem[],
  by: 'RARITY' | 'NEWEST' | 'NAME' | 'VALUE'
): InventoryItem[] {
  const copy = [...inventory];
  switch (by) {
    case 'RARITY':
      return copy.sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name));
    case 'NEWEST':
      return copy.sort((a, b) => b.acquiredAt - a.acquiredAt);
    case 'NAME':
      return copy.sort((a, b) => a.name.localeCompare(b.name));
    case 'VALUE':
      return copy.sort((a, b) => dismantleValue(b) - dismantleValue(a));
    default:
      return copy;
  }
}

/** Total inventory value — shown on the profile screen. */
export function inventoryValue(inventory: InventoryItem[]): number {
  return inventory.reduce((sum, i) => sum + dismantleValue(i), 0);
}

/** Count of items by rarity — drives the collection progress bar. */
export function rarityBreakdown(inventory: InventoryItem[]): Record<Rarity, number> {
  const out = {
    [Rarity.COMMON]: 0,
    [Rarity.UNCOMMON]: 0,
    [Rarity.RARE]: 0,
    [Rarity.EPIC]: 0,
    [Rarity.LEGENDARY]: 0,
    [Rarity.MYTHIC]: 0,
  } as Record<Rarity, number>;
  for (const i of inventory) out[i.rarity] += i.quantity;
  return out;
}

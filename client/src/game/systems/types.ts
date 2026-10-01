/**
 * Shared runtime types for the game layer.
 *
 * These are the *runtime* shapes (live entities, session state). The static
 * design data lives in `game/config/*`.
 */

import type { Rarity } from '../config/rarity';
import type { ShipStats } from '../config/ships';
import type { Biome } from '../config/sectors';

export type ItemCategory = 'SHIP' | 'WEAPON' | 'SKIN' | 'EQUIPMENT' | 'COLLECTIBLE' | 'ACCESSORY';

/**
 * Ownership state of an inventory entry. Mirrors the DB `item_state` enum.
 *   LOCKED    — bound to the account (starter gear, soulbound collectibles)
 *   TRADEABLE — free to list or trade
 *   LISTED    — escrowed on the marketplace
 *   EQUIPPED  — currently in a loadout slot
 */
export type ItemState = 'LOCKED' | 'TRADEABLE' | 'LISTED' | 'EQUIPPED';

export interface InventoryItem {
  /** Client-side unique id (server assigns the authoritative one). */
  id: string;
  itemKey: string;
  name: string;
  category: ItemCategory;
  rarity: Rarity;
  state: ItemState;
  quantity: number;
  level: number;
  stats: Record<string, number>;
  /** On-chain token id, if this item has been minted. */
  tokenId?: string;
  chainId?: number;
  acquiredVia: 'LOOT' | 'CRAFT' | 'MISSION' | 'MARKET' | 'TRADE' | 'MINT';
  acquiredAt: number;
}

export interface OwnedShip {
  id: string;
  shipKey: string;
  nickname?: string;
  rarity: Rarity;
  level: number;
  stats: ShipStats;
  upgradePoints: number;
  tokenId?: string;
  chainId?: number;
  isStarter: boolean;
}

export interface Loadout {
  primary: string;
  secondary: string;
  ultimate: string;
  skin?: string;
  equipment: string[];
  accessory: string[];
}

export interface PlayerProfile {
  /** Local player id; replaced by the server id once authenticated. */
  id: string;
  walletAddress?: string;
  displayName: string;
  level: number;
  xp: number;
  scrap: number;
  plasma: number;
  riftCrystal: number;
  seasonId: number;
  seasonXp: number;
  equippedShipId: string;
  ships: OwnedShip[];
  inventory: InventoryItem[];
  loadout: Loadout;
  /** Aggregate stats for the profile screen. */
  stats: PlayerStats;
  createdAt: number;
}

export interface PlayerStats {
  runsPlayed: number;
  bestScore: number;
  bestSector: number;
  totalKills: number;
  totalBossesKilled: number;
  totalPlaytimeMs: number;
  totalLootValue: number;
}

export interface MissionDef {
  key: string;
  name: string;
  description: string;
  kind: 'DAILY' | 'WEEKLY' | 'SPECIAL' | 'SEASONAL';
  /** What the player must do. */
  objective: MissionObjective;
  target: number;
  rewards: MissionRewards;
  /** Season this mission belongs to (SEASONAL only). */
  seasonId?: number;
}

export type MissionObjective =
  | 'KILL_ENEMIES'
  | 'KILL_BOSSES'
  | 'CLEAR_SECTORS'
  | 'COLLECT_SCRAP'
  | 'COLLECT_LOOT'
  | 'DEAL_DAMAGE'
  | 'SURVIVE_MS'
  | 'CRAFT_ITEMS'
  | 'REACH_SECTOR'
  | 'USE_ABILITY';

export interface MissionRewards {
  xp?: number;
  scrap?: number;
  plasma?: number;
  riftCrystal?: number;
  items?: { itemKey: string; rarity: Rarity; quantity: number }[];
}

export interface MissionProgress {
  missionKey: string;
  progress: number;
  target: number;
  completed: boolean;
  claimed: boolean;
  periodKey: string;
}

export interface CraftingRecipe {
  key: string;
  name: string;
  /** Output item. */
  output: { itemKey: string; category: ItemCategory; rarity: Rarity; quantity: number };
  /** Input materials. */
  inputs: { itemKey: string; quantity: number }[];
  /** Currency cost. */
  cost: { scrap?: number; plasma?: number };
  /** Seconds to craft (0 = instant). */
  craftTimeSec: number;
  /** Player level required. */
  requiredLevel: number;
  blurb: string;
}

export interface UpgradeOption {
  key: 'health' | 'shield' | 'damage' | 'speed' | 'fireRate' | 'critChance' | 'cargo';
  name: string;
  description: string;
  /** Cost curve: cost = base * (level+1)^exponent. */
  baseCost: number;
  exponent: number;
  /** Stat gain per upgrade point. */
  perPoint: number;
  maxPoints: number;
}

/** A single run's live state — the thing the anti-cheat layer validates. */
export interface RunState {
  sessionId: string;
  seed: number;
  sectorIndex: number;
  biome: Biome;
  isBoss: boolean;
  startedAt: number;
  score: number;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  lootValue: number;
  xpGained: number;
  scrapGained: number;
  plasmaGained: number;
  abilitiesUsed: number;
  /** Rolling per-second buckets used by the score-density check. */
  scoreBuckets: number[];
  killBuckets: number[];
}

export interface RunResult {
  sessionId: string;
  seed: number;
  sectorReached: number;
  score: number;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  lootValue: number;
  xpGained: number;
  scrapGained: number;
  plasmaGained: number;
  durationMs: number;
  bossKilled: boolean;
  /** HMAC signature over the canonical payload — verified server-side. */
  signature: string;
  payload: string;
  /** Client-side pre-check result; the server re-runs its own. */
  clientFlagged: boolean;
  clientFlagReason?: string;
}

export interface LootDrop {
  itemKey: string;
  name: string;
  category: ItemCategory;
  rarity: Rarity;
  quantity: number;
  /** Scrap value if dismantled. */
  value: number;
}

export type PowerUpKind =
  | 'HEAL'
  | 'SHIELD'
  | 'DAMAGE_BOOST'
  | 'FIRE_RATE_BOOST'
  | 'SPEED_BOOST'
  | 'MAGNET'
  | 'INVULN'
  | 'SCRAP_MULTIPLIER';

export interface PowerUpDef {
  kind: PowerUpKind;
  name: string;
  description: string;
  durationMs: number;
  magnitude: number;
  tint: number;
  weight: number;
}

export interface GameSettings {
  musicVolume: number;
  sfxVolume: number;
  screenShake: boolean;
  showDamageNumbers: boolean;
  reducedMotion: boolean;
  virtualJoystick: 'AUTO' | 'ALWAYS' | 'NEVER';
}

export interface SaveData {
  version: number;
  profile: PlayerProfile;
  missions: MissionProgress[];
  settings: GameSettings;
  /** Crafting jobs in flight. */
  crafting: { recipeKey: string; startedAt: number; completesAt: number }[];
  lastSavedAt: number;
}
